from __future__ import annotations

import base64
import json
import string
import uuid
from pathlib import Path
from typing import Any, Dict, List, Tuple

from .domain import extract_domains


STORAGE_KEY = "cardData"
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
    if not local_storage_file.exists():
        return []
    try:
        local_storage = json.loads(local_storage_file.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    raw_card_data = local_storage.get(STORAGE_KEY)
    if not raw_card_data:
        return []
    try:
        encoded_items = json.loads(raw_card_data)
    except json.JSONDecodeError:
        return []

    cards: List[Dict[str, Any]] = []
    for encoded in encoded_items:
        raw, ok = deobfuscate(encoded)
        if not ok:
            continue
        try:
            cards.append(json.loads(raw))
        except json.JSONDecodeError:
            continue
    return cards


def convert_legacy_cards(cards: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return [_convert_card(card) for card in cards if card]


def _convert_card(card: Dict[str, Any]) -> Dict[str, Any]:
    title = card.get("appName") or "Untitled"
    if card.get("type") == "fold":
        return {
            "id": str(uuid.uuid4()),
            "kind": "folder",
            "title": title,
            "domains": extract_domains(title, card.get("appNote") or ""),
            "children": convert_legacy_cards(card.get("subCards") or []),
        }
    return {
        "id": str(uuid.uuid4()),
        "kind": "login",
        "title": title,
        "domains": extract_domains(title, card.get("appNote") or ""),
        "username": card.get("appUser") or "",
        "email": "",
        "password": card.get("appPwd") or "",
        "phone": card.get("appPhone") or "",
        "loginAccountSource": "auto",
        "note": card.get("appNote") or "",
        "totpSecret": card.get("appTotpSecret") or "",
        "children": [],
    }
