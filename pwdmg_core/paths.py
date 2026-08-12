from __future__ import annotations

from pathlib import Path

APP_NAME = "My Password Manager"
APP_DIR = Path.home() / "mypwdmg"
VAULT_FILE = APP_DIR / "vault.json"
LEGACY_LOCAL_STORAGE_FILE = APP_DIR / "localStorage_data.json"
DESKTOP_CONFIG_FILE = APP_DIR / "desktop_config.json"
LOCAL_BACKUP_DIR = APP_DIR / "backups"
UPDATE_DIR = APP_DIR / "updates"
NATIVE_HOST_DIR = APP_DIR / "native-host"
PLUGIN_CONFIG_FILE = APP_DIR / "plugin_config.json"
DEVICE_UNLOCK_FILE = APP_DIR / "device_unlock.json"
ATTACHMENT_DIR = APP_DIR / "attachments"


DEFAULT_DESKTOP_CONFIG = {
    "appname": "My Password Manager",
    "width": 360,
    "height": 480,
    "x_position": 160,
    "y_position": 80,
    "tray_enabled": True,
    "close_behavior": "minimize-to-tray",
}


def ensure_app_dir() -> Path:
    APP_DIR.mkdir(parents=True, exist_ok=True)
    return APP_DIR
