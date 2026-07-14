import tempfile
import unittest
from pathlib import Path

from main import clear_webview_resource_cache


class WebViewCacheTest(unittest.TestCase):
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
