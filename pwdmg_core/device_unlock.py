from __future__ import annotations

import base64
import ctypes
import hashlib
import json
import os
import time
import uuid
from ctypes import wintypes
from pathlib import Path
from typing import Callable, Protocol

from .crypto import MAX_KDF_ITERATIONS, MIN_KDF_ITERATIONS, VaultKey
from .paths import DEVICE_UNLOCK_FILE


DEVICE_UNLOCK_VERSION = 1
DEFAULT_REAUTH_SECONDS = 7 * 24 * 60 * 60
MIN_REAUTH_SECONDS = 60 * 60
MAX_REAUTH_SECONDS = 30 * 24 * 60 * 60
MAX_DEVICE_UNLOCK_FILE_BYTES = 128 * 1024
PURPOSE = b"mypwdmg-device-unlock-v1"


class DeviceUnlockError(ValueError):
    pass


class DeviceProtector(Protocol):
    @property
    def supported(self) -> bool: ...

    def protect(self, plaintext: bytes, entropy: bytes) -> bytes: ...

    def unprotect(self, ciphertext: bytes, entropy: bytes) -> bytes: ...


class WindowsDpapiProtector:
    @property
    def supported(self) -> bool:
        return os.name == "nt"

    def protect(self, plaintext: bytes, entropy: bytes) -> bytes:
        return _dpapi_call("CryptProtectData", plaintext, entropy)

    def unprotect(self, ciphertext: bytes, entropy: bytes) -> bytes:
        return _dpapi_call("CryptUnprotectData", ciphertext, entropy)


