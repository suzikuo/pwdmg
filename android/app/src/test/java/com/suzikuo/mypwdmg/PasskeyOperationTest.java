package com.suzikuo.mypwdmg;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

public class PasskeyOperationTest {
    @Test
    public void sharedValidVectorsNormalizeToNativeOperationModel() throws Exception {
        JSONArray vectors = vectors().getJSONArray("valid");
        for (int index = 0; index < vectors.length(); index += 1) {
            JSONObject vector = vectors.getJSONObject(index);
            JSONObject expected = vector.getJSONObject("expect");
            PasskeyOperation.Operation operation = PasskeyOperation.parse(
                PasskeyOperation.Kind.fromWireValue(vector.getString("kind")),
                requestJson(vector),
                vector.getString("origin"),
                vector.getString("clientDataHash")
            );
            assertEquals(expected.getString("origin"), operation.origin);
            assertEquals(expected.getString("rpId"), operation.rpId);
            assertEquals(expected.getString("challenge"), operation.challenge);
            assertEquals(expected.getLong("timeoutMs"), operation.timeoutMs);
            assertEquals(expected.getJSONArray("credentialIds").toString(), new JSONArray(operation.credentialIds).toString());
            assertEquals(expected.getBoolean("requiresUserVerification"), operation.requiresUserVerification);
            if (operation.kind == PasskeyOperation.Kind.CREATE) {
                assertEquals(expected.getString("rpName"), operation.rpName);
                assertNotNull(operation.user);
                assertEquals(expected.getString("userName"), operation.user.name);
                assertEquals(-7, operation.algorithm);
                assertEquals(expected.getBoolean("discoverable"), operation.discoverable);
            }
        }
    }

    @Test
    public void sharedInvalidVectorsFailWithStableSafeCodes() throws Exception {
        JSONArray vectors = vectors().getJSONArray("invalid");
        for (int index = 0; index < vectors.length(); index += 1) {
            JSONObject vector = vectors.getJSONObject(index);
            PasskeyOperation.OperationException error = assertThrows(
                PasskeyOperation.OperationException.class,
                () -> PasskeyOperation.parse(
                    PasskeyOperation.Kind.fromWireValue(vector.getString("kind")),
                    requestJson(vector),
                    vector.getString("origin"),
                    vector.getString("clientDataHash")
                )
            );
            assertEquals(vector.getString("errorCode"), error.code);
        }
    }

    @Test
    public void nativeTicketAndDiagnosticProjectionKeepCeremonyDataOutOfDiagnostics() throws Exception {
        JSONObject vector = vectors().getJSONArray("valid").getJSONObject(1);
        PasskeyOperation.Operation operation = PasskeyOperation.parse(
            PasskeyOperation.Kind.GET,
            requestJson(vector),
            vector.getString("origin"),
            vector.getString("clientDataHash")
        );
        PasskeyOperation.NativeOperation ticket = PasskeyOperation.bindNativeOperation(
            operation,
            "AAECAwQFBgcICQoLDA0ODw",
            1_000_000L
        );
        assertEquals(1_015_000L, ticket.expiresAt);
        assertFalse(PasskeyOperation.isExpired(ticket, 1_014_999L));
        assertTrue(PasskeyOperation.isExpired(ticket, 1_015_000L));

        PasskeyOperation.Diagnostic cancelled = PasskeyOperation.toDiagnostic(
            PasskeyOperation.createCancelledOutcome(ticket)
        );
        assertEquals(PasskeyOperation.Status.CANCELLED, cancelled.status);
        assertEquals("CANCELLED", cancelled.code);

        PasskeyOperation.Diagnostic succeeded = PasskeyOperation.toDiagnostic(
            PasskeyOperation.createSucceededOutcome(
                ticket,
                "{\"id\":\"AQIDBA\",\"response\":{\"userHandle\":\"dXNlci0x\"}}"
            )
        );
        assertEquals(PasskeyOperation.Status.SUCCEEDED, succeeded.status);
        assertEquals("SUCCESS", succeeded.code);
        String diagnosticText = succeeded.kind + ":" + succeeded.status + ":" + succeeded.code;
        assertFalse(diagnosticText.contains("AQIDBA"));
        assertFalse(diagnosticText.contains("dXNlci0x"));
        assertFalse(diagnosticText.contains("AAECAwQF"));
    }

    private static JSONObject vectors() throws Exception {
        File current = new File(System.getProperty("user.dir")).getAbsoluteFile();
        for (int depth = 0; current != null && depth < 5; depth += 1) {
            File candidate = new File(current, "test-vectors/passkey-operation-contract.json");
            if (candidate.isFile()) {
                return new JSONObject(new String(Files.readAllBytes(candidate.toPath()), StandardCharsets.UTF_8));
            }
            current = current.getParentFile();
        }
        throw new IllegalStateException("Unable to locate passkey operation vectors");
    }

    private static String requestJson(JSONObject vector) throws Exception {
        return vector.has("requestJson")
            ? vector.getString("requestJson")
            : vector.getJSONObject("request").toString();
    }
}
