import json
import tempfile
import threading
import time
import unittest
from pathlib import Path

from pwdmg_core.crypto import VaultCryptoError, decrypt_payload, encrypt_payload
from pwdmg_core.domain import autofill_rule_matches, domain_matches
from pwdmg_core.totp import generate_totp
from pwdmg_core.vault import VaultLockedError, VaultService, default_payload


class CoreTests(unittest.TestCase):
    def test_attachment_references_are_preserved_and_strictly_validated(self):
        with tempfile.TemporaryDirectory() as tmp:
            service = VaultService(
                vault_path=Path(tmp) / "vault.json",
                legacy_path=Path(tmp) / "missing.json",
            )
            attachment = {
                "id": "123e4567-e89b-42d3-a456-426614174000",
                "name": "codes.txt",
                "mimeType": "text/plain",
                "size": 10,
                "sha256": "a" * 64,
                "ciphertextSha256": "b" * 64,
                "createdAt": 100,
            }
            normalized = service._normalize_payload({**default_payload([{
                "id": "entry-1",
                "kind": "secure-note",
                "title": "Recovery",
                "attachments": [attachment],
            }]), "attachmentKey": "a2tra2tra2tra2tra2tra2tra2tra2tra2tra2tra2s="})
            self.assertEqual(normalized["entries"][0]["attachments"], [attachment])
            with self.assertRaisesRegex(ValueError, "key is missing"):
                service._normalize_payload(default_payload([{
                    "id": "entry-without-key",
                    "kind": "secure-note",
                    "title": "Missing key",
                    "attachments": [attachment],
                }]))
            invalid = dict(attachment)
            invalid["id"] = "../secret"
            with self.assertRaises(ValueError):
                service._normalize_payload({**default_payload([{
                    "id": "entry-2",
                    "kind": "secure-note",
                    "title": "Bad",
                    "attachments": [invalid],
                }]), "attachmentKey": "a2tra2tra2tra2tra2tra2tra2tra2tra2tra2tra2s="})

    def test_vault_service_serializes_shared_session_calls(self):
        with tempfile.TemporaryDirectory() as tmp:
            service = VaultService(
                vault_path=Path(tmp) / "vault.json",
                legacy_path=Path(tmp) / "missing.json",
            )
            first_entered = threading.Event()
            release_first = threading.Event()
            second_completed = threading.Event()

            def slow_passwordless_check():
                first_entered.set()
                release_first.wait(2)
                return False

            service._is_passwordless_vault = slow_passwordless_check
            first = threading.Thread(target=service.state)
            second = threading.Thread(
                target=lambda: (service.storage_state(), second_completed.set())
            )
            first.start()
            self.assertTrue(first_entered.wait(1))
            second.start()
            self.assertFalse(second_completed.wait(0.05))
            release_first.set()
            first.join(1)
            second.join(1)

            self.assertFalse(first.is_alive())
            self.assertFalse(second.is_alive())
            self.assertTrue(second_completed.is_set())

    def test_encrypt_decrypt_roundtrip(self):
        envelope, _ = encrypt_payload("correct horse battery staple", {"entries": [{"title": "A"}]})
        payload, _ = decrypt_payload("correct horse battery staple", envelope)
        self.assertEqual(payload["entries"][0]["title"], "A")
        with self.assertRaises(VaultCryptoError):
            decrypt_payload("wrong password", envelope)

    def test_empty_password_is_allowed(self):
        envelope, _ = encrypt_payload("", {"entries": [{"title": "A"}]})
        self.assertTrue(envelope["passwordless"])
        payload, _ = decrypt_payload("", envelope)
        self.assertEqual(payload["entries"][0]["title"], "A")
        with self.assertRaises(VaultCryptoError):
            decrypt_payload("not-empty", envelope)

    def test_vault_service_reports_passwordless_state(self):
        with tempfile.TemporaryDirectory() as tmp:
            vault_path = Path(tmp) / "vault.json"
            legacy_path = Path(tmp) / "missing.json"
            service = VaultService(vault_path=vault_path, legacy_path=legacy_path)

            service.create_vault("password123", import_legacy=False)
            self.assertFalse(service.state()["passwordless"])
            service.change_password("")
            self.assertTrue(service.state()["passwordless"])
            service.save_vault(default_payload([{"id": "entry-1", "kind": "login", "title": "Example"}]))
            self.assertTrue(service.storage_state()["passwordless"])

    def test_unlock_repairs_stale_passwordless_marker_in_both_directions(self):
        with tempfile.TemporaryDirectory() as tmp:
            vault_path = Path(tmp) / "vault.json"
            legacy_path = Path(tmp) / "missing.json"
            service = VaultService(vault_path=vault_path, legacy_path=legacy_path)
            service.create_vault("password123", import_legacy=False)
            service.lock()

            envelope = json.loads(vault_path.read_text(encoding="utf-8"))
            original_revision = envelope["revision"]
            envelope["passwordless"] = True
            vault_path.write_text(json.dumps(envelope), encoding="utf-8")

            service.unlock("password123")

            repaired = json.loads(vault_path.read_text(encoding="utf-8"))
            self.assertIs(repaired["passwordless"], False)
            self.assertEqual(repaired["revision"], original_revision + 1)
            self.assertFalse(service.storage_state()["passwordless"])

    def test_passwordless_vault_auto_unlocks_for_native_queries(self):
        with tempfile.TemporaryDirectory() as tmp:
            vault_path = Path(tmp) / "vault.json"
            legacy_path = Path(tmp) / "missing.json"
            service = VaultService(vault_path=vault_path, legacy_path=legacy_path)
            service.create_vault("", import_legacy=False)
            service.save_vault(
                default_payload(
                    [
                        {
                            "id": "entry-1",
                            "kind": "login",
                            "title": "Example",
                            "domains": ["example.com"],
                            "username": "alice",
                            "password": "secret",
                        }
                    ]
                )
            )

            restored = VaultService(vault_path=vault_path, legacy_path=legacy_path)
            matches = restored.query_matches("www.example.com")

            self.assertEqual([match["id"] for match in matches], ["entry-1"])
            self.assertFalse(restored.state()["locked"])

    def test_expired_session_cannot_release_vault_payload(self):
        with tempfile.TemporaryDirectory() as tmp:
            service = VaultService(
                vault_path=Path(tmp) / "vault.json",
                legacy_path=Path(tmp) / "missing.json",
                session_seconds=60,
            )
            service.create_vault("password123", import_legacy=False)
            service._expires_at = time.time() - 1
            with self.assertRaises(VaultLockedError):
                service.get_vault()
            self.assertTrue(service.state()["locked"])

    def test_zero_session_timeout_preserves_explicit_indefinite_mode(self):
        with tempfile.TemporaryDirectory() as tmp:
            service = VaultService(
                vault_path=Path(tmp) / "vault.json",
                legacy_path=Path(tmp) / "missing.json",
                session_seconds=0,
            )
            service.create_vault("password123", import_legacy=False)
            self.assertFalse(service.state()["locked"])
            self.assertGreater(service.state()["expiresAt"], int(time.time()))

    def test_domain_matching(self):
        self.assertTrue(domain_matches("www.example.com", "example.com"))
        self.assertTrue(domain_matches("login.example.com", "example.com"))
        self.assertTrue(domain_matches("us-east-2.signin.aws.amazon.com", "signin.aws.amazon.com"))
        self.assertTrue(domain_matches("us-east-2.signin.aws.amazon.com", "*.signin.aws.amazon.com"))
        self.assertTrue(domain_matches("us-east-1.signin.aws.amazon.com", "us-east-*.signin.aws.amazon.com"))
        self.assertFalse(domain_matches("us-west-1.signin.aws.amazon.com", "us-east-*.signin.aws.amazon.com"))
        self.assertFalse(domain_matches("signin.aws.amazon.com.evil.test", "signin.aws.amazon.com"))
        self.assertFalse(domain_matches("badexample.com", "example.com"))

    def test_autofill_matching_modes_are_boundary_safe(self):
        self.assertTrue(autofill_rule_matches("login.example.com", "https://login.example.com/sign-in", "example.com", "base-domain"))
        self.assertFalse(autofill_rule_matches("login.example.com", "https://login.example.com/sign-in", "example.com", "exact-host"))
        self.assertTrue(autofill_rule_matches("login.example.com", "https://login.example.com/sign-in", "example.com", "subdomain"))
        self.assertFalse(autofill_rule_matches("example.com", "https://example.com/sign-in", "example.com", "subdomain"))
        self.assertFalse(autofill_rule_matches("login.example.com", "https://login.example.com/sign-in", "example.com", "never"))
        self.assertTrue(autofill_rule_matches("www.example.com", "https://www.example.com/", "www.example.com", "exact-host"))
        self.assertFalse(autofill_rule_matches("example.com", "https://example.com/", "www.example.com", "exact-host"))

    def test_url_prefix_matching_requires_url_origin_and_path_boundary(self):
        rule = "https://example.com/account"
        self.assertTrue(autofill_rule_matches("example.com", "https://example.com/account/profile", rule, "url-prefix"))
        self.assertTrue(autofill_rule_matches("example.com", "https://example.com/account?view=1", rule, "url-prefix"))
        self.assertFalse(autofill_rule_matches("example.com", "https://example.com/accounting", rule, "url-prefix"))
        self.assertFalse(autofill_rule_matches("example.com", "http://example.com/account/profile", rule, "url-prefix"))
        self.assertFalse(autofill_rule_matches("example.com", "", rule, "url-prefix"))

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
            authorized_fill = service.get_fill_payload_for_host("entry-1", "app.example.com")
            self.assertEqual(authorized_fill["password"], "secret")
            with self.assertRaises(ValueError):
                service.get_fill_payload_for_host("entry-1", "attacker.example.net")
            with self.assertRaises(ValueError):
                service.get_fill_payload_for_host("entry-1", "")

    def test_vault_service_query_matches_wildcard_domain(self):
        with tempfile.TemporaryDirectory() as tmp:
            vault_path = Path(tmp) / "vault.json"
            legacy_path = Path(tmp) / "missing.json"
            service = VaultService(vault_path=vault_path, legacy_path=legacy_path)
            service.create_vault("password123", import_legacy=False)
            service.save_vault(
                default_payload(
                    [
                        {
                            "id": "entry-aws",
                            "kind": "login",
                            "title": "AWS",
                            "domains": ["*.signin.aws.amazon.com"],
                            "username": "alice",
                            "password": "secret",
                            "totpSecret": "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
                        }
                    ]
                )
            )

            matches = service.query_matches("us-east-2.signin.aws.amazon.com")
            self.assertEqual(matches[0]["id"], "entry-aws")
            self.assertTrue(matches[0]["hasTotp"])

    def test_vault_service_enforces_saved_autofill_mode_for_query_and_fill(self):
        with tempfile.TemporaryDirectory() as tmp:
            service = VaultService(vault_path=Path(tmp) / "vault.json", legacy_path=Path(tmp) / "missing.json")
            service.create_vault("password123", import_legacy=False)
            service.save_vault(default_payload([
                {
                    "id": "exact",
                    "kind": "login",
                    "title": "Exact",
                    "domains": ["example.com"],
                    "autofillMatchMode": "exact-host",
                    "password": "exact-secret",
                },
                {
                    "id": "prefix",
                    "kind": "login",
                    "title": "Prefix",
                    "domains": ["https://example.com/account"],
                    "autofillMatchMode": "url-prefix",
                    "password": "prefix-secret",
                },
                {
                    "id": "never",
                    "kind": "login",
                    "title": "Never",
                    "domains": ["example.com"],
                    "autofillMatchMode": "never",
                    "password": "never-secret",
                },
            ]))

            self.assertEqual([item["id"] for item in service.query_matches("example.com", "https://example.com/account/profile")], ["exact", "prefix"])
            self.assertEqual(service.query_matches("login.example.com", "https://login.example.com/account"), [])
            self.assertEqual(service.get_fill_payload_for_host("prefix", "example.com", "https://example.com/account/profile")["password"], "prefix-secret")
            with self.assertRaises(ValueError):
                service.get_fill_payload_for_host("prefix", "example.com", "https://example.com/accounting")

    def test_vault_service_query_matches_saved_aws_parent_domain(self):
        with tempfile.TemporaryDirectory() as tmp:
            vault_path = Path(tmp) / "vault.json"
            legacy_path = Path(tmp) / "missing.json"
            service = VaultService(vault_path=vault_path, legacy_path=legacy_path)
            service.create_vault("password123", import_legacy=False)
            service.save_vault(
                default_payload(
                    [
                        {
                            "id": "entry-aws-parent",
                            "kind": "login",
                            "title": "AWS",
                            "domains": ["signin.aws.amazon.com"],
                            "username": "alice",
                            "password": "secret",
                        }
                    ]
                )
            )

            matches = service.query_matches("us-east-2.signin.aws.amazon.com")

            self.assertEqual([match["id"] for match in matches], ["entry-aws-parent"])

    def test_vault_service_query_index_rebuilds_after_save(self):
        with tempfile.TemporaryDirectory() as tmp:
            vault_path = Path(tmp) / "vault.json"
            legacy_path = Path(tmp) / "missing.json"
            service = VaultService(vault_path=vault_path, legacy_path=legacy_path)
            service.create_vault("password123", import_legacy=False)
            service.save_vault(
                default_payload(
                    [
                        {
                            "id": "entry-old",
                            "kind": "login",
                            "title": "Old",
                            "domains": ["old.example.net"],
                            "username": "old",
                            "password": "old-secret",
                        }
                    ]
                )
            )
            self.assertEqual([m["id"] for m in service.query_matches("old.example.net")], ["entry-old"])

            service.save_vault(
                default_payload(
                    [
                        {
                            "id": "entry-new",
                            "kind": "login",
                            "title": "New",
                            "domains": ["example.com"],
                            "username": "new",
                            "password": "new-secret",
                        }
                    ]
                )
            )

            self.assertEqual(service.query_matches("old.example.net"), [])
            self.assertEqual([m["id"] for m in service.query_matches("app.example.com")], ["entry-new"])
            self.assertEqual(service.get_fill_payload("entry-new")["password"], "new-secret")

    def test_vault_service_excludes_disabled_and_trashed_from_autofill(self):
        with tempfile.TemporaryDirectory() as tmp:
            vault_path = Path(tmp) / "vault.json"
            legacy_path = Path(tmp) / "missing.json"
            service = VaultService(vault_path=vault_path, legacy_path=legacy_path)
            service.create_vault("password123", import_legacy=False)
            service.save_vault(
                default_payload(
                    [
                        {
                            "id": "entry-active",
                            "kind": "login",
                            "title": "Active",
                            "domains": ["example.com"],
                            "username": "active",
                            "password": "active-secret",
                            "status": "active",
                        },
                        {
                            "id": "entry-disabled",
                            "kind": "login",
                            "title": "Disabled",
                            "domains": ["example.com"],
                            "username": "disabled",
                            "password": "disabled-secret",
                            "status": "disabled",
                        },
                        {
                            "id": "entry-trashed",
                            "kind": "login",
                            "title": "Trashed",
                            "domains": ["example.com"],
                            "username": "trashed",
                            "password": "trashed-secret",
                            "status": "trashed",
                        },
                    ]
                )
            )

            matches = service.query_matches("www.example.com")

            self.assertEqual([match["id"] for match in matches], ["entry-active"])

    def test_vault_service_excludes_entries_inside_archived_folder(self):
        with tempfile.TemporaryDirectory() as tmp:
            vault_path = Path(tmp) / "vault.json"
            legacy_path = Path(tmp) / "missing.json"
            service = VaultService(vault_path=vault_path, legacy_path=legacy_path)
            service.create_vault("password123", import_legacy=False)
            service.save_vault(
                default_payload(
                    [
                        {
                            "id": "folder-disabled",
                            "kind": "folder",
                            "title": "Archived Folder",
                            "status": "disabled",
                            "children": [
                                {
                                    "id": "entry-inside",
                                    "kind": "login",
                                    "title": "Inside",
                                    "domains": ["example.com"],
                                    "username": "inside",
                                    "password": "secret",
                                    "status": "active",
                                }
                            ],
                        }
                    ]
                )
            )

            self.assertEqual(service.query_matches("www.example.com"), [])

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

    def test_vault_service_preserves_item_kinds_and_protected_custom_fields(self):
        with tempfile.TemporaryDirectory() as tmp:
            service = VaultService(
                vault_path=Path(tmp) / "vault.json",
                legacy_path=Path(tmp) / "missing.json",
            )
            service.create_vault("password123", import_legacy=False)
            service.save_vault(
                default_payload(
                    [
                        {
                            "id": "card-1",
                            "kind": "card",
                            "title": "Travel card",
                            "customFields": [
                                {
                                    "id": "field-1",
                                    "label": "Card number",
                                    "value": "4111111111111111",
                                    "type": "secret",
                                    "protected": True,
                                }
                            ],
                            "children": [{"id": "nested", "kind": "login", "title": "Discard"}],
                        }
                    ]
                )
            )

            entry = service.get_vault()["entries"][0]
            self.assertEqual(entry["kind"], "card")
            self.assertEqual(entry["customFields"][0]["value"], "4111111111111111")
            self.assertTrue(entry["customFields"][0]["protected"])
            self.assertEqual(entry["children"], [])

    def test_save_captured_login_creates_entry_in_folder(self):
        with tempfile.TemporaryDirectory() as tmp:
            vault_path = Path(tmp) / "vault.json"
            legacy_path = Path(tmp) / "missing.json"
            service = VaultService(vault_path=vault_path, legacy_path=legacy_path)
            service.create_vault("password123", import_legacy=False)
            service.save_vault(
                default_payload(
                    [
                        {
                            "id": "folder-1",
                            "kind": "folder",
                            "title": "Work",
                            "domains": [],
                            "children": [],
                        }
                    ]
                )
            )

            result = service.save_captured_login(
                {
                    "hostname": "login.example.com",
                    "title": "Example Login",
                    "account": "alice@example.com",
                    "accountKind": "email",
                    "password": "secret",
                },
                parentId="folder-1",
            )

            self.assertEqual(result["action"], "created")
            saved = service.get_vault()["entries"][0]["children"][0]
            self.assertEqual(saved["email"], "alice@example.com")
            self.assertEqual(saved["password"], "secret")
            self.assertEqual(saved["domains"], ["login.example.com"])
            self.assertEqual(saved["loginAccountSource"], "email")

    def test_preview_captured_login_skips_same_password_and_updates_changed_password(self):
        with tempfile.TemporaryDirectory() as tmp:
            vault_path = Path(tmp) / "vault.json"
            legacy_path = Path(tmp) / "missing.json"
            service = VaultService(vault_path=vault_path, legacy_path=legacy_path)
            service.create_vault("password123", import_legacy=False)
            service.save_vault(
                default_payload(
                    [
                        {
                            "id": "entry-1",
                            "kind": "login",
                            "title": "Example",
                            "domains": ["example.com"],
                            "username": "alice",
                            "email": "",
                            "password": "old-secret",
                            "phone": "",
                            "loginAccountSource": "auto",
                            "note": "",
                            "totpSecret": "",
                            "children": [],
                        }
                    ]
                )
            )

            same = service.preview_captured_login(
                {
                    "hostname": "www.example.com",
                    "title": "Example",
                    "account": "alice",
                    "accountKind": "username",
                    "password": "old-secret",
                }
            )
            self.assertFalse(same["shouldPrompt"])
            self.assertTrue(same["passwordSame"])

            changed_capture = {
                "hostname": "www.example.com",
                "title": "Example",
                "account": "alice",
                "accountKind": "username",
                "password": "new-secret",
            }
            changed = service.preview_captured_login(changed_capture)
            self.assertTrue(changed["shouldPrompt"])
            self.assertEqual(changed["updateCandidate"]["id"], "entry-1")

            updated = service.save_captured_login(changed_capture, updateEntryId="entry-1")
            self.assertEqual(updated["action"], "updated")
            self.assertEqual(service.get_fill_payload("entry-1")["password"], "new-secret")

    def test_save_captured_login_applies_edited_title_and_account_on_update(self):
        with tempfile.TemporaryDirectory() as tmp:
            vault_path = Path(tmp) / "vault.json"
            legacy_path = Path(tmp) / "missing.json"
            service = VaultService(vault_path=vault_path, legacy_path=legacy_path)
            service.create_vault("password123", import_legacy=False)
            service.save_vault(
                default_payload(
                    [
                        {
                            "id": "entry-1",
                            "kind": "login",
                            "title": "Old title",
                            "domains": ["example.com"],
                            "username": "alice",
                            "email": "",
                            "password": "old-secret",
                            "phone": "",
                            "loginAccountSource": "username",
                            "note": "",
                            "totpSecret": "",
                            "children": [],
                        }
                    ]
                )
            )

            result = service.save_captured_login(
                {
                    "hostname": "www.example.com",
                    "title": "Renamed login",
                    "titleEdited": True,
                    "account": "alice@example.com",
                    "accountKind": "email",
                    "accountEdited": True,
                    "password": "new-secret",
                },
                updateEntryId="entry-1",
            )

            self.assertEqual(result["action"], "updated")
            saved = service.get_fill_payload("entry-1")
            self.assertEqual(saved["title"], "Renamed login")
            self.assertEqual(saved["username"], "")
            self.assertEqual(saved["email"], "alice@example.com")
            self.assertEqual(saved["loginAccountSource"], "email")

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
