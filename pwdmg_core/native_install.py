from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, Iterable

from .paths import NATIVE_HOST_DIR, PLUGIN_CONFIG_FILE, ensure_app_dir


HOST_NAME = "com.suzikuo.mypwdmg"
PACKAGED_HOST_ARG = "--native-host"
CHROME_REG_PATH = rf"Software\Google\Chrome\NativeMessagingHosts\{HOST_NAME}"
EDGE_REG_PATH = rf"Software\Microsoft\Edge\NativeMessagingHosts\{HOST_NAME}"
EXTENSION_ID_RE = re.compile(r"^[a-p]{32}$")


def plugin_listener_state() -> Dict[str, Any]:
    config = _read_config()
    manifest_path = _manifest_path()
    launcher_path = _launcher_path()
    host_executable = _host_executable_path()
    chrome_path = _read_registry(CHROME_REG_PATH)
    edge_path = _read_registry(EDGE_REG_PATH)
    return {
        "supported": os.name == "nt",
        "hostName": HOST_NAME,
        "extensionId": config.get("extensionId", ""),
        "manifestPath": str(manifest_path),
        "launcherPath": str(launcher_path),
        "logPath": str(_log_path()),
        "executablePath": str(Path(sys.executable).resolve()),
        "hostExecutablePath": str(host_executable),
        "hostExecutableExists": host_executable.exists(),
        "hostRunning": _is_packaged() and _is_process_running(host_executable.name),
        "enabled": config.get("enabled") is True,
        "mode": "packaged" if _is_packaged() else "development",
        "chromeRegistered": chrome_path == str(manifest_path),
        "edgeRegistered": edge_path == str(manifest_path),
        "chromeManifestPath": chrome_path,
        "edgeManifestPath": edge_path,
    }


def enable_plugin_listener(extension_id: str, browsers: Iterable[str] | None = None) -> Dict[str, Any]:
    if os.name != "nt":
        raise RuntimeError("Native Messaging registration is only implemented for Windows")

    extension_id = _normalize_extension_id(extension_id)
    browser_set = set(browsers or ("chrome", "edge"))
    if not browser_set:
        browser_set = {"chrome", "edge"}

    ensure_app_dir()
    NATIVE_HOST_DIR.mkdir(parents=True, exist_ok=True)
    _write_launcher()
    manifest_path = _write_manifest(extension_id)

    if "chrome" in browser_set:
        _write_registry(CHROME_REG_PATH, manifest_path)
    if "edge" in browser_set:
        _write_registry(EDGE_REG_PATH, manifest_path)

    _write_config({"enabled": True, "extensionId": extension_id, "browsers": sorted(browser_set)})
    return plugin_listener_state()


def disable_plugin_listener() -> Dict[str, Any]:
    config = _read_config()
    config["enabled"] = False
    _write_config(config)
    if os.name == "nt":
        _delete_registry(CHROME_REG_PATH)
        _delete_registry(EDGE_REG_PATH)
        _stop_packaged_host_processes()
    return plugin_listener_state()


def is_plugin_listener_enabled() -> bool:
    config = _read_config()
    if not config:
        return True
    return config.get("enabled") is not False


def _normalize_extension_id(extension_id: str) -> str:
    extension_id = (extension_id or "").strip()
    if extension_id.startswith("chrome-extension://"):
        extension_id = extension_id.removeprefix("chrome-extension://").strip("/")
    if not EXTENSION_ID_RE.match(extension_id):
        raise ValueError("请输入 Chrome/Edge 扩展页里的 32 位插件 ID")
    return extension_id


def _write_launcher() -> Path:
    launcher_path = _launcher_path()
    log_path = _log_path()
    command = _host_command()
    cwd = _host_working_dir()
    content = "\n".join(
        [
            "@echo off",
            "setlocal",
            f'set "LOG_DIR={NATIVE_HOST_DIR}"',
            f'set "LOG_FILE={log_path}"',
            'if not exist "%LOG_DIR%" mkdir "%LOG_DIR%" >nul 2>nul',
            f'cd /d "{cwd}" >nul 2>nul',
            f'{command} 2>>"%LOG_FILE%"',
            'exit /b %ERRORLEVEL%',
            "",
        ]
    )
    launcher_path.write_text(content, encoding="utf-8")
    return launcher_path


def _host_command() -> str:
    if _is_packaged():
        executable = Path(sys.executable).resolve()
        if not executable.exists():
            raise FileNotFoundError(f"Packaged executable does not exist: {executable}")
        return f'"{executable}" {PACKAGED_HOST_ARG}'
    executable = _host_executable_path()
    return f'"{executable}" -m pwdmg_core.native_host'


def _host_working_dir() -> Path:
    if _is_packaged():
        return _host_executable_path().parent
    return Path(__file__).resolve().parent.parent


def _host_executable_path() -> Path:
    return Path(sys.executable).resolve()


def _write_manifest(extension_id: str) -> Path:
    manifest_path = _manifest_path()
    manifest = {
        "name": HOST_NAME,
        "description": "My Password native messaging host",
        "path": str(_launcher_path()),
        "type": "stdio",
        "allowed_origins": [f"chrome-extension://{extension_id}/"],
    }
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return manifest_path


def _read_config() -> Dict[str, Any]:
    if not PLUGIN_CONFIG_FILE.exists():
        return {}
    try:
        value = json.loads(PLUGIN_CONFIG_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        return {}
    return value if isinstance(value, dict) else {}


def _write_config(config: Dict[str, Any]) -> None:
    ensure_app_dir()
    PLUGIN_CONFIG_FILE.write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding="utf-8")


def _read_registry(path: str) -> str:
    if os.name != "nt":
        return ""
    try:
        import winreg

        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, path) as key:
            value, _ = winreg.QueryValueEx(key, None)
            return str(value)
    except OSError:
        return ""


def _write_registry(path: str, manifest_path: Path) -> None:
    import winreg

    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, path) as key:
        winreg.SetValueEx(key, None, 0, winreg.REG_SZ, str(manifest_path))


def _delete_registry(path: str) -> None:
    try:
        import winreg

        winreg.DeleteKey(winreg.HKEY_CURRENT_USER, path)
    except OSError:
        pass


def _stop_packaged_host_processes() -> None:
    if not _is_packaged():
        return
    # Packaged mode uses the same exe for GUI and Native Messaging
    # (`My Password.exe --native-host`). Killing by image name would close the
    # desktop app too, so disabling the listener relies on the local flag that
    # is checked before each native-host request.
    return


def _is_process_running(image_name: str) -> bool:
    if os.name != "nt" or not image_name:
        return False
    try:
        result = subprocess.run(
            ["tasklist", "/FI", f"IMAGENAME eq {image_name}", "/NH"],
            capture_output=True,
            text=True,
            check=False,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except OSError:
        return False
    return image_name.lower() in (result.stdout or "").lower()


def _is_packaged() -> bool:
    return bool(getattr(sys, "frozen", False))


def _manifest_path() -> Path:
    return NATIVE_HOST_DIR / f"{HOST_NAME}.json"


def _launcher_path() -> Path:
    return NATIVE_HOST_DIR / "mypwdmg_native_host.cmd"


def _log_path() -> Path:
    return NATIVE_HOST_DIR / "native-host-error.log"
