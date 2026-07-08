package com.suzikuo.mypwdmg;

import android.content.Context;
import android.util.Base64;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import javax.crypto.Cipher;
import javax.crypto.Mac;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

final class AndroidVaultStore {
    private static final String TAG = "AndroidVaultStore";
    private static final String SOURCE_AUTO = "auto";
    private static final String SOURCE_USERNAME = "username";
    private static final String SOURCE_EMAIL = "email";
    private static final String SOURCE_PHONE = "phone";
    private static final String STATUS_ACTIVE = "active";
    private static final String STATUS_DISABLED = "disabled";
    private static final String STATUS_TRASHED = "trashed";
    private static final byte[] AAD = "mypwdmg-vault-v1".getBytes(StandardCharsets.UTF_8);
    private static final int DEFAULT_ITERATIONS = 390000;
    private static final long UNLOCKED_EXPIRES_AT = 253402300799000L;
    private static final int MAX_IMPORT_BACKUPS = 5;

    private final SecureRandom random = new SecureRandom();
    private final File vaultFile;
    private final File backupDir;

    private static JSONObject payload;
    private static byte[] key;
    private static byte[] salt;
    private static int iterations;
    private static long expiresAt;
    private static VaultSessionIndex vaultIndex;

    static class LockedException extends Exception {
        LockedException(String message) {
            super(message);
        }
    }

    static class BadPasswordException extends Exception {
        BadPasswordException(String message, Throwable cause) {
            super(message, cause);
        }
    }

    AndroidVaultStore(Context context) {
        File root = context.getApplicationContext().getFilesDir();
        this.vaultFile = new File(root, "vault.json");
        this.backupDir = new File(root, "backups");
    }

    synchronized JSONObject state() throws JSONException {
        return new JSONObject()
            .put("hasVault", vaultFile.exists())
            .put("locked", !isUnlocked())
            .put("expiresAt", isUnlocked() ? expiresAt / 1000 : 0)
            .put("legacyAvailable", false)
            .put("vaultPath", vaultFile.getAbsolutePath());
    }

    synchronized JSONObject storageState() throws JSONException {
        return new JSONObject()
            .put("hasVault", vaultFile.exists())
            .put("legacyAvailable", false)
            .put("vaultPath", vaultFile.getAbsolutePath());
    }

    synchronized String readVaultEnvelope() throws Exception {
        if (!vaultFile.exists()) {
            throw new IllegalStateException("Vault does not exist");
        }
        return readFile(vaultFile);
    }

    synchronized JSONObject writeVaultEnvelope(String envelopeText, boolean protectBackup) throws Exception {
        JSONObject envelope = validateEnvelope(envelopeText);
        File backupPath = protectBackup ? backupCurrentVault() : null;
        writeEnvelope(envelope);
        if (protectBackup) {
            lock();
        } else if (key != null) {
            try {
                setPayload(normalizePayload(decryptWithCurrentKey(envelope)));
                refreshSession();
            } catch (Exception ignored) {
                lock();
            }
        }
        return new JSONObject()
            .put("vaultPath", vaultFile.getAbsolutePath())
            .put("backupPath", backupPath == null ? "" : backupPath.getAbsolutePath());
    }

    synchronized String readLegacyLocalStorage() {
        return "{}";
    }

    synchronized JSONObject createVault(String password, boolean importLegacy) throws Exception {
        if (vaultFile.exists()) {
            throw new IllegalStateException("Vault already exists; unlock it instead");
        }
        JSONObject nextPayload = defaultPayload(new JSONArray());
        writeNewEnvelope(password, nextPayload);
        return new JSONObject()
            .put("vault", copy(payload))
            .put("migrated", 0);
    }

    synchronized JSONObject unlock(String password) throws Exception {
        JSONObject envelope = readEnvelope();
        JSONObject nextPayload = decryptPayload(password, envelope);
        setPayload(normalizePayload(nextPayload));
        refreshSession();
        return copy(payload);
    }

    synchronized JSONObject tryUnlockWithEmptyPasswordForAutofill() {
        try {
            if (!vaultFile.exists()) return null;
            if (!isUnlocked()) unlock("");
            return isUnlocked() ? copy(payload) : null;
        } catch (Exception error) {
            Log.e(TAG, "Empty-password autofill unlock failed", error);
            return null;
        }
    }

    synchronized void lock() {
        payload = null;
        key = null;
        salt = null;
        iterations = 0;
        expiresAt = 0;
        vaultIndex = null;
    }

    synchronized JSONObject getVault() throws Exception {
        return copy(requirePayload());
    }

    synchronized JSONObject saveVault(JSONObject nextPayload) throws Exception {
        requirePayload();
        JSONObject normalized = normalizePayload(nextPayload);
        normalized.put("updatedAt", nowSeconds());
        setPayload(normalized);
        writeEnvelope(encryptWithCurrentKey(payload));
        refreshSession();
        return copy(payload);
    }

    synchronized JSONObject changePassword(String newPassword) throws Exception {
        JSONObject current = copy(requirePayload());
        writeNewEnvelope(newPassword, current);
        return state();
    }

    synchronized JSONObject exportBackup() throws Exception {
        requirePayload();
        return new JSONObject()
            .put("content", readFile(vaultFile))
            .put("vaultPath", vaultFile.getAbsolutePath())
            .put("updatedAt", vaultFile.lastModified() / 1000);
    }

    synchronized JSONObject importBackup(String envelopeText) throws Exception {
        requirePayload();
        JSONObject envelope = validateEnvelope(envelopeText);
        File backupPath = backupCurrentVault();
        writeEnvelope(envelope);
        lock();
        return new JSONObject()
            .put("state", state())
            .put("backupPath", backupPath == null ? "" : backupPath.getAbsolutePath())
            .put("vaultPath", vaultFile.getAbsolutePath());
    }

