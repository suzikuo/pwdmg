from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import math
import struct
import time
from typing import Any, Dict
from urllib.parse import parse_qs, urlparse


SUPPORTED_ALGORITHMS = {
    "SHA1": hashlib.sha1,
    "SHA256": hashlib.sha256,
    "SHA512": hashlib.sha512,
}
MIN_DIGITS = 6
MAX_DIGITS = 8
MIN_PERIOD = 1
MAX_PERIOD = 300
MAX_SECRET_TEXT_LENGTH = 4096
MAX_SECRET_BYTES = 1024


def generate_totp(
    secret: str,
    *,
    timestamp: int | None = None,
    digits: int = 6,
    period: int = 30,
    algorithm: str = "SHA1",
) -> str:
    if not secret:
        return ""

    config = parse_totp_config(secret, digits=digits, period=period, algorithm=algorithm)
    key = _decode_secret(config["secret"])
    now = timestamp if timestamp is not None else time.time()
    if (
        isinstance(now, bool)
        or not isinstance(now, (int, float))
        or not math.isfinite(now)
        or now < 0
    ):
        raise ValueError("TOTP timestamp is invalid")
    counter = int(now // config["period"])
    digest = hmac.new(
        key,
        struct.pack(">Q", counter),
        SUPPORTED_ALGORITHMS[config["algorithm"]],
    ).digest()
    offset = digest[-1] & 0x0F
    code = struct.unpack(">I", digest[offset : offset + 4])[0] & 0x7FFFFFFF
    return str(code % (10 ** config["digits"])).zfill(config["digits"])


def parse_totp_config(
    value: str,
    *,
    digits: int = 6,
    period: int = 30,
    algorithm: str = "SHA1",
) -> Dict[str, Any]:
    if not isinstance(value, str):
        raise ValueError("TOTP secret must be text")
    if len(value) > MAX_SECRET_TEXT_LENGTH:
        raise ValueError("TOTP secret is too long")

    secret = value
    parsed = urlparse(value)
    if parsed.scheme:
        if parsed.scheme.lower() != "otpauth" or parsed.netloc.lower() != "totp":
            raise ValueError("Only otpauth TOTP URIs are supported")
        params = {key.lower(): values[-1] for key, values in parse_qs(parsed.query).items() if values}
        secret = params.get("secret", "")
        digits = _parse_int_parameter(params.get("digits", digits), "digits")
        period = _parse_int_parameter(params.get("period", period), "period")
        algorithm = params.get("algorithm", algorithm)

    normalized_algorithm = str(algorithm or "").replace("-", "").upper()
    if normalized_algorithm not in SUPPORTED_ALGORITHMS:
        raise ValueError("Unsupported TOTP algorithm")
    digits = _parse_int_parameter(digits, "digits")
    period = _parse_int_parameter(period, "period")
    if not MIN_DIGITS <= digits <= MAX_DIGITS:
        raise ValueError("TOTP digits must be between 6 and 8")
    if not MIN_PERIOD <= period <= MAX_PERIOD:
        raise ValueError("TOTP period must be between 1 and 300 seconds")
    if not secret or not secret.strip():
        raise ValueError("TOTP secret is empty")
    return {
        "secret": secret,
        "digits": digits,
        "period": period,
        "algorithm": normalized_algorithm,
    }


def _decode_secret(secret: str) -> bytes:
    cleaned = "".join(secret.upper().split()).replace("-", "").rstrip("=")
    if len(cleaned) > MAX_SECRET_TEXT_LENGTH:
        raise ValueError("TOTP secret is too long")
    padding = "=" * ((8 - len(cleaned) % 8) % 8)
    try:
        key = base64.b32decode(cleaned + padding, casefold=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError("TOTP secret is not valid base32") from exc
    if not key:
        raise ValueError("TOTP secret is empty")
    if len(key) > MAX_SECRET_BYTES:
        raise ValueError("TOTP secret is too large")
    return key


def _parse_int_parameter(value: Any, name: str) -> int:
    if isinstance(value, bool):
        raise ValueError(f"TOTP {name} is invalid")
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.isdigit():
        return int(value)
    raise ValueError(f"TOTP {name} is invalid")
