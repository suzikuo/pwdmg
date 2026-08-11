package com.suzikuo.mypwdmg;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Base64;
import java.util.HashSet;
import java.util.Iterator;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

final class PasskeySchema {
    private static final Pattern BASE64URL_PATTERN = Pattern.compile("^[A-Za-z0-9_-]+$");
    private static final Pattern RP_ID_LABEL_PATTERN = Pattern.compile("^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$");
    private static final Set<String> PASSKEY_TRANSPORTS = new HashSet<>(Arrays.asList(
        "usb", "nfc", "ble", "internal", "hybrid", "smart-card"
    ));
    private static final String[] PASSKEY_TRANSPORT_ORDER = {
        "internal", "hybrid", "usb", "nfc", "ble", "smart-card"
    };
    private static final Set<String> PASSKEY_FIELDS = new HashSet<>(Arrays.asList(
        "id", "label", "credentialId", "rpId", "rpName", "userHandle", "userName", "userDisplayName",
        "algorithm", "publicKeyCose", "privateKeyPkcs8", "discoverable", "backupEligible",
        "backupState", "transports", "entryId", "createdAt", "updatedAt"
    ));
    private static final Set<String> TOMBSTONE_FIELDS = new HashSet<>(Arrays.asList(
        "id", "credentialId", "deletedAt"
    ));
    static final int SCHEMA_VERSION = 1;
    private static final int MAX_ID_LENGTH = 128;
    private static final int MAX_CREDENTIAL_ID_LENGTH = 2048;
    private static final int MAX_KEY_LENGTH = 16_384;
    private static final int MAX_USER_HANDLE_LENGTH = 256;
    private static final int MAX_DISPLAY_LENGTH = 512;
    private static final int MAX_COLLECTION_SIZE = 10_000;
    private static final long MAX_SAFE_INTEGER = (1L << 53) - 1;

    private PasskeySchema() {}

    static State normalize(JSONObject payload) throws JSONException {
        if (payload == null) throw new IllegalArgumentException("Vault payload must be an object");

        int currentVersion = VaultFormat.readPayloadVersion(payload);
        if (currentVersion == 2 && (!payload.has("passkeys") || !payload.has("passkeyTombstones"))) {
            throw new IllegalArgumentException("Vault v2 requires passkeys and passkeyTombstones arrays");
        }
        JSONArray passkeys = normalizePasskeys(readArray(payload, "passkeys"));
        JSONArray tombstones = normalizeTombstones(readArray(payload, "passkeyTombstones"));
        boolean hasPasskeyState = currentVersion == 2 || passkeys.length() > 0 || tombstones.length() > 0;
        int schemaVersion = readSchemaVersion(payload.opt("passkeySchemaVersion"), hasPasskeyState);
        Set<String> liveIds = new HashSet<>();
        Set<String> liveCredentialIds = new HashSet<>();
        for (int index = 0; index < passkeys.length(); index += 1) {
            JSONObject passkey = passkeys.getJSONObject(index);
            liveIds.add(passkey.getString("id"));
            liveCredentialIds.add(passkey.getString("credentialId"));
        }
        for (int index = 0; index < tombstones.length(); index += 1) {
            JSONObject tombstone = tombstones.getJSONObject(index);
            String id = tombstone.getString("id");
            if (liveIds.contains(id)) {
                throw new IllegalArgumentException("Passkey " + id + " cannot be live and deleted");
            }
            String credentialId = tombstone.getString("credentialId");
            if (liveCredentialIds.contains(credentialId)) {
                throw new IllegalArgumentException("Passkey credentialId " + credentialId + " cannot be live and deleted");
            }
        }

        return new State(currentVersion == 2 || hasPasskeyState ? 2 : 1, schemaVersion, passkeys, tombstones);
    }

    static void requireValidEncryptionState(JSONObject payload) throws JSONException {
        int declaredVersion = VaultFormat.readPayloadVersion(payload);
        State state = normalize(payload);
        if (declaredVersion != state.version) {
            throw new IllegalArgumentException("Vault v1 cannot contain passkey state");
        }
    }

    static void validateDecryptedState(JSONObject payload) throws JSONException {
        normalize(payload);
    }

