from __future__ import annotations

import base64
import binascii
import json
import os
from dataclasses import dataclass
from hashlib import pbkdf2_hmac
from typing import Any, Dict, Tuple

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


AAD = b"mypwdmg-vault-v1"
DEFAULT_ITERATIONS = 390_000
MIN_KDF_ITERATIONS = 10_000
MAX_KDF_ITERATIONS = 2_000_000
MIN_SALT_BYTES = 16
MAX_SALT_BYTES = 16
NONCE_BYTES = 12
MIN_CIPHERTEXT_BYTES = 16
MAX_CIPHERTEXT_BYTES = 16 * 1024 * 1024 + MIN_CIPHERTEXT_BYTES
MAX_PLAINTEXT_BYTES = MAX_CIPHERTEXT_BYTES - MIN_CIPHERTEXT_BYTES
MAX_REVISION = (1 << 53) - 1


class VaultCryptoError(Exception):
    """Raised when a vault cannot be decrypted or verified."""


@dataclass(frozen=True)
class VaultKey:
    key: bytes
    salt: bytes
    iterations: int


def _b64e(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def _bounded_int(value: Any, field: str, minimum: int, maximum: int) -> int:
    if isinstance(value, bool):
        raise VaultCryptoError(f"Vault {field} is invalid")
    if isinstance(value, int):
        result = value
    elif isinstance(value, str) and value.isdigit():
        result = int(value)
    else:
        raise VaultCryptoError(f"Vault {field} is invalid")
    if result < minimum or result > maximum:
        raise VaultCryptoError(f"Vault {field} is outside the supported range")
    return result


def _b64d(
    data: Any,
    field: str,
    *,
    minimum: int = 0,
    maximum: int,
    exact: int | None = None,
) -> bytes:
    if not isinstance(data, str) or not data:
        raise VaultCryptoError(f"Vault {field} is invalid")
    max_encoded_length = ((maximum + 2) // 3) * 4
    if len(data) > max_encoded_length:
        raise VaultCryptoError(f"Vault {field} is too large")
    try:
        decoded = base64.b64decode(data.encode("ascii"), validate=True)
    except (UnicodeEncodeError, binascii.Error, ValueError) as exc:
        raise VaultCryptoError(f"Vault {field} is not valid base64") from exc
    if exact is not None and len(decoded) != exact:
        raise VaultCryptoError(f"Vault {field} has an invalid length")
    if len(decoded) < minimum or len(decoded) > maximum:
        raise VaultCryptoError(f"Vault {field} has an invalid length")
    return decoded


def validate_revision(value: Any) -> int:
    return _bounded_int(value, "revision", 0, MAX_REVISION)


def _parse_envelope(envelope: Dict[str, Any]) -> Tuple[int, bytes, bytes, bytes]:
    if not isinstance(envelope, dict):
        raise VaultCryptoError("Vault file is malformed")
    if envelope.get("format") != "mypwdmg-vault":
        raise VaultCryptoError("Unsupported vault format")
    if type(envelope.get("version")) is not int or envelope.get("version") != 1:
        raise VaultCryptoError("Unsupported vault version")
    if envelope.get("cipher") != "AES-256-GCM":
        raise VaultCryptoError("Unsupported vault cipher")

    kdf = envelope.get("kdf")
    if not isinstance(kdf, dict) or kdf.get("name") != "PBKDF2-HMAC-SHA256":
        raise VaultCryptoError("Unsupported vault KDF")
    iterations = _bounded_int(
        kdf.get("iterations"),
        "KDF iteration count",
        MIN_KDF_ITERATIONS,
        MAX_KDF_ITERATIONS,
    )
    salt = _b64d(
        kdf.get("salt"),
        "salt",
        minimum=MIN_SALT_BYTES,
        maximum=MAX_SALT_BYTES,
    )
    nonce = _b64d(
        envelope.get("nonce"),
        "nonce",
        maximum=NONCE_BYTES,
        exact=NONCE_BYTES,
    )
    ciphertext = _b64d(
        envelope.get("ciphertext"),
        "ciphertext",
        minimum=MIN_CIPHERTEXT_BYTES,
        maximum=MAX_CIPHERTEXT_BYTES,
    )
    if "revision" in envelope:
        _bounded_int(envelope["revision"], "revision", 1, MAX_REVISION)
    if "passwordless" in envelope and not isinstance(envelope["passwordless"], bool):
        raise VaultCryptoError("Vault passwordless marker is invalid")
    return iterations, salt, nonce, ciphertext


def validate_envelope(envelope: Dict[str, Any]) -> Dict[str, Any]:
    _parse_envelope(envelope)
    return envelope


def envelope_revision(envelope: Dict[str, Any]) -> int:
    if "revision" not in envelope:
        return 1
    return _bounded_int(envelope["revision"], "revision", 1, MAX_REVISION)


def derive_key(password: str, salt: bytes, iterations: int = DEFAULT_ITERATIONS) -> bytes:
    if not isinstance(salt, bytes) or not MIN_SALT_BYTES <= len(salt) <= MAX_SALT_BYTES:
        raise VaultCryptoError("Vault salt has an invalid length")
    iterations = _bounded_int(
        iterations,
        "KDF iteration count",
        MIN_KDF_ITERATIONS,
        MAX_KDF_ITERATIONS,
    )
    return pbkdf2_hmac("sha256", (password or "").encode("utf-8"), salt, iterations, dklen=32)


def encrypt_payload(
    password: str,
    payload: Dict[str, Any],
    *,
    iterations: int = DEFAULT_ITERATIONS,
) -> Tuple[Dict[str, Any], VaultKey]:
    iterations = _bounded_int(
        iterations,
        "KDF iteration count",
        MIN_KDF_ITERATIONS,
        MAX_KDF_ITERATIONS,
    )
    salt = os.urandom(16)
    key = derive_key(password, salt, iterations)
    envelope = encrypt_payload_with_key(VaultKey(key=key, salt=salt, iterations=iterations), payload)
    envelope["passwordless"] = password == ""
    return envelope, VaultKey(key=key, salt=salt, iterations=iterations)


def encrypt_payload_with_key(vault_key: VaultKey, payload: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(payload, dict):
        raise VaultCryptoError("Vault payload must be an object")
    if not isinstance(vault_key.key, bytes) or len(vault_key.key) != 32:
        raise VaultCryptoError("Vault encryption key has an invalid length")
    if not isinstance(vault_key.salt, bytes) or not MIN_SALT_BYTES <= len(vault_key.salt) <= MAX_SALT_BYTES:
        raise VaultCryptoError("Vault salt has an invalid length")
    iterations = _bounded_int(
        vault_key.iterations,
        "KDF iteration count",
        MIN_KDF_ITERATIONS,
        MAX_KDF_ITERATIONS,
    )
    nonce = os.urandom(12)
    raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if len(raw) > MAX_PLAINTEXT_BYTES:
        raise VaultCryptoError("Vault payload is too large")
    ciphertext = AESGCM(vault_key.key).encrypt(nonce, raw, AAD)
    envelope = {
        "format": "mypwdmg-vault",
        "version": 1,
        "cipher": "AES-256-GCM",
        "kdf": {
            "name": "PBKDF2-HMAC-SHA256",
            "iterations": iterations,
            "salt": _b64e(vault_key.salt),
        },
        "nonce": _b64e(nonce),
        "ciphertext": _b64e(ciphertext),
    }
    if "revision" in payload:
        revision = validate_revision(payload["revision"])
        if revision < 1:
            raise VaultCryptoError("Vault revision is outside the supported range")
        envelope["revision"] = revision
    return envelope


def decrypt_payload(password: str, envelope: Dict[str, Any]) -> Tuple[Dict[str, Any], VaultKey]:
    iterations, salt, nonce, ciphertext = _parse_envelope(envelope)

    key = derive_key(password, salt, iterations)
    try:
        raw = AESGCM(key).decrypt(nonce, ciphertext, AAD)
    except InvalidTag as exc:
        raise VaultCryptoError("Wrong password or corrupted vault") from exc

    try:
        payload = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise VaultCryptoError("Vault payload is not valid JSON") from exc
    if not isinstance(payload, dict):
        raise VaultCryptoError("Vault payload must be an object")
    if "revision" in envelope and validate_revision(payload.get("revision", 0)) != envelope_revision(envelope):
        raise VaultCryptoError("Vault revision metadata does not match its payload")
    return payload, VaultKey(key=key, salt=salt, iterations=iterations)


def decrypt_payload_with_key(vault_key: VaultKey, envelope: Dict[str, Any]) -> Dict[str, Any]:
    iterations, salt, nonce, ciphertext = _parse_envelope(envelope)

    if not isinstance(vault_key.key, bytes) or len(vault_key.key) != 32:
        raise VaultCryptoError("Vault encryption key has an invalid length")
    key_iterations = _bounded_int(
        vault_key.iterations,
        "KDF iteration count",
        MIN_KDF_ITERATIONS,
        MAX_KDF_ITERATIONS,
    )
    if iterations != key_iterations or salt != vault_key.salt:
        raise VaultCryptoError("Vault password changed; unlock again")

    try:
        raw = AESGCM(vault_key.key).decrypt(nonce, ciphertext, AAD)
    except InvalidTag as exc:
        raise VaultCryptoError("Wrong password or corrupted vault") from exc

    try:
        payload = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise VaultCryptoError("Vault payload is not valid JSON") from exc
    if not isinstance(payload, dict):
        raise VaultCryptoError("Vault payload must be an object")
    if "revision" in envelope and validate_revision(payload.get("revision", 0)) != envelope_revision(envelope):
        raise VaultCryptoError("Vault revision metadata does not match its payload")
    return payload
