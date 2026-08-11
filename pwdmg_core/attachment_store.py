from __future__ import annotations

import base64
import binascii
import json
import os
import re
import time
import uuid
from pathlib import Path
from typing import Any, Dict, Iterable


ATTACHMENT_FORMAT = "mypwdmg-attachment"
ATTACHMENT_VERSION = 1
ATTACHMENT_CIPHER = "AES-256-GCM"
MAX_ATTACHMENT_PLAINTEXT_BYTES = 10 * 1024 * 1024
MAX_ATTACHMENT_CIPHERTEXT_BYTES = MAX_ATTACHMENT_PLAINTEXT_BYTES + 16
MAX_ATTACHMENT_OBJECT_BYTES = ((MAX_ATTACHMENT_CIPHERTEXT_BYTES + 2) // 3) * 4 + 1024
MAX_ATTACHMENT_STORE_BYTES = 256 * 1024 * 1024
ORPHAN_GRACE_SECONDS = 24 * 60 * 60
RETAIN_SECONDS = 7 * 24 * 60 * 60
OBJECT_FIELDS = {"format", "version", "cipher", "attachmentId", "nonce", "ciphertext"}
ATTACHMENT_ID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
)
RETAINED_NAME_RE = re.compile(
    r"^(?P<id>[0-9a-f-]{36})\.(?P<deleted>[0-9]{1,12})\.json$"
)


class AttachmentStoreError(ValueError):
    pass


class AttachmentObjectStore:
    def __init__(self, root: Path, now=None) -> None:
        self.root = Path(root)
        self.retained_dir = self.root / ".retained"
        self._now = now or time.time

    def state(self) -> Dict[str, int]:
        active = list(self._active_files())
        retained = list(self._retained_files())
        active_bytes = sum(self._safe_size(path) for path in active)
        retained_bytes = sum(self._safe_size(path) for path in retained)
        return {
            "maxFileBytes": MAX_ATTACHMENT_PLAINTEXT_BYTES,
            "quotaBytes": MAX_ATTACHMENT_STORE_BYTES,
            "activeCount": len(active),
            "activeBytes": active_bytes,
            "retainedCount": len(retained),
            "retainedBytes": retained_bytes,
        }

    def write(self, attachment_id: str, object_text: str) -> Dict[str, Any]:
        attachment_id = validate_attachment_id(attachment_id)
        raw = str(object_text or "").encode("utf-8")
        if len(raw) > MAX_ATTACHMENT_OBJECT_BYTES:
            raise AttachmentStoreError("Attachment object is too large")
        parsed = validate_attachment_object(object_text, attachment_id)
        target = self._active_path(attachment_id)
        if target.exists():
            if target.read_bytes() == raw:
                return self._object_result(target, parsed)
            raise AttachmentStoreError("Attachment objects are immutable")

        state = self.state()
        current_bytes = state["activeBytes"] + state["retainedBytes"]
        if current_bytes + len(raw) > MAX_ATTACHMENT_STORE_BYTES:
            raise AttachmentStoreError("Attachment storage quota exceeded")

        self.root.mkdir(parents=True, exist_ok=True)
        temp_path = self.root / f".{attachment_id}.{uuid.uuid4().hex}.tmp"
        try:
            with temp_path.open("xb") as handle:
                handle.write(raw)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(str(temp_path), str(target))
        finally:
            try:
                if temp_path.exists():
                    temp_path.unlink()
            except OSError:
                pass
        return self._object_result(target, parsed)

    def read(self, attachment_id: str) -> str:
        attachment_id = validate_attachment_id(attachment_id)
        path = self._active_path(attachment_id)
        if not path.exists():
            path = self._restore_retained(attachment_id)
        if not path or not path.is_file():
            raise FileNotFoundError("Attachment object does not exist")
        if path.stat().st_size > MAX_ATTACHMENT_OBJECT_BYTES:
            raise AttachmentStoreError("Attachment object is too large")
        text = path.read_text(encoding="utf-8")
        validate_attachment_object(text, attachment_id)
        return text

    def retain(self, attachment_id: str) -> Dict[str, Any]:
        attachment_id = validate_attachment_id(attachment_id)
        source = self._active_path(attachment_id)
        if not source.exists():
            return {"attachmentId": attachment_id, "retained": False}
        self.retained_dir.mkdir(parents=True, exist_ok=True)
        deleted_at = int(self._now())
        target = self.retained_dir / f"{attachment_id}.{deleted_at}.json"
        os.replace(str(source), str(target))
        return {"attachmentId": attachment_id, "retained": True, "deletedAt": deleted_at}

    def collect(self, referenced_ids: Iterable[str]) -> Dict[str, int]:
        referenced = {validate_attachment_id(value) for value in referenced_ids}
        now = int(self._now())
        retained_count = 0
        deleted_count = 0
        for path in self._active_files():
            attachment_id = path.stem
            if attachment_id in referenced:
                continue
            if now - int(path.stat().st_mtime) < ORPHAN_GRACE_SECONDS:
                continue
            self.retain(attachment_id)
            retained_count += 1
        for path in self._retained_files():
            match = RETAINED_NAME_RE.fullmatch(path.name)
            if not match:
                continue
            attachment_id = match.group("id")
            deleted_at = int(match.group("deleted"))
            if attachment_id in referenced:
                self._restore_retained(attachment_id)
                continue
            if now - deleted_at < RETAIN_SECONDS:
                continue
            path.unlink()
            deleted_count += 1
        return {"retained": retained_count, "deleted": deleted_count}

    def _active_path(self, attachment_id: str) -> Path:
        return self.root / f"{attachment_id}.json"

    def _active_files(self):
        if not self.root.exists():
            return []
        return [
            path for path in self.root.glob("*.json")
            if path.is_file() and ATTACHMENT_ID_RE.fullmatch(path.stem)
        ]

    def _retained_files(self):
        if not self.retained_dir.exists():
            return []
        return [path for path in self.retained_dir.glob("*.json") if path.is_file()]

    def _restore_retained(self, attachment_id: str) -> Path | None:
        matches = sorted(
            self.retained_dir.glob(f"{attachment_id}.*.json") if self.retained_dir.exists() else [],
            key=lambda path: path.name,
            reverse=True,
        )
        if not matches:
            return None
        self.root.mkdir(parents=True, exist_ok=True)
        target = self._active_path(attachment_id)
        os.replace(str(matches[0]), str(target))
        return target

    @staticmethod
    def _safe_size(path: Path) -> int:
        try:
            return path.stat().st_size
        except OSError:
            return 0

    @staticmethod
    def _object_result(path: Path, parsed: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "attachmentId": parsed["attachmentId"],
            "objectBytes": path.stat().st_size,
        }