    private static JSONArray normalizePasskeys(JSONArray values) throws JSONException {
        JSONArray normalized = new JSONArray();
        Set<String> ids = new HashSet<>();
        Set<String> credentialIds = new HashSet<>();
        for (int index = 0; index < values.length(); index += 1) {
            String field = "passkeys[" + index + "]";
            JSONObject raw = readObject(values.get(index), field);
            assertKnownFields(raw, PASSKEY_FIELDS, field);
            String id = readText(raw.opt("id"), field + ".id", MAX_ID_LENGTH);
            String credentialId = readBase64Url(
                raw.opt("credentialId"),
                field + ".credentialId",
                MAX_CREDENTIAL_ID_LENGTH
            );
            if (!ids.add(id)) throw new IllegalArgumentException("Duplicate passkey id: " + id);
            if (!credentialIds.add(credentialId)) {
                throw new IllegalArgumentException("Duplicate passkey credentialId: " + credentialId);
            }

            boolean backupEligible = readBoolean(raw.opt("backupEligible"), field + ".backupEligible");
            boolean backupState = readBoolean(raw.opt("backupState"), field + ".backupState");
            if (backupState && !backupEligible) {
                throw new IllegalArgumentException(field + ".backupState requires backupEligible");
            }
            long createdAt = readTimestamp(raw.opt("createdAt"), field + ".createdAt");
            long updatedAt = readTimestamp(raw.opt("updatedAt"), field + ".updatedAt");
            if (updatedAt < createdAt) {
                throw new IllegalArgumentException(field + ".updatedAt predates createdAt");
            }

            JSONObject item = new JSONObject()
                .put("id", id)
                .put("credentialId", credentialId)
                .put("rpId", readRpId(raw.opt("rpId"), field + ".rpId"))
                .put("userHandle", readBase64Url(raw.opt("userHandle"), field + ".userHandle", MAX_USER_HANDLE_LENGTH))
                .put("userName", readText(raw.opt("userName"), field + ".userName", MAX_DISPLAY_LENGTH))
                .put("algorithm", readAlgorithm(raw.opt("algorithm"), field + ".algorithm"))
                .put("publicKeyCose", readBase64Url(raw.opt("publicKeyCose"), field + ".publicKeyCose", MAX_KEY_LENGTH))
                .put("privateKeyPkcs8", readBase64Url(raw.opt("privateKeyPkcs8"), field + ".privateKeyPkcs8", MAX_KEY_LENGTH))
                .put("discoverable", readBoolean(raw.opt("discoverable"), field + ".discoverable"))
                .put("backupEligible", backupEligible)
                .put("backupState", backupState)
                .put("transports", readTransports(raw.opt("transports"), field + ".transports"))
                .put("createdAt", createdAt)
                .put("updatedAt", updatedAt);

            putOptionalText(item, raw, "label", field + ".label", MAX_DISPLAY_LENGTH);
            putOptionalText(item, raw, "rpName", field + ".rpName", MAX_DISPLAY_LENGTH);
            putOptionalText(item, raw, "userDisplayName", field + ".userDisplayName", MAX_DISPLAY_LENGTH);
            putOptionalText(item, raw, "entryId", field + ".entryId", MAX_ID_LENGTH);
            normalized.put(item);
        }
        return normalized;
    }

    private static JSONArray normalizeTombstones(JSONArray values) throws JSONException {
        JSONArray normalized = new JSONArray();
        Set<String> ids = new HashSet<>();
        Set<String> credentialIds = new HashSet<>();
        for (int index = 0; index < values.length(); index += 1) {
            String field = "passkeyTombstones[" + index + "]";
            JSONObject raw = readObject(values.get(index), field);
            assertKnownFields(raw, TOMBSTONE_FIELDS, field);
            String id = readText(raw.opt("id"), field + ".id", MAX_ID_LENGTH);
            String credentialId = readBase64Url(
                raw.opt("credentialId"),
                field + ".credentialId",
                MAX_CREDENTIAL_ID_LENGTH
            );
            if (!ids.add(id)) throw new IllegalArgumentException("Duplicate passkey tombstone id: " + id);
            if (!credentialIds.add(credentialId)) {
                throw new IllegalArgumentException("Duplicate passkey tombstone credentialId: " + credentialId);
            }
            normalized.put(new JSONObject()
                .put("id", id)
                .put("credentialId", credentialId)
                .put("deletedAt", readTimestamp(raw.opt("deletedAt"), field + ".deletedAt")));
        }
        return normalized;
    }

    private static JSONArray readArray(JSONObject payload, String key) {
        if (!payload.has(key)) return new JSONArray();
        Object value = payload.opt(key);
        if (!(value instanceof JSONArray)) {
            throw new IllegalArgumentException("Vault " + key + " must be an array");
        }
        JSONArray array = (JSONArray) value;
        if (array.length() > MAX_COLLECTION_SIZE) {
            throw new IllegalArgumentException("Vault " + key + " exceeds the maximum size");
        }
        return array;
    }

    private static JSONObject readObject(Object value, String field) {
        if (!(value instanceof JSONObject)) throw new IllegalArgumentException(field + " must be an object");
        return (JSONObject) value;
    }

