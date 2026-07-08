from __future__ import annotations

import copy
import json
import shutil
import time
import uuid
from pathlib import Path
from typing import Any, Dict, Iterable, List

from .crypto import VaultCryptoError, VaultKey, decrypt_payload, decrypt_payload_with_key, encrypt_payload, encrypt_payload_with_key
from .domain import domain_matches, find_entry, flatten_entries, normalize_domain
from .legacy import convert_legacy_cards, load_legacy_cards
from .paths import LEGACY_LOCAL_STORAGE_FILE, LOCAL_BACKUP_DIR, VAULT_FILE, ensure_app_dir
from .totp import generate_totp
from .vault_index import VaultIndex


SESSION_SECONDS = 0
UNLOCKED_EXPIRES_AT = 253402300799
MAX_LOCAL_IMPORT_BACKUPS = 5
LOCAL_IMPORT_BACKUP_PREFIX = "vault-before-cloud-download-"
LOCAL_IMPORT_BACKUP_SUFFIX = ".json"
LOGIN_ACCOUNT_SOURCES = {"auto", "username", "email", "phone"}
CAPTURE_ACCOUNT_KINDS = {"generic", "username", "email", "phone"}
ENTRY_STATUSES = {"active", "disabled", "trashed"}
MAX_CAPTURE_TEXT_LENGTH = 512
MAX_CAPTURE_PASSWORD_LENGTH = 4096


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
        self._index: VaultIndex | None = None
        self._passwordless = False
        self._expires_at = 0.0
        self._vault_mtime_ns = 0

    def state(self) -> Dict[str, Any]:
        return {
            "hasVault": self.vault_path.exists(),
            "locked": not self._is_unlocked(),
            "expiresAt": int(self._expires_at) if self._is_unlocked() else 0,
            "legacyAvailable": self.legacy_path.exists(),
            "vaultPath": str(self.vault_path),
            "passwordless": self._is_passwordless_vault(),
        }

    def storage_state(self) -> Dict[str, Any]:
        return {
            "hasVault": self.vault_path.exists(),
            "legacyAvailable": self.legacy_path.exists(),
            "vaultPath": str(self.vault_path),
            "passwordless": self._is_passwordless_vault(),
        }

    def read_vault_envelope(self) -> str:
        if not self.vault_path.exists():
            raise FileNotFoundError("Vault does not exist")
        return self.vault_path.read_text(encoding="utf-8")

    def write_vault_envelope(self, envelope_text: str, *, protect_backup: bool = False) -> Dict[str, Any]:
        envelope = self._validate_backup_envelope(envelope_text)
        backup_path = self._backup_current_vault() if protect_backup else None
        self.vault_path.parent.mkdir(parents=True, exist_ok=True)
        self._write_envelope(envelope)
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
        self._set_payload(self._normalize_payload(payload))
        self._key = key
        self._passwordless = password == ""
        self._vault_mtime_ns = self._current_vault_mtime_ns()
        self._refresh_session()
        if password == "" and envelope.get("passwordless") is not True:
            self._save_current()
        return copy.deepcopy(self._payload)

    def lock(self) -> None:
        self._payload = None
        self._key = None
        self._index = None
        self._passwordless = False
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
        self._set_payload(normalized)
        self._save_current()
        self._refresh_session()
        return copy.deepcopy(normalized)

    def change_password(self, new_password: str) -> Dict[str, Any]:
        payload = copy.deepcopy(self._require_payload())
        envelope, key = encrypt_payload(new_password or "", payload)
        self._write_envelope(envelope)
        self._set_payload(payload)
        self._key = key
        self._passwordless = new_password == ""
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
        self._write_envelope(envelope)
        self.lock()
        return {
            "state": self.state(),
            "backupPath": str(backup_path) if backup_path else "",
            "vaultPath": str(self.vault_path),
        }

    def query_matches(self, hostname: str) -> List[Dict[str, Any]]:
        host = normalize_domain(hostname)
        matches: List[Dict[str, Any]] = []
        for entry in self._require_index().matching_logins(host):
            matches.append(self._match_summary(entry))
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

    def list_save_targets(self) -> Dict[str, Any]:
        payload = self._require_payload()
        self._refresh_session()
        return {"folders": self._folder_summaries(payload.get("entries") or [])}

    def preview_captured_login(self, capture: Dict[str, Any]) -> Dict[str, Any]:
        payload = self._require_payload()
        normalized = self._normalize_capture(capture)
        if not normalized["password"]:
            raise ValueError("Captured password is empty")

        candidate = self._find_capture_candidate(payload.get("entries") or [], normalized)
        self._refresh_session()
        return {
            "hostname": normalized["hostname"],
            "title": normalized["title"],
            "accountLabel": normalized["accountLabel"],
            "accountKind": normalized["accountKind"],
            "folders": self._folder_summaries(payload.get("entries") or []),
            "updateCandidate": self._candidate_summary(candidate["entry"], candidate["path"], normalized)
            if candidate
            else None,
            "passwordSame": bool(candidate and candidate["passwordSame"]),
            "shouldPrompt": not bool(candidate and candidate["passwordSame"]),
        }

    def save_captured_login(
        self,
        capture: Dict[str, Any],
        parentId: str = "",
        updateEntryId: str = "",
    ) -> Dict[str, Any]:
        payload = self._require_payload()
        normalized = self._normalize_capture(capture)
        if not normalized["password"]:
            raise ValueError("Captured password is empty")

        if updateEntryId:
            entry = self._require_index().get_login(updateEntryId)
            if not entry or entry.get("kind") != "login":
                raise KeyError("Entry not found")
            self._apply_capture_update(entry, normalized)
            action = "updated"
        else:
            entry = self._entry_from_capture(normalized)
            target = self._find_folder(payload.get("entries") or [], parentId)
            if parentId and target is None:
                raise KeyError("Folder not found")
            if target is None:
                payload.setdefault("entries", []).insert(0, entry)
            else:
                target.setdefault("children", []).insert(0, entry)
            action = "created"

        payload["updatedAt"] = int(time.time())
        self._set_payload(self._normalize_payload(payload))
        self._save_current()
        self._refresh_session()
        saved = self._require_index().get_entry(entry.get("id")) or entry
        return {
            "action": action,
            "entry": self._entry_summary(saved),
        }

    def generate_totp(self, entry_id: str) -> str:
        entry = self._get_login(entry_id)
        self._refresh_session()
        return generate_totp(entry.get("totpSecret") or "")

    def _get_login(self, entry_id: str) -> Dict[str, Any]:
        entry = self._require_index().get_login(entry_id)
        if not entry or entry.get("kind") != "login":
            raise KeyError("Entry not found")
        return entry

    def _write_new_envelope(self, password: str, payload: Dict[str, Any]) -> None:
        normalized = self._normalize_payload(payload)
        envelope, key = encrypt_payload(password, normalized)
        self._write_envelope(envelope)
        self._set_payload(normalized)
        self._key = key
        self._passwordless = password == ""
        self._vault_mtime_ns = self._current_vault_mtime_ns()
        self._refresh_session()

    def _save_current(self) -> None:
        if self._payload is None or self._key is None:
            raise VaultLockedError("Vault is locked")
        envelope = encrypt_payload_with_key(self._key, self._payload)
        envelope["passwordless"] = self._passwordless
        self._write_envelope(envelope)
        self._vault_mtime_ns = self._current_vault_mtime_ns()

    def _write_envelope(self, envelope: Dict[str, Any]) -> None:
        text = json.dumps(envelope, ensure_ascii=False, indent=2)
        self._write_text_atomic(self.vault_path, text)

    def _write_text_atomic(self, path: Path, content: str) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        temp_path = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
        try:
            temp_path.write_text(content, encoding="utf-8")
            temp_path.replace(path)
        finally:
            try:
                if temp_path.exists():
                    temp_path.unlink()
            except OSError:
                pass

    def _read_envelope(self) -> Dict[str, Any]:
        if not self.vault_path.exists():
            raise FileNotFoundError("Vault does not exist")
        return json.loads(self.vault_path.read_text(encoding="utf-8"))

    def _is_passwordless_vault(self) -> bool:
        if not self.vault_path.exists():
            return False
        try:
            envelope = self._read_envelope()
        except (OSError, ValueError, TypeError, json.JSONDecodeError):
            return False
        return envelope.get("passwordless") is True

    def _try_unlock_passwordless(self) -> bool:
        if self._payload is not None and self._key is not None and self._passwordless:
            self._refresh_session()
            return True
        if not self._is_passwordless_vault():
            return False
        try:
            self.unlock("")
        except (OSError, ValueError, TypeError, json.JSONDecodeError, VaultCryptoError):
            return False
        return self._is_unlocked() and self._payload is not None

    def _require_payload(self) -> Dict[str, Any]:
        if self._payload is not None and self._key is not None:
            self._reload_if_vault_changed()
        if not self._is_unlocked() or self._payload is None:
            if self._try_unlock_passwordless():
                return self._payload
            self.lock()
            raise VaultLockedError("Vault is locked")
        return self._payload

    def _set_payload(self, payload: Dict[str, Any]) -> None:
        self._payload = payload
        self._index = VaultIndex.build(payload.get("entries") or [])

    def _require_index(self) -> VaultIndex:
        payload = self._require_payload()
        if self._index is None:
            self._index = VaultIndex.build(payload.get("entries") or [])
        return self._index

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
        self._set_payload(self._normalize_payload(payload))
        self._vault_mtime_ns = current_mtime_ns

    def _current_vault_mtime_ns(self) -> int:
        try:
            return self.vault_path.stat().st_mtime_ns
        except OSError:
            return 0

    def _is_unlocked(self) -> bool:
        if self._payload is None or self._key is None:
            return False
        return self.session_seconds <= 0 or time.time() < self._expires_at

    def _refresh_session(self) -> None:
        if self.session_seconds <= 0:
            self._expires_at = float(UNLOCKED_EXPIRES_AT)
        else:
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
            "status": self._normalize_entry_status(entry.get("status")),
            "statusReason": entry.get("statusReason") or "",
            "statusUpdatedAt": int(entry.get("statusUpdatedAt") or 0),
            "deletedAt": int(entry.get("deletedAt") or 0),
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
                    "history": entry.get("history") if isinstance(entry.get("history"), list) else [],
                    "children": [],
                }
            )
        return normalized

    def _normalize_login_account_source(self, value: Any) -> str:
        return value if value in LOGIN_ACCOUNT_SOURCES else "auto"

    def _normalize_entry_status(self, value: Any) -> str:
        return value if value in ENTRY_STATUSES else "active"

    def _normalize_capture(self, capture: Dict[str, Any]) -> Dict[str, Any]:
        title = self._clean_capture_text(capture.get("title")) or "Untitled"
        hostname = normalize_domain(
            self._clean_capture_text(capture.get("hostname") or capture.get("domain") or capture.get("url"))
        )
        account_kind = capture.get("accountKind") if capture.get("accountKind") in CAPTURE_ACCOUNT_KINDS else "generic"
        account_value = self._clean_capture_text(capture.get("account") or capture.get("accountValue"))
        username = self._clean_capture_text(capture.get("username"))
        email = self._clean_capture_text(capture.get("email"))
        phone = self._clean_capture_text(capture.get("phone"))

        if account_value:
            if account_kind == "email" and not email:
                email = account_value
            elif account_kind == "phone" and not phone:
                phone = account_value
            elif account_kind == "username" and not username:
                username = account_value
            elif not username and not email and not phone:
                if self._looks_like_email(account_value):
                    email = account_value
                elif self._looks_like_phone(account_value):
                    phone = account_value
                else:
                    username = account_value

        password = self._clean_capture_text(capture.get("password"), MAX_CAPTURE_PASSWORD_LENGTH)
        login_account_source = account_kind if account_kind in LOGIN_ACCOUNT_SOURCES else "auto"
        account_label = username or email or phone or account_value
        return {
            "title": title,
            "hostname": hostname,
            "username": username,
            "email": email,
            "phone": phone,
            "password": password,
            "accountKind": account_kind,
            "accountLabel": account_label,
            "loginAccountSource": login_account_source,
            "titleEdited": bool(capture.get("titleEdited")),
            "accountEdited": bool(capture.get("accountEdited")),
        }

    def _clean_capture_text(self, value: Any, max_length: int = MAX_CAPTURE_TEXT_LENGTH) -> str:
        if value is None:
            return ""
        text = str(value).replace("\x00", "").strip()
        return text[:max_length]

    def _looks_like_email(self, value: str) -> bool:
        return "@" in value and "." in value.rsplit("@", 1)[-1]

    def _looks_like_phone(self, value: str) -> bool:
        digits = "".join(ch for ch in value if ch.isdigit())
        return len(digits) >= 6 and len(digits) >= max(1, len(value.strip()) - 4)

    def _folder_summaries(self, entries: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
        folders = [{"id": "", "title": "根目录", "path": "根目录", "depth": 0}]

        def visit(items: Iterable[Dict[str, Any]], parents: List[str], depth: int) -> None:
            for item in items or []:
                if item.get("kind") != "folder":
                    continue
                if item.get("status", "active") != "active":
                    continue
                title = item.get("title") or "Untitled"
                path_parts = [*parents, title]
                folders.append(
                    {
                        "id": item.get("id", ""),
                        "title": title,
                        "path": " / ".join(path_parts),
                        "depth": depth,
                    }
                )
                visit(item.get("children") or [], path_parts, depth + 1)

        visit(entries, [], 1)
        return folders

    def _find_folder(self, entries: Iterable[Dict[str, Any]], folder_id: str) -> Dict[str, Any] | None:
        if not folder_id:
            return None
        if self._index is not None:
            entry = self._index.get_entry(folder_id)
        else:
            entry = find_entry(entries, folder_id)
        return entry if entry and entry.get("kind") == "folder" and entry.get("status", "active") == "active" else None

    def _find_capture_candidate(self, entries: Iterable[Dict[str, Any]], capture: Dict[str, Any]) -> Dict[str, Any] | None:
        best: Dict[str, Any] | None = None

        if self._index is not None and capture.get("hostname"):
            for entry in self._index.matching_logins(capture["hostname"]):
                if not self._account_matches_capture(entry, capture):
                    continue
                current = {
                    "entry": entry,
                    "path": self._index.path_for(entry.get("id", "")),
                    "passwordSame": entry.get("password", "") == capture["password"],
                }
                if current["passwordSame"]:
                    return current
                if best is None:
                    best = current
            return best

        def visit(items: Iterable[Dict[str, Any]], path: List[str]) -> None:
            nonlocal best
            for entry in items or []:
                if entry.get("kind") == "folder":
                    if entry.get("status", "active") != "active":
                        continue
                    visit(entry.get("children") or [], [*path, entry.get("title") or "Untitled"])
                    continue
                if entry.get("kind") != "login":
                    continue
                if entry.get("status", "active") != "active":
                    continue
                if not any(domain_matches(capture["hostname"], domain) for domain in entry.get("domains") or []):
                    continue
                if not self._account_matches_capture(entry, capture):
                    continue
                current = {
                    "entry": entry,
                    "path": path,
                    "passwordSame": entry.get("password", "") == capture["password"],
                }
                if current["passwordSame"]:
                    best = current
                    return
                if best is None:
                    best = current

        visit(entries, [])
        return best

    def _account_matches_capture(self, entry: Dict[str, Any], capture: Dict[str, Any]) -> bool:
        capture_values = {
            self._identity_value(capture.get("username")),
            self._identity_value(capture.get("email")),
            self._identity_value(capture.get("phone")),
        } - {""}
        if not capture_values:
            return False
        entry_values = {
            self._identity_value(entry.get("username")),
            self._identity_value(entry.get("email")),
            self._identity_value(entry.get("phone")),
        } - {""}
        return bool(capture_values & entry_values)

    def _identity_value(self, value: Any) -> str:
        return str(value or "").strip().lower()

    def _candidate_summary(self, entry: Dict[str, Any], path: List[str], capture: Dict[str, Any]) -> Dict[str, Any]:
        summary = self._entry_summary(entry)
        summary["path"] = " / ".join(path) if path else "根目录"
        summary["passwordSame"] = entry.get("password", "") == capture["password"]
        return summary

    def _entry_summary(self, entry: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "id": entry.get("id", ""),
            "title": entry.get("title", ""),
            "username": entry.get("username", ""),
            "email": entry.get("email", ""),
            "phone": entry.get("phone", ""),
            "domains": entry.get("domains", []),
            "loginAccountSource": entry.get("loginAccountSource", "auto"),
        }

    def _match_summary(self, entry: Dict[str, Any]) -> Dict[str, Any]:
        return {
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

    def _apply_capture_update(self, entry: Dict[str, Any], capture: Dict[str, Any]) -> None:
        if capture["hostname"]:
            domains = entry.setdefault("domains", [])
            if not any(domain_matches(capture["hostname"], domain) for domain in domains):
                domains.append(capture["hostname"])
        if capture.get("titleEdited") or not entry.get("title") or entry.get("title") == "Untitled":
            entry["title"] = capture["title"]
        if capture.get("accountEdited"):
            entry["username"] = capture["username"]
            entry["email"] = capture["email"]
            entry["phone"] = capture["phone"]
            entry["loginAccountSource"] = capture["loginAccountSource"]
        else:
            for field in ("username", "email", "phone"):
                if capture[field] and not entry.get(field):
                    entry[field] = capture[field]
        if entry.get("loginAccountSource") not in LOGIN_ACCOUNT_SOURCES:
            entry["loginAccountSource"] = capture["loginAccountSource"]
        entry["password"] = capture["password"]

    def _entry_from_capture(self, capture: Dict[str, Any]) -> Dict[str, Any]:
        domains = [capture["hostname"]] if capture["hostname"] else []
        return {
            "id": str(uuid.uuid4()),
            "kind": "login",
            "title": capture["title"] or capture["hostname"] or "Untitled",
            "status": "active",
            "statusReason": "",
            "statusUpdatedAt": 0,
            "deletedAt": 0,
            "domains": domains,
            "username": capture["username"],
            "email": capture["email"],
            "password": capture["password"],
            "phone": capture["phone"],
            "loginAccountSource": capture["loginAccountSource"],
            "note": "",
            "totpSecret": "",
            "history": [],
            "children": [],
        }

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
