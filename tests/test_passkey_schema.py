import base64
import copy
import json
import os
import tempfile
import unittest
from pathlib import Path

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from pwdmg_core.crypto import AAD_BY_VERSION, VaultCryptoError, decrypt_payload, encrypt_payload
from pwdmg_core.passkey_schema import normalize_passkey_state
from pwdmg_core.vault import VaultConflictError, VaultService, default_payload


def sample_passkey(**overrides):
    value = {
        "id": "passkey-1",
        "credentialId": "AQIDBA",
        "rpId": "Login.Example.com.",
        "rpName": "Example",
        "userHandle": "dXNlci0x",
        "userName": "alice@example.com",
        "userDisplayName": "Alice",
        "algorithm": -7,
        "publicKeyCose": "cHVibGljLWtleQ",
        "privateKeyPkcs8": "cHJpdmF0ZS1rZXk",
        "discoverable": True,
        "backupEligible": True,
        "backupState": True,
        "transports": ["internal", "hybrid", "internal"],
        "entryId": "login-1",
        "createdAt": 100,
        "updatedAt": 101,
    }
    value.update(overrides)
    return value


def replace_encrypted_payload(envelope, vault_key, payload, version):
    nonce = os.urandom(12)
    raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    ciphertext = AESGCM(vault_key.key).encrypt(nonce, raw, AAD_BY_VERSION[version])
    replaced = copy.deepcopy(envelope)
    replaced["version"] = version
    replaced["nonce"] = base64.b64encode(nonce).decode("ascii")
    replaced["ciphertext"] = base64.b64encode(ciphertext).decode("ascii")
    return replaced


