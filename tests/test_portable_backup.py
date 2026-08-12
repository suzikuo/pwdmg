import hashlib
import json
import tempfile
import unittest
import uuid
import warnings
import zipfile
from pathlib import Path

from pwdmg_core.portable_backup import (
    MANIFEST_NAME,
    MAX_VAULT_BYTES,
    PortableBackupArchive,
    PortableBackupError,
    inspect_portable_backup,
    write_portable_backup,
)


def attachment_object(attachment_id):
    return json.dumps({
        "format": "mypwdmg-attachment",
        "version": 1,
        "cipher": "AES-256-GCM",
        "attachmentId": attachment_id,
        "nonce": "AAAAAAAAAAAAAAAA",
        "ciphertext": "AAAAAAAAAAAAAAAAAAAAAA==",
    }, separators=(",", ":"))


class PortableBackupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.path = self.root / "vault.mypwdmg-backup"
        self.attachment_id = str(uuid.uuid4())
        self.object_text = attachment_object(self.attachment_id)
        self.object_hash = hashlib.sha256(self.object_text.encode("utf-8")).hexdigest()
        self.envelope = '{"format":"mypwdmg-vault","version":1}'

    def tearDown(self):
        self.temp.cleanup()

    def write_valid(self):
        return write_portable_backup(
            self.path,
            self.envelope,
            {self.attachment_id: self.object_hash},
            lambda _attachment_id: self.object_text,
            created_at=1800000000,
        )

    def test_atomic_round_trip_and_summary(self):
        result = self.write_valid()
        self.assertEqual(result["attachmentCount"], 1)
        self.assertGreater(result["packageBytes"], 0)
        summary = inspect_portable_backup(self.path)
        self.assertEqual(summary["name"], self.path.name)
        self.assertEqual(summary["createdAt"], 1800000000)
        with PortableBackupArchive(self.path) as archive:
            self.assertEqual(archive.envelope_text, self.envelope)
            self.assertEqual(list(archive.iter_attachment_objects()), [(self.attachment_id, self.object_text)])

    def test_export_rejects_missing_or_hash_mismatched_object_without_replacing_target(self):
        self.path.write_bytes(b"existing")
        with self.assertRaises(FileNotFoundError):
            write_portable_backup(
                self.path,
                self.envelope,
                {self.attachment_id: self.object_hash},
                lambda _attachment_id: (_ for _ in ()).throw(FileNotFoundError("missing")),
                created_at=1800000000,
            )
        self.assertEqual(self.path.read_bytes(), b"existing")
        with self.assertRaises(PortableBackupError):
            write_portable_backup(
                self.path,
                self.envelope,
                {self.attachment_id: "0" * 64},
                lambda _attachment_id: self.object_text,
                created_at=1800000000,
            )
        self.assertEqual(self.path.read_bytes(), b"existing")

    def test_import_rejects_tampered_member_hash(self):
        self.write_valid()
        with zipfile.ZipFile(self.path, "r") as source:
            entries = {info.filename: source.read(info) for info in source.infolist()}
        object_name = f"attachments/v1/{self.attachment_id}.json"
        entries[object_name] = entries[object_name].replace(b"AAAA", b"AQAA", 1)
        self._rewrite(entries)
        with self.assertRaisesRegex(PortableBackupError, "hash"):
            inspect_portable_backup(self.path)

    def test_import_rejects_unexpected_path_and_missing_member(self):
        self.write_valid()
        with zipfile.ZipFile(self.path, "r") as source:
            entries = {info.filename: source.read(info) for info in source.infolist()}
        entries["../vault.json"] = entries["vault.json"]
        self._rewrite(entries)
        with self.assertRaisesRegex(PortableBackupError, "unexpected"):
            inspect_portable_backup(self.path)

        entries.pop("../vault.json")
        entries.pop(f"attachments/v1/{self.attachment_id}.json")
        self._rewrite(entries)
        with self.assertRaisesRegex(PortableBackupError, "missing"):
            inspect_portable_backup(self.path)

    def test_import_rejects_compressed_members_and_duplicate_names(self):
        self.write_valid()
        with zipfile.ZipFile(self.path, "r") as source:
            entries = [(info.filename, source.read(info)) for info in source.infolist()]
        with zipfile.ZipFile(self.path, "w", compression=zipfile.ZIP_DEFLATED) as target:
            for name, content in entries:
                target.writestr(name, content)
        with self.assertRaisesRegex(PortableBackupError, "format"):
            inspect_portable_backup(self.path)

        with warnings.catch_warnings():
            warnings.filterwarnings("ignore", message="Duplicate name: 'manifest.json'", category=UserWarning)
            with zipfile.ZipFile(self.path, "w", compression=zipfile.ZIP_STORED) as target:
                for name, content in entries:
                    target.writestr(name, content)
                target.writestr(MANIFEST_NAME, entries[-1][1])
        with self.assertRaisesRegex(PortableBackupError, "duplicate"):
            inspect_portable_backup(self.path)

    def test_import_rejects_malformed_manifest(self):
        self.write_valid()
        with zipfile.ZipFile(self.path, "r") as source:
            entries = {info.filename: source.read(info) for info in source.infolist()}
        manifest = json.loads(entries[MANIFEST_NAME])
        manifest["unexpected"] = True
        entries[MANIFEST_NAME] = json.dumps(manifest, separators=(",", ":")).encode("utf-8")
        self._rewrite(entries)
        with self.assertRaisesRegex(PortableBackupError, "manifest"):
            inspect_portable_backup(self.path)

    def test_import_rejects_oversized_declared_vault(self):
        self.write_valid()
        with zipfile.ZipFile(self.path, "r") as source:
            entries = {info.filename: source.read(info) for info in source.infolist()}
        manifest = json.loads(entries[MANIFEST_NAME])
        manifest["vault"]["size"] = MAX_VAULT_BYTES + 1
        entries[MANIFEST_NAME] = json.dumps(manifest, separators=(",", ":")).encode("utf-8")
        self._rewrite(entries)
        with self.assertRaisesRegex(PortableBackupError, "size"):
            inspect_portable_backup(self.path)

    def _rewrite(self, entries):
        with zipfile.ZipFile(self.path, "w", compression=zipfile.ZIP_STORED) as target:
            for name, content in entries.items():
                target.writestr(name, content)


if __name__ == "__main__":
    unittest.main()
