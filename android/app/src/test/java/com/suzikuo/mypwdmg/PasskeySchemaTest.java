package com.suzikuo.mypwdmg;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

public class PasskeySchemaTest {
    @Test
    public void legacyStateRemainsV1AndPasskeyStatePromotesV2() throws Exception {
        PasskeySchema.State legacy = PasskeySchema.normalize(new JSONObject().put("version", 1));
        assertEquals(1, legacy.version);
        assertEquals(0, legacy.passkeys.length());
        assertEquals(0, legacy.passkeyTombstones.length());

        PasskeySchema.State promoted = PasskeySchema.normalize(new JSONObject()
            .put("version", 1)
            .put("passkeys", new JSONArray().put(samplePasskey())));
        assertEquals(2, promoted.version);
        assertEquals(1, promoted.schemaVersion);
        assertEquals("login.example.com", promoted.passkeys.getJSONObject(0).getString("rpId"));
        assertEquals(
            "[\"internal\",\"hybrid\"]",
            promoted.passkeys.getJSONObject(0).getJSONArray("transports").toString()
        );

        PasskeySchema.State sticky = PasskeySchema.normalize(new JSONObject()
            .put("version", 2)
            .put("passkeys", new JSONArray())
            .put("passkeyTombstones", new JSONArray()));
        assertEquals(2, sticky.version);
    }

    @Test
    public void malformedVersionsAndCollectionsAreRejected() throws Exception {
        assertInvalid(new JSONObject().put("version", 3), "version");
        assertInvalid(new JSONObject().put("version", "2"), "version");
        assertInvalid(new JSONObject()
            .put("version", 2)
            .put("passkeySchemaVersion", 2)
            .put("passkeys", new JSONArray())
            .put("passkeyTombstones", new JSONArray()), "schema version");
        assertInvalid(new JSONObject().put("version", 2).put("passkeys", new JSONArray()), "requires");
        assertInvalid(new JSONObject().put("passkeys", new JSONObject()), "array");
        assertInvalid(new JSONObject().put("passkeyTombstones", JSONObject.NULL), "array");

        JSONArray oversized = new JSONArray();
        for (int index = 0; index <= 10_000; index += 1) oversized.put(JSONObject.NULL);
        assertInvalid(new JSONObject().put("passkeys", oversized), "maximum size");
    }

    @Test
    public void duplicateAndLossyCredentialRepairsAreRejected() throws Exception {
        assertInvalid(new JSONObject().put("passkeys", new JSONArray()
            .put(samplePasskey())
            .put(copyWith(samplePasskey(), "credentialId", "BQYHCA"))), "Duplicate passkey id");
        assertInvalid(new JSONObject().put("passkeys", new JSONArray()
            .put(samplePasskey())
            .put(copyWith(samplePasskey(), "id", "passkey-2"))), "Duplicate passkey credentialId");
        assertInvalid(new JSONObject().put("passkeys", new JSONArray()
            .put(copyWith(samplePasskey(), "privateKeyPkcs8", "not+base64"))), "base64url");
        assertInvalid(new JSONObject().put("passkeys", new JSONArray()
            .put(copyWith(samplePasskey(), "credentialId", "AB"))), "canonical");
        assertInvalid(new JSONObject().put("passkeys", new JSONArray()
            .put(copyWith(copyWith(samplePasskey(), "backupEligible", false), "backupState", true))), "backupEligible");
        assertInvalid(new JSONObject().put("passkeys", new JSONArray()
            .put(copyWith(samplePasskey(), "algorithm", "-7"))), "algorithm");
        assertInvalid(new JSONObject().put("passkeys", new JSONArray()
            .put(copyWith(samplePasskey(), "algorithm", -257))), "ES256");
        assertInvalid(new JSONObject().put("passkeys", new JSONArray()
            .put(copyWith(samplePasskey(), "futureExtension", true))), "unsupported field");
        assertInvalid(new JSONObject().put("passkeys", new JSONArray()
            .put(copyWith(samplePasskey(), "updatedAt", "101"))), "updatedAt");
        assertInvalid(new JSONObject().put("passkeys", new JSONArray()
            .put(copyWith(samplePasskey(), "updatedAt", 99))), "predates");
        assertInvalid(new JSONObject().put("passkeys", new JSONArray()
            .put(copyWith(samplePasskey(), "userName", repeatedText("界", 171)))), "invalid length");
    }

    @Test
    public void liveAndDeletedCredentialsCannotOverlap() throws Exception {
        JSONObject tombstone = new JSONObject()
            .put("id", "passkey-1")
            .put("credentialId", "AQIDBA")
            .put("deletedAt", 200);
        assertInvalid(new JSONObject()
            .put("passkeys", new JSONArray().put(samplePasskey()))
            .put("passkeyTombstones", new JSONArray().put(tombstone)), "live and deleted");

        JSONObject sameCredential = new JSONObject(tombstone.toString())
            .put("id", "passkey-deleted")
            .put("credentialId", "AQIDBA");
        assertInvalid(new JSONObject()
            .put("passkeys", new JSONArray().put(samplePasskey()))
            .put("passkeyTombstones", new JSONArray().put(sameCredential)), "credentialId");
    }

    private static JSONObject samplePasskey() throws Exception {
        return new JSONObject()
            .put("id", "passkey-1")
            .put("credentialId", "AQIDBA")
            .put("rpId", "Login.Example.com.")
            .put("rpName", "Example")
            .put("userHandle", "dXNlci0x")
            .put("userName", "alice@example.com")
            .put("userDisplayName", "Alice")
            .put("algorithm", -7)
            .put("publicKeyCose", "cHVibGljLWtleQ")
            .put("privateKeyPkcs8", "cHJpdmF0ZS1rZXk")
            .put("discoverable", true)
            .put("backupEligible", true)
            .put("backupState", true)
            .put("transports", new JSONArray().put("internal").put("hybrid").put("internal"))
            .put("entryId", "login-1")
            .put("createdAt", 100)
            .put("updatedAt", 101);
    }

    private static JSONObject copyWith(JSONObject source, String key, Object value) throws Exception {
        return new JSONObject(source.toString()).put(key, value);
    }

    private static String repeatedText(String value, int count) {
        StringBuilder builder = new StringBuilder(value.length() * count);
        for (int index = 0; index < count; index += 1) builder.append(value);
        return builder.toString();
    }

    private static void assertInvalid(JSONObject payload, String messagePart) {
        IllegalArgumentException error = assertThrows(
            IllegalArgumentException.class,
            () -> PasskeySchema.normalize(payload)
        );
        assertTrue(error.getMessage(), error.getMessage().contains(messagePart));
    }
}