class PasskeySchemaTests(unittest.TestCase):
    def test_legacy_empty_state_remains_v1_and_passkeys_promote_v2(self):
        legacy = normalize_passkey_state(default_payload())
        self.assertEqual(legacy["version"], 1)
        self.assertEqual(legacy["passkeys"], [])
        self.assertEqual(legacy["passkeyTombstones"], [])

        payload = default_payload()
        payload["passkeys"] = [sample_passkey()]
        promoted = normalize_passkey_state(payload)
        self.assertEqual(promoted["version"], 2)
        self.assertEqual(promoted["passkeySchemaVersion"], 1)
        self.assertEqual(promoted["passkeys"][0]["rpId"], "login.example.com")
        self.assertEqual(promoted["passkeys"][0]["transports"], ["internal", "hybrid"])

        sticky = normalize_passkey_state({**default_payload(), "version": 2})
        self.assertEqual(sticky["version"], 2)

    def test_malformed_and_duplicate_credentials_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "version"):
            normalize_passkey_state({"version": 3})
        with self.assertRaisesRegex(ValueError, "version"):
            normalize_passkey_state({"version": "2"})
        with self.assertRaisesRegex(ValueError, "schema version"):
            normalize_passkey_state({"version": 2, "passkeySchemaVersion": 2, "passkeys": [], "passkeyTombstones": []})
        with self.assertRaisesRegex(ValueError, "requires passkeys"):
            normalize_passkey_state({"version": 2, "passkeyTombstones": []})
        with self.assertRaisesRegex(ValueError, "array"):
            normalize_passkey_state({"passkeys": {}})
        with self.assertRaisesRegex(ValueError, "item limit"):
            normalize_passkey_state({"passkeys": [None] * 10_001})
        with self.assertRaisesRegex(ValueError, "Duplicate passkey id"):
            normalize_passkey_state(
                {"passkeys": [sample_passkey(), sample_passkey(credentialId="BQYHCA")]}
            )
        with self.assertRaisesRegex(ValueError, "Duplicate passkey credentialId"):
            normalize_passkey_state(
                {"passkeys": [sample_passkey(), sample_passkey(id="passkey-2")]}
            )
        with self.assertRaisesRegex(ValueError, "base64url"):
            normalize_passkey_state(
                {"passkeys": [sample_passkey(privateKeyPkcs8="not+base64")]}
            )
        with self.assertRaisesRegex(ValueError, "canonical"):
            normalize_passkey_state(
                {"passkeys": [sample_passkey(credentialId="AB")]}
            )
        with self.assertRaisesRegex(ValueError, "backupEligible"):
            normalize_passkey_state(
                {"passkeys": [sample_passkey(backupEligible=False, backupState=True)]}
            )
        with self.assertRaisesRegex(ValueError, "algorithm"):
            normalize_passkey_state({"passkeys": [sample_passkey(algorithm="-7")]})
        with self.assertRaisesRegex(ValueError, "ES256"):
            normalize_passkey_state({"passkeys": [sample_passkey(algorithm=-257)]})
        with self.assertRaisesRegex(ValueError, "unsupported fields"):
            normalize_passkey_state({"passkeys": [sample_passkey(futureExtension=True)]})
        with self.assertRaisesRegex(ValueError, "updatedAt"):
            normalize_passkey_state({"passkeys": [sample_passkey(updatedAt="101")]})
        with self.assertRaisesRegex(ValueError, "userName"):
            normalize_passkey_state({"passkeys": [sample_passkey(userName="😀" * 129)]})

    def test_live_and_deleted_credentials_cannot_overlap(self):
        with self.assertRaisesRegex(ValueError, "live and deleted"):
            normalize_passkey_state(
                {
                    "passkeys": [sample_passkey()],
                    "passkeyTombstones": [
                        {"id": "passkey-1", "credentialId": "AQIDBA", "deletedAt": 200}
                    ],
                }
            )
        with self.assertRaisesRegex(ValueError, "credential"):
            normalize_passkey_state(
                {
                    "passkeys": [sample_passkey()],
                    "passkeyTombstones": [
                        {"id": "passkey-2", "credentialId": "AQIDBA", "deletedAt": 200}
                    ],
                }
            )

    def test_v1_and_v2_envelopes_use_distinct_authenticated_versions(self):
        legacy_payload = default_payload()
        legacy_envelope, _ = encrypt_payload("password123", legacy_payload)
        self.assertEqual(legacy_envelope["version"], 1)
        self.assertEqual(decrypt_payload("password123", legacy_envelope)[0]["version"], 1)

        passkey_payload = default_payload()
        passkey_state = normalize_passkey_state(
            {**passkey_payload, "passkeys": [sample_passkey()]}
        )
        passkey_payload.update(passkey_state)
        envelope, envelope_key = encrypt_payload("password123", passkey_payload)
        self.assertEqual(envelope["version"], 2)
        self.assertEqual(decrypt_payload("password123", envelope)[0]["passkeys"], passkey_state["passkeys"])

        downgraded = copy.deepcopy(envelope)
        downgraded["version"] = 1
        with self.assertRaises(VaultCryptoError):
            decrypt_payload("password123", downgraded)

        mismatched_payload = {**passkey_payload, "version": 1}
        mismatched = replace_encrypted_payload(envelope, envelope_key, mismatched_payload, 2)
        with self.assertRaisesRegex(VaultCryptoError, "version metadata"):
            decrypt_payload("password123", mismatched)

    def test_encryption_rejects_v1_passkey_state(self):
        payload = default_payload()
        payload["passkeys"] = [sample_passkey()]
        with self.assertRaisesRegex(VaultCryptoError, "version 1"):
            encrypt_payload("password123", payload)

    def test_unlock_promotes_noncanonical_v1_passkey_state_and_blocks_downgrade(self):
        legacy_payload = default_payload()
        legacy_envelope, vault_key = encrypt_payload("password123", legacy_payload)
        legacy_payload["passkeys"] = [sample_passkey()]
        noncanonical = replace_encrypted_payload(legacy_envelope, vault_key, legacy_payload, 1)

        with tempfile.TemporaryDirectory() as tmp:
            vault_path = Path(tmp) / "vault.json"
            vault_path.write_text(json.dumps(noncanonical), encoding="utf-8")
            service = VaultService(vault_path=vault_path, legacy_path=Path(tmp) / "missing.json")
            unlocked = service.unlock("password123")
            self.assertEqual(unlocked["version"], 2)
            self.assertEqual(json.loads(vault_path.read_text(encoding="utf-8"))["version"], 2)

            downgrade_payload = default_payload()
            downgrade_payload["revision"] = unlocked["revision"]
            with self.assertRaisesRegex(VaultConflictError, "downgrade"):
                service.save_vault(downgrade_payload, expected_revision=unlocked["revision"])

            old_envelope, _ = encrypt_payload("password123", default_payload())
            with self.assertRaisesRegex(VaultConflictError, "version 2"):
                service.write_vault_envelope(json.dumps(old_envelope), protect_backup=True)


if __name__ == "__main__":
    unittest.main()
