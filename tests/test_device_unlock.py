import json
import tempfile
import unittest
from pathlib import Path

from pwdmg_core.crypto import VaultKey
from pwdmg_core.device_unlock import DeviceUnlockError, DeviceUnlockStore
from pwdmg_core.vault import VaultService


class FakeProtector:
    supported = True

    def protect(self, plaintext, entropy):
        return bytes(value ^ entropy[index % len(entropy)] for index, value in enumerate(plaintext))

    def unprotect(self, ciphertext, entropy):
        return self.protect(ciphertext, entropy)


class DeviceUnlockStoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.now = 1_800_000_000
        self.store = DeviceUnlockStore(
            self.root / "device_unlock.json",
            FakeProtector(),
            lambda: self.now,
        )
        self.vault_path = self.root / "vault.json"
        self.key = VaultKey(b"k" * 32, b"s" * 16, 390_000)

    def tearDown(self):
        self.temp.cleanup()

    def test_round_trip_stores_only_an_opaque_device_blob(self):
        state = self.store.enable(self.vault_path, self.key, 3600)
        self.assertTrue(state["enabled"])
        outer_text = self.store.path.read_text(encoding="utf-8")
        self.assertNotIn("kkkk", outer_text)
        self.assertNotIn("ssss", outer_text)
        self.assertEqual(self.store.load(self.vault_path), self.key)

    def test_path_mismatch_and_expiry_remove_the_unusable_token(self):
        self.store.enable(self.vault_path, self.key, 3600)
        with self.assertRaises(DeviceUnlockError):
            self.store.load(self.root / "other-vault.json")
        self.assertFalse(self.store.path.exists())

        self.store.enable(self.vault_path, self.key, 3600)
        self.now += 3600
        with self.assertRaises(DeviceUnlockError):
            self.store.load(self.vault_path)
        self.assertFalse(self.store.path.exists())

    def test_tampering_unknown_fields_and_invalid_intervals_fail_closed(self):
        with self.assertRaises(DeviceUnlockError):
            self.store.enable(self.vault_path, self.key, 59)
        self.store.enable(self.vault_path, self.key, 3600)
        outer = json.loads(self.store.path.read_text(encoding="utf-8"))
        outer["unexpected"] = True
        self.store.path.write_text(json.dumps(outer), encoding="utf-8")
        self.assertFalse(self.store.state(self.vault_path)["enabled"])
        self.assertFalse(self.store.path.exists())

    def test_vault_service_requires_the_master_password_and_invalidates_on_rotation(self):
        service = VaultService(
            vault_path=self.vault_path,
            legacy_path=self.root / "legacy.json",
            device_unlock_store=self.store,
        )
        service.create_vault("correct-password", import_legacy=False)
        with self.assertRaises(Exception):
            service.enable_device_unlock("wrong-password", 3600)

        enabled = service.enable_device_unlock("correct-password", 3600)
        self.assertTrue(enabled["enabled"])
        service.lock()
        material = service.read_device_unlock_key()
        self.assertEqual(material["iterations"], 390_000)
        self.assertNotIn("password", json.dumps(material).lower())

        service.unlock("correct-password")
        service.change_password("new-password")
        self.assertFalse(service.device_unlock_state()["enabled"])


if __name__ == "__main__":
    unittest.main()
