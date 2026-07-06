import unittest

from pwdmg_core.updater import DesktopUpdateService, UpdateError, compare_versions


class UpdaterTest(unittest.TestCase):
    def test_compare_versions(self):
        self.assertGreater(compare_versions("2.0.1", "2.0.0"), 0)
        self.assertEqual(compare_versions("v2.0.0", "2.0.0"), 0)
        self.assertLess(compare_versions("1.9.9", "2.0.0"), 0)

    def test_parse_manifest_accepts_windows_asset(self):
        service = DesktopUpdateService(current_version="2.0.0")
        manifest = {
            "version": "2.0.1",
            "publishedAt": "2026-07-06T00:00:00Z",
            "notes": "Release notes",
            "assets": {
                "windows": {
                    "url": "https://github.com/owner/repo/releases/download/v2.0.1/MyPasswordDesktop-windows.zip",
                    "fileName": "MyPasswordDesktop-windows.zip",
                    "size": 123,
                    "sha256": "a" * 64,
                }
            },
        }

        parsed = service._parse_manifest(manifest, "https://example.com/update-manifest.json")

        self.assertEqual(parsed["latestVersion"], "2.0.1")
        self.assertEqual(parsed["asset"]["sha256"], "a" * 64)
        self.assertEqual(parsed["asset"]["fileName"], "MyPasswordDesktop-windows.zip")

    def test_parse_manifest_requires_sha256(self):
        service = DesktopUpdateService(current_version="2.0.0")
        manifest = {
            "version": "2.0.1",
            "assets": {
                "windows": {
                    "url": "https://github.com/owner/repo/releases/download/v2.0.1/MyPasswordDesktop-windows.zip",
                    "sha256": "bad",
                }
            },
        }

        with self.assertRaises(UpdateError):
            service._parse_manifest(manifest, "https://example.com/update-manifest.json")


if __name__ == "__main__":
    unittest.main()
