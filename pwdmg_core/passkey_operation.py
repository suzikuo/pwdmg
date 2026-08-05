from __future__ import annotations

import base64
import binascii
import json
import math
import re
from dataclasses import dataclass
from typing import Any, Dict, Mapping, Optional
from urllib.parse import SplitResult, urlsplit


PASSKEY_OPERATION_PROTOCOL_VERSION = 1
BASE64URL_RE = re.compile(r"^[A-Za-z0-9_-]+$")
ANDROID_ORIGIN_PREFIX = "android:apk-key-hash:"
DOMAIN_LABEL_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$")
MAX_REQUEST_BYTES = 64 * 1024
MAX_ORIGIN_BYTES = 2 * 1024
MAX_CHALLENGE_BYTES = 1024
MIN_CHALLENGE_BYTES = 16
MAX_CREDENTIAL_ID_BYTES = 2048
MAX_CREDENTIAL_DESCRIPTORS = 100
MAX_USER_ID_BYTES = 64
MAX_USER_TEXT_BYTES = 512
MAX_RP_TEXT_BYTES = 512
DEFAULT_TIMEOUT_MS = 60_000
MIN_TIMEOUT_MS = 15_000
MAX_TIMEOUT_MS = 120_000
MIN_OPERATION_ID_BYTES = 16
MAX_OPERATION_ID_BYTES = 64
MAX_SAFE_INTEGER = (1 << 53) - 1
MISSING = object()


PasskeyOperationKind = str
PasskeyOperationStatus = str


class PasskeyOperationError(ValueError):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class PasskeyCreateUser:
    id: str
    name: str
    display_name: str


@dataclass(frozen=True)
class PasskeyOperation:
    protocol_version: int
    kind: PasskeyOperationKind
    origin: str
    rp_id: str
    challenge: str
    client_data_hash: str
    timeout_ms: int
    credential_ids: tuple[str, ...]
    requires_user_verification: bool
    rp_name: Optional[str] = None
    user: Optional[PasskeyCreateUser] = None
    algorithm: Optional[int] = None
    discoverable: bool = False


@dataclass(frozen=True)
class NativePasskeyOperation:
    operation: PasskeyOperation
    operation_id: str
    issued_at: int
    expires_at: int


@dataclass(frozen=True)
class PasskeyOperationOutcome:
    kind: PasskeyOperationKind
    operation_id: str
    status: PasskeyOperationStatus
    platform_response_json: Optional[str] = None


@dataclass(frozen=True)
class PasskeyOperationDiagnostic:
    kind: PasskeyOperationKind
    status: PasskeyOperationStatus
    code: str


