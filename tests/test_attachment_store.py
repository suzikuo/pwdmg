import json
import os
import tempfile
import unittest
import uuid
from pathlib import Path

from pwdmg_core.attachment_store import (
    ORPHAN_GRACE_SECONDS,
    RETAIN_SECONDS,
    AttachmentObjectStore,
    AttachmentStoreError,
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


class AttachmentObjectStoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / "attachments"
        self.now = 1_800_000_000
        self.store = AttachmentObjectStore(self.root, lambda: self.now)
        self.attachment_id = str(uuid.uuid4())

    def tearDown(self):
        self.temp.cleanup()

    def test_atomic_immutable_round_trip_and_state(self):
        content = attachment_object(self.attachment_id)
        result = self.store.write(self.attachment_id, content)
        self.assertEqual(result["attachmentId"], self.attachment_id)
        self.assertEqual(self.store.read(self.attachment_id), content)
        self.assertEqual(self.store.state()["activeCount"], 1)
        self.assertEqual(self.store.write(self.attachment_id, content)["attachmentId"], self.attachment_id)
        changed = content.replace("AAAAAAAAAAAAAAAAAAAAAA==", "AQAAAAAAAAAAAAAAAAAAAA==")
        with self.assertRaises(AttachmentStoreError):
            self.store.write(self.attachment_id, changed)

    def test_rejects_mismatched_ids_unknown_fields_and_bad_base64(self):
        other_id = str(uuid.uuid4())
        with self.assertRaises(AttachmentStoreError):
            self.store.write(self.attachment_id, attachment_object(other_id))
        parsed = json.loads(attachment_object(self.attachment_id))
        parsed["name"] = "secret.txt"
        with self.assertRaises(AttachmentStoreError):
            self.store.write(self.attachment_id, json.dumps(parsed))
        parsed.pop("name")
        parsed["nonce"] = "not base64"
        with self.assertRaises(AttachmentStoreError):
            self.store.write(self.attachment_id, json.dumps(parsed))

    def test_retained_object_is_recovered_on_read(self):
        content = attachment_object(self.attachment_id)
        self.store.write(self.attachment_id, content)
        self.assertTrue(self.store.retain(self.attachment_id)["retained"])
        self.assertEqual(self.store.state()["activeCount"], 0)
        self.assertEqual(self.store.read(self.attachment_id), content)
        self.assertEqual(self.store.state()["activeCount"], 1)

    def test_collection_observes_orphan_and_retention_windows(self):
        self.store.write(self.attachment_id, attachment_object(self.attachment_id))
        old = self.now - ORPHAN_GRACE_SECONDS - 1
        os.utime(self.root / f"{self.attachment_id}.json", (old, old))
        result = self.store.collect([])
        self.assertEqual(result["retained"], 1)
        self.now += RETAIN_SECONDS + 1
        result = self.store.collect([])
        self.assertEqual(result["deleted"], 1)
        self.assertEqual(self.store.state()["retainedCount"], 0)


if __name__ == "__main__":
    unittest.main()
