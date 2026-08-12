package com.suzikuo.mypwdmg;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Base64;
import java.util.concurrent.atomic.AtomicLong;

public class AndroidAttachmentStoreTest {
    private static final String ID = "123e4567-e89b-42d3-a456-426614174000";
    private static final String OTHER_ID = "123e4567-e89b-42d3-a456-426614174001";

    @Rule
    public final TemporaryFolder temporaryFolder = new TemporaryFolder();

    @Test
    public void writesReadsAndReportsEncryptedObjects() throws Exception {
        AndroidAttachmentStore store = store();
        String objectText = objectText(ID, 16);

        JSONObject written = store.write(ID, objectText);

        assertEquals(ID, written.getString("attachmentId"));
        assertEquals(objectText.getBytes(StandardCharsets.UTF_8).length, written.getLong("objectBytes"));
        assertEquals(objectText, store.read(ID));
        assertEquals(1, store.state().getInt("activeCount"));
        assertEquals(0, store.state().getInt("retainedCount"));
        assertEquals(written.toString(), store.write(ID, objectText).toString());
    }

    @Test
    public void immutableAndMalformedObjectsFailClosed() throws Exception {
        AndroidAttachmentStore store = store();
        store.write(ID, objectText(ID, 16));

        assertThrows(IllegalStateException.class, () -> store.write(ID, objectText(ID, 17)));
        assertThrows(IllegalArgumentException.class, () -> store.write(ID, objectText(OTHER_ID, 16)));
        assertThrows(IllegalArgumentException.class, () -> store.write("../vault", objectText(ID, 16)));
        assertThrows(IllegalArgumentException.class, () -> store.write(ID, "{}"));
    }

    @Test
    public void retainedObjectIsRestoredByRead() throws Exception {
        AtomicLong now = new AtomicLong(1_000_000L);
        AndroidAttachmentStore store = new AndroidAttachmentStore(
            temporaryFolder.newFolder("attachments"),
            now::get,
            AndroidAttachmentStore.MAX_ATTACHMENT_STORE_BYTES
        );
        String objectText = objectText(ID, 16);
        store.write(ID, objectText);

        JSONObject retained = store.retain(ID);

        assertTrue(retained.getBoolean("retained"));
        assertEquals(1, store.state().getInt("retainedCount"));
        assertEquals(objectText, store.read(ID));
        assertEquals(1, store.state().getInt("activeCount"));
        assertEquals(0, store.state().getInt("retainedCount"));
        assertFalse(store.retain(OTHER_ID).getBoolean("retained"));
    }

    @Test
    public void collectionUsesOrphanAndRetentionGracePeriods() throws Exception {
        AtomicLong now = new AtomicLong(2_000_000L);
        File root = temporaryFolder.newFolder("attachments");
        AndroidAttachmentStore store = new AndroidAttachmentStore(root, now::get, AndroidAttachmentStore.MAX_ATTACHMENT_STORE_BYTES);
        store.write(ID, objectText(ID, 16));
        File active = new File(root, ID + ".json");
        assertTrue(active.setLastModified((now.get() - AndroidAttachmentStore.ORPHAN_GRACE_SECONDS - 1) * 1000L));

        JSONObject first = store.collect("[]");
        assertEquals(1, first.getInt("retained"));
        assertEquals(0, first.getInt("deleted"));

        now.addAndGet(AndroidAttachmentStore.RETAIN_SECONDS + 1);
        JSONObject second = store.collect("[]");
        assertEquals(1, second.getInt("deleted"));
        assertEquals(0, store.state().getInt("retainedCount"));
    }

    @Test
    public void referencedRetainedObjectIsRecoveredDuringCollection() throws Exception {
        AndroidAttachmentStore store = store();
        store.write(ID, objectText(ID, 16));
        store.retain(ID);

        store.collect(new JSONArray().put(ID).toString());

        assertEquals(1, store.state().getInt("activeCount"));
        assertEquals(0, store.state().getInt("retainedCount"));
    }

    @Test
    public void configuredQuotaIsEnforcedBeforeSecondObject() throws Exception {
        File root = temporaryFolder.newFolder("attachments");
        String first = objectText(ID, 16);
        AndroidAttachmentStore store = new AndroidAttachmentStore(root, () -> 1_000_000L, first.length() + 1L);
        store.write(ID, first);

        assertThrows(IllegalStateException.class, () -> store.write(OTHER_ID, objectText(OTHER_ID, 16)));
    }

    private AndroidAttachmentStore store() throws Exception {
        return new AndroidAttachmentStore(temporaryFolder.newFolder("attachments"));
    }

    private static String objectText(String id, int ciphertextBytes) throws Exception {
        return new JSONObject()
            .put("format", "mypwdmg-attachment")
            .put("version", 1)
            .put("cipher", "AES-256-GCM")
            .put("attachmentId", id)
            .put("nonce", Base64.getEncoder().encodeToString(new byte[12]))
            .put("ciphertext", Base64.getEncoder().encodeToString(new byte[ciphertextBytes]))
            .toString();
    }
}
