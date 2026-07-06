from __future__ import annotations

import base64
import hmac
import struct
import time
from hashlib import sha1


def generate_totp(secret: str, *, timestamp: int | None = None, digits: int = 6, period: int = 30) -> str:
    if not secret:
        return ""
    cleaned = "".join(secret.upper().split())
    padding = "=" * ((8 - len(cleaned) % 8) % 8)
    key = base64.b32decode(cleaned + padding, casefold=True)
    counter = int((timestamp if timestamp is not None else time.time()) // period)
    digest = hmac.new(key, struct.pack(">Q", counter), sha1).digest()
    offset = digest[-1] & 0x0F
    code = struct.unpack(">I", digest[offset : offset + 4])[0] & 0x7FFFFFFF
    return str(code % (10**digits)).zfill(digits)