def parse_passkey_operation(
    kind: PasskeyOperationKind,
    operation_input: Mapping[str, Any],
) -> PasskeyOperation:
    if kind not in {"create", "get"}:
        _fail("INVALID_REQUEST_JSON")
    if not isinstance(operation_input, Mapping):
        _fail("INVALID_REQUEST_JSON")

    origin, origin_host = _read_trusted_origin(_field(operation_input, "trustedOrigin"))
    client_data_hash = _read_base64url(
        _field(operation_input, "clientDataHash"),
        "INVALID_CLIENT_DATA_HASH",
        32,
        32,
    )
    request = _read_request_json(_field(operation_input, "requestJson"))
    rp_source = _read_object(_field(request, "rp"), "INVALID_RP") if kind == "create" else request
    rp_id = _read_rp_id(_field(rp_source, "id") if kind == "create" else _field(request, "rpId"), origin_host)
    credential_ids = _read_credential_descriptors(
        _field(request, "excludeCredentials") if kind == "create" else _field(request, "allowCredentials")
    )
    base = {
        "protocol_version": PASSKEY_OPERATION_PROTOCOL_VERSION,
        "kind": kind,
        "origin": origin,
        "rp_id": rp_id,
        "challenge": _read_base64url(
            _field(request, "challenge"),
            "INVALID_CHALLENGE",
            MIN_CHALLENGE_BYTES,
            MAX_CHALLENGE_BYTES,
        ),
        "client_data_hash": client_data_hash,
        "timeout_ms": _read_timeout(_field(request, "timeout")),
        "credential_ids": tuple(credential_ids),
        "requires_user_verification": True,
    }

    if kind == "get":
        _read_user_verification(_field(request, "userVerification"))
        return PasskeyOperation(**base)

    rp = _read_object(_field(request, "rp"), "INVALID_RP")
    user = _read_object(_field(request, "user"), "INVALID_USER")
    _read_create_selection(_field(request, "authenticatorSelection"))
    _require_es256(_field(request, "pubKeyCredParams"))
    return PasskeyOperation(
        **base,
        rp_name=_read_wire_text(_field(rp, "name"), "INVALID_RP", MAX_RP_TEXT_BYTES),
        user=PasskeyCreateUser(
            id=_read_base64url(_field(user, "id"), "INVALID_USER", 1, MAX_USER_ID_BYTES),
            name=_read_wire_text(_field(user, "name"), "INVALID_USER", MAX_USER_TEXT_BYTES),
            display_name=_read_wire_text(
                _field(user, "displayName"),
                "INVALID_USER",
                MAX_USER_TEXT_BYTES,
            ),
        ),
        algorithm=-7,
        discoverable=True,
    )


def bind_native_passkey_operation(
    operation: PasskeyOperation,
    operation_id: str,
    issued_at: int,
) -> NativePasskeyOperation:
    canonical_id = _read_base64url(
        operation_id,
        "INVALID_OPERATION_ID",
        MIN_OPERATION_ID_BYTES,
        MAX_OPERATION_ID_BYTES,
    )
    if not _is_safe_integer(issued_at) or issued_at <= 0 or issued_at > MAX_SAFE_INTEGER - operation.timeout_ms:
        _fail("INVALID_OPERATION_TICKET")
    return NativePasskeyOperation(
        operation=operation,
        operation_id=canonical_id,
        issued_at=issued_at,
        expires_at=issued_at + operation.timeout_ms,
    )


def is_passkey_operation_expired(ticket: NativePasskeyOperation, now: int) -> bool:
    if not _is_safe_integer(now) or now <= 0:
        _fail("INVALID_OPERATION_TICKET")
    return now >= ticket.expires_at


def create_succeeded_passkey_operation_outcome(
    ticket: NativePasskeyOperation,
    platform_response_json: str,
) -> PasskeyOperationOutcome:
    _read_platform_response_json(platform_response_json)
    return PasskeyOperationOutcome(
        kind=ticket.operation.kind,
        operation_id=ticket.operation_id,
        status="succeeded",
        platform_response_json=platform_response_json,
    )


def create_cancelled_passkey_operation_outcome(
    ticket: NativePasskeyOperation,
) -> PasskeyOperationOutcome:
    return _create_terminal_outcome(ticket, "cancelled")


def create_rejected_passkey_operation_outcome(
    ticket: NativePasskeyOperation,
) -> PasskeyOperationOutcome:
    return _create_terminal_outcome(ticket, "rejected")


def create_failed_passkey_operation_outcome(
    ticket: NativePasskeyOperation,
) -> PasskeyOperationOutcome:
    return _create_terminal_outcome(ticket, "failed")


def to_passkey_operation_diagnostic(
    outcome: PasskeyOperationOutcome,
) -> PasskeyOperationDiagnostic:
    code: str
    if outcome.status == "succeeded":
        code = "SUCCESS"
    elif outcome.status == "cancelled":
        code = "CANCELLED"
    elif outcome.status == "rejected":
        code = "REJECTED"
    else:
        code = "FAILED"
    return PasskeyOperationDiagnostic(kind=outcome.kind, status=outcome.status, code=code)


def _create_terminal_outcome(
    ticket: NativePasskeyOperation,
    status: str,
) -> PasskeyOperationOutcome:
    return PasskeyOperationOutcome(
        kind=ticket.operation.kind,
        operation_id=ticket.operation_id,
        status=status,
    )


