package com.suzikuo.mypwdmg;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Base64;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.function.LongSupplier;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** App-private immutable storage for encrypted attachment objects. */
final class AndroidAttachmentStore {
    static final int MAX_ATTACHMENT_FILE_BYTES = 10 * 1024 * 1024;
    static final long MAX_ATTACHMENT_STORE_BYTES = 256L * 1024L * 1024L;
    static final long ORPHAN_GRACE_SECONDS = 24L * 60L * 60L;
    static final long RETAIN_SECONDS = 7L * 24L * 60L * 60L;
    private static final int MAX_CIPHERTEXT_BYTES = MAX_ATTACHMENT_FILE_BYTES + 16;
    private static final int MAX_ATTACHMENT_OBJECT_BYTES = ((MAX_CIPHERTEXT_BYTES + 2) / 3) * 4 + 1024;
    private static final Pattern ATTACHMENT_ID = Pattern.compile(
        "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
    );
    private static final Pattern RETAINED_NAME = Pattern.compile(
        "^(?<id>[0-9a-f-]{36})\\.(?<deleted>[0-9]{1,12})\\.json$"
    );
    private static final Set<String> OBJECT_FIELDS = Collections.unmodifiableSet(new HashSet<>(Arrays.asList(
        "format", "version", "cipher", "attachmentId", "nonce", "ciphertext"
    )));

    private final File root;
    private final File retainedDir;
    private final LongSupplier nowSeconds;
    private final long quotaBytes;

    AndroidAttachmentStore(File root) {
        this(root, () -> System.currentTimeMillis() / 1000L, MAX_ATTACHMENT_STORE_BYTES);
    }

    AndroidAttachmentStore(File root, LongSupplier nowSeconds, long quotaBytes) {
        this.root = root;
        this.retainedDir = new File(root, ".retained");
        this.nowSeconds = nowSeconds;
        this.quotaBytes = quotaBytes;
    }

    synchronized JSONObject state() throws Exception {
        List<File> active = activeFiles();
        List<File> retained = retainedFiles();
        return new JSONObject()
            .put("maxFileBytes", MAX_ATTACHMENT_FILE_BYTES)
            .put("quotaBytes", quotaBytes)
            .put("activeCount", active.size())
            .put("activeBytes", totalBytes(active))
            .put("retainedCount", retained.size())
            .put("retainedBytes", totalBytes(retained));
    }

    synchronized String read(String attachmentId) throws Exception {
        String id = validateId(attachmentId);
        File target = activePath(id);
        if (!target.isFile()) target = restoreRetained(id);
        if (target == null || !target.isFile()) throw new IllegalStateException("Attachment object does not exist");
        String text = readText(target);
        validateObject(text, id);
        return text;
    }

    synchronized JSONObject write(String attachmentId, String objectText) throws Exception {
        String id = validateId(attachmentId);
        byte[] raw = String.valueOf(objectText == null ? "" : objectText).getBytes(StandardCharsets.UTF_8);
        try {
            if (raw.length > MAX_ATTACHMENT_OBJECT_BYTES) throw new IllegalArgumentException("Attachment object is too large");
            validateObject(objectText, id);
            File target = activePath(id);
            if (target.isFile()) {
                requireIdentical(target, raw);
                return objectResult(id, target.length());
            }

            File retained = latestRetained(id);
            if (retained != null) {
                requireIdentical(retained, raw);
                move(retained, target);
                return objectResult(id, target.length());
            }

            JSONObject current = state();
            long storedBytes = current.getLong("activeBytes") + current.getLong("retainedBytes");
            if (storedBytes > quotaBytes - raw.length) throw new IllegalStateException("Attachment storage quota exceeded");
            writeAtomic(target, raw);
            return objectResult(id, target.length());
        } finally {
            Arrays.fill(raw, (byte) 0);
        }
    }

    synchronized JSONObject retain(String attachmentId) throws Exception {
        String id = validateId(attachmentId);
        File source = activePath(id);
        if (!source.isFile()) {
            return new JSONObject().put("attachmentId", id).put("retained", false);
        }
        ensureDirectory(retainedDir);
        long deletedAt = nowSeconds.getAsLong();
        File target = new File(retainedDir, id + "." + deletedAt + ".json");
        move(source, target);
        return new JSONObject()
            .put("attachmentId", id)
            .put("retained", true)
            .put("deletedAt", deletedAt);
    }

