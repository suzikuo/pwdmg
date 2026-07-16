import base64
import copy
import hashlib
import json
import multiprocessing
import tempfile
import unittest
from pathlib import Path

from pwdmg_core.api import PasswordManagerApi
from pwdmg_core.crypto import (
    MAX_KDF_ITERATIONS,
    MIN_KDF_ITERATIONS,
    VaultCryptoError,
    decrypt_payload,
    encrypt_payload,
    encrypt_payload_with_key,
)
from pwdmg_core.file_lock import FileLockTimeoutError, exclusive_file_lock
from pwdmg_core.legacy import FORWARD_ALPHABETS, ORIG_ALPHABET
from pwdmg_core.totp import generate_totp
from pwdmg_core.vault import (
    MAX_CAPTURE_PASSWORD_LENGTH,
    VaultConflictError,
    VaultService,
    default_payload,
)
from pwdmg_core.vault_index import VaultIndex


def _hold_process_lock(path, ready, release):
    with exclusive_file_lock(Path(path), timeout=5):
        ready.set()
        release.wait(5)


class CoreIntegrityTests(unittest.TestCase):
    def test_file_lock_serializes_separate_processes(self):
        with tempfile.TemporaryDirectory() as tmp:
            lock_path = Path(tmp) / "vault.lock"
            context = multiprocessing.get_context("spawn")
            ready = context.Event()
            release = context.Event()
            process = context.Process(
                target=_hold_process_lock,
                args=(str(lock_path), ready, release),
            )
            process.start()
            try:
                self.assertTrue(ready.wait(5), "child process did not acquire the lock")
                with self.assertRaises(FileLockTimeoutError):
                    with exclusive_file_lock(lock_path, timeout=0.2):
                        pass
            finally:
                release.set()
                process.join(5)
                if process.is_alive():
                    process.terminate()
                    process.join(5)
            self.assertEqual(process.exitcode, 0)

    def test_duplicate_ids_are_repaired_deterministically_without_cross_site_aliasing(self):
        original_payload = default_payload(
            [
                {
                    "id": "duplicate",
                    "kind": "login",
                    "title": "Site A",
                    "domains": ["a.example"],
                    "username": "alice",
                    "password": "password-a",
                },
                {
                    "id": "duplicate",
                    "kind": "login",
                    "title": "Site B",
                    "domains": ["b.example"],
                    "username": "bob",
                    "password": "password-b",
                },
            ]
        )
        envelope, _ = encrypt_payload("password123", original_payload)

        repaired_id_sets = []
        for _ in range(2):
            with tempfile.TemporaryDirectory() as tmp:
                vault_path = Path(tmp) / "vault.json"
                vault_path.write_text(json.dumps(envelope), encoding="utf-8")
                service = VaultService(vault_path=vault_path, legacy_path=Path(tmp) / "missing.json")

                payload = service.unlock("password123")
                ids = [entry["id"] for entry in payload["entries"]]
                repaired_id_sets.append(ids)
                self.assertEqual(len(set(ids)), 2)
                self.assertEqual(ids[0], "duplicate")
                self.assertEqual(ids[1], "duplicate-duplicate-2")

                site_b = service.query_matches("login.b.example")
                self.assertEqual([match["id"] for match in site_b], [ids[1]])
                self.assertEqual(service.get_fill_payload(ids[1])["password"], "password-b")

        self.assertEqual(repaired_id_sets[0], repaired_id_sets[1])

    def test_missing_entry_ids_use_zero_based_index_paths(self):
        with tempfile.TemporaryDirectory() as tmp:
            service = VaultService(
                vault_path=Path(tmp) / "vault.json",
                legacy_path=Path(tmp) / "missing.json",
            )
            service.create_vault("password123", import_legacy=False)
            payload = service.get_vault()
            payload["entries"] = [
                {
                    "kind": "folder",
                    "title": "Folder",
                    "children": [
                        {"id": "kept", "kind": "login", "title": "Kept"},
                        {"kind": "login", "title": "Missing"},
                    ],
                }
            ]

            saved = service.save_vault(payload, expected_revision=payload["revision"])
            self.assertEqual(saved["entries"][0]["id"], "entry-missing-0")
            self.assertEqual(
                saved["entries"][0]["children"][1]["id"],
                "entry-missing-0-1",
            )

    def test_index_refuses_ambiguous_ids_even_before_normalization(self):
        index = VaultIndex.build(
            [
                {"id": "same", "kind": "login", "domains": ["a.example"], "status": "active"},
                {"id": "same", "kind": "login", "domains": ["b.example"], "status": "active"},
            ]
        )

        self.assertIsNone(index.get_login("same"))
        self.assertEqual(index.matching_logins("a.example"), [])
        self.assertEqual(index.matching_logins("b.example"), [])

    def test_legacy_vault_without_revision_is_upgraded_to_revision_one(self):
        payload = default_payload()
        payload.pop("revision")
        envelope, _ = encrypt_payload("password123", payload)
        self.assertNotIn("revision", envelope)

        with tempfile.TemporaryDirectory() as tmp:
            vault_path = Path(tmp) / "vault.json"
            vault_path.write_text(json.dumps(envelope), encoding="utf-8")
            service = VaultService(vault_path=vault_path, legacy_path=Path(tmp) / "missing.json")

            unlocked = service.unlock("password123")
            persisted_envelope = json.loads(vault_path.read_text(encoding="utf-8"))

            self.assertEqual(unlocked["revision"], 1)
            self.assertEqual(persisted_envelope["revision"], 1)

    def test_save_vault_returns_conflict_for_stale_explicit_revision(self):
        with tempfile.TemporaryDirectory() as tmp:
            vault_path = Path(tmp) / "vault.json"
            legacy_path = Path(tmp) / "missing.json"
            first = VaultService(vault_path=vault_path, legacy_path=legacy_path)
            first.create_vault("password123", import_legacy=False)
            second = VaultService(vault_path=vault_path, legacy_path=legacy_path)
            second.unlock("password123")

            first_payload = first.get_vault()
            stale_payload = second.get_vault()
            first_payload["entries"] = [{"id": "first", "kind": "login", "title": "First"}]
            saved = first.save_vault(first_payload, expected_revision=1)
            self.assertEqual(saved["revision"], 2)

            stale_payload["entries"] = [{"id": "second", "kind": "login", "title": "Second"}]
            conflict = PasswordManagerApi(second).saveVault(stale_payload, expectedRevision=1)
            self.assertFalse(conflict["ok"])
            self.assertEqual(conflict["code"], "CONFLICT")

            restored = VaultService(vault_path=vault_path, legacy_path=legacy_path)
            self.assertEqual(restored.unlock("password123")["entries"][0]["id"], "first")

    def test_raw_envelope_write_uses_revision_cas(self):
        with tempfile.TemporaryDirectory() as tmp:
            vault_path = Path(tmp) / "vault.json"
            service = VaultService(vault_path=vault_path, legacy_path=Path(tmp) / "missing.json")
            service.create_vault("password123", import_legacy=False)
            current_envelope = json.loads(service.read_vault_envelope())
            payload, key = decrypt_payload("password123", current_envelope)
            payload["revision"] = 2
            payload["entries"] = [{"id": "new", "kind": "login", "title": "New"}]
            next_envelope = encrypt_payload_with_key(key, payload)

            result = service.write_vault_envelope(
                json.dumps(next_envelope),
                expected_revision=1,
            )
            self.assertEqual(result["revision"], 2)

            with self.assertRaises(VaultConflictError):
                service.write_vault_envelope(
                    json.dumps(next_envelope),
                    expected_revision=1,
                )

    def test_capture_preserves_password_whitespace_and_rejects_oversize(self):
        with tempfile.TemporaryDirectory() as tmp:
            service = VaultService(
                vault_path=Path(tmp) / "vault.json",
                legacy_path=Path(tmp) / "missing.json",
            )
            service.create_vault("password123", import_legacy=False)
            result = service.save_captured_login(
                {
                    "hostname": "example.com",
                    "title": "Example",
                    "account": "alice",
                    "password": "  secret \x00 ",
                }
            )
            self.assertEqual(
                service.get_fill_payload(result["entry"]["id"])["password"],
                "  secret  ",
            )

            with self.assertRaisesRegex(ValueError, "4096-character limit"):
                service.preview_captured_login(
                    {"hostname": "example.com", "password": "x" * (MAX_CAPTURE_PASSWORD_LENGTH + 1)}
                )

    def test_totp_uri_algorithms_and_invalid_fill_fallback(self):
        sha1_secret = base64.b32encode(b"12345678901234567890").decode("ascii")
        sha256_secret = base64.b32encode(b"12345678901234567890123456789012").decode("ascii")
        sha512_secret = base64.b32encode(
            b"1234567890123456789012345678901234567890123456789012345678901234"
        ).decode("ascii")
        self.assertEqual(
            generate_totp(
                f"otpauth://totp/Test?secret={sha1_secret}&digits=8&period=30&algorithm=SHA1",
                timestamp=59,
            ),
            "94287082",
        )
        self.assertEqual(
            generate_totp(
                f"otpauth://totp/Test?secret={sha256_secret}&digits=8&algorithm=SHA256",
                timestamp=59,
            ),
            "46119246",
        )
        self.assertEqual(
            generate_totp(sha512_secret, timestamp=59, digits=8, algorithm="SHA512"),
            "90693936",
        )

        with tempfile.TemporaryDirectory() as tmp:
            service = VaultService(
                vault_path=Path(tmp) / "vault.json",
                legacy_path=Path(tmp) / "missing.json",
            )
            service.create_vault("password123", import_legacy=False)
            payload = service.get_vault()
            payload["entries"] = [
                {
                    "id": "invalid-totp",
                    "kind": "login",
                    "title": "Example",
                    "domains": ["example.com"],
                    "password": "secret",
                    "totpSecret": "otpauth://hotp/Test?secret=AAAA",
                }
            ]
            service.save_vault(payload, expected_revision=1)
            fill = service.get_fill_payload("invalid-totp")
            self.assertEqual(fill["password"], "secret")
            self.assertEqual(fill["totp"], "")

    def test_crypto_rejects_unbounded_or_mismatched_envelope_parameters(self):
        envelope, _ = encrypt_payload("password123", default_payload())
        invalid_envelopes = []

        below_min = copy.deepcopy(envelope)
        below_min["kdf"]["iterations"] = MIN_KDF_ITERATIONS - 1
        invalid_envelopes.append(below_min)
        above_max = copy.deepcopy(envelope)
        above_max["kdf"]["iterations"] = MAX_KDF_ITERATIONS + 1
        invalid_envelopes.append(above_max)
        bad_salt = copy.deepcopy(envelope)
        bad_salt["kdf"]["salt"] = base64.b64encode(b"short").decode("ascii")
        invalid_envelopes.append(bad_salt)
        bad_nonce = copy.deepcopy(envelope)
        bad_nonce["nonce"] = base64.b64encode(b"too-short").decode("ascii")
        invalid_envelopes.append(bad_nonce)
        bad_ciphertext = copy.deepcopy(envelope)
        bad_ciphertext["ciphertext"] = base64.b64encode(b"short").decode("ascii")
        invalid_envelopes.append(bad_ciphertext)
        bad_revision = copy.deepcopy(envelope)
        bad_revision["revision"] = 2
        invalid_envelopes.append(bad_revision)

        for invalid in invalid_envelopes:
            with self.subTest(invalid=invalid):
                with self.assertRaises(VaultCryptoError):
                    decrypt_payload("password123", invalid)

    def test_legacy_migration_reports_bad_items_and_cleanup_requires_matching_digest(self):
        valid_card = {
            "appName": "Example",
            "appUser": "alice",
            "appPwd": "secret",
            "appNote": "https://example.com/login",
        }
        encoded = self._encode_legacy_card(valid_card)

        with tempfile.TemporaryDirectory() as tmp:
            legacy_path = Path(tmp) / "legacy.json"
            legacy_path.write_text(
                json.dumps({"cardData": json.dumps([encoded, "broken", 123])}),
                encoding="utf-8",
            )
            service = VaultService(
                vault_path=Path(tmp) / "vault.json",
                legacy_path=legacy_path,
            )

            created = service.create_vault("password123", import_legacy=True)
            report = created["migration"]
            self.assertEqual(created["migrated"], 1)
            self.assertEqual(report["failureCount"], 2)
            self.assertEqual(report["skipped"], 2)
            self.assertTrue(legacy_path.exists())

            with self.assertRaises(VaultConflictError):
                service.cleanup_legacy_local_storage("0" * 64)
            locked_service = VaultService(
                vault_path=Path(tmp) / "vault.json",
                legacy_path=legacy_path,
            )
            cleanup = locked_service.cleanup_legacy_local_storage(report["sourceDigest"])
            self.assertTrue(cleanup["removed"])
            self.assertFalse(legacy_path.exists())

    def test_legacy_cleanup_rejects_replaced_vault_and_accepts_matching_digests(self):
        with tempfile.TemporaryDirectory() as tmp:
            vault_path = Path(tmp) / "vault.json"
            legacy_path = Path(tmp) / "legacy.json"
            legacy_path.write_text('{"cardData":"[]"}', encoding="utf-8")
            legacy_digest = hashlib.sha256(legacy_path.read_bytes()).hexdigest()
            service = VaultService(vault_path=vault_path, legacy_path=legacy_path)
            service.create_vault("password123", import_legacy=False)
            verified_vault_digest = hashlib.sha256(vault_path.read_bytes()).hexdigest()

            payload = service.get_vault()
            payload["entries"] = [{"id": "changed", "kind": "login", "title": "Changed"}]
            service.save_vault(payload, expected_revision=payload["revision"])

            cleanup_api = PasswordManagerApi(
                VaultService(vault_path=vault_path, legacy_path=legacy_path)
            )
            conflict = cleanup_api.cleanupLegacyStorage(
                legacy_digest,
                verified_vault_digest,
            )
            self.assertFalse(conflict["ok"])
            self.assertEqual(conflict["code"], "CONFLICT")
            self.assertTrue(legacy_path.exists())

            current_vault_digest = hashlib.sha256(vault_path.read_bytes()).hexdigest()
            cleaned = cleanup_api.cleanupLegacyStorage(
                legacy_digest,
                current_vault_digest,
            )
            self.assertTrue(cleaned["ok"])
            self.assertTrue(cleaned["data"]["removed"])
            self.assertEqual(cleaned["data"]["vaultDigest"], current_vault_digest)
            self.assertFalse(legacy_path.exists())

    def test_same_second_import_backups_have_unique_names(self):
        with tempfile.TemporaryDirectory() as tmp:
            service = VaultService(
                vault_path=Path(tmp) / "vault.json",
                legacy_path=Path(tmp) / "missing.json",
            )
            service.create_vault("password123", import_legacy=False)
            original = service.export_backup()["content"]
            paths = []
            for index in range(2):
                payload = service.get_vault()
                payload["entries"] = [{"id": str(index), "kind": "login", "title": str(index)}]
                service.save_vault(payload, expected_revision=payload["revision"])
                paths.append(service.import_backup(original)["backupPath"])
                service.unlock("password123")

            self.assertEqual(len(set(paths)), 2)
            self.assertTrue(all(Path(path).exists() for path in paths))

    @staticmethod
    def _encode_legacy_card(card):
        prefix, alphabet = next(iter(FORWARD_ALPHABETS.items()))
        raw = json.dumps(card, ensure_ascii=False).encode("utf-8")
        encoded = base64.b64encode(raw).decode("ascii")
        return prefix + encoded.translate(str.maketrans(ORIG_ALPHABET, alphabet))


if __name__ == "__main__":
    unittest.main()