    synchronized JSONArray queryMatches(String hostname) throws Exception {
        JSONArray matches = queryMatchesFromPayload(requirePayload(), hostname);
        refreshSession();
        return matches;
    }

    synchronized JSONObject getFillPayload(String entryId) throws Exception {
        JSONObject result = getFillPayloadFromPayload(requirePayload(), entryId);
        refreshSession();
        return result;
    }

    synchronized String generateTotp(String entryId) throws Exception {
        JSONObject sourcePayload = requirePayload();
        JSONObject entry = vaultIndex == null ? null : vaultIndex.getLogin(entryId);
        if (entry == null) entry = findEntry(sourcePayload.optJSONArray("entries"), entryId);
        if (entry == null || !"login".equals(entry.optString("kind")) || !STATUS_ACTIVE.equals(normalizeEntryStatus(entry.optString("status")))) {
            throw new IllegalArgumentException("Entry not found");
        }
        refreshSession();
        return generateTotpCode(entry.optString("totpSecret", ""));
    }

    JSONArray queryMatchesFromPayload(JSONObject sourcePayload, String hostname) throws JSONException {
        return queryMatchesFromPayload(sourcePayload, hostname, false);
    }

    JSONArray queryMatchesFromPayload(JSONObject sourcePayload, String hostname, boolean includeAll) throws JSONException {
        JSONArray matches = new JSONArray();

        if (includeAll) {
            for (JSONObject entry : indexedLoginEntries(sourcePayload)) {
                matches.put(matchSummary(entry, entry.optJSONArray("domains")));
            }
            return matches;
        }

        for (JSONObject entry : matchingLoginEntries(sourcePayload, hostname)) {
            matches.put(matchSummary(entry, entry.optJSONArray("domains")));
        }
        return matches;
    }

    private JSONObject matchSummary(JSONObject entry, JSONArray domains) throws JSONException {
        return new JSONObject()
            .put("id", entry.optString("id"))
            .put("title", entry.optString("title"))
            .put("username", entry.optString("username"))
            .put("email", entry.optString("email"))
            .put("phone", entry.optString("phone"))
            .put("loginAccountSource", normalizeLoginAccountSource(entry.optString("loginAccountSource")))
            .put("domains", domains == null ? new JSONArray() : new JSONArray(domains.toString()))
            .put("hasPassword", !entry.optString("password").isEmpty())
            .put("hasTotp", !entry.optString("totpSecret").isEmpty());
    }

    JSONObject getFillPayloadFromPayload(JSONObject sourcePayload, String entryId) throws Exception {
        JSONObject entry = vaultIndex == null ? null : vaultIndex.getLogin(entryId);
        if (entry == null) entry = findEntry(sourcePayload.optJSONArray("entries"), entryId);
        if (entry == null || !"login".equals(entry.optString("kind"))) {
            throw new IllegalArgumentException("Entry not found");
        }

        String totp = "";
        if (!entry.optString("totpSecret").isEmpty()) {
            totp = generateTotpCode(entry.optString("totpSecret"));
        }
        return new JSONObject()
            .put("id", entry.optString("id"))
            .put("title", entry.optString("title"))
            .put("username", entry.optString("username"))
            .put("email", entry.optString("email"))
            .put("password", entry.optString("password"))
            .put("phone", entry.optString("phone"))
            .put("loginAccountSource", normalizeLoginAccountSource(entry.optString("loginAccountSource")))
            .put("totp", totp);
    }

    synchronized JSONObject saveCapturedLogin(JSONObject capture) throws Exception {
        JSONObject sourcePayload = requirePayload();
        JSONObject normalized = normalizeCapture(capture);
        if (normalized.optString("password").isEmpty()) {
            throw new IllegalArgumentException("Captured password is empty");
        }
        if (identityValues(normalized).isEmpty()) {
            throw new IllegalArgumentException("Captured account is empty");
        }

        JSONObject candidate = findCaptureCandidate(sourcePayload, normalized);
        JSONObject entry;
        String action;
        if (candidate != null) {
            entry = candidate;
            if (entry.optString("password").equals(normalized.optString("password"))) {
                refreshSession();
                return new JSONObject()
                    .put("action", "skipped")
                    .put("entry", matchSummary(entry, entry.optJSONArray("domains")));
            }
            applyCaptureUpdate(entry, normalized);
            action = "updated";
        } else {
            entry = entryFromCapture(normalized);
            prependEntry(sourcePayload, entry);
            action = "created";
        }

        sourcePayload.put("updatedAt", nowSeconds());
        setPayload(normalizePayload(sourcePayload));
        writeEnvelope(encryptWithCurrentKey(payload));
        refreshSession();
        return new JSONObject()
            .put("action", action)
            .put("entry", matchSummary(entry, entry.optJSONArray("domains")));
    }