    synchronized JSONObject collect(String referencedIdsJson) throws Exception {
        JSONArray values = new JSONArray(String.valueOf(referencedIdsJson == null ? "[]" : referencedIdsJson));
        Set<String> referenced = new HashSet<>();
        for (int index = 0; index < values.length(); index += 1) {
            Object value = values.get(index);
            if (!(value instanceof String)) throw new IllegalArgumentException("Attachment reference ID is invalid");
            referenced.add(validateId((String) value));
        }

        long now = nowSeconds.getAsLong();
        int retainedCount = 0;
        int deletedCount = 0;
        for (File file : activeFiles()) {
            String id = file.getName().substring(0, file.getName().length() - 5);
            if (referenced.contains(id)) continue;
            long modifiedAt = Math.max(0L, file.lastModified() / 1000L);
            if (now - modifiedAt < ORPHAN_GRACE_SECONDS) continue;
            retain(id);
            retainedCount += 1;
        }
        for (File file : retainedFiles()) {
            Matcher match = RETAINED_NAME.matcher(file.getName());
            if (!match.matches()) continue;
            String id = validateId(match.group("id"));
            long deletedAt = Long.parseLong(match.group("deleted"));
            if (referenced.contains(id)) {
                restoreRetained(id);
                continue;
            }
            if (now - deletedAt < RETAIN_SECONDS) continue;
            if (!file.delete() && file.exists()) throw new IllegalStateException("Could not delete retained attachment object");
            deletedCount += 1;
        }
        return new JSONObject().put("retained", retainedCount).put("deleted", deletedCount);
    }

    static String validateId(String value) {
        String id = value == null ? "" : value.trim().toLowerCase(Locale.ROOT);
        if (!ATTACHMENT_ID.matcher(id).matches()) throw new IllegalArgumentException("Attachment ID is invalid");
        return id;
    }

    static JSONObject validateObject(String objectText, String expectedId) throws Exception {
        if (objectText == null || objectText.getBytes(StandardCharsets.UTF_8).length > MAX_ATTACHMENT_OBJECT_BYTES) {
            throw new IllegalArgumentException("Attachment object is too large");
        }
        JSONObject object;
        try {
            object = new JSONObject(objectText);
        } catch (Exception error) {
            throw new IllegalArgumentException("Attachment object is malformed", error);
        }
        if (object.length() != OBJECT_FIELDS.size()) throw new IllegalArgumentException("Attachment object is malformed");
        Iterator<String> keys = object.keys();
        while (keys.hasNext()) {
            if (!OBJECT_FIELDS.contains(keys.next())) throw new IllegalArgumentException("Attachment object is malformed");
        }
        if (!"mypwdmg-attachment".equals(object.opt("format"))
            || !(object.opt("version") instanceof Number)
            || ((Number) object.opt("version")).intValue() != 1
            || !"AES-256-GCM".equals(object.opt("cipher"))) {
            throw new IllegalArgumentException("Attachment object format is unsupported");
        }
        if (!(object.opt("attachmentId") instanceof String)
            || !(object.opt("nonce") instanceof String)
            || !(object.opt("ciphertext") instanceof String)) {
            throw new IllegalArgumentException("Attachment object is malformed");
        }
        String id = validateId((String) object.opt("attachmentId"));
        if (!id.equals(validateId(expectedId))) throw new IllegalArgumentException("Attachment object ID does not match");
        byte[] nonce = decodeBase64((String) object.opt("nonce"), 12);
        byte[] ciphertext = decodeBase64((String) object.opt("ciphertext"), MAX_CIPHERTEXT_BYTES);
        try {
            if (nonce.length != 12 || ciphertext.length < 16) throw new IllegalArgumentException("Attachment object is malformed");
        } finally {
            Arrays.fill(nonce, (byte) 0);
            Arrays.fill(ciphertext, (byte) 0);
        }
        return object;
    }

