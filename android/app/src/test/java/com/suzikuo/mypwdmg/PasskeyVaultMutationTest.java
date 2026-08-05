package com.suzikuo.mypwdmg;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

public class PasskeyVaultMutationTest {
    @Test
    public void deleteMovesStableIdentityToTombstone() throws Exception {
        JSONObject payload = payload();
        assertTrue(AndroidVaultStore.deletePasskeyFromPayload(payload, "one", 123));
        assertEquals(0, payload.getJSONArray("passkeys").length());
        assertEquals(
            new JSONObject().put("id", "one").put("credentialId", "credential-one").put("deletedAt", 123).toString(),
            payload.getJSONArray("passkeyTombstones").getJSONObject(0).toString()
        );
        assertEquals(2, payload.getInt("version"));
        assertEquals(1, payload.getInt("passkeySchemaVersion"));
        assertFalse(AndroidVaultStore.deletePasskeyFromPayload(payload, "missing", 124));
    }

    @Test
    public void deleteRejectsPreexistingTombstoneIdentity() throws Exception {
        JSONObject payload = payload();
        payload.getJSONArray("passkeyTombstones").put(
            new JSONObject().put("id", "old").put("credentialId", "credential-one").put("deletedAt", 100)
        );
        assertThrows(
            IllegalArgumentException.class,
            () -> AndroidVaultStore.deletePasskeyFromPayload(payload, "one", 123)
        );
    }

    private static JSONObject payload() throws Exception {
        return new JSONObject()
            .put("version", 2)
            .put("passkeySchemaVersion", 1)
            .put("passkeys", new JSONArray().put(
                new JSONObject().put("id", "one").put("credentialId", "credential-one")
            ))
            .put("passkeyTombstones", new JSONArray());
    }
}