    private JSONObject normalizeCapture(JSONObject capture) throws JSONException {
        String title = cleanCaptureText(capture.optString("title"));
        String hostname = normalizeDomain(firstNotEmpty(
            capture.optString("hostname"),
            capture.optString("domain"),
            capture.optString("url")
        ));
        String accountKind = normalizeCaptureAccountKind(capture.optString("accountKind"));
        String accountValue = cleanCaptureText(firstNotEmpty(capture.optString("account"), capture.optString("accountValue")));
        String username = cleanCaptureText(capture.optString("username"));
        String email = cleanCaptureText(capture.optString("email"));
        String phone = cleanCaptureText(capture.optString("phone"));

        if (!accountValue.isEmpty()) {
            if (PwdAutofillService.ACCOUNT_KIND_EMAIL.equals(accountKind) && email.isEmpty()) {
                email = accountValue;
            } else if (PwdAutofillService.ACCOUNT_KIND_PHONE.equals(accountKind) && phone.isEmpty()) {
                phone = accountValue;
            } else if (PwdAutofillService.ACCOUNT_KIND_USERNAME.equals(accountKind) && username.isEmpty()) {
                username = accountValue;
            } else if (username.isEmpty() && email.isEmpty() && phone.isEmpty()) {
                if (looksLikeEmail(accountValue)) email = accountValue;
                else if (looksLikePhone(accountValue)) phone = accountValue;
                else username = accountValue;
            }
        }

        String loginAccountSource = SOURCE_AUTO;
        if (SOURCE_USERNAME.equals(accountKind) || SOURCE_EMAIL.equals(accountKind) || SOURCE_PHONE.equals(accountKind)) {
            loginAccountSource = accountKind;
        }

        return new JSONObject()
            .put("title", firstNotEmpty(title, PwdAutofillService.titleForTarget(hostname), "Untitled"))
            .put("hostname", hostname)
            .put("username", username)
            .put("email", email)
            .put("phone", phone)
            .put("password", cleanCaptureText(capture.optString("password"), 4096))
            .put("accountKind", accountKind)
            .put("loginAccountSource", loginAccountSource);
    }

    private JSONObject findCaptureCandidate(JSONObject sourcePayload, JSONObject capture) {
        List<JSONObject> candidates = capture.optString("hostname").isEmpty()
            ? indexedLoginEntries(sourcePayload)
            : matchingLoginEntries(sourcePayload, capture.optString("hostname"));
        JSONObject fallback = null;
        for (JSONObject entry : candidates) {
            if (!accountMatchesCapture(entry, capture)) continue;
            if (entry.optString("password").equals(capture.optString("password"))) return entry;
            if (fallback == null) fallback = entry;
        }
        return fallback;
    }

    private static boolean accountMatchesCapture(JSONObject entry, JSONObject capture) {
        Set<String> captureValues = identityValues(capture);
        if (captureValues.isEmpty()) return false;
        Set<String> entryValues = new HashSet<>();
        addIdentityValue(entryValues, entry.optString("username"));
        addIdentityValue(entryValues, entry.optString("email"));
        addIdentityValue(entryValues, entry.optString("phone"));
        for (String value : captureValues) {
            if (entryValues.contains(value)) return true;
        }
        return false;
    }

    private static Set<String> identityValues(JSONObject source) {
        Set<String> values = new HashSet<>();
        addIdentityValue(values, source.optString("username"));
        addIdentityValue(values, source.optString("email"));
        addIdentityValue(values, source.optString("phone"));
        return values;
    }

    private static void addIdentityValue(Set<String> values, String value) {
        String normalized = value == null ? "" : value.trim().toLowerCase(Locale.ROOT);
        if (!normalized.isEmpty()) values.add(normalized);
    }

    private static void applyCaptureUpdate(JSONObject entry, JSONObject capture) throws JSONException {
        String hostname = capture.optString("hostname");
        if (!hostname.isEmpty()) {
            JSONArray domains = entry.optJSONArray("domains");
            if (domains == null) {
                domains = new JSONArray();
                entry.put("domains", domains);
            }
            boolean hasDomain = false;
            for (int index = 0; index < domains.length(); index += 1) {
                if (domainMatches(hostname, domains.optString(index))) {
                    hasDomain = true;
                    break;
                }
            }
            if (!hasDomain) domains.put(hostname);
        }

        if (entry.optString("title").isEmpty() || "Untitled".equals(entry.optString("title"))) {
            entry.put("title", capture.optString("title"));
        }
        if (!capture.optString("username").isEmpty() && entry.optString("username").isEmpty()) {
            entry.put("username", capture.optString("username"));
        }
        if (!capture.optString("email").isEmpty() && entry.optString("email").isEmpty()) {
            entry.put("email", capture.optString("email"));
        }
        if (!capture.optString("phone").isEmpty() && entry.optString("phone").isEmpty()) {
            entry.put("phone", capture.optString("phone"));
        }
        if (!SOURCE_USERNAME.equals(entry.optString("loginAccountSource"))
            && !SOURCE_EMAIL.equals(entry.optString("loginAccountSource"))
            && !SOURCE_PHONE.equals(entry.optString("loginAccountSource"))) {
            entry.put("loginAccountSource", capture.optString("loginAccountSource", SOURCE_AUTO));
        }
        entry.put("password", capture.optString("password"));
    }

    private static JSONObject entryFromCapture(JSONObject capture) throws JSONException {
        JSONArray domains = new JSONArray();
        if (!capture.optString("hostname").isEmpty()) domains.put(capture.optString("hostname"));
        return new JSONObject()
            .put("id", UUID.randomUUID().toString())
            .put("kind", "login")
            .put("title", firstNotEmpty(capture.optString("title"), capture.optString("hostname"), "Untitled"))
            .put("status", STATUS_ACTIVE)
            .put("statusReason", "")
            .put("statusUpdatedAt", 0)
            .put("deletedAt", 0)
            .put("domains", domains)
            .put("username", capture.optString("username"))
            .put("email", capture.optString("email"))
            .put("password", capture.optString("password"))
            .put("phone", capture.optString("phone"))
            .put("loginAccountSource", normalizeLoginAccountSource(capture.optString("loginAccountSource")))
            .put("note", "")
            .put("totpSecret", "")
            .put("history", new JSONArray())
            .put("children", new JSONArray());
    }

