package com.suzikuo.mypwdmg;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

import java.nio.charset.StandardCharsets;
import java.util.Base64;

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

public class VaultFormatTest {
    private static final byte[] KEY = repeatedBytes(32, (byte) 0x31);
    private static final byte[] SALT = repeatedBytes(16, (byte) 0x42);
    private static final byte[] NONCE = repeatedBytes(12, (byte) 0x53);

    @Test
    public void versionsHaveDistinctAuthenticatedData() {
        assertArrayEquals("mypwdmg-vault-v1".getBytes(StandardCharsets.UTF_8), VaultFormat.aadForVersion(1));
        assertArrayEquals("mypwdmg-vault-v2".getBytes(StandardCharsets.UTF_8), VaultFormat.aadForVersion(2));
        assertThrows(IllegalArgumentException.class, () -> VaultFormat.aadForVersion(3));
    }

    @Test
    public void legacyAndV2PayloadsRoundTripWithTheirOwnAad() throws Exception {
        JSONObject legacyPayload = new JSONObject()
            .put("entries", new JSONArray())
            .put("passkeys", new JSONArray())
            .put("passkeyTombstones", new JSONArray());
        JSONObject legacyEnvelope = AndroidVaultStore.encryptPayloadWithKey(
            legacyPayload,
            KEY,
            SALT,
            390000,
            NONCE
        );
        assertEquals(1, legacyEnvelope.getInt("version"));
        assertEquals(1, VaultFormat.readPayloadVersion(AndroidVaultStore.decryptEnvelopeWithKey(legacyEnvelope, KEY)));

        JSONObject v2Payload = new JSONObject(legacyPayload.toString()).put("version", 2);
        JSONObject v2Envelope = AndroidVaultStore.encryptPayloadWithKey(v2Payload, KEY, SALT, 390000, NONCE);
        assertEquals(2, v2Envelope.getInt("version"));
        assertEquals(2, AndroidVaultStore.decryptEnvelopeWithKey(v2Envelope, KEY).getInt("version"));
    }

    @Test
    public void changingOnlyTheOuterVersionBreaksAuthentication() throws Exception {
        JSONObject payload = new JSONObject()
            .put("version", 2)
            .put("entries", new JSONArray())
            .put("passkeys", new JSONArray())
            .put("passkeyTombstones", new JSONArray());
        JSONObject envelope = AndroidVaultStore.encryptPayloadWithKey(payload, KEY, SALT, 390000, NONCE);
        JSONObject downgraded = new JSONObject(envelope.toString()).put("version", 1);
        assertThrows(Exception.class, () -> AndroidVaultStore.decryptEnvelopeWithKey(downgraded, KEY));
    }

    @Test
    public void authenticatedEnvelopeAndPayloadVersionsMustMatch() throws Exception {
        JSONObject payload = new JSONObject().put("version", 1).put("entries", new JSONArray());
        JSONObject mismatched = encryptWithEnvelopeVersion(payload, 2);
        IllegalArgumentException error = assertThrows(
            IllegalArgumentException.class,
            () -> AndroidVaultStore.decryptEnvelopeWithKey(mismatched, KEY)
        );
        assertEquals("Vault version metadata does not match its payload", error.getMessage());
    }

    @Test
    public void envelopeRevisionTracksTheInnerPayloadAndRejectsStaleMetadata() throws Exception {
        JSONObject payload = new JSONObject()
            .put("version", 1)
            .put("revision", 7)
            .put("entries", new JSONArray())
            .put("passkeys", new JSONArray())
            .put("passkeyTombstones", new JSONArray());
        JSONObject envelope = AndroidVaultStore.encryptPayloadWithKey(payload, KEY, SALT, 390000, NONCE);
        assertEquals(7, envelope.getLong("revision"));
        assertEquals(7, AndroidVaultStore.decryptEnvelopeWithKey(envelope, KEY).getLong("revision"));

        JSONObject stale = new JSONObject(envelope.toString()).put("revision", 6);
        IllegalArgumentException error = assertThrows(
            IllegalArgumentException.class,
            () -> AndroidVaultStore.decryptEnvelopeWithKey(stale, KEY)
        );
        assertEquals("Vault revision metadata does not match its payload", error.getMessage());
    }

    @Test
    public void casRevisionPolicyRequiresTheCurrentRevisionAndAValidNextValue() throws Exception {
        AndroidVaultStore.requireExpectedRevision(-1, 7);
        AndroidVaultStore.requireExpectedRevision(7, 7);
        assertEquals(8, AndroidVaultStore.nextRevision(7));

        assertThrows(
            AndroidVaultStore.ConflictException.class,
            () -> AndroidVaultStore.requireExpectedRevision(6, 7)
        );
        assertThrows(
            IllegalArgumentException.class,
            () -> AndroidVaultStore.requireExpectedRevision(-2, 7)
        );
        assertThrows(
            AndroidVaultStore.ConflictException.class,
            () -> AndroidVaultStore.nextRevision(VaultFormat.MAX_REVISION)
        );
    }

    @Test
    public void passwordlessMarkerSurvivesNativeMigrationRewrite() throws Exception {
        JSONObject original = new JSONObject().put("passwordless", true);
        JSONObject rewritten = new JSONObject();

        AndroidVaultStore.preservePasswordlessMarker(original, rewritten);

        assertTrue(rewritten.getBoolean("passwordless"));
    }

