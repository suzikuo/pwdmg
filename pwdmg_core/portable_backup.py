from __future__ import annotations

import hashlib
import json
import os
import time
import uuid
import zipfile
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, Iterator, List, Mapping, Tuple

from .attachment_store import (
    MAX_ATTACHMENT_OBJECT_BYTES,
    MAX_ATTACHMENT_STORE_BYTES,
    validate_attachment_id,
    validate_attachment_object,
)


PORTABLE_BACKUP_FORMAT = "mypwdmg-portable-backup"
PORTABLE_BACKUP_VERSION = 1
MANIFEST_NAME = "manifest.json"
VAULT_NAME = "vault.json"
ATTACHMENT_PREFIX = "attachments/v1/"
MAX_VAULT_BYTES = 24 * 1024 * 1024
MAX_MANIFEST_BYTES = 2 * 1024 * 1024
MAX_ATTACHMENT_COUNT = 10000
MAX_PACKAGE_BYTES = MAX_VAULT_BYTES + MAX_ATTACHMENT_STORE_BYTES + MAX_MANIFEST_BYTES + 1024 * 1024
SHA256_LENGTH = 64
MANIFEST_FIELDS = {"format", "version", "createdAt", "vault", "attachments"}
VAULT_RECORD_FIELDS = {"path", "size", "sha256"}
ATTACHMENT_RECORD_FIELDS = {"id", "path", "size", "sha256"}


class PortableBackupError(ValueError):
    pass


def write_portable_backup(
    target: Path,
    envelope_text: str,
    attachment_hashes: Mapping[str, str],
    read_attachment: Callable[[str], str],
    created_at: int | None = None,
) -> Dict[str, Any]:
    target = Path(target)
    envelope_bytes = str(envelope_text or "").encode("utf-8")
    if not envelope_bytes or len(envelope_bytes) > MAX_VAULT_BYTES:
        raise PortableBackupError("Vault envelope is empty or too large")
    normalized_hashes = _normalize_attachment_hashes(attachment_hashes)
    timestamp = _timestamp(created_at if created_at is not None else int(time.time()))
    target.parent.mkdir(parents=True, exist_ok=True)
    temp_path = target.with_name(f".{target.name}.{uuid.uuid4().hex}.tmp")
    attachment_records: List[Dict[str, Any]] = []
    attachment_bytes = 0
    try:
        with zipfile.ZipFile(temp_path, "x", compression=zipfile.ZIP_STORED, allowZip64=False) as archive:
            archive.writestr(_zip_info(VAULT_NAME), envelope_bytes)
            for attachment_id in sorted(normalized_hashes):
                object_text = read_attachment(attachment_id)
                validate_attachment_object(object_text, attachment_id)
                object_bytes = object_text.encode("utf-8")
                if len(object_bytes) > MAX_ATTACHMENT_OBJECT_BYTES:
                    raise PortableBackupError("Attachment object is too large")
                object_hash = _sha256(object_bytes)
                if object_hash != normalized_hashes[attachment_id]:
                    raise PortableBackupError("Attachment object hash does not match its vault reference")
                attachment_bytes += len(object_bytes)
                if attachment_bytes > MAX_ATTACHMENT_STORE_BYTES:
                    raise PortableBackupError("Portable backup attachment quota exceeded")
                member_path = _attachment_member_path(attachment_id)
                archive.writestr(_zip_info(member_path), object_bytes)
                attachment_records.append({
                    "id": attachment_id,
                    "path": member_path,
                    "size": len(object_bytes),
                    "sha256": object_hash,
                })
            manifest = {
                "format": PORTABLE_BACKUP_FORMAT,
                "version": PORTABLE_BACKUP_VERSION,
                "createdAt": timestamp,
                "vault": {
                    "path": VAULT_NAME,
                    "size": len(envelope_bytes),
                    "sha256": _sha256(envelope_bytes),
                },
                "attachments": attachment_records,
            }
            manifest_bytes = json.dumps(
                manifest,
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
            ).encode("utf-8")
            if len(manifest_bytes) > MAX_MANIFEST_BYTES:
                raise PortableBackupError("Portable backup manifest is too large")
            archive.writestr(_zip_info(MANIFEST_NAME), manifest_bytes)
        if temp_path.stat().st_size > MAX_PACKAGE_BYTES:
            raise PortableBackupError("Portable backup package is too large")
        with temp_path.open("r+b") as handle:
            os.fsync(handle.fileno())
        os.replace(str(temp_path), str(target))
    finally:
        try:
            if temp_path.exists():
                temp_path.unlink()
        except OSError:
            pass
    return {
        "path": str(target),
        "createdAt": timestamp,
        "attachmentCount": len(attachment_records),
        "packageBytes": target.stat().st_size,
    }