    private static void prependEntry(JSONObject sourcePayload, JSONObject entry) throws JSONException {
        JSONArray entries = sourcePayload.optJSONArray("entries");
        JSONArray nextEntries = new JSONArray();
        nextEntries.put(entry);
        for (int index = 0; entries != null && index < entries.length(); index += 1) {
            nextEntries.put(entries.get(index));
        }
        sourcePayload.put("entries", nextEntries);
    }

    private static String normalizeCaptureAccountKind(String value) {
        if (PwdAutofillService.ACCOUNT_KIND_USERNAME.equals(value)) return PwdAutofillService.ACCOUNT_KIND_USERNAME;
        if (PwdAutofillService.ACCOUNT_KIND_EMAIL.equals(value)) return PwdAutofillService.ACCOUNT_KIND_EMAIL;
        if (PwdAutofillService.ACCOUNT_KIND_PHONE.equals(value)) return PwdAutofillService.ACCOUNT_KIND_PHONE;
        return PwdAutofillService.ACCOUNT_KIND_GENERIC;
    }

    private static String cleanCaptureText(String value) {
        return cleanCaptureText(value, 512);
    }

    private static String cleanCaptureText(String value, int maxLength) {
        if (value == null) return "";
        String text = value.replace("\u0000", "").trim();
        return text.length() > maxLength ? text.substring(0, maxLength) : text;
    }

    private static boolean looksLikeEmail(String value) {
        int at = value.indexOf('@');
        return at > 0 && value.indexOf('.', at) > at + 1;
    }

    private static boolean looksLikePhone(String value) {
        int digits = 0;
        for (int index = 0; index < value.length(); index += 1) {
            if (Character.isDigit(value.charAt(index))) digits += 1;
        }
        return digits >= 6 && digits >= Math.max(1, value.trim().length() - 4);
    }

    private static String firstNotEmpty(String... values) {
        for (String value : values) {
            if (value != null && !value.trim().isEmpty()) return value.trim();
        }
        return "";
    }

    private JSONObject requirePayload() throws LockedException {
        if (!isUnlocked() || payload == null || key == null) {
            lock();
            throw new LockedException("Vault is locked");
        }
        return payload;
    }

    private boolean isUnlocked() {
        return payload != null && key != null && expiresAt > 0;
    }

    private void refreshSession() {
        expiresAt = UNLOCKED_EXPIRES_AT;
    }

    private void writeNewEnvelope(String password, JSONObject nextPayload) throws Exception {
        salt = randomBytes(16);
        iterations = DEFAULT_ITERATIONS;
        key = deriveKey(password, salt, iterations);
        setPayload(normalizePayload(nextPayload));
        writeEnvelope(encryptWithCurrentKey(payload));
        refreshSession();
    }

    private static void setPayload(JSONObject nextPayload) throws JSONException {
        payload = nextPayload;
        vaultIndex = VaultSessionIndex.build(payload.optJSONArray("entries"));
    }

