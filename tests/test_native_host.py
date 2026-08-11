import io
import json
import struct
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from pwdmg_core import native_host


class FakeApi:
    def getState(self):
        return {"ok": True, "data": {"locked": True}}

    def getFillPayload(self, entryId, hostname, pageUrl=""):
        return {"ok": True, "data": {"id": entryId, "hostname": hostname, "pageUrl": pageUrl}}

    def unlock(self, password):
        raise RuntimeError(f"must not escape: {password}")


class NativeHostTest(unittest.TestCase):
    def read_message(self, payload):
        with patch.object(native_host.sys, "stdin", SimpleNamespace(buffer=io.BytesIO(payload))):
            return native_host._read_message()

    def test_reads_one_bounded_object_message(self):
        encoded = json.dumps({"method": "getState", "params": {}}).encode("utf-8")
        request = self.read_message(struct.pack("<I", len(encoded)) + encoded)
        self.assertEqual(request["method"], "getState")

    def test_rejects_oversized_truncated_and_non_object_messages(self):
        with self.assertRaises(ValueError):
            self.read_message(struct.pack("<I", native_host.MAX_NATIVE_MESSAGE_BYTES + 1))
        with self.assertRaises(ValueError):
            self.read_message(struct.pack("<I", 8) + b"{}")
        encoded = b"[]"
        with self.assertRaises(ValueError):
            self.read_message(struct.pack("<I", len(encoded)) + encoded)

    @patch("pwdmg_core.native_host.is_plugin_listener_enabled", return_value=True)
    def test_dispatch_rejects_bad_parameters_without_calling_api(self, _enabled):
        response = native_host.dispatch(FakeApi(), {"method": "getFillPayload", "params": {"entryId": "entry-1"}})
        self.assertEqual(response["code"], "INVALID_INPUT")

        response = native_host.dispatch(FakeApi(), {"method": "getState", "params": ["unexpected"]})
        self.assertEqual(response["code"], "INVALID_INPUT")

    @patch("pwdmg_core.native_host.is_plugin_listener_enabled", return_value=True)
    def test_dispatch_does_not_echo_api_exception_details(self, _enabled):
        response = native_host.dispatch(FakeApi(), {"method": "unlock", "params": {"password": "secret-value"}})
        self.assertEqual(response["code"], "NATIVE_HOST_ERROR")
        self.assertNotIn("secret-value", response["message"])

    @patch("pwdmg_core.native_host.is_plugin_listener_enabled", return_value=True)
    def test_dispatch_accepts_a_valid_hostname_bound_fill(self, _enabled):
        response = native_host.dispatch(FakeApi(), {
            "method": "getFillPayload",
            "params": {"entryId": "entry-1", "hostname": "login.example.com"},
        })
        self.assertTrue(response["ok"])
        self.assertEqual(response["data"]["hostname"], "login.example.com")

    @patch("pwdmg_core.native_host.is_plugin_listener_enabled", return_value=True)
    def test_dispatch_accepts_optional_page_url_context(self, _enabled):
        response = native_host.dispatch(FakeApi(), {
            "method": "getFillPayload",
            "params": {
                "entryId": "entry-1",
                "hostname": "login.example.com",
                "pageUrl": "https://login.example.com/account",
            },
        })
        self.assertTrue(response["ok"])
        self.assertEqual(response["data"]["pageUrl"], "https://login.example.com/account")


if __name__ == "__main__":
    unittest.main()
