from __future__ import annotations

import base64
import json
import os
from dataclasses import dataclass
from hashlib import pbkdf2_hmac
from typing import Any, Dict, Tuple

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


AAD = b"mypwdmg-vault-v1"
DEFAULT_ITERATIONS = 390_000


class VaultCryptoError(Exception):
    """Raised when a vault cannot be decrypted or verified."""


@dataclass(frozen=True)
class VaultKey:
    key: bytes
    salt: bytes
    iterations: int


def _b64e(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def _b64d(data: str) -> bytes:
    return base64.b64decode(data.encode("ascii"))


def derive_key(password: str, salt: bytes, iterations: int = DEFAULT_ITERATIONS) -> bytes:
    return pbkdf2_hmac("sha256", (password or "").encode("utf-8"), salt, iterations, dklen=32)


def encrypt_payload(
    password: str,
    payload: Dict[str, Any],
    *,
    iterations: int = DEFAULT_ITERATIONS,
) -> Tuple[Dict[str, Any], VaultKey]:
    salt = os.urandom(16)
    key = derive_key(password, salt, iterations)
    envelope = encrypt_payload_with_key(VaultKey(key=key, salt=salt, iterations=iterations), payload)
    return envelope, VaultKey(key=key, salt=salt, iterations=iterations)


def encrypt_payload_with_key(vault_key: VaultKey, payload: Dict[str, Any]) -> Dict[str, Any]:
    nonce = os.urandom(12)
    raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    ciphertext = AESGCM(vault_key.key).encrypt(nonce, raw, AAD)
    return {
        "format": "mypwdmg-vault",
        "version": 1,
        "cipher": "AES-256-GCM",
        "kdf": {
            "name": "PBKDF2-HMAC-SHA256",
            "iterations": vault_key.iterations,
            "salt": _b64e(vault_key.salt),
        },
        "nonce": _b64e(nonce),
        "ciphertext": _b64e(ciphertext),
    }


def decrypt_payload(password: str, envelope: Dict[str, Any]) -> Tuple[Dict[str, Any], VaultKey]:
    try:
        if envelope.get("format") != "mypwdmg-vault":
            raise VaultCryptoError("Unsupported vault format")
        kdf = envelope["kdf"]
        iterations = int(kdf["iterations"])
        salt = _b64d(kdf["salt"])
        nonce = _b64d(envelope["nonce"])
        ciphertext = _b64d(envelope["ciphertext"])
    except (KeyError, TypeError, ValueError) as exc:
        raise VaultCryptoError("Vault file is malformed") from exc

    key = derive_key(password, salt, iterations)
    try:
        raw = AESGCM(key).decrypt(nonce, ciphertext, AAD)
    except InvalidTag as exc:
        raise VaultCryptoError("Wrong password or corrupted vault") from exc

    try:
        payload = json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise VaultCryptoError("Vault payload is not valid JSON") from exc
    return payload, VaultKey(key=key, salt=salt, iterations=iterations)


def decrypt_payload_with_key(vault_key: VaultKey, envelope: Dict[str, Any]) -> Dict[str, Any]:
    try:
        if envelope.get("format") != "mypwdmg-vault":
            raise VaultCryptoError("Unsupported vault format")
        kdf = envelope["kdf"]
        iterations = int(kdf["iterations"])
        salt = _b64d(kdf["salt"])
        nonce = _b64d(envelope["nonce"])
        ciphertext = _b64d(envelope["ciphertext"])
    except (KeyError, TypeError, ValueError) as exc:
        raise VaultCryptoError("Vault file is malformed") from exc

    if iterations != vault_key.iterations or salt != vault_key.salt:
        raise VaultCryptoError("Vault password changed; unlock again")

    try:
        raw = AESGCM(vault_key.key).decrypt(nonce, ciphertext, AAD)
    except InvalidTag as exc:
        raise VaultCryptoError("Wrong password or corrupted vault") from exc

    try:
        return json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise VaultCryptoError("Vault payload is not valid JSON") from exc