class PortableBackupArchive:
    def __init__(self, path: Path) -> None:
        self.path = Path(path)
        self._archive: zipfile.ZipFile | None = None
        self.manifest: Dict[str, Any] = {}
        self.envelope_text = ""
        self.attachment_records: List[Dict[str, Any]] = []

    def __enter__(self) -> "PortableBackupArchive":
        if not self.path.is_file():
            raise FileNotFoundError("Portable backup does not exist")
        if self.path.stat().st_size > MAX_PACKAGE_BYTES:
            raise PortableBackupError("Portable backup package is too large")
        try:
            self._archive = zipfile.ZipFile(self.path, "r", allowZip64=False)
            self._load_header()
            return self
        except Exception:
            self.close()
            raise

    def __exit__(self, exc_type, exc_value, traceback) -> None:
        self.close()

    def close(self) -> None:
        if self._archive is not None:
            self._archive.close()
            self._archive = None

    def summary(self) -> Dict[str, Any]:
        return {
            "name": self.path.name,
            "createdAt": self.manifest["createdAt"],
            "attachmentCount": len(self.attachment_records),
            "packageBytes": self.path.stat().st_size,
        }

    def iter_attachment_objects(self) -> Iterator[Tuple[str, str]]:
        archive = self._require_archive()
        for record in self.attachment_records:
            raw = _read_member(archive, record["path"], record["size"], MAX_ATTACHMENT_OBJECT_BYTES)
            if _sha256(raw) != record["sha256"]:
                raise PortableBackupError("Portable backup attachment hash does not match")
            try:
                object_text = raw.decode("utf-8")
            except UnicodeDecodeError as exc:
                raise PortableBackupError("Portable backup attachment is not UTF-8") from exc
            validate_attachment_object(object_text, record["id"])
            yield record["id"], object_text

    def verify_attachment_objects(self) -> None:
        for _attachment_id, _object_text in self.iter_attachment_objects():
            pass

    def _load_header(self) -> None:
        archive = self._require_archive()
        if archive.comment:
            raise PortableBackupError("Portable backup archive comments are not supported")
        infos = archive.infolist()
        if len(infos) < 2 or len(infos) > MAX_ATTACHMENT_COUNT + 2:
            raise PortableBackupError("Portable backup member count is invalid")
        names = [info.filename for info in infos]
        if len(names) != len(set(names)):
            raise PortableBackupError("Portable backup contains duplicate members")
        total_size = 0
        for info in infos:
            if info.is_dir() or info.flag_bits & 0x1 or info.compress_type != zipfile.ZIP_STORED:
                raise PortableBackupError("Portable backup member format is unsupported")
            if info.file_size < 0 or info.compress_size != info.file_size:
                raise PortableBackupError("Portable backup member size is invalid")
            total_size += info.file_size
            if total_size > MAX_PACKAGE_BYTES:
                raise PortableBackupError("Portable backup contents are too large")
        if MANIFEST_NAME not in names or VAULT_NAME not in names:
            raise PortableBackupError("Portable backup is incomplete")
        manifest_info = archive.getinfo(MANIFEST_NAME)
        manifest_raw = _read_member(archive, MANIFEST_NAME, manifest_info.file_size, MAX_MANIFEST_BYTES)
        try:
            manifest = json.loads(manifest_raw.decode("utf-8"))
        except (UnicodeDecodeError, ValueError) as exc:
            raise PortableBackupError("Portable backup manifest is malformed") from exc
        self.manifest, self.attachment_records = _normalize_manifest(manifest)
        expected_names = {MANIFEST_NAME, VAULT_NAME}
        expected_names.update(record["path"] for record in self.attachment_records)
        if set(names) != expected_names:
            raise PortableBackupError("Portable backup contains missing or unexpected members")
        vault_record = self.manifest["vault"]
        vault_raw = _read_member(archive, VAULT_NAME, vault_record["size"], MAX_VAULT_BYTES)
        if _sha256(vault_raw) != vault_record["sha256"]:
            raise PortableBackupError("Portable backup vault hash does not match")
        try:
            self.envelope_text = vault_raw.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise PortableBackupError("Portable backup vault is not UTF-8") from exc

    def _require_archive(self) -> zipfile.ZipFile:
        if self._archive is None:
            raise RuntimeError("Portable backup archive is closed")
        return self._archive


