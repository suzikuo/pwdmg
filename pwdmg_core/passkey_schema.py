from __future__ import annotations

import base64
import binascii
import re
from typing import Any, Dict, List


BASE64URL_RE = re.compile(r"^[A-Za-z0-9_-]+$")
RP_ID_LABEL_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$")
PASSKEY_TRANSPORTS = {"usb", "nfc", "ble", "internal", "hybrid", "smart-card"}
PASSKEY_TRANSPORT_ORDER = ("internal", "hybrid", "usb", "nfc", "ble", "smart-card")
PASSKEY_FIELDS = {
    "id", "label", "credentialId", "rpId", "rpName", "userHandle", "userName", "userDisplayName",
    "algorithm", "publicKeyCose", "privateKeyPkcs8", "discoverable", "backupEligible",
    "backupState", "transports", "entryId", "createdAt", "updatedAt",
}
TOMBSTONE_FIELDS = {"id", "credentialId", "deletedAt"}
PASSKEY_SCHEMA_VERSION = 1
MAX_ID_LENGTH = 128
MAX_CREDENTIAL_ID_LENGTH = 2048
MAX_KEY_LENGTH = 16_384
MAX_USER_HANDLE_LENGTH = 256
MAX_DISPLAY_LENGTH = 512
MAX_PASSKEY_ITEMS = 10_000


def normalize_passkey_state(payload: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValueError("Vault payload must be an object")
    declared_version = _normalize_payload_version(payload.get("version", 1), False)
    if declared_version == 2:
        for key in ("passkeys", "passkeyTombstones"):
            if key not in payload:
                raise ValueError(f"Vault version 2 requires {key}")
    passkeys = _normalize_passkeys(_read_array(payload, "passkeys"))
    tombstones = _normalize_tombstones(_read_array(payload, "passkeyTombstones"))
    has_passkey_state = declared_version == 2 or bool(passkeys or tombstones)
    schema_version = _read_schema_version(payload.get("passkeySchemaVersion"), has_passkey_state)
    live_ids = {passkey["id"] for passkey in passkeys}
    live_credential_ids = {passkey["credentialId"] for passkey in passkeys}
    for tombstone in tombstones:
        if tombstone["id"] in live_ids:
            raise ValueError(f"Passkey {tombstone['id']} cannot be live and deleted")
        if tombstone["credentialId"] in live_credential_ids:
            raise ValueError(
                f"Passkey credential {tombstone['credentialId']} cannot be live and deleted"
            )
    result = {
        "version": _normalize_payload_version(
            payload.get("version", 1),
            bool(passkeys or tombstones),
        ),
        "passkeys": passkeys,
        "passkeyTombstones": tombstones,
    }
    if has_passkey_state:
        result["passkeySchemaVersion"] = schema_version
    return result


def _normalize_passkeys(values: List[Any]) -> List[Dict[str, Any]]:
    normalized: List[Dict[str, Any]] = []
    ids: set[str] = set()
    credential_ids: set[str] = set()
    for index, value in enumerate(values):
        field = f"passkeys[{index}]"
        raw = _read_object(value, field)
        _assert_known_fields(raw, PASSKEY_FIELDS, field)
        passkey_id = _read_text(raw.get("id"), f"{field}.id", MAX_ID_LENGTH)
        credential_id = _read_base64url(
            raw.get("credentialId"),
            f"{field}.credentialId",
            MAX_CREDENTIAL_ID_LENGTH,
        )
        if passkey_id in ids:
            raise ValueError(f"Duplicate passkey id: {passkey_id}")
        if credential_id in credential_ids:
            raise ValueError(f"Duplicate passkey credentialId: {credential_id}")
        ids.add(passkey_id)
        credential_ids.add(credential_id)

        backup_eligible = _read_bool(raw.get("backupEligible"), f"{field}.backupEligible")
        backup_state = _read_bool(raw.get("backupState"), f"{field}.backupState")
        if backup_state and not backup_eligible:
            raise ValueError(f"{field}.backupState requires backupEligible")
        created_at = _read_timestamp(raw.get("createdAt"), f"{field}.createdAt")
        updated_at = _read_timestamp(raw.get("updatedAt"), f"{field}.updatedAt")
        if updated_at < created_at:
            raise ValueError(f"{field}.updatedAt predates createdAt")

        item: Dict[str, Any] = {
            "id": passkey_id,
            "credentialId": credential_id,
            "rpId": _read_rp_id(raw.get("rpId"), f"{field}.rpId"),
            "userHandle": _read_base64url(
                raw.get("userHandle"),
                f"{field}.userHandle",
                MAX_USER_HANDLE_LENGTH,
            ),
            "userName": _read_text(raw.get("userName"), f"{field}.userName", MAX_DISPLAY_LENGTH),
            "algorithm": _read_algorithm(raw.get("algorithm"), f"{field}.algorithm"),
            "publicKeyCose": _read_base64url(
                raw.get("publicKeyCose"),
                f"{field}.publicKeyCose",
                MAX_KEY_LENGTH,
            ),
            "privateKeyPkcs8": _read_base64url(
                raw.get("privateKeyPkcs8"),
                f"{field}.privateKeyPkcs8",
                MAX_KEY_LENGTH,
            ),
            "discoverable": _read_bool(raw.get("discoverable"), f"{field}.discoverable"),
            "backupEligible": backup_eligible,
            "backupState": backup_state,
            "transports": _read_transports(raw.get("transports"), f"{field}.transports"),
            "createdAt": created_at,
            "updatedAt": updated_at,
        }
        for key, max_length in (
            ("label", MAX_DISPLAY_LENGTH),
            ("rpName", MAX_DISPLAY_LENGTH),
            ("userDisplayName", MAX_DISPLAY_LENGTH),
            ("entryId", MAX_ID_LENGTH),
        ):
            optional = _read_optional_text(raw.get(key), f"{field}.{key}", max_length)
            if optional:
                item[key] = optional
        normalized.append(item)
    return normalized


def _normalize_tombstones(values: List[Any]) -> List[Dict[str, Any]]:
    normalized: List[Dict[str, Any]] = []
    ids: set[str] = set()
    credential_ids: set[str] = set()
    for index, value in enumerate(values):
        field = f"passkeyTombstones[{index}]"
        raw = _read_object(value, field)
        _assert_known_fields(raw, TOMBSTONE_FIELDS, field)
        passkey_id = _read_text(raw.get("id"), f"{field}.id", MAX_ID_LENGTH)
        credential_id = _read_base64url(
            raw.get("credentialId"),
            f"{field}.credentialId",
            MAX_CREDENTIAL_ID_LENGTH,
        )
        if passkey_id in ids:
            raise ValueError(f"Duplicate passkey tombstone id: {passkey_id}")
        if credential_id in credential_ids:
            raise ValueError(f"Duplicate passkey tombstone credentialId: {credential_id}")
        ids.add(passkey_id)
        credential_ids.add(credential_id)
        normalized.append(
            {
                "id": passkey_id,
                "credentialId": credential_id,
                "deletedAt": _read_timestamp(raw.get("deletedAt"), f"{field}.deletedAt"),
            }
        )
    return normalized


def _normalize_payload_version(value: Any, has_passkey_state: bool) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value not in {1, 2}:
        raise ValueError("Unsupported vault payload version")
    return 2 if value == 2 or has_passkey_state else 1


def _read_array(payload: Dict[str, Any], key: str) -> List[Any]:
    value = payload.get(key, [])
    if not isinstance(value, list):
        raise ValueError(f"Vault {key} must be an array")
    if len(value) > MAX_PASSKEY_ITEMS:
        raise ValueError(f"Vault {key} exceeds the supported item limit")
    return value


def _read_object(value: Any, field: str) -> Dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"{field} must be an object")
    return value


