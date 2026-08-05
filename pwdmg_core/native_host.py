from __future__ import annotations

import inspect
import json
import struct
import sys
from typing import Any, Dict

from pwdmg_core.api import PasswordManagerApi
from pwdmg_core.native_install import is_plugin_listener_enabled


MAX_NATIVE_MESSAGE_BYTES = 1024 * 1024

ALLOWED_METHODS = {
    "getState",
    "unlock",
    "lock",
    "queryMatches",
    "getFillPayload",
    "listSaveTargets",
    "previewCapturedLogin",
    "saveCapturedLogin",
    "generateTotp",
}


def _read_message() -> Dict[str, Any] | None:
    raw_length = sys.stdin.buffer.read(4)
    if not raw_length:
        return None
    if len(raw_length) != 4:
        raise ValueError("Truncated native message header")
    message_length = struct.unpack("<I", raw_length)[0]
    if message_length <= 0 or message_length > MAX_NATIVE_MESSAGE_BYTES:
        raise ValueError("Invalid native message length")

    chunks = []
    remaining = message_length
    while remaining:
        chunk = sys.stdin.buffer.read(remaining)
        if not chunk:
            raise ValueError("Truncated native message body")
        chunks.append(chunk)
        remaining -= len(chunk)

    try:
        request = json.loads(b"".join(chunks).decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError("Invalid native message JSON") from exc
    if not isinstance(request, dict):
        raise ValueError("Native message must be an object")
    return request


def _write_message(message: Dict[str, Any]) -> None:
    encoded = json.dumps(message, ensure_ascii=False).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("<I", len(encoded)))
    sys.stdout.buffer.write(encoded)
    sys.stdout.buffer.flush()


def dispatch(api: PasswordManagerApi, request: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(request, dict):
        return {
            "ok": False,
            "code": "INVALID_INPUT",
            "message": "Invalid native host request.",
        }
    if not is_plugin_listener_enabled():
        return {
            "ok": False,
            "code": "PLUGIN_DISABLED",
            "message": "插件监听已在桌面端关闭。",
        }

    method = request.get("method")
    params = request.get("params", {})
    if not isinstance(method, str) or method not in ALLOWED_METHODS or not hasattr(api, method):
        return {
            "ok": False,
            "code": "UNKNOWN_METHOD",
            "message": "Unknown native host method.",
        }
    if params is None:
        params = {}
    if not isinstance(params, dict):
        return {
            "ok": False,
            "code": "INVALID_INPUT",
            "message": "Invalid native host request parameters.",
        }
    fn = getattr(api, method)
    try:
        inspect.signature(fn).bind(**params)
    except TypeError:
        return {
            "ok": False,
            "code": "INVALID_INPUT",
            "message": "Invalid native host request parameters.",
        }
    try:
        response = fn(**params)
    except Exception:
        return {
            "ok": False,
            "code": "NATIVE_HOST_ERROR",
            "message": "Native host request failed.",
        }
    if not isinstance(response, dict):
        return {
            "ok": False,
            "code": "NATIVE_HOST_ERROR",
            "message": "Native host returned an invalid response.",
        }
    return response


def main() -> None:
    api = PasswordManagerApi()
    while True:
        try:
            request = _read_message()
        except ValueError:
            break
        if request is None:
            break
        response = dispatch(api, request)
        if "id" in request:
            response["id"] = request["id"]
        _write_message(response)


if __name__ == "__main__":
    main()