def _read_request_json(value: Any) -> Dict[str, Any]:
    request_json = _read_wire_text(value, "INVALID_REQUEST_JSON", MAX_REQUEST_BYTES)
    try:
        return _read_object(
            json.loads(request_json, parse_constant=_reject_json_constant),
            "INVALID_REQUEST_JSON",
        )
    except (TypeError, ValueError, json.JSONDecodeError) as error:
        if isinstance(error, PasskeyOperationError):
            raise
        raise PasskeyOperationError("INVALID_REQUEST_JSON") from error


def _read_trusted_origin(value: Any) -> tuple[str, Optional[str]]:
    origin = _read_wire_text(value, "INVALID_ORIGIN", MAX_ORIGIN_BYTES)
    if origin.startswith(ANDROID_ORIGIN_PREFIX):
        _read_base64url(origin[len(ANDROID_ORIGIN_PREFIX):], "INVALID_ORIGIN", 32, 32)
        return origin, None
    try:
        split = urlsplit(origin)
        host = split.hostname
        port = split.port
    except ValueError as error:
        raise PasskeyOperationError("INVALID_ORIGIN") from error

    if not _is_canonical_origin(split, origin, host, port):
        _fail("INVALID_ORIGIN")
    if split.scheme not in {"https", "http"} or not _is_webauthn_domain(host):
        _fail("INVALID_ORIGIN")
    if split.scheme == "http" and host != "localhost":
        _fail("INVALID_ORIGIN")
    return origin, host


def _is_canonical_origin(
    split: SplitResult,
    origin: str,
    host: Optional[str],
    port: Optional[int],
) -> bool:
    if not split.scheme or not split.netloc or not host:
        return False
    if split.username is not None or split.password is not None:
        return False
    if split.path or split.query or split.fragment:
        return False
    if split.scheme not in {"https", "http"}:
        return False
    canonical_port = ""
    if port is not None and not (split.scheme == "https" and port == 443) and not (split.scheme == "http" and port == 80):
        canonical_port = f":{port}"
    return origin == f"{split.scheme}://{host}{canonical_port}"


def _read_rp_id(value: Any, origin_host: Optional[str]) -> str:
    if value is MISSING and origin_host is None:
        _fail("INVALID_RP_ID")
    rp_id = origin_host if value is MISSING else _read_wire_text(value, "INVALID_RP_ID", 253).lower()
    if not isinstance(rp_id, str) or not _is_webauthn_domain(rp_id):
        _fail("INVALID_RP_ID")
    return rp_id


def _read_credential_descriptors(value: Any) -> list[str]:
    if value is MISSING:
        return []
    if not isinstance(value, list) or len(value) > MAX_CREDENTIAL_DESCRIPTORS:
        _fail("INVALID_CREDENTIAL_DESCRIPTOR")
    ids: list[str] = []
    seen: set[str] = set()
    for descriptor in value:
        raw = _read_object(descriptor, "INVALID_CREDENTIAL_DESCRIPTOR")
        if _field(raw, "type") != "public-key":
            _fail("INVALID_CREDENTIAL_DESCRIPTOR")
        credential_id = _read_base64url(
            _field(raw, "id"),
            "INVALID_CREDENTIAL_DESCRIPTOR",
            1,
            MAX_CREDENTIAL_ID_BYTES,
        )
        if credential_id in seen:
            _fail("DUPLICATE_CREDENTIAL_ID")
        seen.add(credential_id)
        ids.append(credential_id)
    return ids


