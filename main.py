from __future__ import annotations

import json
import os
import sys
import threading
import ctypes
from pathlib import Path
from typing import Any

import webview

from pwdmg_core.api import PasswordManagerApi
from pwdmg_core.native_host import main as native_host_main
from pwdmg_core.native_install import disable_plugin_listener, enable_plugin_listener, plugin_listener_state
from pwdmg_core.paths import DEFAULT_DESKTOP_CONFIG, DESKTOP_CONFIG_FILE, ensure_app_dir


_desktop_window: webview.Window | None = None
_desktop_state: "DesktopWindowState | None" = None


class DesktopPasswordManagerApi(PasswordManagerApi):
    def getPluginListenerState(self) -> dict[str, Any]:
        try:
            return {"ok": True, "data": plugin_listener_state()}
        except Exception as exc:
            return {"ok": False, "code": "PLUGIN_LISTENER_ERROR", "message": str(exc)}

    def enablePluginListener(self, extensionId: str, browsers: list[str] | None = None) -> dict[str, Any]:
        try:
            return {"ok": True, "data": enable_plugin_listener(extensionId, browsers)}
        except Exception as exc:
            return {"ok": False, "code": "PLUGIN_LISTENER_ERROR", "message": str(exc)}

    def disablePluginListener(self) -> dict[str, Any]:
        try:
            return {"ok": True, "data": disable_plugin_listener()}
        except Exception as exc:
            return {"ok": False, "code": "PLUGIN_LISTENER_ERROR", "message": str(exc)}

    def safeExit(self) -> dict[str, Any]:
        try:
            window = _desktop_window
            state = _desktop_state
            if window is not None and state is not None:
                state.save_window(window)
            if window is not None:
                timer = threading.Timer(0.05, window.destroy)
                timer.daemon = True
                timer.start()
            return {"ok": True, "data": None}
        except Exception as exc:
            return {"ok": False, "code": "EXIT_FAILED", "message": str(exc)}


