from __future__ import annotations

import json
import struct
import sys
from typing import Any, Dict

from pwdmg_core.api import PasswordManagerApi
from pwdmg_core.native_install import is_plugin_listener_enabled


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
    message_length = struct.unpack("<I", raw_length)[0]
    message = sys.stdin.buffer.read(message_length)
    if not message:
        return None
    return json.loads(message.decode("utf-8"))


def _write_message(message: Dict[str, Any]) -> None:
    encoded = json.dumps(message, ensure_ascii=False).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("<I", len(encoded)))
    sys.stdout.buffer.write(encoded)
    sys.stdout.buffer.flush()


def dispatch(api: PasswordManagerApi, request: Dict[str, Any]) -> Dict[str, Any]:
    if not is_plugin_listener_enabled():
        return {
            "ok": False,
            "code": "PLUGIN_DISABLED",
            "message": "插件监听已在桌面端关闭。",
        }

    method = request.get("method")
    params = request.get("params") or {}
    if not method or method not in ALLOWED_METHODS or not hasattr(api, method):
        return {
            "ok": False,
            "code": "UNKNOWN_METHOD",
            "message": f"Unknown method: {method}",
        }
    fn = getattr(api, method)
    if isinstance(params, dict):
        return fn(**params)
    return fn(*params)


def main() -> None:
    api = PasswordManagerApi()
    while True:
        request = _read_message()
        if request is None:
            break
        response = dispatch(api, request)
        if "id" in request:
            response["id"] = request["id"]
        _write_message(response)


if __name__ == "__main__":
    main()