def _read_create_selection(value: Any) -> None:
    if value is MISSING:
        return
    selection = _read_object(value, "UNSUPPORTED_RESIDENT_KEY")
    resident_key = _field(selection, "residentKey")
    if resident_key is not MISSING:
        if resident_key not in {"required", "preferred", "discouraged"}:
            _fail("UNSUPPORTED_RESIDENT_KEY")
        if resident_key == "discouraged":
            _fail("UNSUPPORTED_RESIDENT_KEY")
    if "requireResidentKey" in selection and not isinstance(selection["requireResidentKey"], bool):
        _fail("UNSUPPORTED_RESIDENT_KEY")
    authenticator_attachment = _field(selection, "authenticatorAttachment")
    if authenticator_attachment is not MISSING and authenticator_attachment != "platform":
        _fail("UNSUPPORTED_AUTHENTICATOR_ATTACHMENT")
    _read_user_verification(_field(selection, "userVerification"))


def _read_user_verification(value: Any) -> None:
    if value is MISSING:
        return
    if value not in {"required", "preferred", "discouraged"}:
        _fail("INVALID_USER_VERIFICATION")


def _require_es256(value: Any) -> None:
    if not isinstance(value, list) or not value or len(value) > 32:
        _fail("UNSUPPORTED_ALGORITHM")
    for parameter in value:
        if not isinstance(parameter, dict):
            continue
        if parameter.get("type") == "public-key" and _is_integer_value(parameter.get("alg"), -7):
            return
    _fail("UNSUPPORTED_ALGORITHM")


def _read_timeout(value: Any) -> int:
    if value is MISSING:
        return DEFAULT_TIMEOUT_MS
    if not _is_safe_integer(value) or value <= 0:
        _fail("INVALID_TIMEOUT")
    return max(MIN_TIMEOUT_MS, min(MAX_TIMEOUT_MS, int(value)))


def _read_platform_response_json(value: Any) -> None:
    response_json = _read_wire_text(value, "INVALID_PLATFORM_RESPONSE", MAX_REQUEST_BYTES)
    try:
        _read_object(
            json.loads(response_json, parse_constant=_reject_json_constant),
            "INVALID_PLATFORM_RESPONSE",
        )
    except (TypeError, ValueError, json.JSONDecodeError) as error:
        if isinstance(error, PasskeyOperationError):
            raise
        raise PasskeyOperationError("INVALID_PLATFORM_RESPONSE") from error


def _read_object(value: Any, code: str) -> Dict[str, Any]:
    if not isinstance(value, dict):
        _fail(code)
    return value


def _reject_json_constant(_: str) -> None:
    raise ValueError("Non-standard JSON constant")


def _field(value: Mapping[str, Any], key: str) -> Any:
    return value[key] if key in value else MISSING


def _read_wire_text(value: Any, code: str, max_bytes: int) -> str:
    if not isinstance(value, str) or not value or value != value.strip():
        _fail(code)
    if len(value.encode("utf-8")) > max_bytes:
        _fail(code)
    return value


def _read_base64url(value: Any, code: str, min_bytes: int, max_bytes: int) -> str:
    text = _read_wire_text(value, code, max_bytes * 2)
    if not BASE64URL_RE.fullmatch(text):
        _fail(code)
    try:
        decoded = base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))
    except (binascii.Error, ValueError) as error:
        raise PasskeyOperationError(code) from error
    canonical = base64.urlsafe_b64encode(decoded).decode("ascii").rstrip("=")
    if canonical != text or not min_bytes <= len(decoded) <= max_bytes:
        _fail(code)
    return text


def _is_webauthn_domain(value: Optional[str]) -> bool:
    if not value or len(value) > 253 or value.endswith("."):
        return False
    labels = value.split(".")
    if value != "localhost" and len(labels) < 2:
        return False
    return all(DOMAIN_LABEL_RE.fullmatch(label) for label in labels)


def _is_safe_integer(value: Any) -> bool:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return False
    if isinstance(value, float) and not math.isfinite(value):
        return False
    return value == int(value) and 0 < value <= MAX_SAFE_INTEGER


def _is_integer_value(value: Any, expected: int) -> bool:
    return not isinstance(value, bool) and isinstance(value, (int, float)) and value == expected


def _fail(code: str) -> None:
    raise PasskeyOperationError(code)
