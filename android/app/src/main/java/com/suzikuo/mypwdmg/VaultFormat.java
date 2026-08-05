package com.suzikuo.mypwdmg;

import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.util.Base64;

final class VaultFormat {
    static final int MIN_KDF_ITERATIONS = 10_000;
    static final int MAX_KDF_ITERATIONS = 2_000_000;
    static final int SALT_BYTES = 16;
    static final int NONCE_BYTES = 12;
    static final int MIN_CIPHERTEXT_BYTES = 16;
    static final int MAX_PLAINTEXT_BYTES = 16 * 1024 * 1024;
    static final int MAX_CIPHERTEXT_BYTES = MAX_PLAINTEXT_BYTES + MIN_CIPHERTEXT_BYTES;
    static final long MAX_REVISION = (1L << 53) - 1;

    private static final byte[] AAD_V1 = "mypwdmg-vault-v1".getBytes(StandardCharsets.UTF_8);
    private static final byte[] AAD_V2 = "mypwdmg-vault-v2".getBytes(StandardCharsets.UTF_8);

    private VaultFormat() {}

    static int readEnvelopeVersion(JSONObject envelope) {
        if (envelope == null || !envelope.has("version")) {
            throw new IllegalArgumentException("Unsupported vault version");
        }
        return readSupportedVersion(envelope.opt("version"), "vault");
    }

    static int readPayloadVersion(JSONObject payload) {
        if (payload == null) {
            throw new IllegalArgumentException("Vault payload must be an object");
        }
        Object value = payload.has("version") ? payload.opt("version") : Integer.valueOf(1);
        return readSupportedVersion(value, "vault payload");
    }

    static long readPayloadRevision(JSONObject payload) {
        if (payload == null) throw new IllegalArgumentException("Vault payload must be an object");
        Object value = payload.has("revision") ? payload.opt("revision") : Long.valueOf(1);
        return readBoundedInteger(value, "revision", 1, MAX_REVISION);
    }

    static long readEnvelopeRevision(JSONObject envelope) {
        if (envelope == null) throw new IllegalArgumentException("Vault file is malformed");
        Object value = envelope.has("revision") ? envelope.opt("revision") : Long.valueOf(1);
        return readBoundedInteger(value, "revision", 1, MAX_REVISION);
    }

    static byte[] aadForVersion(int version) {
        if (version == 1) return AAD_V1.clone();
        if (version == 2) return AAD_V2.clone();
        throw new IllegalArgumentException("Unsupported vault version");
    }

    static void requireMatchingVersions(JSONObject envelope, JSONObject payload) {
        if (readEnvelopeVersion(envelope) != readPayloadVersion(payload)) {
            throw new IllegalArgumentException("Vault version metadata does not match its payload");
        }
    }

    static void requireMatchingRevisions(JSONObject envelope, JSONObject payload) {
        if (envelope.has("revision") && readEnvelopeRevision(envelope) != readPayloadRevision(payload)) {
            throw new IllegalArgumentException("Vault revision metadata does not match its payload");
        }
    }

    static void requireNoDowngrade(JSONObject currentEnvelope, JSONObject incomingEnvelope) {
        if (readEnvelopeVersion(currentEnvelope) == 2 && readEnvelopeVersion(incomingEnvelope) < 2) {
            throw new IllegalArgumentException("Refusing to replace a version 2 vault with version 1");
        }
    }

    static ValidatedEnvelope validateEnvelope(JSONObject envelope) {
        if (envelope == null) throw new IllegalArgumentException("Vault file is malformed");
        if (!"mypwdmg-vault".equals(envelope.optString("format"))) {
            throw new IllegalArgumentException("Unsupported vault format");
        }
        int version = readEnvelopeVersion(envelope);
        if (!"AES-256-GCM".equals(envelope.optString("cipher"))) {
            throw new IllegalArgumentException("Unsupported vault cipher");
        }

        Object rawKdf = envelope.opt("kdf");
        if (!(rawKdf instanceof JSONObject)) throw new IllegalArgumentException("Unsupported vault KDF");
        JSONObject kdf = (JSONObject) rawKdf;
        if (!"PBKDF2-HMAC-SHA256".equals(kdf.optString("name"))) {
            throw new IllegalArgumentException("Unsupported vault KDF");
        }
        int iterations = (int) readBoundedInteger(
            kdf.opt("iterations"),
            "KDF iteration count",
            MIN_KDF_ITERATIONS,
            MAX_KDF_ITERATIONS
        );
        byte[] salt = decodeBase64(kdf.opt("salt"), "salt", SALT_BYTES, SALT_BYTES);
        byte[] nonce = decodeBase64(envelope.opt("nonce"), "nonce", NONCE_BYTES, NONCE_BYTES);
        byte[] ciphertext = decodeBase64(
            envelope.opt("ciphertext"),
            "ciphertext",
            MIN_CIPHERTEXT_BYTES,
            MAX_CIPHERTEXT_BYTES
        );
        if (envelope.has("passwordless") && !(envelope.opt("passwordless") instanceof Boolean)) {
            throw new IllegalArgumentException("Vault passwordless marker is invalid");
        }
        long revision = readEnvelopeRevision(envelope);
        return new ValidatedEnvelope(version, revision, iterations, salt, nonce, ciphertext);
    }

    private static int readSupportedVersion(Object value, String field) {
        if (!(value instanceof Byte || value instanceof Short || value instanceof Integer || value instanceof Long)) {
            throw new IllegalArgumentException("Unsupported " + field + " version");
        }
        long version = ((Number) value).longValue();
        if (version != 1 && version != 2) {
            throw new IllegalArgumentException("Unsupported " + field + " version");
        }
        return (int) version;
    }

    private static long readBoundedInteger(Object value, String field, long minimum, long maximum) {
        if (!(value instanceof Byte || value instanceof Short || value instanceof Integer || value instanceof Long)) {
            throw new IllegalArgumentException("Vault " + field + " is invalid");
        }
        long result = ((Number) value).longValue();
        if (result < minimum || result > maximum) {
            throw new IllegalArgumentException("Vault " + field + " is outside the supported range");
        }
        return result;
    }

    private static byte[] decodeBase64(Object value, String field, int minimum, int maximum) {
        if (!(value instanceof String) || ((String) value).isEmpty()) {
            throw new IllegalArgumentException("Vault " + field + " is invalid");
        }
        String text = (String) value;
        int maxEncodedLength = ((maximum + 2) / 3) * 4;
        if (text.length() > maxEncodedLength) {
            throw new IllegalArgumentException("Vault " + field + " is too large");
        }
        byte[] decoded;
        try {
            decoded = Base64.getDecoder().decode(text);
        } catch (IllegalArgumentException error) {
            throw new IllegalArgumentException("Vault " + field + " is not valid base64", error);
        }
        if (!Base64.getEncoder().encodeToString(decoded).equals(text)) {
            throw new IllegalArgumentException("Vault " + field + " is not canonical base64");
        }
        if (decoded.length < minimum || decoded.length > maximum) {
            throw new IllegalArgumentException("Vault " + field + " has an invalid length");
        }
        return decoded;
    }

    static final class ValidatedEnvelope {
        final int version;
        final long revision;
        final int iterations;
        final byte[] salt;
        final byte[] nonce;
        final byte[] ciphertext;

        ValidatedEnvelope(int version, long revision, int iterations, byte[] salt, byte[] nonce, byte[] ciphertext) {
            this.version = version;
            this.revision = revision;
            this.iterations = iterations;
            this.salt = salt;
            this.nonce = nonce;
            this.ciphertext = ciphertext;
        }
    }
}
