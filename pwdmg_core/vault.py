from __future__ import annotations

import copy
import json
import shutil
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List

from .crypto import VaultCryptoError, VaultKey, decrypt_payload, decrypt_payload_with_key, encrypt_payload, encrypt_payload_with_key
from .domain import domain_matches, find_entry, flatten_entries, normalize_domain
from .legacy import convert_legacy_cards, load_legacy_cards
from .paths import LEGACY_LOCAL_STORAGE_FILE, LOCAL_BACKUP_DIR, VAULT_FILE, ensure_app_dir
from .totp import generate_totp


SESSION_SECONDS = 10 * 60
MAX_LOCAL_IMPORT_BACKUPS = 5
LOCAL_IMPORT_BACKUP_PREFIX = "vault-before-cloud-download-"
LOCAL_IMPORT_BACKUP_SUFFIX = ".json"
LOGIN_ACCOUNT_SOURCES = {"auto", "username", "email", "phone"}


class VaultLockedError(Exception):
    pass


def default_payload(entries: List[Dict[str, Any]] | None = None) -> Dict[str, Any]:
    return {
        "version": 1,
        "entries": entries or [],
        "settings": {
            "oss": {
                "bucketName": "",
                "accessKeyId": "",
                "accessKeySecret": "",
                "region": "",
                "objectName": "mypwdmg-vault.json",
            }
        },
        "updatedAt": int(time.time()),
    }


