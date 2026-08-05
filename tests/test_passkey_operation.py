import json
import unittest
from dataclasses import asdict
from pathlib import Path

from pwdmg_core.passkey_operation import (
    PasskeyOperationError,
    bind_native_passkey_operation,
    create_cancelled_passkey_operation_outcome,
    create_succeeded_passkey_operation_outcome,
    is_passkey_operation_expired,
    parse_passkey_operation,
    to_passkey_operation_diagnostic,
)


VECTORS = json.loads(
    (Path(__file__).resolve().parents[1] / "test-vectors" / "passkey-operation-contract.json").read_text(
        encoding="utf-8"
    )
)


class PasskeyOperationTests(unittest.TestCase):
    def test_shared_valid_vectors_normalize_to_native_operation_model(self):
        for vector in VECTORS["valid"]:
            with self.subTest(vector=vector["name"]):
                operation = parse_passkey_operation(vector["kind"], vector_input(vector))
                expected = vector["expect"]
                self.assertEqual(operation.origin, expected["origin"])
                self.assertEqual(operation.rp_id, expected["rpId"])
                self.assertEqual(operation.challenge, expected["challenge"])
                self.assertEqual(operation.timeout_ms, expected["timeoutMs"])
                self.assertEqual(list(operation.credential_ids), expected["credentialIds"])
                self.assertEqual(operation.requires_user_verification, expected["requiresUserVerification"])
                if operation.kind == "create":
                    self.assertEqual(operation.rp_name, expected["rpName"])
                    self.assertEqual(operation.user.name, expected["userName"])
                    self.assertEqual(operation.algorithm, -7)
                    self.assertEqual(operation.discoverable, expected["discoverable"])

    def test_shared_invalid_vectors_fail_with_stable_safe_codes(self):
        for vector in VECTORS["invalid"]:
            with self.subTest(vector=vector["name"]):
                with self.assertRaises(PasskeyOperationError) as context:
                    parse_passkey_operation(vector["kind"], vector_input(vector))
                self.assertEqual(context.exception.code, vector["errorCode"])

    def test_ticket_expiry_and_diagnostic_projection_exclude_ceremony_data(self):
        operation = parse_passkey_operation("get", vector_input(VECTORS["valid"][1]))
        ticket = bind_native_passkey_operation(
            operation,
            "AAECAwQFBgcICQoLDA0ODw",
            1_000_000,
        )
        self.assertEqual(ticket.expires_at, 1_015_000)
        self.assertFalse(is_passkey_operation_expired(ticket, 1_014_999))
        self.assertTrue(is_passkey_operation_expired(ticket, 1_015_000))

        cancelled = to_passkey_operation_diagnostic(create_cancelled_passkey_operation_outcome(ticket))
        self.assertEqual(asdict(cancelled), {"kind": "get", "status": "cancelled", "code": "CANCELLED"})

        successful = to_passkey_operation_diagnostic(
            create_succeeded_passkey_operation_outcome(
                ticket,
                '{"id":"AQIDBA","response":{"userHandle":"dXNlci0x"}}',
            )
        )
        self.assertEqual(asdict(successful), {"kind": "get", "status": "succeeded", "code": "SUCCESS"})
        self.assertNotIn("AQIDBA", json.dumps(asdict(successful)))
        self.assertNotIn("dXNlci0x", json.dumps(asdict(successful)))


def vector_input(vector):
    return {
        "requestJson": vector.get("requestJson") or json.dumps(vector["request"], separators=(",", ":")),
        "trustedOrigin": vector["origin"],
        "clientDataHash": vector["clientDataHash"],
    }


if __name__ == "__main__":
    unittest.main()
