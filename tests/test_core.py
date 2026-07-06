import tempfile
import unittest
from pathlib import Path

from pwdmg_core.crypto import VaultCryptoError, decrypt_payload, encrypt_payload
from pwdmg_core.domain import domain_matches
from pwdmg_core.totp import generate_totp
from pwdmg_core.vault import VaultService, default_payload


class CoreTests(unittest.TestCase):
    def test_encrypt_decrypt_roundtrip(self):
        envelope, _ = encrypt_payload("correct horse battery staple", {"entries": [{"title": "A"}]})
        payload, _ = decrypt_payload("correct horse battery staple", envelope)
        self.assertEqual(payload["entries"][0]["title"], "A")
        with self.assertRaises(VaultCryptoError):
            decrypt_payload("wrong password", envelope)

    def test_empty_password_is_allowed(self):
        envelope, _ = encrypt_payload("", {"entries": [{"title": "A"}]})
        payload, _ = decrypt_payload("", envelope)
        self.assertEqual(payload["entries"][0]["title"], "A")
        with self.assertRaises(VaultCryptoError):
            decrypt_payload("not-empty", envelope)

    def test_domain_matching(self):
        self.assertTrue(domain_matches("www.example.com", "example.com"))
        self.assertTrue(domain_matches("login.example.com", "example.com"))
        self.assertFalse(domain_matches("badexample.com", "example.com"))

    def test_totp_known_vector(self):
        secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
        self.assertEqual(generate_totp(secret, timestamp=59), "287082")

    def test_vault_service_save_and_query(self):
        with tempfile.TemporaryDirectory() as tmp:
            vault_path = Path(tmp) / "vault.json"
            legacy_path = Path(tmp) / "missing.json"
            service = VaultService(vault_path=vault_path, legacy_path=legacy_path)
            service.create_vault("password123", import_legacy=False)
            payload = default_payload(
                [
                    {
                        "id": "entry-1",
                        "kind": "login",
                        "title": "Example",
                        "domains": ["example.com"],
                        "username": "alice",
                        "email": "alice@example.com",
                        "password": "secret",
                        "phone": "15500001111",
                        "loginAccountSource": "email",
                        "note": "",
                        "totpSecret": "",
                        "children": [],
                    }
                ]
            )
            service.save_vault(payload)
            match = service.query_matches("app.example.com")[0]
            self.assertEqual(match["username"], "alice")
            self.assertEqual(match["email"], "alice@example.com")
            self.assertEqual(match["phone"], "15500001111")
            self.assertEqual(match["loginAccountSource"], "email")
            fill = service.get_fill_payload("entry-1")
            self.assertEqual(fill["password"], "secret")
            self.assertEqual(fill["email"], "alice@example.com")
            self.assertEqual(fill["loginAccountSource"], "email")

    def test_vault_service_defaults_new_login_account_fields(self):
        with tempfile.TemporaryDirectory() as tmp:
            vault_path = Path(tmp) / "vault.json"
            legacy_path = Path(tmp) / "missing.json"
            service = VaultService(vault_path=vault_path, legacy_path=legacy_path)
            service.create_vault("password123", import_legacy=False)
            service.save_vault(default_payload([{"id": "entry-1", "kind": "login", "title": "Example"}]))

            entry = service.get_vault()["entries"][0]
            self.assertEqual(entry["email"], "")
            self.assertEqual(entry["loginAccountSource"], "auto")
            fill = service.get_fill_payload("entry-1")
            self.assertEqual(fill["email"], "")
            self.assertEqual(fill["loginAccountSource"], "auto")

    def test_vault_service_change_password(self):
        with tempfile.TemporaryDirectory() as tmp:
            vault_path = Path(tmp) / "vault.json"
            legacy_path = Path(tmp) / "missing.json"
            service = VaultService(vault_path=vault_path, legacy_path=legacy_path)
            service.create_vault("old", import_legacy=False)
            service.save_vault(default_payload([{"id": "entry-1", "kind": "login", "title": "Example"}]))
            state = service.change_password("")
            self.assertFalse(state["locked"])

            restored = VaultService(vault_path=vault_path, legacy_path=legacy_path)
            payload = restored.unlock("")
            self.assertEqual(payload["entries"][0]["title"], "Example")
            with self.assertRaises(VaultCryptoError):
                restored.unlock("old")

    def test_vault_backup_export_and_import(self):
        with tempfile.TemporaryDirectory() as tmp:
            vault_path = Path(tmp) / "vault.json"
            legacy_path = Path(tmp) / "missing.json"
            source = VaultService(vault_path=vault_path, legacy_path=legacy_path)
            source.create_vault("password123", import_legacy=False)
            exported = source.export_backup()
            self.assertIn("mypwdmg-vault", exported["content"])

            source.save_vault(default_payload([{"id": "changed", "kind": "login", "title": "Changed"}]))
            imported = source.import_backup(exported["content"])

            self.assertTrue(imported["state"]["locked"])
            self.assertTrue(vault_path.exists())
            self.assertNotEqual(vault_path.read_text(encoding="utf-8"), "")

            restored = VaultService(vault_path=vault_path, legacy_path=legacy_path)
            payload = restored.unlock("password123")
            self.assertEqual(payload["entries"], [])

    def test_local_import_backups_are_pruned(self):
        with tempfile.TemporaryDirectory() as tmp:
            vault_path = Path(tmp) / "vault.json"
            legacy_path = Path(tmp) / "missing.json"
            service = VaultService(vault_path=vault_path, legacy_path=legacy_path)
            service.create_vault("password123", import_legacy=False)
            exported = service.export_backup()["content"]

            for index in range(7):
                service.unlock("password123")
                service.save_vault(default_payload([{"id": f"entry-{index}", "kind": "login", "title": str(index)}]))
                service.import_backup(exported)

            backups = sorted((vault_path.parent / "backups").glob("vault-before-cloud-download-*.json"))
            self.assertLessEqual(len(backups), 5)


if __name__ == "__main__":
    unittest.main()
