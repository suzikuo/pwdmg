from __future__ import annotations

import unittest
from unittest.mock import patch

from pwdmg_core.desktop_commands import normalize_external_url, open_external_url


class DesktopCommandsTest(unittest.TestCase):
    def test_normalize_external_url_accepts_http_and_https(self):
        self.assertEqual(
            normalize_external_url(" HTTPS://example.com/path?q=1 "),
            "https://example.com/path?q=1",
        )
        self.assertEqual(normalize_external_url("http://localhost:8080"), "http://localhost:8080")

    def test_normalize_external_url_rejects_unsafe_values(self):
        for value in (
            "javascript:alert(1)",
            "file:///C:/secret.txt",
            "https://user:password@example.com",
            "https://",
            "https://example.com/\nnext",
        ):
            with self.subTest(value=value), self.assertRaises(ValueError):
                normalize_external_url(value)

    @patch("pwdmg_core.desktop_commands.webbrowser.open", return_value=True)
    def test_open_external_url_uses_the_system_browser(self, browser_open):
        self.assertEqual(open_external_url("https://example.com"), "https://example.com")
        browser_open.assert_called_once_with("https://example.com", new=2)


if __name__ == "__main__":
    unittest.main()