def inspect_portable_backup(path: Path) -> Dict[str, Any]:
    with PortableBackupArchive(path) as archive:
        archive.verify_attachment_objects()
        return archive.summary()


def _normalize_manifest(value: Any) -> Tuple[Dict[str, Any], List[Dict[str, Any]]]:
    if not isinstance(value, dict) or set(value) != MANIFEST_FIELDS:
        raise PortableBackupError("Portable backup manifest is malformed")
    if value.get("format") != PORTABLE_BACKUP_FORMAT or value.get("version") != PORTABLE_BACKUP_VERSION:
        raise PortableBackupError("Portable backup format is unsupported")
    created_at = _timestamp(value.get("createdAt"))
    vault = _normalize_record(value.get("vault"), VAULT_RECORD_FIELDS, MAX_VAULT_BYTES)
    if vault["path"] != VAULT_NAME:
        raise PortableBackupError("Portable backup vault path is invalid")
    raw_attachments = value.get("attachments")
    if not isinstance(raw_attachments, list) or len(raw_attachments) > MAX_ATTACHMENT_COUNT:
        raise PortableBackupError("Portable backup attachment list is invalid")
    attachments: List[Dict[str, Any]] = []
    seen_ids = set()
    for raw in raw_attachments:
        record = _normalize_record(raw, ATTACHMENT_RECORD_FIELDS, MAX_ATTACHMENT_OBJECT_BYTES)
        attachment_id = validate_attachment_id(record.get("id"))
        if attachment_id in seen_ids or record["path"] != _attachment_member_path(attachment_id):
            raise PortableBackupError("Portable backup attachment record is invalid")
        seen_ids.add(attachment_id)
        record["id"] = attachment_id
        attachments.append(record)
    if [record["id"] for record in attachments] != sorted(seen_ids):
        raise PortableBackupError("Portable backup attachments are not canonical")
    return {
        "format": PORTABLE_BACKUP_FORMAT,
        "version": PORTABLE_BACKUP_VERSION,
        "createdAt": created_at,
        "vault": vault,
        "attachments": attachments,
    }, attachments


def _normalize_record(value: Any, fields: set, max_size: int) -> Dict[str, Any]:
    if not isinstance(value, dict) or set(value) != fields:
        raise PortableBackupError("Portable backup manifest record is malformed")
    size = value.get("size")
    digest = str(value.get("sha256") or "").lower()
    path = value.get("path")
    if isinstance(size, bool) or not isinstance(size, int) or size < 1 or size > max_size:
        raise PortableBackupError("Portable backup member size is invalid")
    if not isinstance(path, str) or not path or not _valid_sha256(digest):
        raise PortableBackupError("Portable backup manifest record is malformed")
    normalized = dict(value)
    normalized["sha256"] = digest
    return normalized


def _normalize_attachment_hashes(value: Mapping[str, str]) -> Dict[str, str]:
    if not isinstance(value, Mapping) or len(value) > MAX_ATTACHMENT_COUNT:
        raise PortableBackupError("Portable backup attachment list is invalid")
    normalized: Dict[str, str] = {}
    for raw_id, raw_hash in value.items():
        attachment_id = validate_attachment_id(raw_id)
        digest = str(raw_hash or "").lower()
        if attachment_id in normalized or not _valid_sha256(digest):
            raise PortableBackupError("Portable backup attachment hash is invalid")
        normalized[attachment_id] = digest
    return normalized


def _read_member(archive: zipfile.ZipFile, name: str, expected_size: int, max_size: int) -> bytes:
    info = archive.getinfo(name)
    if info.file_size != expected_size or info.file_size > max_size:
        raise PortableBackupError("Portable backup member size does not match")
    raw = archive.read(info)
    if len(raw) != expected_size:
        raise PortableBackupError("Portable backup member is truncated")
    return raw


def _attachment_member_path(attachment_id: str) -> str:
    return f"{ATTACHMENT_PREFIX}{validate_attachment_id(attachment_id)}.json"


def _zip_info(name: str) -> zipfile.ZipInfo:
    info = zipfile.ZipInfo(name)
    info.compress_type = zipfile.ZIP_STORED
    info.create_system = 0
    info.external_attr = 0o600 << 16
    return info


def _valid_sha256(value: str) -> bool:
    return len(value) == SHA256_LENGTH and all(character in "0123456789abcdef" for character in value)


def _sha256(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _timestamp(value: Any) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 1 or value > 253402300799:
        raise PortableBackupError("Portable backup timestamp is invalid")
    return value
