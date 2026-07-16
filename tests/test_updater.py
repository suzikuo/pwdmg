import base64
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from pwdmg_core.updater import (
    DEFAULT_UPDATE_MANIFEST_URL,
    DesktopUpdateService,
    UPDATE_SIGNING_KEY_ID,
    UpdateError,
    canonical_manifest_bytes,
    compare_versions,
    verified_metadata_path,
)


class UpdaterTest(unittest.TestCase):
    def setUp(self):
        self.private_key = Ed25519PrivateKey.generate()
        raw_public = self.private_key.public_key().public_bytes(
            serialization.Encoding.Raw,
            serialization.PublicFormat.Raw,
        )
        self.public_key_b64 = base64.b64encode(raw_public).decode("ascii")

    def service(self, **kwargs):
        return DesktopUpdateService(public_key_b64=self.public_key_b64, **kwargs)

    def signed_manifest(
        self,
        *,
        version="2.0.1",
        package=b"test update package",
        url="https://github.com/owner/repo/releases/download/v2.0.1/MyPasswordDesktop-windows.zip",
        urls=None,
        file_name="MyPasswordDesktop-windows.zip",
    ):
        asset = {
            "url": url,
            "fileName": file_name,
            "size": len(package),
            "sha256": hashlib.sha256(package).hexdigest(),
        }
        if urls is not None:
            asset["urls"] = urls
        manifest = {
            "version": version,
            "publishedAt": "2026-07-06T00:00:00Z",
            "notes": "Release notes",
            "assets": {"windows": asset},
        }
        signature = self.private_key.sign(canonical_manifest_bytes(manifest))
        manifest["signature"] = {
            "algorithm": "Ed25519",
            "keyId": UPDATE_SIGNING_KEY_ID,
            "value": base64.b64encode(signature).decode("ascii"),
        }
        return manifest

    def test_compare_versions(self):
        self.assertGreater(compare_versions("2.0.1", "2.0.0"), 0)
        self.assertEqual(compare_versions("v2.0.0", "2.0.0"), 0)
        self.assertLess(compare_versions("1.9.9", "2.0.0"), 0)

    def test_empty_manifest_url_uses_official_release_manifest(self):
        service = self.service(current_version="2.0.0")

        self.assertEqual(service._normalize_manifest_url(""), DEFAULT_UPDATE_MANIFEST_URL)
        self.assertEqual(
            DEFAULT_UPDATE_MANIFEST_URL,
            "https://github.com/suzikuo/pwdmg/releases/latest/download/update-manifest.json",
        )
        self.assertNotIn("ghproxy", DEFAULT_UPDATE_MANIFEST_URL)

    def test_manifest_url_accepts_signed_custom_candidates(self):
        service = self.service(current_version="2.0.0")

        urls = service._normalize_manifest_urls(
            "https://updates.example.com/update.json, https://github.com/owner/repo/releases/latest/download/update-manifest.json"
        )

        self.assertEqual(
            urls,
            [
                "https://updates.example.com/update.json",
                "https://github.com/owner/repo/releases/latest/download/update-manifest.json",
            ],
        )

    def test_parse_manifest_accepts_real_ed25519_signature(self):
        service = self.service(current_version="2.0.0")
        manifest = self.signed_manifest(package=b"x" * 123)

        parsed = service._parse_manifest(manifest, "https://updates.example.com/update-manifest.json")

        self.assertEqual(parsed["latestVersion"], "2.0.1")
        self.assertEqual(parsed["asset"]["sha256"], hashlib.sha256(b"x" * 123).hexdigest())
        self.assertEqual(parsed["asset"]["fileName"], "MyPasswordDesktop-windows.zip")
        self.assertTrue(parsed["signatureVerified"])

    def test_parse_manifest_accepts_multiple_trusted_github_asset_urls(self):
        service = self.service(current_version="2.0.0")
        primary = "https://github.com/owner/repo/releases/download/v2.0.1/MyPasswordDesktop-windows.zip"
        alternate = "https://github.com/owner/backup/releases/download/v2.0.1/MyPasswordDesktop-windows.zip"
        manifest = self.signed_manifest(url=primary, urls=[alternate, primary])

        parsed = service._parse_manifest(manifest, "https://updates.example.com/update-manifest.json")

        self.assertEqual(parsed["asset"]["url"], alternate)
        self.assertEqual(parsed["asset"]["urls"], [alternate, primary])

    def test_unsigned_or_tampered_manifest_is_rejected(self):
        service = self.service(current_version="2.0.0")
        unsigned = self.signed_manifest()
        unsigned.pop("signature")
        with self.assertRaisesRegex(UpdateError, "signature is missing"):
            service._parse_manifest(unsigned, "https://updates.example.com/update-manifest.json")

        tampered = self.signed_manifest()
        tampered["version"] = "9.9.9"
        with self.assertRaisesRegex(UpdateError, "signature verification failed"):
            service._parse_manifest(tampered, "https://updates.example.com/update-manifest.json")

    def test_custom_manifest_source_still_requires_signature(self):
        service = self.service(current_version="2.0.0")
        unsigned = self.signed_manifest()
        unsigned.pop("signature")
        service._fetch_manifest_from_candidates = lambda _urls: (
            "https://updates.example.com/update.json",
            unsigned,
        )

        with self.assertRaisesRegex(UpdateError, "signature is missing"):
            service.check("https://updates.example.com/update.json")

    def test_untrusted_or_proxy_asset_urls_are_rejected_even_when_signed(self):
        service = self.service(current_version="2.0.0")
        for url in (
            "https://cdn.example.com/MyPasswordDesktop-windows.zip",
            "https://ghproxy.net/https://github.com/owner/repo/releases/download/v2.0.1/MyPasswordDesktop-windows.zip",
            "https://github.com/owner/repo/archive/v2.0.1.zip",
        ):
            with self.subTest(url=url):
                manifest = self.signed_manifest(url=url)
                with self.assertRaisesRegex(UpdateError, "trusted GitHub Release"):
                    service._parse_manifest(manifest, "https://updates.example.com/update.json")

    def test_parse_manifest_requires_sha256_and_positive_size(self):
        service = self.service(current_version="2.0.0")
        manifest = self.signed_manifest()
        manifest["assets"]["windows"]["sha256"] = "bad"
        manifest = self._resign(manifest)
        with self.assertRaisesRegex(UpdateError, "valid SHA256"):
            service._parse_manifest(manifest, "https://updates.example.com/update.json")

        manifest = self.signed_manifest()
        manifest["assets"]["windows"]["size"] = 0
        manifest = self._resign(manifest)
        with self.assertRaisesRegex(UpdateError, "size is invalid"):
            service._parse_manifest(manifest, "https://updates.example.com/update.json")

    def _resign(self, manifest):
        manifest = dict(manifest)
        manifest.pop("signature", None)
        signature = self.private_key.sign(canonical_manifest_bytes(manifest))
        manifest["signature"] = {
            "algorithm": "Ed25519",
            "keyId": UPDATE_SIGNING_KEY_ID,
            "value": base64.b64encode(signature).decode("ascii"),
        }
        return manifest

    def test_apply_reverifies_signed_metadata_hash_and_size(self):
        package_bytes = b"verified package contents"
        manifest = self.signed_manifest(package=package_bytes)
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            update_dir = root / "updates"
            install_dir = root / "install"
            update_dir.mkdir()
            install_dir.mkdir()
            exe_path = install_dir / "My Password.exe"
            exe_path.write_bytes(b"old executable")
            package = update_dir / "MyPasswordDesktop-windows.zip"
            package.write_bytes(package_bytes)
            service = self.service(current_version="2.0.0", update_dir=update_dir)
            service._write_verified_download_record(
                package,
                "https://updates.example.com/update.json",
                manifest,
            )

            with patch("pwdmg_core.updater.is_packaged_windows", return_value=True), \
                    patch("pwdmg_core.updater.sys.executable", str(exe_path)), \
                    patch("pwdmg_core.updater.launch_hidden_powershell") as launch:
                result = service.apply(str(package))

            launch.assert_called_once()
            self.assertTrue(result["willRestart"])
            script = Path(result["scriptPath"]).read_text(encoding="utf-8")
            self.assertIn(hashlib.sha256(package_bytes).hexdigest(), script)
            self.assertIn(f"$ExpectedSize = {len(package_bytes)}", script)

    def test_apply_rejects_tampered_package_and_manifest_record(self):
        package_bytes = b"verified package contents"
        with tempfile.TemporaryDirectory() as temp_dir:
            update_dir = Path(temp_dir)
            package = update_dir / "MyPasswordDesktop-windows.zip"
            package.write_bytes(package_bytes)
            service = self.service(current_version="2.0.0", update_dir=update_dir)
            manifest = self.signed_manifest(package=package_bytes)
            service._write_verified_download_record(package, "https://updates.example.com/update.json", manifest)
            package.write_bytes(package_bytes + b"tampered")

            with patch("pwdmg_core.updater.is_packaged_windows", return_value=True), \
                    patch("pwdmg_core.updater.launch_hidden_powershell") as launch:
                with self.assertRaisesRegex(UpdateError, "size verification failed before apply"):
                    service.apply(str(package))
            launch.assert_not_called()

            package.write_bytes(package_bytes)
            record_path = verified_metadata_path(package)
            record = json.loads(record_path.read_text(encoding="utf-8"))
            record["manifest"]["version"] = "9.9.9"
            record_path.write_text(json.dumps(record), encoding="utf-8")
            with patch("pwdmg_core.updater.is_packaged_windows", return_value=True):
                with self.assertRaisesRegex(UpdateError, "signature verification failed"):
                    service.apply(str(package))

    def test_apply_script_aborts_on_backup_failure_and_rolls_back_copy_failure(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            update_dir = root / "updates"
            install_dir = root / "install"
            update_dir.mkdir()
            install_dir.mkdir()
            package = update_dir / "MyPasswordDesktop-windows.zip"
            package.write_bytes(b"package")
            service = self.service(current_version="2.0.0", update_dir=update_dir)

            script_path = service._write_apply_script(
                package,
                install_dir,
                "My Password.exe",
                expected_sha256=hashlib.sha256(b"package").hexdigest(),
                expected_size=7,
            )
            script = script_path.read_text(encoding="utf-8")

        self.assertIn("function Restore-InstallBackup", script)
        self.assertIn("Backup verification failed", script)
        self.assertIn("Copy-Item -LiteralPath $InstallItem.FullName", script)
        self.assertIn("-ErrorAction Stop", script)
        self.assertNotIn("Copy-Item -Path (Join-Path $InstallDir '*')", script)
        self.assertLess(script.index("$BackupComplete = $true"), script.index("$InstallMutationStarted = $true"))
        catch_block = script[script.index("} catch {") :]
        self.assertIn("if ($InstallMutationStarted)", catch_block)
        self.assertIn("Restore-InstallBackup", catch_block)
        self.assertIn("previous installation was restored", catch_block)


if __name__ == "__main__":
    unittest.main()