    private JSONObject decryptPayload(String password, JSONObject envelope) throws Exception {
        try {
            if (!"mypwdmg-vault".equals(envelope.optString("format"))) {
                throw new BadPasswordException("Unsupported vault format", null);
            }
            JSONObject kdf = envelope.getJSONObject("kdf");
            iterations = kdf.getInt("iterations");
            salt = b64d(kdf.getString("salt"));
            key = deriveKey(password, salt, iterations);

            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, b64d(envelope.getString("nonce"))));
            cipher.updateAAD(AAD);
            byte[] plain = cipher.doFinal(b64d(envelope.getString("ciphertext")));
            return new JSONObject(new String(plain, StandardCharsets.UTF_8));
        } catch (BadPasswordException error) {
            throw error;
        } catch (Exception error) {
            lock();
            throw new BadPasswordException("Wrong password or corrupted vault", error);
        }
    }

    private JSONObject decryptWithCurrentKey(JSONObject envelope) throws Exception {
        if (key == null || salt == null || iterations <= 0) {
            throw new LockedException("Vault is locked");
        }
        JSONObject kdf = envelope.getJSONObject("kdf");
        if (kdf.getInt("iterations") != iterations || !sameBytes(b64d(kdf.getString("salt")), salt)) {
            throw new BadPasswordException("Vault password changed", null);
        }

        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, b64d(envelope.getString("nonce"))));
        cipher.updateAAD(AAD);
        byte[] plain = cipher.doFinal(b64d(envelope.getString("ciphertext")));
        return new JSONObject(new String(plain, StandardCharsets.UTF_8));
    }

    private JSONObject encryptWithCurrentKey(JSONObject sourcePayload) throws Exception {
        byte[] nonce = randomBytes(12);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, nonce));
        cipher.updateAAD(AAD);
        byte[] ciphertext = cipher.doFinal(sourcePayload.toString().getBytes(StandardCharsets.UTF_8));

        JSONObject kdf = new JSONObject()
            .put("name", "PBKDF2-HMAC-SHA256")
            .put("iterations", iterations)
            .put("salt", b64e(salt));

        return new JSONObject()
            .put("format", "mypwdmg-vault")
            .put("version", 1)
            .put("cipher", "AES-256-GCM")
            .put("kdf", kdf)
            .put("nonce", b64e(nonce))
            .put("ciphertext", b64e(ciphertext));
    }

    private JSONObject normalizePayload(JSONObject input) throws JSONException {
        JSONObject settings = input.optJSONObject("settings");
        if (settings == null) settings = new JSONObject();

        JSONObject oss = settings.optJSONObject("oss");
        if (oss == null) oss = new JSONObject();
        JSONObject normalizedOss = new JSONObject()
            .put("bucketName", oss.optString("bucketName"))
            .put("accessKeyId", oss.optString("accessKeyId"))
            .put("accessKeySecret", oss.optString("accessKeySecret"))
            .put("region", oss.optString("region"))
            .put("objectName", oss.optString("objectName", "mypwdmg-vault.json"));

        JSONObject normalizedSettings = new JSONObject().put("oss", normalizedOss);
        return new JSONObject()
            .put("version", 1)
            .put("entries", normalizeEntries(input.optJSONArray("entries")))
            .put("settings", normalizedSettings)
            .put("updatedAt", input.optLong("updatedAt", nowSeconds()));
    }

    private JSONArray normalizeEntries(JSONArray entries) throws JSONException {
        JSONArray normalized = new JSONArray();
        for (int index = 0; entries != null && index < entries.length(); index += 1) {
            JSONObject entry = entries.optJSONObject(index);
            if (entry != null) normalized.put(normalizeEntry(entry));
        }
        return normalized;
    }

    private JSONObject normalizeEntry(JSONObject entry) throws JSONException {
        String kind = "folder".equals(entry.optString("kind")) ? "folder" : "login";
        JSONObject normalized = new JSONObject()
            .put("id", entry.optString("id", UUID.randomUUID().toString()))
            .put("kind", kind)
            .put("title", defaultString(entry.optString("title"), "Untitled"))
            .put("status", normalizeEntryStatus(entry.optString("status")))
            .put("statusReason", entry.optString("statusReason"))
            .put("statusUpdatedAt", entry.optLong("statusUpdatedAt", 0))
            .put("deletedAt", entry.optLong("deletedAt", 0))
            .put("domains", normalizeDomains(entry.optJSONArray("domains")));

        if ("folder".equals(kind)) {
            normalized.put("children", normalizeEntries(entry.optJSONArray("children")));
        } else {
            normalized
                .put("username", entry.optString("username"))
                .put("email", entry.optString("email"))
                .put("password", entry.optString("password"))
                .put("phone", entry.optString("phone"))
                .put("loginAccountSource", normalizeLoginAccountSource(entry.optString("loginAccountSource")))
                .put("note", entry.optString("note"))
                .put("totpSecret", entry.optString("totpSecret"))
                .put("history", entry.optJSONArray("history") == null ? new JSONArray() : new JSONArray(entry.optJSONArray("history").toString()))
                .put("children", new JSONArray());
        }
        return normalized;
    }

    private JSONArray normalizeDomains(JSONArray domains) {
        JSONArray normalized = new JSONArray();
        for (int index = 0; domains != null && index < domains.length(); index += 1) {
            String domain = normalizeDomain(domains.optString(index));
            if (!domain.isEmpty()) normalized.put(domain);
        }
        return normalized;
    }

    private static JSONObject defaultPayload(JSONArray entries) throws JSONException {
        JSONObject oss = new JSONObject()
            .put("bucketName", "")
            .put("accessKeyId", "")
            .put("accessKeySecret", "")
            .put("region", "")
            .put("objectName", "mypwdmg-vault.json");
        return new JSONObject()
            .put("version", 1)
            .put("entries", entries)
            .put("settings", new JSONObject().put("oss", oss))
            .put("updatedAt", nowSeconds());
    }

    private JSONObject readEnvelope() throws Exception {
        if (!vaultFile.exists()) {
            throw new IllegalStateException("Vault does not exist");
        }
        return new JSONObject(readFile(vaultFile));
    }

    private JSONObject validateEnvelope(String envelopeText) throws JSONException {
        JSONObject envelope = new JSONObject(envelopeText);
        if (!"mypwdmg-vault".equals(envelope.optString("format"))) {
            throw new IllegalArgumentException("Backup vault format is not supported");
        }
        if (!envelope.has("version") || !envelope.has("cipher") || !envelope.has("kdf") || !envelope.has("nonce") || !envelope.has("ciphertext")) {
            throw new IllegalArgumentException("Backup vault file is incomplete");
        }
        return envelope;
    }

    private File backupCurrentVault() throws Exception {
        if (!vaultFile.exists()) return null;
        if (!backupDir.exists() && !backupDir.mkdirs()) {
            throw new IllegalStateException("Could not create backup directory");
        }
        File backup = new File(backupDir, "vault-before-import-" + System.currentTimeMillis() + ".json");
        writeFile(backup, readFile(vaultFile));
        pruneImportBackups();
        return backup;
    }

    private void pruneImportBackups() {
        File[] files = backupDir.listFiles((dir, name) -> name.startsWith("vault-before-import-") && name.endsWith(".json"));
        if (files == null || files.length <= MAX_IMPORT_BACKUPS) return;
        java.util.Arrays.sort(files, (left, right) -> Long.compare(right.lastModified(), left.lastModified()));
        for (int index = MAX_IMPORT_BACKUPS; index < files.length; index += 1) {
            files[index].delete();
        }
    }

    private void writeEnvelope(JSONObject envelope) throws Exception {
        writeFile(vaultFile, envelope.toString());
    }

    private static String readFile(File file) throws Exception {
        FileInputStream input = new FileInputStream(file);
        try {
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int read;
            while ((read = input.read(buffer)) != -1) {
                output.write(buffer, 0, read);
            }
            return output.toString("UTF-8");
        } finally {
            input.close();
        }
    }

    private static void writeFile(File file, String content) throws Exception {
        File parent = file.getParentFile();
        if (parent != null && !parent.exists() && !parent.mkdirs()) {
            throw new IllegalStateException("Could not create directory");
        }
        File temp = new File(parent == null ? new File(".") : parent, "." + file.getName() + "." + UUID.randomUUID() + ".tmp");
        FileOutputStream output = new FileOutputStream(temp, false);
        try {
            output.write(content.getBytes(StandardCharsets.UTF_8));
            output.getFD().sync();
        } finally {
            output.close();
        }
        try {
            Files.move(
                temp.toPath(),
                file.toPath(),
                StandardCopyOption.REPLACE_EXISTING,
                StandardCopyOption.ATOMIC_MOVE
            );
        } catch (Exception atomicMoveError) {
            Files.move(temp.toPath(), file.toPath(), StandardCopyOption.REPLACE_EXISTING);
        } finally {
            if (temp.exists()) temp.delete();
        }
    }

    private byte[] randomBytes(int size) {
        byte[] bytes = new byte[size];
        random.nextBytes(bytes);
        return bytes;
    }

    private static byte[] deriveKey(String password, byte[] nextSalt, int nextIterations) throws Exception {
        byte[] passwordBytes = (password == null ? "" : password).getBytes(StandardCharsets.UTF_8);
        return pbkdf2HmacSha256(passwordBytes, nextSalt, nextIterations, 32);
    }

    private static byte[] pbkdf2HmacSha256(byte[] passwordBytes, byte[] nextSalt, int nextIterations, int keyLengthBytes) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        byte[] hmacKey = passwordBytes.length == 0 ? new byte[64] : passwordBytes;
        mac.init(new SecretKeySpec(hmacKey, "HmacSHA256"));
        int hashLength = mac.getMacLength();
        int blockCount = (int) Math.ceil((double) keyLengthBytes / hashLength);
        ByteArrayOutputStream output = new ByteArrayOutputStream(blockCount * hashLength);

        for (int blockIndex = 1; blockIndex <= blockCount; blockIndex += 1) {
            mac.reset();
            mac.update(nextSalt);
            mac.update(int32be(blockIndex));
            byte[] u = mac.doFinal();
            byte[] block = u.clone();
            for (int iteration = 1; iteration < nextIterations; iteration += 1) {
                mac.reset();
                u = mac.doFinal(u);
                for (int index = 0; index < block.length; index += 1) {
                    block[index] ^= u[index];
                }
            }
            output.write(block);
        }

        byte[] derived = output.toByteArray();
        if (derived.length == keyLengthBytes) return derived;
        byte[] result = new byte[keyLengthBytes];
        System.arraycopy(derived, 0, result, 0, keyLengthBytes);
        return result;
    }

    private static byte[] int32be(int value) {
        return new byte[] {
            (byte) (value >>> 24),
            (byte) (value >>> 16),
            (byte) (value >>> 8),
            (byte) value
        };
    }

    private static String b64e(byte[] value) {
        return Base64.encodeToString(value, Base64.NO_WRAP);
    }

    private static byte[] b64d(String value) {
        return Base64.decode(value, Base64.DEFAULT);
    }

    private static boolean sameBytes(byte[] left, byte[] right) {
        if (left == null || right == null || left.length != right.length) return false;
        int diff = 0;
        for (int index = 0; index < left.length; index += 1) {
            diff |= left[index] ^ right[index];
        }
        return diff == 0;
    }

    private static JSONObject copy(JSONObject source) throws JSONException {
        return new JSONObject(source.toString());
    }

    private static long nowSeconds() {
        return System.currentTimeMillis() / 1000;
    }

    private static String defaultString(String value, String fallback) {
        return value == null || value.trim().isEmpty() ? fallback : value;
    }

    private static String normalizeLoginAccountSource(String value) {
        if (SOURCE_USERNAME.equals(value) || SOURCE_EMAIL.equals(value) || SOURCE_PHONE.equals(value)) return value;
        return SOURCE_AUTO;
    }

    private static String normalizeEntryStatus(String value) {
        if (STATUS_DISABLED.equals(value) || STATUS_TRASHED.equals(value)) return value;
        return STATUS_ACTIVE;
    }

    private static String normalizeDomain(String value) {
        if (value == null) return "";
        String result = value.trim().toLowerCase(Locale.ROOT);
        int schemeIndex = result.indexOf("://");
        if (schemeIndex >= 0) result = result.substring(schemeIndex + 3);
        int slashIndex = result.indexOf('/');
        if (slashIndex >= 0) result = result.substring(0, slashIndex);
        int atIndex = result.lastIndexOf('@');
        if (atIndex >= 0) result = result.substring(atIndex + 1);
        int portIndex = result.indexOf(':');
        if (portIndex >= 0) result = result.substring(0, portIndex);
        while (result.startsWith(".")) result = result.substring(1);
        while (result.endsWith(".")) result = result.substring(0, result.length() - 1);
        if (result.startsWith("www.")) result = result.substring(4);
        return result;
    }

    private static boolean domainMatches(String hostname, String savedDomain) {
        String host = normalizeDomain(hostname);
        String domain = normalizeDomain(savedDomain);
        if (host.isEmpty() || domain.isEmpty()) return false;
        if (domain.indexOf('*') >= 0) return wildcardDomainMatches(host, domain);
        return host.equals(domain) || host.endsWith("." + domain);
    }

    private static boolean relaxedAutofillDomainMatches(String hostname, String savedDomain) {
        String host = normalizeDomain(hostname);
        String domain = normalizeDomain(savedDomain);
        if (host.isEmpty() || domain.isEmpty() || domain.indexOf('*') >= 0) return false;
        if (host.indexOf('.') < 0 || domain.indexOf('.') < 0) return false;
        return domain.equals(host) || domain.endsWith("." + host);
    }

    private static boolean sameSiteAutofillDomainMatches(String hostname, String savedDomain) {
        String host = normalizeDomain(hostname);
        String domain = normalizeDomain(savedDomain);
        String hostSite = siteDomain(host);
        String domainSite = siteDomain(domain);
        return !hostSite.isEmpty() && hostSite.equals(domainSite);
    }

    private static String siteDomain(String value) {
        String host = normalizeDomain(value);
        if (host.isEmpty()) return "";
        String alias = knownServiceDomain(host);
        if (!alias.isEmpty()) host = alias;
        String[] parts = host.split("\\.");
        if (parts.length < 2) return "";
        if (parts.length >= 3 && isTwoPartPublicSuffix(parts[parts.length - 2] + "." + parts[parts.length - 1])) {
            return parts[parts.length - 3] + "." + parts[parts.length - 2] + "." + parts[parts.length - 1];
        }
        return parts[parts.length - 2] + "." + parts[parts.length - 1];
    }

    private static boolean isTwoPartPublicSuffix(String suffix) {
        return "com.cn".equals(suffix)
            || "net.cn".equals(suffix)
            || "org.cn".equals(suffix)
            || "co.uk".equals(suffix)
            || "com.au".equals(suffix)
            || "co.jp".equals(suffix);
    }

    private static String knownServiceDomain(String value) {
        String host = normalizeDomain(value);
        if (host.contains("xiaoheihe")) return "xiaoheihe.cn";
        return "";
    }

    private static boolean wildcardDomainMatches(String host, String domain) {
        StringBuilder pattern = new StringBuilder("^");
        for (int index = 0; index < domain.length(); index += 1) {
            char ch = domain.charAt(index);
            if (ch == '*') {
                pattern.append("[^.]*");
            } else if ("\\.[]{}()+-^$?|".indexOf(ch) >= 0) {
                pattern.append('\\').append(ch);
            } else {
                pattern.append(ch);
            }
        }
        pattern.append("$");
        return host.matches(pattern.toString());
    }

    private static void flattenEntries(JSONArray entries, List<JSONObject> output) {
        for (int index = 0; entries != null && index < entries.length(); index += 1) {
            JSONObject entry = entries.optJSONObject(index);
            if (entry == null) continue;
            output.add(entry);
            if ("folder".equals(entry.optString("kind"))) {
                if (!STATUS_ACTIVE.equals(normalizeEntryStatus(entry.optString("status")))) continue;
                flattenEntries(entry.optJSONArray("children"), output);
            }
        }
    }

    private static List<JSONObject> indexedLoginEntries(JSONObject sourcePayload) {
        if (vaultIndex != null) return vaultIndex.loginEntries();

        List<JSONObject> entries = new ArrayList<>();
        flattenEntries(sourcePayload.optJSONArray("entries"), entries);
        List<JSONObject> logins = new ArrayList<>();
        for (JSONObject entry : entries) {
            if ("login".equals(entry.optString("kind")) && STATUS_ACTIVE.equals(normalizeEntryStatus(entry.optString("status")))) logins.add(entry);
        }
        return logins;
    }

    private static List<JSONObject> matchingLoginEntries(JSONObject sourcePayload, String hostname) {
        if (vaultIndex != null) return vaultIndex.matchingLogins(hostname);

        String host = normalizeDomain(hostname);
        List<JSONObject> matches = new ArrayList<>();
        for (JSONObject entry : indexedLoginEntries(sourcePayload)) {
            JSONArray domains = entry.optJSONArray("domains");
            for (int index = 0; domains != null && index < domains.length(); index += 1) {
                String domain = domains.optString(index);
                if (domainMatches(host, domain)
                    || relaxedAutofillDomainMatches(host, domain)
                    || sameSiteAutofillDomainMatches(host, domain)) {
                    matches.add(entry);
                    break;
                }
            }
        }
        return matches;
    }

    private static JSONObject findEntry(JSONArray entries, String entryId) {
        for (int index = 0; entries != null && index < entries.length(); index += 1) {
            JSONObject entry = entries.optJSONObject(index);
            if (entry == null) continue;
            if (entryId != null && entryId.equals(entry.optString("id"))) return entry;
            JSONObject nested = findEntry(entry.optJSONArray("children"), entryId);
            if (nested != null) return nested;
        }
        return null;
    }

    private static String generateTotpCode(String secret) throws Exception {
        if (secret == null || secret.trim().isEmpty()) return "";
        byte[] key = decodeBase32(secret);
        long counter = (System.currentTimeMillis() / 1000) / 30;
        byte[] counterBytes = ByteBuffer.allocate(8).putLong(counter).array();
        Mac mac = Mac.getInstance("HmacSHA1");
        mac.init(new SecretKeySpec(key, "HmacSHA1"));
        byte[] hash = mac.doFinal(counterBytes);
        int offset = hash[hash.length - 1] & 0x0F;
        int binary =
            ((hash[offset] & 0x7F) << 24) |
            ((hash[offset + 1] & 0xFF) << 16) |
            ((hash[offset + 2] & 0xFF) << 8) |
            (hash[offset + 3] & 0xFF);
        return String.format(Locale.ROOT, "%06d", binary % 1000000);
    }

    private static byte[] decodeBase32(String value) {
        String alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
        String cleaned = value.toUpperCase(Locale.ROOT).replaceAll("\\s", "").replace("=", "");
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        int buffer = 0;
        int bitsLeft = 0;
        for (int index = 0; index < cleaned.length(); index += 1) {
            int next = alphabet.indexOf(cleaned.charAt(index));
            if (next < 0) continue;
            buffer = (buffer << 5) | next;
            bitsLeft += 5;
            if (bitsLeft >= 8) {
                output.write((buffer >> (bitsLeft - 8)) & 0xFF);
                bitsLeft -= 8;
            }
        }
        return output.toByteArray();
    }

    private static final class VaultSessionIndex {
        private final Map<String, JSONObject> entriesById = new HashMap<>();
        private final List<JSONObject> loginEntries = new ArrayList<>();
        private final Map<String, List<JSONObject>> exactDomainEntries = new HashMap<>();
        private final List<JSONObject> wildcardEntries = new ArrayList<>();

        static VaultSessionIndex build(JSONArray entries) {
            VaultSessionIndex index = new VaultSessionIndex();
            index.visit(entries);
            return index;
        }

        JSONObject getLogin(String entryId) {
            JSONObject entry = entriesById.get(entryId == null ? "" : entryId);
            return entry != null && "login".equals(entry.optString("kind")) && STATUS_ACTIVE.equals(normalizeEntryStatus(entry.optString("status"))) ? entry : null;
        }

        List<JSONObject> loginEntries() {
            return new ArrayList<>(loginEntries);
        }

        List<JSONObject> matchingLogins(String hostname) {
            String host = normalizeDomain(hostname);
            if (host.isEmpty()) return new ArrayList<>();

            Set<String> candidateIds = new HashSet<>();
            for (String suffix : domainSuffixes(host)) {
                List<JSONObject> entries = exactDomainEntries.get(suffix);
                if (entries == null) continue;
                for (JSONObject entry : entries) {
                    String id = entry.optString("id");
                    if (!id.isEmpty()) candidateIds.add(id);
                }
            }

            for (JSONObject entry : wildcardEntries) {
                JSONArray domains = entry.optJSONArray("domains");
                for (int index = 0; domains != null && index < domains.length(); index += 1) {
                    String domain = normalizeDomain(domains.optString(index));
                    if (domain.indexOf('*') >= 0 && domainMatches(host, domain)) {
                        String id = entry.optString("id");
                        if (!id.isEmpty()) candidateIds.add(id);
                        break;
                    }
                }
            }

            if (candidateIds.isEmpty()) {
                addRelaxedParentDomainMatches(host, candidateIds);
            }

            if (candidateIds.isEmpty()) {
                addSameSiteAutofillMatches(host, candidateIds);
            }

            List<JSONObject> matches = new ArrayList<>();
            if (candidateIds.isEmpty()) return matches;
            for (JSONObject entry : loginEntries) {
                if (candidateIds.contains(entry.optString("id"))) matches.add(entry);
            }
            return matches;
        }

        private void visit(JSONArray entries) {
            for (int index = 0; entries != null && index < entries.length(); index += 1) {
                JSONObject entry = entries.optJSONObject(index);
                if (entry == null) continue;

                String id = entry.optString("id");
                if (!id.isEmpty()) entriesById.put(id, entry);

                if ("folder".equals(entry.optString("kind"))) {
                    if (!STATUS_ACTIVE.equals(normalizeEntryStatus(entry.optString("status")))) continue;
                    visit(entry.optJSONArray("children"));
                    continue;
                }
                if (!"login".equals(entry.optString("kind"))) continue;
                if (!STATUS_ACTIVE.equals(normalizeEntryStatus(entry.optString("status")))) continue;

                loginEntries.add(entry);
                boolean hasWildcard = false;
                JSONArray domains = entry.optJSONArray("domains");
                for (int domainIndex = 0; domains != null && domainIndex < domains.length(); domainIndex += 1) {
                    String domain = normalizeDomain(domains.optString(domainIndex));
                    if (domain.isEmpty()) continue;
                    if (domain.indexOf('*') >= 0) {
                        hasWildcard = true;
                    } else {
                        List<JSONObject> list = exactDomainEntries.get(domain);
                        if (list == null) {
                            list = new ArrayList<>();
                            exactDomainEntries.put(domain, list);
                        }
                        list.add(entry);
                    }
                }
                if (hasWildcard) wildcardEntries.add(entry);
            }
        }

        private void addRelaxedParentDomainMatches(String host, Set<String> candidateIds) {
            for (JSONObject entry : loginEntries) {
                JSONArray domains = entry.optJSONArray("domains");
                for (int index = 0; domains != null && index < domains.length(); index += 1) {
                    if (relaxedAutofillDomainMatches(host, domains.optString(index))) {
                        String id = entry.optString("id");
                        if (!id.isEmpty()) candidateIds.add(id);
                        break;
                    }
                }
            }
        }

        private void addSameSiteAutofillMatches(String host, Set<String> candidateIds) {
            for (JSONObject entry : loginEntries) {
                JSONArray domains = entry.optJSONArray("domains");
                for (int index = 0; domains != null && index < domains.length(); index += 1) {
                    if (sameSiteAutofillDomainMatches(host, domains.optString(index))) {
                        String id = entry.optString("id");
                        if (!id.isEmpty()) candidateIds.add(id);
                        break;
                    }
                }
            }
        }

        private static List<String> domainSuffixes(String hostname) {
            String host = normalizeDomain(hostname);
            List<String> suffixes = new ArrayList<>();
            if (host.isEmpty()) return suffixes;
            String[] parts = host.split("\\.");
            for (int index = 0; index < parts.length; index += 1) {
                StringBuilder builder = new StringBuilder();
                for (int part = index; part < parts.length; part += 1) {
                    if (parts[part].isEmpty()) continue;
                    if (builder.length() > 0) builder.append('.');
                    builder.append(parts[part]);
                }
                if (builder.length() > 0) suffixes.add(builder.toString());
            }
            return suffixes;
        }
    }
}