def validate_attachment_id(value: str) -> str:
    attachment_id = str(value or "").strip().lower()
    if not ATTACHMENT_ID_RE.fullmatch(attachment_id):
        raise AttachmentStoreError("Attachment ID is invalid")
    return attachment_id


def validate_attachment_object(object_text: str, expected_id: str = "") -> Dict[str, Any]:
    try:
        parsed = json.loads(str(object_text or ""))
    except (TypeError, ValueError) as exc:
        raise AttachmentStoreError("Attachment object is malformed") from exc
    if not isinstance(parsed, dict) or set(parsed) != OBJECT_FIELDS:
        raise AttachmentStoreError("Attachment object is malformed")
    attachment_id = validate_attachment_id(parsed.get("attachmentId"))
    if expected_id and attachment_id != validate_attachment_id(expected_id):
        raise AttachmentStoreError("Attachment object ID does not match")
    if (
        parsed.get("format") != ATTACHMENT_FORMAT
        or parsed.get("version") != ATTACHMENT_VERSION
        or parsed.get("cipher") != ATTACHMENT_CIPHER
    ):
        raise AttachmentStoreError("Attachment object format is unsupported")
    nonce = _decode_base64(parsed.get("nonce"), 12)
    ciphertext = _decode_base64(parsed.get("ciphertext"), MAX_ATTACHMENT_CIPHERTEXT_BYTES)
    if len(nonce) != 12 or len(ciphertext) < 16:
        raise AttachmentStoreError("Attachment object is malformed")
    return parsed


def _decode_base64(value: Any, max_bytes: int) -> bytes:
    text = str(value or "")
    if len(text) > ((max_bytes + 2) // 3) * 4 + 4:
        raise AttachmentStoreError("Attachment object is too large")
    try:
        return base64.b64decode(text.encode("ascii"), validate=True)
    except (UnicodeEncodeError, binascii.Error, ValueError) as exc:
        raise AttachmentStoreError("Attachment object is malformed") from exc