def _read_text(value: Any, field: str, max_length: int) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{field} must be a string")
    text = value.strip()
    if not text or len(text.encode("utf-8")) > max_length:
        raise ValueError(f"{field} has an invalid length")
    return text


def _read_optional_text(value: Any, field: str, max_length: int) -> str:
    if value is None or value == "":
        return ""
    return _read_text(value, field, max_length)


def _read_base64url(value: Any, field: str, max_length: int) -> str:
    text = _read_text(value, field, max_length)
    if not BASE64URL_RE.fullmatch(text):
        raise ValueError(f"{field} must be unpadded base64url")
    try:
        decoded = base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))
    except (binascii.Error, ValueError) as exc:
        raise ValueError(f"{field} must be canonical unpadded base64url") from exc
    canonical = base64.urlsafe_b64encode(decoded).decode("ascii").rstrip("=")
    if canonical != text:
        raise ValueError(f"{field} must be canonical unpadded base64url")
    return text


def _read_rp_id(value: Any, field: str) -> str:
    rp_id = _read_text(value, field, 253).lower().removesuffix(".")
    if any(not RP_ID_LABEL_RE.fullmatch(label) for label in rp_id.split(".")):
        raise ValueError(f"{field} is invalid")
    return rp_id


def _read_bool(value: Any, field: str) -> bool:
    if not isinstance(value, bool):
        raise ValueError(f"{field} must be a boolean")
    return value


def _read_algorithm(value: Any, field: str) -> int:
    if isinstance(value, bool) or value != -7:
        raise ValueError(f"{field} supports ES256 (-7) only")
    return -7


def _read_timestamp(value: Any, field: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0 or value > (1 << 53) - 1:
        raise ValueError(f"{field} is invalid")
    return value


def _read_transports(value: Any, field: str) -> List[str]:
    if not isinstance(value, list):
        raise ValueError(f"{field} must be an array")
    transports: List[str] = []
    for transport in value:
        if not isinstance(transport, str) or transport not in PASSKEY_TRANSPORTS:
            raise ValueError(f"{field} contains an unsupported transport")
        if transport not in transports:
            transports.append(transport)
    return [transport for transport in PASSKEY_TRANSPORT_ORDER if transport in transports]


def _read_schema_version(value: Any, required: bool) -> Any:
    if not required and value is None:
        return None
    version = PASSKEY_SCHEMA_VERSION if value is None else value
    if isinstance(version, bool) or version != PASSKEY_SCHEMA_VERSION:
        raise ValueError("Unsupported passkey schema version")
    return PASSKEY_SCHEMA_VERSION


def _assert_known_fields(raw: Dict[str, Any], known: set[str], field: str) -> None:
    unknown = sorted(set(raw) - known)
    if unknown:
        raise ValueError(f"{field} contains unsupported fields: {', '.join(unknown)}")
