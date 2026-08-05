package com.suzikuo.mypwdmg;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertThrows;

import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

public class AndroidVaultWebBoundaryTest {
    @Test
    public void projectionRedactsPrivateKeyAndRehydratesOnlyCachedMaterial() throws Exception {
        JSONObject source = payload(new JSONArray().put(passkey("private-material")), new JSONArray());
        Map<String, JSONObject> materials = new HashMap<>();
        Set<String> tombstones = new HashSet<>();

        JSONObject projected = AndroidVaultStore.redactPayloadForWeb(source, materials, tombstones);
        JSONObject visible = projected.getJSONArray("passkeys").getJSONObject(0);
        assertEquals(AndroidVaultStore.WEB_REDACTED_PRIVATE_KEY, visible.getString("privateKeyPkcs8"));
        assertFalse(projected.toString().contains("private-material"));

        visible.put("rpName", "Synced display name");
        JSONObject restored = AndroidVaultStore.rehydratePayloadFromWeb(source, projected, materials, tombstones);
        JSONObject restoredPasskey = restored.getJSONArray("passkeys").getJSONObject(0);
        assertEquals("private-material", restoredPasskey.getString("privateKeyPkcs8"));
        assertEquals("Synced display name", restoredPasskey.getString("rpName"));
    }

    @Test
    public void webCannotInjectPrivateKeyOrDeleteWithoutAuthorizedTombstone() throws Exception {
        JSONObject source = payload(new JSONArray().put(passkey("private-material")), new JSONArray());
        Map<String, JSONObject> materials = new HashMap<>();
        Set<String> tombstones = new HashSet<>();
        JSONObject projected = AndroidVaultStore.redactPayloadForWeb(source, materials, tombstones);

        JSONObject injected = new JSONObject(projected.toString());
        injected.getJSONArray("passkeys").getJSONObject(0).put("privateKeyPkcs8", "attacker-material");
        assertThrows(SecurityException.class, () -> AndroidVaultStore.rehydratePayloadFromWeb(
            source, injected, materials, tombstones
        ));

        JSONObject removed = new JSONObject(projected.toString()).put("passkeys", new JSONArray());
        assertThrows(SecurityException.class, () -> AndroidVaultStore.rehydratePayloadFromWeb(
            source, removed, materials, tombstones
        ));
    }

    @Test
    public void remotePreviewCanAuthorizeADeletionTombstoneWithoutExposingKeyMaterial() throws Exception {
        JSONObject source = payload(new JSONArray().put(passkey("private-material")), new JSONArray());
        Map<String, JSONObject> materials = new HashMap<>();
        Set<String> authorizedTombstones = new HashSet<>();
        AndroidVaultStore.redactPayloadForWeb(source, materials, authorizedTombstones);

        JSONObject remote = payload(new JSONArray(), new JSONArray().put(new JSONObject()
            .put("id", "passkey-1")
            .put("credentialId", "AQIDBA")
            .put("deletedAt", 200)));
        JSONObject projectedRemote = AndroidVaultStore.redactPayloadForWeb(remote, materials, authorizedTombstones);
        JSONObject restored = AndroidVaultStore.rehydratePayloadFromWeb(
            source, projectedRemote, materials, authorizedTombstones
        );
        assertEquals(0, restored.getJSONArray("passkeys").length());
        assertEquals(1, restored.getJSONArray("passkeyTombstones").length());
    }

    private static JSONObject payload(JSONArray passkeys, JSONArray tombstones) throws Exception {
        return new JSONObject()
            .put("version", 2)
            .put("passkeySchemaVersion", 1)
            .put("revision", 1)
            .put("entries", new JSONArray())
            .put("passkeys", passkeys)
            .put("passkeyTombstones", tombstones)
            .put("settings", new JSONObject())
            .put("updatedAt", 100);
    }

    private static JSONObject passkey(String privateKey) throws Exception {
        return new JSONObject()
            .put("id", "passkey-1")
            .put("credentialId", "AQIDBA")
            .put("rpId", "example.com")
            .put("rpName", "Example")
            .put("userHandle", "dXNlci0x")
            .put("userName", "alice@example.com")
            .put("algorithm", -7)
            .put("publicKeyCose", "cHVibGljLWtleQ")
            .put("privateKeyPkcs8", privateKey)
            .put("discoverable", true)
            .put("backupEligible", true)
            .put("backupState", true)
            .put("transports", new JSONArray().put("internal"))
            .put("createdAt", 100)
            .put("updatedAt", 101);
    }
}
