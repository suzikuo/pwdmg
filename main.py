from __future__ import annotations

import hashlib
import json
import os
import shutil
import sys
import threading
from pathlib import Path
from typing import Any

import webview

from pwdmg_core.paths import (
    DEFAULT_DESKTOP_CONFIG,
    DESKTOP_CONFIG_FILE,
    LEGACY_LOCAL_STORAGE_FILE,
    VAULT_FILE,
    ensure_app_dir,
)
from pwdmg_core.version import APP_VERSION

_desktop_window: webview.Window | None = None
_desktop_state: "DesktopWindowState | None" = None
WEBVIEW_CACHE_STATE_FILE = "frontend_cache_state.json"
WEBVIEW_CACHE_DIR_NAMES = {
    "BrowserMetrics",
    "Cache",
    "CacheStorage",
    "Code Cache",
    "DawnCache",
    "GPUCache",
    "GraphiteDawnCache",
    "GrShaderCache",
    "ScriptCache",
    "ShaderCache",
    "component_crx_cache",
}


def read_passwordless_marker(vault_path: Path) -> bool:
    if not vault_path.exists():
        return False
    try:
        envelope = json.loads(vault_path.read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        return False
    return isinstance(envelope, dict) and envelope.get("passwordless") is True


def lightweight_storage_state() -> dict[str, Any]:
    ensure_app_dir()
    return {
        "hasVault": VAULT_FILE.exists(),
        "legacyAvailable": LEGACY_LOCAL_STORAGE_FILE.exists(),
        "vaultPath": str(VAULT_FILE),
        "passwordless": read_passwordless_marker(VAULT_FILE),
    }


def lightweight_app_state() -> dict[str, Any]:
    return {
        **lightweight_storage_state(),
        "locked": True,
        "expiresAt": 0,
    }


class DesktopPasswordManagerApi:
    def __init__(self) -> None:
        self._api = None
        self._updater = None

    @property
    def api(self):
        if self._api is None:
            from pwdmg_core.api import PasswordManagerApi

            self._api = PasswordManagerApi()
        return self._api

    @property
    def updater(self):
        if self._updater is None:
            from pwdmg_core.updater import DesktopUpdateService

            self._updater = DesktopUpdateService()
        return self._updater

    def getState(self) -> dict[str, Any]:
        if self._api is None:
            return self._call_result(lightweight_app_state)
        return self.api.getState()

    def getStorageState(self) -> dict[str, Any]:
        if self._api is None:
            return self._call_result(lightweight_storage_state)
        return self.api.getStorageState()

    def getAppInfo(self) -> dict[str, Any]:
        return {
            "ok": True,
            "data": {
                "version": APP_VERSION,
                "platform": "desktop",
                "packaged": bool(getattr(sys, "frozen", False)),
            },
        }

    def readVaultEnvelope(self) -> dict[str, Any]:
        return self.api.readVaultEnvelope()

    def writeVaultEnvelope(
        self,
        envelopeText: str,
        protectBackup: bool = False,
        expectedRevision: int | None = None,
    ) -> dict[str, Any]:
        return self.api.writeVaultEnvelope(envelopeText, protectBackup, expectedRevision)

    def readLegacyLocalStorage(self) -> dict[str, Any]:
        return self.api.readLegacyLocalStorage()

    def cleanupLegacyStorage(
        self,
        expectedDigest: str,
        expectedVaultDigest: str | None = None,
    ) -> dict[str, Any]:
        return self.api.cleanupLegacyStorage(expectedDigest, expectedVaultDigest)

    def createVault(self, password: str, importLegacy: bool = True) -> dict[str, Any]:
        return self.api.createVault(password, importLegacy)

    def unlock(self, password: str) -> dict[str, Any]:
        return self.api.unlock(password)

    def lock(self) -> dict[str, Any]:
        return self.api.lock()

    def getVault(self) -> dict[str, Any]:
        return self.api.getVault()

    def saveVault(
        self,
        payload: dict[str, Any],
        expectedRevision: int | None = None,
    ) -> dict[str, Any]:
        return self.api.saveVault(payload, expectedRevision)

    def changePassword(self, newPassword: str) -> dict[str, Any]:
        return self.api.changePassword(newPassword)

    def exportVaultBackup(self) -> dict[str, Any]:
        return self.api.exportVaultBackup()

    def importVaultBackup(self, envelopeText: str) -> dict[str, Any]:
        return self.api.importVaultBackup(envelopeText)

    def queryMatches(self, hostname: str) -> dict[str, Any]:
        return self.api.queryMatches(hostname)

    def getFillPayload(self, entryId: str) -> dict[str, Any]:
        return self.api.getFillPayload(entryId)

    def listSaveTargets(self) -> dict[str, Any]:
        return self.api.listSaveTargets()

    def previewCapturedLogin(self, capture: dict[str, Any]) -> dict[str, Any]:
        return self.api.previewCapturedLogin(capture)

    def saveCapturedLogin(
        self,
        capture: dict[str, Any],
        parentId: str = "",
        updateEntryId: str = "",
    ) -> dict[str, Any]:
        return self.api.saveCapturedLogin(capture, parentId, updateEntryId)

    def generateTotp(self, entryId: str) -> dict[str, Any]:
        return self.api.generateTotp(entryId)

    def getPluginListenerState(self) -> dict[str, Any]:
        try:
            from pwdmg_core.native_install import plugin_listener_state

            return {"ok": True, "data": plugin_listener_state()}
        except Exception as exc:
            return {"ok": False, "code": "PLUGIN_LISTENER_ERROR", "message": str(exc)}

    def enablePluginListener(
        self, extensionId: str, browsers: list[str] | None = None
    ) -> dict[str, Any]:
        try:
            from pwdmg_core.native_install import enable_plugin_listener

            return {"ok": True, "data": enable_plugin_listener(extensionId, browsers)}
        except Exception as exc:
            return {"ok": False, "code": "PLUGIN_LISTENER_ERROR", "message": str(exc)}

    def disablePluginListener(self) -> dict[str, Any]:
        try:
            from pwdmg_core.native_install import disable_plugin_listener

            return {"ok": True, "data": disable_plugin_listener()}
        except Exception as exc:
            return {"ok": False, "code": "PLUGIN_LISTENER_ERROR", "message": str(exc)}

    def checkDesktopUpdate(self, manifestUrl: str) -> dict[str, Any]:
        return self._call_result(
            lambda: self.updater.check(manifestUrl), "UPDATE_FAILED"
        )

    def downloadDesktopUpdate(self, manifestUrl: str) -> dict[str, Any]:
        return self._call_result(
            lambda: self.updater.download(manifestUrl), "UPDATE_FAILED"
        )

    @staticmethod
    def _call_result(fn, code: str = "ERROR"):
        try:
            return {"ok": True, "data": fn()}
        except Exception as exc:
            return {"ok": False, "code": code, "message": str(exc)}

    def applyDesktopUpdate(self, packagePath: str) -> dict[str, Any]:
        try:
            data = self.updater.apply(packagePath)
            window = _desktop_window
            state = _desktop_state
            if window is not None and state is not None:
                state.save_window(window)

            def exit_for_update() -> None:
                try:
                    if window is not None:
                        window.destroy()
                finally:
                    os._exit(0)

            timer = threading.Timer(0.2, exit_for_update)
            timer.daemon = True
            timer.start()
            return {"ok": True, "data": data}
        except Exception as exc:
            return {"ok": False, "code": "UPDATE_FAILED", "message": str(exc)}

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


def normalize_desktop_config(config: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(DEFAULT_DESKTOP_CONFIG)
    normalized.update(config)

    width = to_int(normalized.get("width"), DEFAULT_DESKTOP_CONFIG["width"])
    height = to_int(normalized.get("height"), DEFAULT_DESKTOP_CONFIG["height"])
    x_position = to_int(
        normalized.get("x_position"), DEFAULT_DESKTOP_CONFIG["x_position"]
    )
    y_position = to_int(
        normalized.get("y_position"), DEFAULT_DESKTOP_CONFIG["y_position"]
    )

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
        "x_position": to_int(
            config.get("x_position"), DEFAULT_DESKTOP_CONFIG["x_position"]
        ),
        "y_position": to_int(
            config.get("y_position"), DEFAULT_DESKTOP_CONFIG["y_position"]
        ),
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
    DESKTOP_CONFIG_FILE.write_text(
        json.dumps(config, ensure_ascii=False, indent=2), encoding="utf-8"
    )


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


def record_initial_desktop_config(
    window: webview.Window, _state: DesktopWindowState
) -> None:
    if not window.events.shown.wait(10):
        return
    window.events.closed.wait()


def bind_desktop_config_events(
    window: webview.Window, state: DesktopWindowState
) -> None:
    def on_resize(_width: int, _height: int) -> None:
        state.schedule_save_window(window)

    def on_move(_x_position: int, _y_position: int) -> None:
        state.schedule_save_window(window)

    def on_closing(*_args: Any) -> None:
        state.save_window(window)

    window.events.resized += on_resize
    window.events.moved += on_move
    window.events.closing += on_closing


def missing_frontend_page(checked_paths: list[Path]) -> str:
    ensure_app_dir()
    page = ensure_app_dir() / "missing_frontend.html"
    checked = "\n".join(f"<li>{path}</li>" for path in checked_paths)
    page.write_text(
        f"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <style>
    body {{ margin: 0; background: #070b10; color: #d9e4f2; font: 14px/1.6 Segoe UI, sans-serif; }}
    main {{ max-width: 760px; margin: 12vh auto; padding: 24px; }}
    h1 {{ margin: 0 0 12px; font-size: 22px; }}
    code, li {{ color: #9ed7ff; overflow-wrap: anywhere; }}
  </style>
</head>
<body>
  <main>
    <h1>前端资源未找到</h1>
    <p>开发模式请先在 <code>front</code> 目录运行 <code>npm run build:desktop</code> 或 <code>npm run build</code> 生成桌面端静态资源。</p>
    <p>打包模式请重新运行桌面端打包脚本，或确认 <code>_internal/front/dist/desktop/index.html</code> 与 exe 一起发布。</p>
    <p>已检查路径：</p>
    <ul>{checked}</ul>
  </main>
</body>
</html>
""",
        encoding="utf-8",
    )
    return str(page)


def resolve_frontend_entry() -> str:
    if getattr(sys, "frozen", False):
        root = Path(sys.executable).resolve().parent / "_internal" / "front" / "dist"
        candidates = [
            root / "desktop" / "index.html",
            root / "index.html",
        ]
    else:
        root = Path(__file__).resolve().parent / "front" / "dist" / "desktop"
        candidates = [root / "index.html"]

    for candidate in candidates:
        if candidate.exists():
            return str(candidate)
    checked_paths = candidates
    return missing_frontend_page(checked_paths)


def frontend_entry_fingerprint(frontend_entry: str) -> str:
    digest = hashlib.sha256()
    digest.update(APP_VERSION.encode("utf-8"))
    digest.update(b"\0")
    try:
        path = Path(frontend_entry)
        if path.is_file():
            digest.update(path.read_bytes())
            return digest.hexdigest()
    except OSError:
        pass
    digest.update(frontend_entry.encode("utf-8", errors="replace"))
    return digest.hexdigest()


def load_webview_cache_state(state_file: Path) -> dict[str, Any]:
    try:
        data = json.loads(state_file.read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        return {}
    return data if isinstance(data, dict) else {}


def clear_webview_resource_cache(webview_storage_dir: Path) -> None:
    webview_root = webview_storage_dir / "EBWebView"
    if not webview_root.exists():
        return

    delete_targets: list[Path] = []
    try:
        for path in webview_root.rglob("*"):
            if path.is_dir() and path.name in WEBVIEW_CACHE_DIR_NAMES:
                delete_targets.append(path)
    except OSError:
        return

    for path in sorted(delete_targets, key=lambda item: len(item.parts), reverse=True):
        try:
            shutil.rmtree(path, ignore_errors=True)
        except OSError:
            pass


def refresh_webview_cache_if_frontend_changed(webview_storage_dir: Path, frontend_entry: str) -> None:
    fingerprint = frontend_entry_fingerprint(frontend_entry)
    state_file = webview_storage_dir / WEBVIEW_CACHE_STATE_FILE
    state = load_webview_cache_state(state_file)
    if state.get("frontendFingerprint") == fingerprint:
        return

    clear_webview_resource_cache(webview_storage_dir)
    next_state = {
        "appVersion": APP_VERSION,
        "frontendFingerprint": fingerprint,
    }
    try:
        state_file.write_text(json.dumps(next_state, ensure_ascii=False, indent=2), encoding="utf-8")
    except OSError:
        pass


def main() -> None:
    global _desktop_window, _desktop_state

    config = load_desktop_config()
    startup_config = get_pywebview_startup_config(config)
    webview_storage_dir = ensure_app_dir() / "webview_storage"
    webview_storage_dir.mkdir(parents=True, exist_ok=True)
    frontend_entry = resolve_frontend_entry()
    refresh_webview_cache_if_frontend_changed(webview_storage_dir, frontend_entry)
    desktop_state = DesktopWindowState(config)
    window = webview.create_window(
        config.get("appname", DEFAULT_DESKTOP_CONFIG["appname"]),
        frontend_entry,
        js_api=DesktopPasswordManagerApi(),
        width=startup_config["width"],
        height=startup_config["height"],
        x=startup_config["x_position"],
        y=startup_config["y_position"],
        resizable=True,
        background_color="#070b10",
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
    main()