class DeviceUnlockStore:
    def __init__(
        self,
        path: Path | None = None,
        protector: DeviceProtector | None = None,
        now: Callable[[], int] | None = None,
    ) -> None:
        self.path = path or DEVICE_UNLOCK_FILE
        self.protector = protector or WindowsDpapiProtector()
        self.now = now or (lambda: int(time.time()))

    @property
    def supported(self) -> bool:
        return bool(self.protector.supported)

    def state(self, vault_path: Path) -> dict:
        if not self.supported:
            return {"supported": False, "enabled": False, "expiresAt": 0}
        try:
            outer = self._read_outer(vault_path)
            if int(outer["expiresAt"]) <= self.now():
                self.disable()
                return {"supported": True, "enabled": False, "expiresAt": 0}
            return {"supported": True, "enabled": True, "expiresAt": int(outer["expiresAt"])}
        except FileNotFoundError:
            return {"supported": True, "enabled": False, "expiresAt": 0}
        except Exception:
            self.disable()
            return {"supported": True, "enabled": False, "expiresAt": 0}

    def enable(
        self,
        vault_path: Path,
        vault_key: VaultKey,
        reauth_seconds: int = DEFAULT_REAUTH_SECONDS,
    ) -> dict:
        if not self.supported:
            raise DeviceUnlockError("DEVICE_UNLOCK_UNSUPPORTED")
        if not isinstance(reauth_seconds, int) or isinstance(reauth_seconds, bool):
            raise DeviceUnlockError("DEVICE_UNLOCK_INTERVAL_INVALID")
        if not MIN_REAUTH_SECONDS <= reauth_seconds <= MAX_REAUTH_SECONDS:
            raise DeviceUnlockError("DEVICE_UNLOCK_INTERVAL_INVALID")
        _validate_vault_key(vault_key)
        now = self.now()
        if now <= 0:
            raise DeviceUnlockError("DEVICE_UNLOCK_TIME_INVALID")
        binding = _vault_binding(vault_path)
        payload = json.dumps({
            "version": DEVICE_UNLOCK_VERSION,
            "vaultPath": binding,
            "key": _b64e(vault_key.key),
            "salt": _b64e(vault_key.salt),
            "iterations": vault_key.iterations,
            "verifiedAt": now,
            "expiresAt": now + reauth_seconds,
        }, separators=(",", ":")).encode("utf-8")
        protected = self.protector.protect(payload, _entropy(binding))
        outer = {
            "version": DEVICE_UNLOCK_VERSION,
            "vaultPathHash": _path_hash(binding),
            "expiresAt": now + reauth_seconds,
            "protected": _b64e(protected),
        }
        self._write_outer(outer)
        return {"supported": True, "enabled": True, "expiresAt": now + reauth_seconds}

    def load(self, vault_path: Path) -> VaultKey:
        if not self.supported:
            raise DeviceUnlockError("DEVICE_UNLOCK_UNSUPPORTED")
        try:
            outer = self._read_outer(vault_path)
            binding = _vault_binding(vault_path)
            protected = _b64d(outer["protected"], MAX_DEVICE_UNLOCK_FILE_BYTES)
            raw = self.protector.unprotect(protected, _entropy(binding))
            if len(raw) > MAX_DEVICE_UNLOCK_FILE_BYTES:
                raise DeviceUnlockError("DEVICE_UNLOCK_INVALID")
            payload = json.loads(raw.decode("utf-8"))
            expected = {"version", "vaultPath", "key", "salt", "iterations", "verifiedAt", "expiresAt"}
            if not isinstance(payload, dict) or set(payload) != expected:
                raise DeviceUnlockError("DEVICE_UNLOCK_INVALID")
            if payload["version"] != DEVICE_UNLOCK_VERSION or payload["vaultPath"] != binding:
                raise DeviceUnlockError("DEVICE_UNLOCK_INVALID")
            expires_at = _positive_int(payload["expiresAt"])
            verified_at = _positive_int(payload["verifiedAt"])
            if expires_at != outer["expiresAt"] or verified_at > self.now() or self.now() >= expires_at:
                raise DeviceUnlockError("DEVICE_UNLOCK_EXPIRED")
            key = VaultKey(
                key=_b64d(payload["key"], 32),
                salt=_b64d(payload["salt"], 16),
                iterations=_positive_int(payload["iterations"]),
            )
            _validate_vault_key(key)
            return key
        except DeviceUnlockError:
            self.disable()
            raise
        except Exception as error:
            self.disable()
            raise DeviceUnlockError("DEVICE_UNLOCK_INVALID") from error

    def disable(self) -> None:
        try:
            self.path.unlink()
        except FileNotFoundError:
            pass

    def _read_outer(self, vault_path: Path) -> dict:
        raw = self.path.read_bytes()
        if not raw or len(raw) > MAX_DEVICE_UNLOCK_FILE_BYTES:
            raise DeviceUnlockError("DEVICE_UNLOCK_INVALID")
        outer = json.loads(raw.decode("utf-8"))
        expected = {"version", "vaultPathHash", "expiresAt", "protected"}
        if not isinstance(outer, dict) or set(outer) != expected:
            raise DeviceUnlockError("DEVICE_UNLOCK_INVALID")
        if outer["version"] != DEVICE_UNLOCK_VERSION:
            raise DeviceUnlockError("DEVICE_UNLOCK_INVALID")
        if outer["vaultPathHash"] != _path_hash(_vault_binding(vault_path)):
            raise DeviceUnlockError("DEVICE_UNLOCK_INVALID")
        outer["expiresAt"] = _positive_int(outer["expiresAt"])
        if not isinstance(outer["protected"], str) or not outer["protected"]:
            raise DeviceUnlockError("DEVICE_UNLOCK_INVALID")
        return outer

    def _write_outer(self, outer: dict) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        encoded = json.dumps(outer, ensure_ascii=True, separators=(",", ":")).encode("utf-8")
        if len(encoded) > MAX_DEVICE_UNLOCK_FILE_BYTES:
            raise DeviceUnlockError("DEVICE_UNLOCK_INVALID")
        temp = self.path.with_name(f".{self.path.name}.{uuid.uuid4().hex}.tmp")
        try:
            temp.write_bytes(encoded)
            os.replace(temp, self.path)
        finally:
            try:
                temp.unlink()
            except FileNotFoundError:
                pass


class _DataBlob(ctypes.Structure):
    _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_ubyte))]