def to_int(value: Any, default: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def hide_packaged_console() -> None:
    if os.name != "nt" or not getattr(sys, "frozen", False):
        return
    try:
        hwnd = ctypes.windll.kernel32.GetConsoleWindow()
        if hwnd:
            ctypes.windll.user32.ShowWindow(hwnd, 0)
    except Exception:
        pass


def normalize_desktop_config(config: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(DEFAULT_DESKTOP_CONFIG)
    normalized.update(config)

    width = to_int(normalized.get("width"), DEFAULT_DESKTOP_CONFIG["width"])
    height = to_int(normalized.get("height"), DEFAULT_DESKTOP_CONFIG["height"])
    x_position = to_int(normalized.get("x_position"), DEFAULT_DESKTOP_CONFIG["x_position"])
    y_position = to_int(normalized.get("y_position"), DEFAULT_DESKTOP_CONFIG["y_position"])

    return {
        "appname": DEFAULT_DESKTOP_CONFIG["appname"],
        "width": int(width),
        "height": int(height),
        "x_position": int(x_position),
        "y_position": int(y_position),
    }


def read_window_config(window: webview.Window) -> dict[str, int]:
    return {
        "width": int(window.width),
        "height": int(window.height),
        "x_position": int(window.x),
        "y_position": int(window.y),
    }


def get_pywebview_startup_config(config: dict[str, Any]) -> dict[str, int]:
    return {
        "width": to_int(config.get("width"), DEFAULT_DESKTOP_CONFIG["width"]),
        "height": to_int(config.get("height"), DEFAULT_DESKTOP_CONFIG["height"]),
        "x_position": to_int(config.get("x_position"), DEFAULT_DESKTOP_CONFIG["x_position"]),
        "y_position": to_int(config.get("y_position"), DEFAULT_DESKTOP_CONFIG["y_position"]),
    }


def load_desktop_config() -> dict:
    ensure_app_dir()
    config: dict[str, Any] = {}
    if DESKTOP_CONFIG_FILE.exists():
        try:
            saved_config = json.loads(DESKTOP_CONFIG_FILE.read_text(encoding="utf-8"))
            if isinstance(saved_config, dict):
                config.update(saved_config)
        except (OSError, ValueError, TypeError):
            pass
    return normalize_desktop_config(config)


def write_desktop_config(config: dict[str, Any]) -> None:
    ensure_app_dir()
    DESKTOP_CONFIG_FILE.write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding="utf-8")


class DesktopWindowState:
    def __init__(self, initial_config: dict[str, Any]) -> None:
        self._lock = threading.Lock()
        self._config = normalize_desktop_config(initial_config)
        self._save_timer: threading.Timer | None = None
        self._pending_config: dict[str, Any] = {}

    def schedule_save_window(
        self,
        window: webview.Window,
        delay: float = 1.0,
    ) -> None:
        try:
            next_config = read_window_config(window)
        except Exception:
            return
        self._schedule_save(next_config, delay)

    def _schedule_save(self, next_config: dict[str, Any], delay: float) -> None:
        with self._lock:
            self._pending_config.update(next_config)
            if self._save_timer:
                self._save_timer.cancel()
            self._save_timer = threading.Timer(delay, self.flush_pending_config)
            self._save_timer.daemon = True
            self._save_timer.start()

    def flush_pending_config(self) -> None:
        with self._lock:
            pending_config = dict(self._pending_config)
            self._pending_config.clear()
            self._save_timer = None
            if pending_config:
                self._config.update(pending_config)
                self._write_locked()

    def save_window(self, window: webview.Window) -> None:
        with self._lock:
            if self._save_timer:
                self._save_timer.cancel()
                self._save_timer = None
            self._pending_config.clear()
        try:
            next_config = read_window_config(window)
        except Exception:
            return

        with self._lock:
            self._config.update(next_config)
            self._write_locked()

    def _write_locked(self) -> None:
        self._config = normalize_desktop_config(self._config)
        write_desktop_config(self._config)


def record_initial_desktop_config(window: webview.Window, _state: DesktopWindowState) -> None:
    if not window.events.shown.wait(10):
        return
    window.events.closed.wait()


def bind_desktop_config_events(window: webview.Window, state: DesktopWindowState) -> None:
    def on_resize(_width: int, _height: int) -> None:
        state.schedule_save_window(window)

    def on_move(_x_position: int, _y_position: int) -> None:
        state.schedule_save_window(window)

    def on_closing(*_args: Any) -> None:
        state.save_window(window)

    window.events.resized += on_resize
    window.events.moved += on_move
    window.events.closing += on_closing


def resolve_frontend_entry() -> str:
    root = Path(__file__).resolve().parent
    desktop_dist_entry = root / "front" / "dist" / "desktop" / "index.html"
    legacy_dist_entry = root / "front" / "dist" / "index.html"
    source_entry = root / "front" / "index.html"
    if desktop_dist_entry.exists():
        return str(desktop_dist_entry)
    if legacy_dist_entry.exists():
        return str(legacy_dist_entry)
    return str(source_entry)


def main() -> None:
    global _desktop_window, _desktop_state

    hide_packaged_console()
    config = load_desktop_config()
    startup_config = get_pywebview_startup_config(config)
    webview_storage_dir = ensure_app_dir() / "webview_storage"
    webview_storage_dir.mkdir(parents=True, exist_ok=True)
    desktop_state = DesktopWindowState(config)
    window = webview.create_window(
        config.get("appname", DEFAULT_DESKTOP_CONFIG["appname"]),
        resolve_frontend_entry(),
        js_api=DesktopPasswordManagerApi(),
        width=startup_config["width"],
        height=startup_config["height"],
        x=startup_config["x_position"],
        y=startup_config["y_position"],
        resizable=True,
    )
    _desktop_window = window
    _desktop_state = desktop_state
    bind_desktop_config_events(window, desktop_state)
    webview.start(
        record_initial_desktop_config,
        (window, desktop_state),
        debug=False,
        private_mode=False,
        storage_path=str(webview_storage_dir),
    )


if __name__ == "__main__":
    if "--native-host" in sys.argv:
        native_host_main()
    else:
        main()