class VaultService:
    def __init__(
        self,
        *,
        vault_path: Path | None = None,
        legacy_path: Path | None = None,
        session_seconds: int = SESSION_SECONDS,
    ) -> None:
        ensure_app_dir()
        self.vault_path = vault_path or VAULT_FILE
        self.backup_dir = LOCAL_BACKUP_DIR if vault_path is None else self.vault_path.parent / "backups"
        self.legacy_path = legacy_path or LEGACY_LOCAL_STORAGE_FILE
        self.session_seconds = session_seconds
        self._payload: Dict[str, Any] | None = None
        self._key: VaultKey | None = None
        self._expires_at = 0.0
        self._vault_mtime_ns = 0

    def state(self) -> Dict[str, Any]:
        return {
            "hasVault": self.vault_path.exists(),
            "locked": not self._is_unlocked(),
            "expiresAt": int(self._expires_at) if self._is_unlocked() else 0,
            "legacyAvailable": self.legacy_path.exists(),
            "vaultPath": str(self.vault_path),
        }

    def storage_state(self) -> Dict[str, Any]:
        return {
            "hasVault": self.vault_path.exists(),
            "legacyAvailable": self.legacy_path.exists(),
            "vaultPath": str(self.vault_path),
        }

    def read_vault_envelope(self) -> str:
        if not self.vault_path.exists():
            raise FileNotFoundError("Vault does not exist")
        return self.vault_path.read_text(encoding="utf-8")

    def write_vault_envelope(self, envelope_text: str, *, protect_backup: bool = False) -> Dict[str, Any]:
        envelope = self._validate_backup_envelope(envelope_text)
        backup_path = self._backup_current_vault() if protect_backup else None
        self.vault_path.parent.mkdir(parents=True, exist_ok=True)
        self.vault_path.write_text(json.dumps(envelope, ensure_ascii=False, indent=2), encoding="utf-8")
        self.lock()
        return {
            "vaultPath": str(self.vault_path),
            "backupPath": str(backup_path) if backup_path else "",
        }

    def read_legacy_local_storage(self) -> str:
        if not self.legacy_path.exists():
            return "{}"
        return self.legacy_path.read_text(encoding="utf-8")

    def create_vault(self, password: str, *, import_legacy: bool = True) -> Dict[str, Any]:
        if self.vault_path.exists():
            raise FileExistsError("Vault already exists; unlock it instead")
        entries: List[Dict[str, Any]] = []
        migrated = 0
        if import_legacy:
            legacy_cards = load_legacy_cards(self.legacy_path)
            entries = convert_legacy_cards(legacy_cards)
            migrated = len(flatten_entries(entries))
        payload = default_payload(entries)
        self._write_new_envelope(password, payload)
        return {"vault": copy.deepcopy(payload), "migrated": migrated}

    def unlock(self, password: str) -> Dict[str, Any]:
        envelope = self._read_envelope()
        payload, key = decrypt_payload(password, envelope)
        self._payload = self._normalize_payload(payload)
        self._key = key
        self._vault_mtime_ns = self._current_vault_mtime_ns()
        self._refresh_session()
        return copy.deepcopy(self._payload)

    def lock(self) -> None:
        self._payload = None
        self._key = None
        self._expires_at = 0.0
        self._vault_mtime_ns = 0

    def get_vault(self) -> Dict[str, Any]:
        return copy.deepcopy(self._require_payload())

    def save_vault(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        self._require_payload()
        if not self._key:
            raise VaultLockedError("Vault is locked")
        normalized = self._normalize_payload(payload)
        normalized["updatedAt"] = int(time.time())
        self._payload = normalized
        self._save_current()
        self._refresh_session()
        return copy.deepcopy(normalized)

    def change_password(self, new_password: str) -> Dict[str, Any]:
        payload = copy.deepcopy(self._require_payload())
        envelope, key = encrypt_payload(new_password or "", payload)
        self.vault_path.parent.mkdir(parents=True, exist_ok=True)
        self.vault_path.write_text(json.dumps(envelope, ensure_ascii=False, indent=2), encoding="utf-8")
        self._payload = payload
        self._key = key
        self._vault_mtime_ns = self._current_vault_mtime_ns()
        self._refresh_session()
        return self.state()

    def export_backup(self) -> Dict[str, Any]:
        self._require_payload()
        if not self.vault_path.exists():
            raise FileNotFoundError("Vault does not exist")
        self._refresh_session()
        return {
            "content": self.vault_path.read_text(encoding="utf-8"),
            "vaultPath": str(self.vault_path),
            "updatedAt": int(self.vault_path.stat().st_mtime),
        }

    def import_backup(self, envelope_text: str) -> Dict[str, Any]:
        self._require_payload()
        envelope = self._validate_backup_envelope(envelope_text)
        backup_path = self._backup_current_vault()
        self.vault_path.parent.mkdir(parents=True, exist_ok=True)
        self.vault_path.write_text(json.dumps(envelope, ensure_ascii=False, indent=2), encoding="utf-8")
        self.lock()
        return {
            "state": self.state(),
            "backupPath": str(backup_path) if backup_path else "",
            "vaultPath": str(self.vault_path),
        }

    def query_matches(self, hostname: str) -> List[Dict[str, Any]]:
        payload = self._require_payload()
        host = normalize_domain(hostname)
        matches: List[Dict[str, Any]] = []
        for entry in flatten_entries(payload.get("entries") or []):
            if entry.get("kind") != "login":
                continue
            if any(domain_matches(host, domain) for domain in entry.get("domains") or []):
                matches.append(
                    {
                        "id": entry.get("id"),
                        "title": entry.get("title"),
                        "username": entry.get("username", ""),
                        "email": entry.get("email", ""),
                        "phone": entry.get("phone", ""),
                        "loginAccountSource": entry.get("loginAccountSource", "auto"),
                        "domains": entry.get("domains", []),
                        "hasPassword": bool(entry.get("password")),
                        "hasTotp": bool(entry.get("totpSecret")),
                    }
                )
        self._refresh_session()
        return matches

    def get_fill_payload(self, entry_id: str) -> Dict[str, Any]:
        entry = self._get_login(entry_id)
        result = {
            "id": entry.get("id"),
            "title": entry.get("title"),
            "username": entry.get("username", ""),
            "email": entry.get("email", ""),
            "password": entry.get("password", ""),
            "phone": entry.get("phone", ""),
            "loginAccountSource": entry.get("loginAccountSource", "auto"),
            "totp": "",
        }
        if entry.get("totpSecret"):
            result["totp"] = generate_totp(entry["totpSecret"])
        self._refresh_session()
        return result

    def generate_totp(self, entry_id: str) -> str:
        entry = self._get_login(entry_id)
        self._refresh_session()
        return generate_totp(entry.get("totpSecret") or "")

    def _get_login(self, entry_id: str) -> Dict[str, Any]:
        payload = self._require_payload()
        entry = find_entry(payload.get("entries") or [], entry_id)
        if not entry or entry.get("kind") != "login":
            raise KeyError("Entry not found")
        return entry

    def _write_new_envelope(self, password: str, payload: Dict[str, Any]) -> None:
        envelope, key = encrypt_payload(password, self._normalize_payload(payload))
        self.vault_path.parent.mkdir(parents=True, exist_ok=True)
        self.vault_path.write_text(json.dumps(envelope, ensure_ascii=False, indent=2), encoding="utf-8")
        self._payload = self._normalize_payload(payload)
        self._key = key
        self._vault_mtime_ns = self._current_vault_mtime_ns()
        self._refresh_session()

    def _save_current(self) -> None:
        if self._payload is None or self._key is None:
            raise VaultLockedError("Vault is locked")
        envelope = encrypt_payload_with_key(self._key, self._payload)
        self.vault_path.parent.mkdir(parents=True, exist_ok=True)
        self.vault_path.write_text(json.dumps(envelope, ensure_ascii=False, indent=2), encoding="utf-8")
        self._vault_mtime_ns = self._current_vault_mtime_ns()

    def _read_envelope(self) -> Dict[str, Any]:
        if not self.vault_path.exists():
            raise FileNotFoundError("Vault does not exist")
        return json.loads(self.vault_path.read_text(encoding="utf-8"))

    def _require_payload(self) -> Dict[str, Any]:
        if self._payload is not None and self._key is not None:
            self._reload_if_vault_changed()
        if not self._is_unlocked() or self._payload is None:
            self.lock()
            raise VaultLockedError("Vault is locked")
        return self._payload

    def _reload_if_vault_changed(self) -> None:
        if not self.vault_path.exists():
            self.lock()
            raise FileNotFoundError("Vault does not exist")
        current_mtime_ns = self._current_vault_mtime_ns()
        if self._vault_mtime_ns and current_mtime_ns <= self._vault_mtime_ns:
            return
        if not self._key:
            return
        payload = decrypt_payload_with_key(self._key, self._read_envelope())
        self._payload = self._normalize_payload(payload)
        self._vault_mtime_ns = current_mtime_ns

    def _current_vault_mtime_ns(self) -> int:
        try:
            return self.vault_path.stat().st_mtime_ns
        except OSError:
            return 0

    def _is_unlocked(self) -> bool:
        return self._payload is not None and self._key is not None and time.time() < self._expires_at

    def _refresh_session(self) -> None:
        self._expires_at = time.time() + self.session_seconds

    def _normalize_payload(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        normalized = {
            "version": 1,
            "entries": self._normalize_entries(payload.get("entries") or []),
            "settings": payload.get("settings") or default_payload()["settings"],
            "updatedAt": int(payload.get("updatedAt") or time.time()),
        }
        normalized.setdefault("settings", {})
        normalized["settings"].setdefault("oss", default_payload()["settings"]["oss"])
        normalized["settings"]["oss"] = {
            **default_payload()["settings"]["oss"],
            **(normalized["settings"].get("oss") or {}),
        }
        return normalized

    def _normalize_entries(self, entries: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        return [self._normalize_entry(entry) for entry in entries if entry]

    def _normalize_entry(self, entry: Dict[str, Any]) -> Dict[str, Any]:
        kind = entry.get("kind") if entry.get("kind") in {"login", "folder"} else "login"
        normalized = {
            "id": entry.get("id") or str(uuid.uuid4()),
            "kind": kind,
            "title": entry.get("title") or "Untitled",
            "domains": [normalize_domain(d) for d in entry.get("domains", []) if normalize_domain(d)],
        }
        if kind == "folder":
            normalized["children"] = self._normalize_entries(entry.get("children") or [])
        else:
            normalized.update(
                {
                    "username": entry.get("username") or "",
                    "email": entry.get("email") or "",
                    "password": entry.get("password") or "",
                    "phone": entry.get("phone") or "",
                    "loginAccountSource": self._normalize_login_account_source(
                        entry.get("loginAccountSource")
                    ),
                    "note": entry.get("note") or "",
                    "totpSecret": entry.get("totpSecret") or "",
                    "children": [],
                }
            )
        return normalized

    def _normalize_login_account_source(self, value: Any) -> str:
        return value if value in LOGIN_ACCOUNT_SOURCES else "auto"

    def _validate_backup_envelope(self, envelope_text: str) -> Dict[str, Any]:
        if not envelope_text or not envelope_text.strip():
            raise ValueError("Backup content is empty")
        try:
            envelope = json.loads(envelope_text)
        except json.JSONDecodeError as exc:
            raise ValueError("Backup content is not valid JSON") from exc
        if not isinstance(envelope, dict):
            raise ValueError("Backup content is not a vault envelope")
        if envelope.get("format") != "mypwdmg-vault":
            raise ValueError("Backup vault format is not supported")
        for field in ("version", "cipher", "kdf", "nonce", "ciphertext"):
            if field not in envelope:
                raise ValueError("Backup vault file is incomplete")
        return envelope

    def _backup_current_vault(self) -> Path | None:
        if not self.vault_path.exists():
            return None
        self.backup_dir.mkdir(parents=True, exist_ok=True)
        timestamp = time.strftime("%Y%m%d-%H%M%S")
        backup_path = self.backup_dir / f"{LOCAL_IMPORT_BACKUP_PREFIX}{timestamp}{LOCAL_IMPORT_BACKUP_SUFFIX}"
        shutil.copy2(self.vault_path, backup_path)
        self._prune_local_import_backups()
        return backup_path

    def _prune_local_import_backups(self) -> None:
        backups = sorted(
            (
                path
                for path in self.backup_dir.glob(f"{LOCAL_IMPORT_BACKUP_PREFIX}*{LOCAL_IMPORT_BACKUP_SUFFIX}")
                if path.is_file()
            ),
            key=lambda path: path.stat().st_mtime,
            reverse=True,
        )
        for old_backup in backups[MAX_LOCAL_IMPORT_BACKUPS:]:
            try:
                old_backup.unlink()
            except OSError:
                pass


def call_result(fn):
    try:
        return {"ok": True, "data": fn()}
    except VaultLockedError as exc:
        return {"ok": False, "code": "LOCKED", "message": str(exc)}
    except VaultCryptoError as exc:
        return {"ok": False, "code": "BAD_PASSWORD", "message": str(exc)}
    except Exception as exc:
        return {"ok": False, "code": "ERROR", "message": str(exc)}