    private static String readText(Object value, String field, int maxLength) {
        if (!(value instanceof String)) throw new IllegalArgumentException(field + " must be a string");
        String text = ((String) value).trim();
        if (text.isEmpty() || text.getBytes(StandardCharsets.UTF_8).length > maxLength) {
            throw new IllegalArgumentException(field + " has an invalid length");
        }
        return text;
    }

    private static String readOptionalText(Object value, String field, int maxLength) {
        if (value == null || value == JSONObject.NULL || "".equals(value)) return "";
        return readText(value, field, maxLength);
    }

    private static String readBase64Url(Object value, String field, int maxLength) {
        String text = readText(value, field, maxLength);
        if (!BASE64URL_PATTERN.matcher(text).matches()) {
            throw new IllegalArgumentException(field + " must be unpadded base64url");
        }
        byte[] decoded;
        try {
            decoded = Base64.getUrlDecoder().decode(text);
        } catch (IllegalArgumentException error) {
            throw new IllegalArgumentException(field + " must be unpadded base64url", error);
        }
        String canonical = Base64.getUrlEncoder().withoutPadding().encodeToString(decoded);
        if (!canonical.equals(text)) {
            throw new IllegalArgumentException(field + " must be canonical unpadded base64url");
        }
        return text;
    }

    private static String readRpId(Object value, String field) {
        String rpId = readText(value, field, 253).toLowerCase(Locale.ROOT);
        if (rpId.endsWith(".")) rpId = rpId.substring(0, rpId.length() - 1);
        for (String label : rpId.split("\\.", -1)) {
            if (!RP_ID_LABEL_PATTERN.matcher(label).matches()) {
                throw new IllegalArgumentException(field + " is invalid");
            }
        }
        return rpId;
    }

    private static boolean readBoolean(Object value, String field) {
        if (!(value instanceof Boolean)) throw new IllegalArgumentException(field + " must be a boolean");
        return (Boolean) value;
    }

    private static int readAlgorithm(Object value, String field) {
        long algorithm = readInteger(value, field);
        if (algorithm != -7) throw new IllegalArgumentException(field + " supports ES256 (-7) only");
        return -7;
    }

    private static long readTimestamp(Object value, String field) {
        long timestamp = readInteger(value, field);
        if (timestamp <= 0 || timestamp > MAX_SAFE_INTEGER) {
            throw new IllegalArgumentException(field + " is invalid");
        }
        return timestamp;
    }

    private static long readInteger(Object value, String field) {
        if (!(value instanceof Byte || value instanceof Short || value instanceof Integer || value instanceof Long)) {
            throw new IllegalArgumentException(field + " is invalid");
        }
        return ((Number) value).longValue();
    }

    private static JSONArray readTransports(Object value, String field) throws JSONException {
        if (!(value instanceof JSONArray)) throw new IllegalArgumentException(field + " must be an array");
        JSONArray raw = (JSONArray) value;
        Set<String> seen = new HashSet<>();
        for (int index = 0; index < raw.length(); index += 1) {
            Object item = raw.get(index);
            if (!(item instanceof String) || !PASSKEY_TRANSPORTS.contains(item)) {
                throw new IllegalArgumentException(field + " contains an unsupported transport");
            }
            seen.add((String) item);
        }
        JSONArray transports = new JSONArray();
        for (String transport : PASSKEY_TRANSPORT_ORDER) {
            if (seen.contains(transport)) transports.put(transport);
        }
        return transports;
    }

    private static int readSchemaVersion(Object value, boolean required) {
        if (!required && (value == null || value == JSONObject.NULL)) return 0;
        if (value == null || value == JSONObject.NULL) return SCHEMA_VERSION;
        long version = readInteger(value, "passkeySchemaVersion");
        if (version != SCHEMA_VERSION) throw new IllegalArgumentException("Unsupported passkey schema version");
        return SCHEMA_VERSION;
    }

    private static void assertKnownFields(JSONObject value, Set<String> known, String field) {
        Iterator<String> keys = value.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            if (!known.contains(key)) {
                throw new IllegalArgumentException(field + " contains unsupported field: " + key);
            }
        }
    }

    private static void putOptionalText(JSONObject target, JSONObject source, String key, String field, int maxLength) throws JSONException {
        String value = readOptionalText(source.opt(key), field, maxLength);
        if (!value.isEmpty()) target.put(key, value);
    }

    static final class State {
        final int version;
        final int schemaVersion;
        final JSONArray passkeys;
        final JSONArray passkeyTombstones;

        State(int version, int schemaVersion, JSONArray passkeys, JSONArray passkeyTombstones) {
            this.version = version;
            this.schemaVersion = schemaVersion;
            this.passkeys = passkeys;
            this.passkeyTombstones = passkeyTombstones;
        }
    }
}