    private static byte[] decodeBase64(String value, int maxBytes) {
        String text = value == null ? "" : value;
        if (text.length() > ((maxBytes + 2) / 3) * 4 + 4) throw new IllegalArgumentException("Attachment object is too large");
        try {
            byte[] decoded = Base64.getDecoder().decode(text);
            if (decoded.length > maxBytes) {
                Arrays.fill(decoded, (byte) 0);
                throw new IllegalArgumentException("Attachment object is too large");
            }
            return decoded;
        } catch (IllegalArgumentException error) {
            throw new IllegalArgumentException("Attachment object is malformed", error);
        }
    }

    private File activePath(String id) {
        return new File(root, id + ".json");
    }

    private List<File> activeFiles() {
        File[] files = root.listFiles(file -> file.isFile() && file.getName().endsWith(".json")
            && ATTACHMENT_ID.matcher(file.getName().substring(0, file.getName().length() - 5)).matches());
        return files == null ? new ArrayList<>() : new ArrayList<>(Arrays.asList(files));
    }

    private List<File> retainedFiles() {
        File[] files = retainedDir.listFiles(file -> file.isFile() && RETAINED_NAME.matcher(file.getName()).matches());
        return files == null ? new ArrayList<>() : new ArrayList<>(Arrays.asList(files));
    }

    private File latestRetained(String id) {
        List<File> matches = new ArrayList<>();
        for (File file : retainedFiles()) {
            if (file.getName().startsWith(id + ".")) matches.add(file);
        }
        matches.sort(Comparator.comparing(File::getName).reversed());
        return matches.isEmpty() ? null : matches.get(0);
    }

    private File restoreRetained(String id) throws Exception {
        File retained = latestRetained(id);
        if (retained == null) return null;
        File target = activePath(id);
        if (!target.isFile()) move(retained, target);
        else if (!retained.delete() && retained.exists()) throw new IllegalStateException("Could not remove duplicate retained attachment");
        return target;
    }

    private static JSONObject objectResult(String id, long objectBytes) throws Exception {
        return new JSONObject().put("attachmentId", id).put("objectBytes", objectBytes);
    }

    private static long totalBytes(List<File> files) {
        long total = 0;
        for (File file : files) total += Math.max(0L, file.length());
        return total;
    }

    private static void requireIdentical(File file, byte[] expected) throws Exception {
        byte[] actual = readBytes(file);
        try {
            if (!Arrays.equals(actual, expected)) throw new IllegalStateException("Attachment objects are immutable");
        } finally {
            Arrays.fill(actual, (byte) 0);
        }
    }

    private static String readText(File file) throws Exception {
        return new String(readBytes(file), StandardCharsets.UTF_8);
    }

    private static byte[] readBytes(File file) throws Exception {
        if (!file.isFile()) throw new IllegalStateException("Attachment object does not exist");
        if (file.length() > MAX_ATTACHMENT_OBJECT_BYTES) throw new IllegalArgumentException("Attachment object is too large");
        try (FileInputStream input = new FileInputStream(file); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int total = 0;
            int read;
            while ((read = input.read(buffer)) >= 0) {
                total += read;
                if (total > MAX_ATTACHMENT_OBJECT_BYTES) throw new IllegalArgumentException("Attachment object is too large");
                output.write(buffer, 0, read);
            }
            return output.toByteArray();
        }
    }

    private static void writeAtomic(File target, byte[] content) throws Exception {
        ensureDirectory(target.getParentFile());
        File temp = new File(target.getParentFile(), "." + target.getName() + "." + UUID.randomUUID() + ".tmp");
        try {
            try (FileOutputStream output = new FileOutputStream(temp, false)) {
                output.write(content);
                output.getFD().sync();
            }
            move(temp, target);
        } finally {
            if (temp.exists()) temp.delete();
        }
    }

    private static void move(File source, File target) throws Exception {
        ensureDirectory(target.getParentFile());
        try {
            Files.move(source.toPath(), target.toPath(), StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        } catch (Exception atomicError) {
            Files.move(source.toPath(), target.toPath(), StandardCopyOption.REPLACE_EXISTING);
        }
    }

    private static void ensureDirectory(File directory) {
        if (directory != null && !directory.exists() && !directory.mkdirs()) {
            throw new IllegalStateException("Could not create attachment directory");
        }
    }
}
