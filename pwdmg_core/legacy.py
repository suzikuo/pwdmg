from __future__ import annotations

import base64
import hashlib
import json
import string
import uuid
from pathlib import Path
from typing import Any, Dict, List, Tuple

from .domain import extract_domains


STORAGE_KEY = "cardData"
MAX_LEGACY_FILE_BYTES = 32 * 1024 * 1024
MAX_REPORTED_FAILURES = 100
ORIG_ALPHABET = string.ascii_lowercase + string.ascii_uppercase + string.digits
FORWARD_ALPHABETS = {
    "QzA9J": "f7Yemasx9Xl6ZgwrR2bUQtpPnMBikN0H83CKcFvDdLIVyTOhJWoq5EAjS4Guz1",
    "eJoFO": "mTsCKrcUxfeG178gyWdzuMOQPkJwSnNE6LvYaDh4F0qbj lZA253XpB9VitRHIo".replace(" ", ""),
    "ZguKa": "rLsupq10Ulw2kcajiZK5NC4ty8EFPhxdMz9ToA7mOIvbWXYQBeGHVSDR63nJgf",
}
REVERSE_TABLES = {
    prefix: str.maketrans(mapped, ORIG_ALPHABET)
    for prefix, mapped in FORWARD_ALPHABETS.items()
}


def deobfuscate(value: str) -> Tuple[str, bool]:
    if not value or len(value) < 5:
        return "", False
    prefix = value[:5]
    table = REVERSE_TABLES.get(prefix)
    if not table:
        return "", False
    restored = value[5:].translate(table)
    try:
        return base64.b64decode(restored.encode("ascii")).decode("utf-8"), True
    except Exception:
        return "", False


def load_legacy_cards(local_storage_file: Path) -> List[Dict[str, Any]]:
    cards, _ = load_legacy_cards_with_report(local_storage_file)
    return cards