    @Test
    public void authenticatedLegacyPasskeyStateCanBeNormalizedAndRewrittenAsV2() throws Exception {
        JSONObject payload = new JSONObject()
            .put("version", 1)
            .put("entries", new JSONArray())
            .put("passkeys", new JSONArray())
            .put("passkeyTombstones", new JSONArray().put(new JSONObject()
                .put("id", "passkey-deleted")
                .put("credentialId", "AQIDBA")
                .put("deletedAt", 200)));
        JSONObject envelope = encryptWithEnvelopeVersion(payload, 1);
        JSONObject decrypted = AndroidVaultStore.decryptEnvelopeWithKey(envelope, KEY);
        assertEquals(2, PasskeySchema.normalize(decrypted).version);
    }

    @Test
    public void knownV2EnvelopeCannotBeReplacedByV1() throws Exception {
        JSONObject base = new JSONObject()
            .put("entries", new JSONArray())
            .put("passkeys", new JSONArray())
            .put("passkeyTombstones", new JSONArray());
        JSONObject current = AndroidVaultStore.encryptPayloadWithKey(
            new JSONObject(base.toString()).put("version", 2),
            KEY,
            SALT,
            390000,
            NONCE
        );
        JSONObject incoming = AndroidVaultStore.encryptPayloadWithKey(base, KEY, SALT, 390000, NONCE);
        assertThrows(IllegalArgumentException.class, () -> VaultFormat.requireNoDowngrade(current, incoming));
    }

    @Test
    public void encryptionRejectsV1PasskeyStateAndOversizedPlaintext() throws Exception {
        JSONObject v1WithTombstone = new JSONObject()
            .put("version", 1)
            .put("entries", new JSONArray())
            .put("passkeys", new JSONArray())
            .put("passkeyTombstones", new JSONArray().put(new JSONObject()
                .put("id", "passkey-deleted")
                .put("credentialId", "AQIDBA")
                .put("deletedAt", 200)));
        assertThrows(
            IllegalArgumentException.class,
            () -> AndroidVaultStore.encryptPayloadWithKey(v1WithTombstone, KEY, SALT, 390000, NONCE)
        );

        JSONObject oversized = new JSONObject()
            .put("version", 1)
            .put("entries", new JSONArray())
            .put("passkeys", new JSONArray())
            .put("passkeyTombstones", new JSONArray())
            .put("padding", repeatedText("x", VaultFormat.MAX_PLAINTEXT_BYTES));
        assertThrows(
            IllegalArgumentException.class,
            () -> AndroidVaultStore.encryptPayloadWithKey(oversized, KEY, SALT, 390000, NONCE)
        );
    }

    @Test
    public void envelopeValidationEnforcesCryptoBoundsAndCanonicalBase64() throws Exception {
        JSONObject payload = new JSONObject()
            .put("version", 1)
            .put("entries", new JSONArray())
            .put("passkeys", new JSONArray())
            .put("passkeyTombstones", new JSONArray());
        JSONObject envelope = AndroidVaultStore.encryptPayloadWithKey(payload, KEY, SALT, 390000, NONCE);
        assertEquals(1, VaultFormat.validateEnvelope(envelope).version);

        JSONObject weakKdf = new JSONObject(envelope.toString());
        weakKdf.getJSONObject("kdf").put("iterations", 9999);
        assertThrows(IllegalArgumentException.class, () -> VaultFormat.validateEnvelope(weakKdf));

        JSONObject wrongSalt = new JSONObject(envelope.toString());
        wrongSalt.getJSONObject("kdf").put("salt", Base64.getEncoder().encodeToString(new byte[15]));
        assertThrows(IllegalArgumentException.class, () -> VaultFormat.validateEnvelope(wrongSalt));

        JSONObject unpaddedSalt = new JSONObject(envelope.toString());
        unpaddedSalt.getJSONObject("kdf").put("salt", Base64.getEncoder().withoutPadding().encodeToString(SALT));
        assertThrows(IllegalArgumentException.class, () -> VaultFormat.validateEnvelope(unpaddedSalt));

        JSONObject shortCiphertext = new JSONObject(envelope.toString())
            .put("ciphertext", Base64.getEncoder().encodeToString(new byte[15]));
        assertThrows(IllegalArgumentException.class, () -> VaultFormat.validateEnvelope(shortCiphertext));
    }

    private static JSONObject encryptWithEnvelopeVersion(JSONObject payload, int envelopeVersion) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(KEY, "AES"), new GCMParameterSpec(128, NONCE));
        cipher.updateAAD(VaultFormat.aadForVersion(envelopeVersion));
        byte[] ciphertext = cipher.doFinal(payload.toString().getBytes(StandardCharsets.UTF_8));
        return new JSONObject()
            .put("format", "mypwdmg-vault")
            .put("version", envelopeVersion)
            .put("cipher", "AES-256-GCM")
            .put("kdf", new JSONObject()
                .put("name", "PBKDF2-HMAC-SHA256")
                .put("iterations", 390000)
                .put("salt", Base64.getEncoder().encodeToString(SALT)))
            .put("nonce", Base64.getEncoder().encodeToString(NONCE))
            .put("ciphertext", Base64.getEncoder().encodeToString(ciphertext));
    }

    private static byte[] repeatedBytes(int size, byte value) {
        byte[] bytes = new byte[size];
        for (int index = 0; index < bytes.length; index += 1) bytes[index] = value;
        return bytes;
    }

    private static String repeatedText(String value, int count) {
        StringBuilder builder = new StringBuilder(value.length() * count);
        for (int index = 0; index < count; index += 1) builder.append(value);
        return builder.toString();
    }
}
