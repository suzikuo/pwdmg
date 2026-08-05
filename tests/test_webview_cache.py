import tempfile
import unittest
from pathlib import Path

from main import (
    DESKTOP_MIN_HEIGHT,
    DESKTOP_MIN_WIDTH,
    DesktopPasswordManagerApi,
    clear_webview_resource_cache,
    get_pywebview_startup_config,
    normalize_desktop_config,
)


class WebViewCacheTest(unittest.TestCase):
    def test_desktop_window_dimensions_are_clamped_to_usable_minimums(self):
        saved = normalize_desktop_config({"width": 120, "height": -20})
        startup = get_pywebview_startup_config({"width": "bad", "height": 200})

        self.assertEqual(saved["width"], DESKTOP_MIN_WIDTH)
        self.assertEqual(saved["height"], DESKTOP_MIN_HEIGHT)
        self.assertEqual(startup["width"], DESKTOP_MIN_WIDTH)
        self.assertEqual(startup["height"], DESKTOP_MIN_HEIGHT)

    def test_desktop_fill_bridge_forwards_hostname_authorization_context(self):
        class FakeApi:
            def getFillPayload(self, entry_id, hostname):
                return {"ok": True, "data": {"id": entry_id, "hostname": hostname}}

        bridge = DesktopPasswordManagerApi()
        bridge._api = FakeApi()

        result = bridge.getFillPayload("entry-1", "login.example.com")

        self.assertEqual(result["data"]["id"], "entry-1")
        self.assertEqual(result["data"]["hostname"], "login.example.com")

    def test_clear_webview_resource_cache_preserves_local_storage(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            storage_dir = Path(temp_dir) / "webview_storage"
            profile_dir = storage_dir / "EBWebView" / "Default"
            cache_dir = profile_dir / "Cache"
            code_cache_dir = profile_dir / "Code Cache"
            local_storage_dir = profile_dir / "Local Storage"

            cache_dir.mkdir(parents=True)
            code_cache_dir.mkdir()
            local_storage_dir.mkdir()
            (cache_dir / "old-resource").write_text("old", encoding="utf-8")
            (code_cache_dir / "old-code").write_text("old", encoding="utf-8")
            (local_storage_dir / "settings").write_text("keep", encoding="utf-8")

            clear_webview_resource_cache(storage_dir)

            self.assertFalse(cache_dir.exists())
            self.assertFalse(code_cache_dir.exists())
            self.assertTrue((local_storage_dir / "settings").is_file())


if __name__ == "__main__":
    unittest.main()