def load_legacy_cards_with_report(local_storage_file: Path) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    report = _new_report(local_storage_file)
    if not local_storage_file.exists():
        return [], report
    try:
        raw_file = local_storage_file.read_bytes()
        report["sourceExists"] = True
        report["sourceDigest"] = hashlib.sha256(raw_file).hexdigest()
        if len(raw_file) > MAX_LEGACY_FILE_BYTES:
            _record_failure(report, "source", "read", "Legacy storage file is too large")
            return [], report
        local_storage = json.loads(raw_file.decode("utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        _record_failure(report, "source", "read", f"Legacy storage is not valid JSON: {exc}")
        return [], report
    if not isinstance(local_storage, dict):
        _record_failure(report, "source", "read", "Legacy storage root is not an object")
        return [], report
    raw_card_data = local_storage.get(STORAGE_KEY)
    if not raw_card_data:
        return [], report
    try:
        encoded_items = json.loads(raw_card_data) if isinstance(raw_card_data, str) else raw_card_data
    except json.JSONDecodeError as exc:
        _record_failure(report, STORAGE_KEY, "parse", f"Legacy card list is not valid JSON: {exc}")
        return [], report
    if not isinstance(encoded_items, list):
        _record_failure(report, STORAGE_KEY, "parse", "Legacy card list is not an array")
        return [], report

    report["encodedItems"] = len(encoded_items)
    cards: List[Dict[str, Any]] = []
    for index, encoded in enumerate(encoded_items):
        item_path = f"{STORAGE_KEY}[{index}]"
        if not isinstance(encoded, str):
            _record_failure(report, item_path, "decode", "Encoded legacy card is not text")
            continue
        raw, ok = deobfuscate(encoded)
        if not ok:
            _record_failure(report, item_path, "decode", "Legacy card could not be decoded")
            continue
        try:
            card = json.loads(raw)
        except json.JSONDecodeError as exc:
            _record_failure(report, item_path, "parse", f"Decoded legacy card is not valid JSON: {exc}")
            continue
        if not isinstance(card, dict):
            _record_failure(report, item_path, "parse", "Decoded legacy card is not an object")
            continue
        cards.append(card)
        report["decodedItems"] += 1
    return cards, report


def convert_legacy_cards(cards: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    entries, _ = convert_legacy_cards_with_report(cards)
    return entries


def convert_legacy_cards_with_report(
    cards: Any,
    report: Dict[str, Any] | None = None,
) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    migration_report = report if report is not None else _new_report(None)
    entries = _convert_cards(cards, migration_report, STORAGE_KEY)
    migration_report["migrated"] = _count_entries(entries)
    return entries, migration_report


def migrate_legacy_file(local_storage_file: Path) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    cards, report = load_legacy_cards_with_report(local_storage_file)
    return convert_legacy_cards_with_report(cards, report)


def _convert_card(card: Dict[str, Any]) -> Dict[str, Any]:
    title = _legacy_text(card.get("appName")) or "Untitled"
    if card.get("type") == "fold":
        return {
            "id": str(uuid.uuid4()),
            "kind": "folder",
            "title": title,
            "domains": extract_domains(title, _legacy_text(card.get("appNote"))),
            "children": convert_legacy_cards(card.get("subCards") or []),
        }
    return {
        "id": str(uuid.uuid4()),
        "kind": "login",
        "title": title,
        "domains": extract_domains(title, _legacy_text(card.get("appNote"))),
        "username": _legacy_text(card.get("appUser")),
        "email": "",
        "password": _legacy_text(card.get("appPwd")),
        "phone": _legacy_text(card.get("appPhone")),
        "loginAccountSource": "auto",
        "note": _legacy_text(card.get("appNote")),
        "totpSecret": _legacy_text(card.get("appTotpSecret")),
        "children": [],
    }


def legacy_file_digest(local_storage_file: Path) -> str:
    if not local_storage_file.exists():
        return ""
    raw = local_storage_file.read_bytes()
    if len(raw) > MAX_LEGACY_FILE_BYTES:
        raise ValueError("Legacy storage file is too large")
    return hashlib.sha256(raw).hexdigest()


def _convert_cards(cards: Any, report: Dict[str, Any], path: str) -> List[Dict[str, Any]]:
    if not isinstance(cards, list):
        _record_failure(report, path, "convert", "Legacy children are not an array")
        return []

    entries: List[Dict[str, Any]] = []
    for index, card in enumerate(cards):
        item_path = f"{path}[{index}]"
        if not isinstance(card, dict):
            _record_failure(report, item_path, "convert", "Legacy card is not an object")
            continue
        try:
            title = _legacy_text(card.get("appName")) or "Untitled"
            note = _legacy_text(card.get("appNote"))
            if card.get("type") == "fold":
                children = _convert_cards(card.get("subCards") or [], report, f"{item_path}.subCards")
                entry = {
                    "id": str(uuid.uuid4()),
                    "kind": "folder",
                    "title": title,
                    "domains": extract_domains(title, note),
                    "children": children,
                }
            else:
                entry = {
                    "id": str(uuid.uuid4()),
                    "kind": "login",
                    "title": title,
                    "domains": extract_domains(title, note),
                    "username": _legacy_text(card.get("appUser")),
                    "email": "",
                    "password": _legacy_text(card.get("appPwd")),
                    "phone": _legacy_text(card.get("appPhone")),
                    "loginAccountSource": "auto",
                    "note": note,
                    "totpSecret": _legacy_text(card.get("appTotpSecret")),
                    "children": [],
                }
            entries.append(entry)
        except (TypeError, ValueError) as exc:
            _record_failure(report, item_path, "convert", str(exc))
    return entries


def _legacy_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, (str, int, float, bool)):
        return str(value).replace("\x00", "")
    raise ValueError("Legacy text field has an unsupported value")


def _new_report(local_storage_file: Path | None) -> Dict[str, Any]:
    return {
        "sourcePath": str(local_storage_file) if local_storage_file is not None else "",
        "sourceExists": False,
        "sourceDigest": "",
        "encodedItems": 0,
        "decodedItems": 0,
        "migrated": 0,
        "skipped": 0,
        "failureCount": 0,
        "failures": [],
    }


def _record_failure(report: Dict[str, Any], path: str, stage: str, message: str) -> None:
    report["skipped"] = int(report.get("skipped") or 0) + 1
    report["failureCount"] = int(report.get("failureCount") or 0) + 1
    failures = report.setdefault("failures", [])
    if len(failures) < MAX_REPORTED_FAILURES:
        failures.append({"path": path, "stage": stage, "message": message})


def _count_entries(entries: List[Dict[str, Any]]) -> int:
    return sum(1 + (_count_entries(entry.get("children") or []) if entry.get("kind") == "folder" else 0) for entry in entries)