def _dpapi_call(function_name: str, value: bytes, entropy: bytes) -> bytes:
    if os.name != "nt":
        raise DeviceUnlockError("DEVICE_UNLOCK_UNSUPPORTED")
    value_buffer = ctypes.create_string_buffer(value)
    entropy_buffer = ctypes.create_string_buffer(entropy)
    value_blob = _DataBlob(len(value), ctypes.cast(value_buffer, ctypes.POINTER(ctypes.c_ubyte)))
    entropy_blob = _DataBlob(len(entropy), ctypes.cast(entropy_buffer, ctypes.POINTER(ctypes.c_ubyte)))
    output_blob = _DataBlob()
    crypt32 = ctypes.WinDLL("crypt32", use_last_error=True)
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    function = getattr(crypt32, function_name)
    function.argtypes = [
        ctypes.POINTER(_DataBlob), wintypes.LPCWSTR, ctypes.POINTER(_DataBlob),
        wintypes.LPVOID, wintypes.LPVOID, wintypes.DWORD, ctypes.POINTER(_DataBlob),
    ] if function_name == "CryptProtectData" else [
        ctypes.POINTER(_DataBlob), ctypes.POINTER(wintypes.LPWSTR), ctypes.POINTER(_DataBlob),
        wintypes.LPVOID, wintypes.LPVOID, wintypes.DWORD, ctypes.POINTER(_DataBlob),
    ]
    function.restype = wintypes.BOOL
    kernel32.LocalFree.argtypes = [ctypes.c_void_p]
    kernel32.LocalFree.restype = ctypes.c_void_p
    args = (
        ctypes.byref(value_blob),
        "My Password device unlock" if function_name == "CryptProtectData" else None,
        ctypes.byref(entropy_blob), None, None, 0x1, ctypes.byref(output_blob),
    )
    try:
        if not function(*args):
            raise DeviceUnlockError("DEVICE_UNLOCK_PROTECTION_FAILED")
        return ctypes.string_at(output_blob.pbData, output_blob.cbData)
    finally:
        ctypes.memset(value_buffer, 0, len(value_buffer))
        ctypes.memset(entropy_buffer, 0, len(entropy_buffer))
        if output_blob.pbData:
            ctypes.memset(output_blob.pbData, 0, output_blob.cbData)
            kernel32.LocalFree(ctypes.cast(output_blob.pbData, ctypes.c_void_p))


def _validate_vault_key(vault_key: VaultKey) -> None:
    if not isinstance(vault_key, VaultKey) or len(vault_key.key) != 32 or len(vault_key.salt) != 16:
        raise DeviceUnlockError("DEVICE_UNLOCK_KEY_INVALID")
    if not MIN_KDF_ITERATIONS <= vault_key.iterations <= MAX_KDF_ITERATIONS:
        raise DeviceUnlockError("DEVICE_UNLOCK_KEY_INVALID")


def _vault_binding(path: Path) -> str:
    return str(path.resolve()).casefold()


def _path_hash(binding: str) -> str:
    return hashlib.sha256(PURPOSE + b"\0" + binding.encode("utf-8")).hexdigest()


def _entropy(binding: str) -> bytes:
    return hashlib.sha256(PURPOSE + b"\0entropy\0" + binding.encode("utf-8")).digest()


def _positive_int(value: object) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise DeviceUnlockError("DEVICE_UNLOCK_INVALID")
    return value


def _b64e(value: bytes) -> str:
    return base64.b64encode(value).decode("ascii")


def _b64d(value: object, expected_size: int) -> bytes:
    if not isinstance(value, str) or not value:
        raise DeviceUnlockError("DEVICE_UNLOCK_INVALID")
    try:
        decoded = base64.b64decode(value, validate=True)
    except Exception as error:
        raise DeviceUnlockError("DEVICE_UNLOCK_INVALID") from error
    if len(decoded) != expected_size and expected_size != MAX_DEVICE_UNLOCK_FILE_BYTES:
        raise DeviceUnlockError("DEVICE_UNLOCK_INVALID")
    if expected_size == MAX_DEVICE_UNLOCK_FILE_BYTES and len(decoded) > expected_size:
        raise DeviceUnlockError("DEVICE_UNLOCK_INVALID")
    return decoded
