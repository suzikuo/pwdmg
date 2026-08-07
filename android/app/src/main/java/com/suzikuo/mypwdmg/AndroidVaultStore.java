package com.suzikuo.mypwdmg;

import android.content.Context;
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
import java.util.Arrays;
import java.util.Base64;
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
    private static final Set<String> ENTRY_KINDS = new HashSet<>(Arrays.asList("login", "secure-note", "card", "identity", "api-key", "folder"));
    private static final Set<String> CUSTOM_FIELD_TYPES = new HashSet<>(Arrays.asList("text", "secret", "date", "url", "email", "phone"));
    private static final int DEFAULT_ITERATIONS = 390000;
    private static final long UNLOCK_SESSION_TIMEOUT_MS = 15 * 60 * 1000L;
    private static final int MAX_IMPORT_BACKUPS = 5;
    static final String WEB_REDACTED_PRIVATE_KEY = "AA";
    private static final Object VAULT_MUTATION_LOCK = new Object();

    private final SecureRandom random = new SecureRandom();
    private final File vaultFile;
    private final File backupDir;
    private final Map<String, JSONObject> webPasskeyMaterials = new HashMap<>();
    private final Set<String> webAuthorizedTombstones = new HashSet<>();

    private static volatile JSONObject payload;
    private static volatile byte[] key;
    private static volatile byte[] salt;
    private static volatile int iterations;
    private static volatile long expiresAt;
    private static volatile VaultSessionIndex vaultIndex;

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

    static class ConflictException extends Exception {
        ConflictException(String message) {
            super(message);
        }
    }

    interface VaultPayloadMutator {
        JSONObject mutate(JSONObject latestPayload) throws Exception;
    }

    private static final class DecryptedVault {
        final JSONObject payload;
        final byte[] key;
        final byte[] salt;
        final int iterations;

        DecryptedVault(JSONObject payload, byte[] key, byte[] salt, int iterations) {
            this.payload = payload;
            this.key = key;
            this.salt = salt;
            this.iterations = iterations;
        }
    }

    private interface NativePayloadMutation<T> {
        NativeMutation<T> apply(JSONObject latestPayload) throws Exception;
    }

    private static final class NativeMutation<T> {
        final boolean changed;
        final JSONObject nextPayload;
        final T value;

        NativeMutation(boolean changed, JSONObject nextPayload, T value) {
            this.changed = changed;
            this.nextPayload = nextPayload;
            this.value = value;
        }
    }

    private static final class NativeMutationCommit<T> {
        final JSONObject payload;
        final T value;

        NativeMutationCommit(JSONObject payload, T value) {
            this.payload = payload;
            this.value = value;
        }
    }

    private static final class CaptureMutationResult {
        final String action;
        final String entryId;

        CaptureMutationResult(String action, String entryId) {
            this.action = action;
            this.entryId = entryId;
        }
    }

    AndroidVaultStore(Context context) {
        File root = context.getApplicationContext().getFilesDir();
        this.vaultFile = new File(root, "vault.json");
        this.backupDir = new File(root, "backups");
    }

    synchronized JSONObject state() throws JSONException {
        synchronized (VAULT_MUTATION_LOCK) {
            boolean unlocked = isUnlocked();
            return new JSONObject()
                .put("hasVault", vaultFile.exists())
                .put("locked", !unlocked)
                .put("expiresAt", unlocked ? expiresAt / 1000 : 0)
                .put("legacyAvailable", false)
                .put("vaultPath", vaultFile.getAbsolutePath());
        }
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
        return writeVaultEnvelope(envelopeText, protectBackup, -1);
    }

    synchronized JSONObject writeVaultEnvelope(String envelopeText, boolean protectBackup, long expectedRevision) throws Exception {
        synchronized (VAULT_MUTATION_LOCK) {
            JSONObject envelope = validateEnvelope(envelopeText);
            JSONObject currentEnvelope = vaultFile.exists() ? readEnvelope() : null;
            long currentRevision = currentEnvelope == null ? 0 : VaultFormat.readEnvelopeRevision(currentEnvelope);
            long incomingRevision = VaultFormat.readEnvelopeRevision(envelope);
            if (currentEnvelope != null) VaultFormat.requireNoDowngrade(currentEnvelope, envelope);
            requireExpectedRevision(expectedRevision, currentRevision);
            if (currentEnvelope != null && !protectBackup && incomingRevision != nextRevision(currentRevision)) {
                throw new ConflictException(
                    "Vault revision conflict: next revision must be " + nextRevision(currentRevision)
                );
            }
            JSONObject decryptedIncoming = null;
            if (!protectBackup && usesCurrentVaultKey(envelope)) {
                decryptedIncoming = normalizePayload(decryptWithCurrentKey(envelope));
            }
            File backupPath = protectBackup ? backupCurrentVault() : null;
            writeEnvelope(envelope);
            if (protectBackup) {
                lock();
            } else if (decryptedIncoming != null) {
                setPayload(decryptedIncoming);
                refreshSession();
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
                .put("backupPath", backupPath == null ? "" : backupPath.getAbsolutePath())
                .put("revision", incomingRevision);
        }
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
            .put("vault", exposePayloadToWeb(payload))
            .put("migrated", 0);
    }

    synchronized JSONObject unlock(String password) throws Exception {
        synchronized (VAULT_MUTATION_LOCK) {
            DecryptedVault decrypted = null;
            boolean committed = false;
            try {
                JSONObject envelope = readEnvelope();
                decrypted = decryptPayloadForPassword(password, envelope);
                JSONObject nextPayload = decrypted.payload;
                JSONObject normalized = normalizePayload(nextPayload);
                boolean passwordless = password == null || password.isEmpty();
                boolean needsSchemaRewrite = passkeyStateChanged(nextPayload, normalized)
                    || !nextPayload.has("revision")
                    || !envelope.has("revision")
                    || !passwordlessMarkerMatches(envelope, passwordless);
                if (needsSchemaRewrite) {
                    long originalRevision = nextPayload.has("revision")
                        ? VaultFormat.readPayloadRevision(nextPayload)
                        : 0;
                    long repairedRevision = originalRevision == 0 ? 1 : nextRevision(originalRevision);
                    normalized.put("revision", repairedRevision);
                    normalized.put("updatedAt", nowSeconds());
                    JSONObject repairedEnvelope = encryptPayloadWithKey(
                        normalized,
                        decrypted.key,
                        decrypted.salt,
                        decrypted.iterations,
                        randomBytes(VaultFormat.NONCE_BYTES)
                    );
                    repairedEnvelope.put("passwordless", passwordless);
                    writeEnvelope(repairedEnvelope);
                }
                setPayload(normalized);
                replaceSessionSecrets(decrypted.key, decrypted.salt, decrypted.iterations);
                refreshSession();
                committed = true;
                return exposePayloadToWeb(payload);
            } catch (Exception error) {
                lock();
                throw error;
            } finally {
                if (!committed && decrypted != null) {
                    wipeBytes(decrypted.key);
                    wipeBytes(decrypted.salt);
                }
            }
        }
    }

    synchronized JSONObject tryUnlockWithEmptyPasswordForAutofill() {
        try {
            if (!vaultFile.exists()) return null;
            if (!isUnlocked()) unlock("");
            return isUnlocked() ? exposePayloadToWeb(payload) : null;
        } catch (Exception error) {
            Log.e(TAG, "Empty-password autofill unlock failed", error);
            return null;
        }
    }

    synchronized void lock() {
        synchronized (VAULT_MUTATION_LOCK) {
            payload = null;
            clearSessionSecrets();
            expiresAt = 0;
            vaultIndex = null;
            webPasskeyMaterials.clear();
            webAuthorizedTombstones.clear();
            PasskeyOperationBroker.getInstance().clear();
        }
    }

    synchronized JSONObject getVault() throws Exception {
        synchronized (VAULT_MUTATION_LOCK) {
            return exposePayloadToWeb(requirePayload());
        }
    }

    synchronized JSONObject saveVault(JSONObject nextPayload) throws Exception {
        requirePayload();
        long expectedRevision = VaultFormat.readPayloadRevision(nextPayload);
        JSONObject restored = restorePayloadFromWeb(requirePayload(), nextPayload);
        JSONObject saved = persistNativePayload(restored, expectedRevision);
        refreshSession();
        return exposePayloadToWeb(saved);
    }

    synchronized JSONObject mutateVaultPayload(VaultPayloadMutator mutator) throws Exception {
        requirePayload();
        if (mutator == null) throw new IllegalArgumentException("Vault mutator is required");
        NativeMutationCommit<JSONObject> commit = mutateNativePayload(
            -1,
            latestPayload -> new NativeMutation<>(true, mutator.mutate(latestPayload), null)
        );
        refreshSession();
        return copy(commit.payload);
    }

    synchronized boolean isUnlockedForPasskeys() {
        synchronized (VAULT_MUTATION_LOCK) {
            return isUnlocked();
        }
    }

    synchronized boolean tryUnlockWithEmptyPasswordForPasskeys() {
        return tryUnlockWithEmptyPasswordForAutofill() != null;
    }

    synchronized void unlockForPasskeys(String password) throws Exception {
        unlock(password == null ? "" : password);
    }

    synchronized JSONArray listPasskeysForOperation(PasskeyOperation.Operation operation) throws Exception {
        synchronized (VAULT_MUTATION_LOCK) {
            if (operation == null || operation.kind != PasskeyOperation.Kind.GET) {
                throw new IllegalArgumentException("Passkey get operation is required");
            }
            JSONArray source = requirePayload().optJSONArray("passkeys");
            JSONArray result = new JSONArray();
            for (int index = 0; source != null && index < source.length(); index += 1) {
                JSONObject passkey = source.getJSONObject(index);
                if (passkeyMatchesOperation(passkey, operation)) result.put(copy(passkey));
            }
            return result;
        }
    }

    synchronized boolean hasExcludedPasskey(PasskeyOperation.Operation operation) throws Exception {
        synchronized (VAULT_MUTATION_LOCK) {
            if (operation == null || operation.kind != PasskeyOperation.Kind.CREATE) {
                throw new IllegalArgumentException("Passkey create operation is required");
            }
            if (operation.credentialIds.isEmpty()) return false;
            JSONArray source = requirePayload().optJSONArray("passkeys");
            for (int index = 0; source != null && index < source.length(); index += 1) {
                JSONObject passkey = source.getJSONObject(index);
                if (operation.rpId.equals(passkey.optString("rpId"))
                    && operation.credentialIds.contains(passkey.optString("credentialId"))) {
                    return true;
                }
            }
            return false;
        }
    }

    synchronized JSONObject passkeyForAssertion(
        String credentialId,
        PasskeyOperation.Operation operation
    ) throws Exception {
        synchronized (VAULT_MUTATION_LOCK) {
            JSONArray source = requirePayload().optJSONArray("passkeys");
            for (int index = 0; source != null && index < source.length(); index += 1) {
                JSONObject passkey = source.getJSONObject(index);
                if (credentialId.equals(passkey.optString("credentialId"))
                    && passkeyMatchesOperation(passkey, operation)) {
                    return copy(passkey);
                }
            }
            throw new IllegalArgumentException("PASSKEY_NOT_FOUND");
        }
    }

    synchronized JSONObject storeCreatedPasskey(
        JSONObject createdPasskey,
        PasskeyOperation.Operation operation
    ) throws Exception {
        if (createdPasskey == null || operation == null || operation.kind != PasskeyOperation.Kind.CREATE) {
            throw new IllegalArgumentException("Created passkey and operation are required");
        }
        String createdId = createdPasskey.getString("id");
        String credentialId = createdPasskey.getString("credentialId");
        mutateVaultPayload(latest -> {
            JSONArray passkeys = latest.optJSONArray("passkeys");
            if (passkeys == null) passkeys = new JSONArray();
            for (int index = 0; index < passkeys.length(); index += 1) {
                JSONObject existing = passkeys.getJSONObject(index);
                if (createdId.equals(existing.optString("id"))
                    || credentialId.equals(existing.optString("credentialId"))) {
                    throw new IllegalArgumentException("PASSKEY_ID_COLLISION");
                }
                if (operation.rpId.equals(existing.optString("rpId"))
                    && operation.credentialIds.contains(existing.optString("credentialId"))) {
                    throw new IllegalArgumentException("EXCLUDED_CREDENTIAL_EXISTS");
                }
            }
            JSONArray tombstones = latest.optJSONArray("passkeyTombstones");
            if (tombstones == null) tombstones = new JSONArray();
            for (int index = 0; index < tombstones.length(); index += 1) {
                JSONObject tombstone = tombstones.getJSONObject(index);
                if (createdId.equals(tombstone.optString("id"))
                    || credentialId.equals(tombstone.optString("credentialId"))) {
                    throw new IllegalArgumentException("PASSKEY_TOMBSTONE_COLLISION");
                }
            }
            passkeys.put(copy(createdPasskey));
            latest
                .put("version", 2)
                .put("passkeySchemaVersion", 1)
                .put("passkeys", passkeys)
                .put("passkeyTombstones", tombstones);
            return latest;
        });
        return copy(createdPasskey);
    }

    synchronized JSONObject deletePasskeyForWeb(String passkeyId) throws Exception {
        JSONObject saved = mutateVaultPayload(latest -> {
            if (!deletePasskeyFromPayload(latest, passkeyId, nowSeconds())) {
                throw new IllegalArgumentException("PASSKEY_NOT_FOUND");
            }
            return latest;
        });
        return exposePayloadToWeb(saved);
    }

    static boolean deletePasskeyFromPayload(JSONObject latest, String passkeyId, long deletedAt) throws Exception {
        if (passkeyId == null || passkeyId.isEmpty()) return false;
        if (deletedAt <= 0) throw new IllegalArgumentException("PASSKEY_DELETE_TIME_INVALID");
        JSONArray passkeys = latest.optJSONArray("passkeys");
        if (passkeys == null) passkeys = new JSONArray();
        JSONObject removed = null;
        int removedIndex = -1;
        for (int index = 0; index < passkeys.length(); index += 1) {
            JSONObject passkey = passkeys.getJSONObject(index);
            if (passkeyId.equals(passkey.optString("id"))) {
                removed = passkey;
                removedIndex = index;
                break;
            }
        }
        if (removed == null) return false;

        JSONArray tombstones = latest.optJSONArray("passkeyTombstones");
        if (tombstones == null) tombstones = new JSONArray();
        String credentialId = removed.getString("credentialId");
        for (int index = 0; index < tombstones.length(); index += 1) {
            JSONObject tombstone = tombstones.getJSONObject(index);
            if (passkeyId.equals(tombstone.optString("id"))
                || credentialId.equals(tombstone.optString("credentialId"))) {
                throw new IllegalArgumentException("PASSKEY_TOMBSTONE_COLLISION");
            }
        }
        passkeys.remove(removedIndex);
        tombstones.put(new JSONObject()
            .put("id", passkeyId)
            .put("credentialId", credentialId)
            .put("deletedAt", deletedAt));
        latest
            .put("version", 2)
            .put("passkeySchemaVersion", 1)
            .put("passkeys", passkeys)
            .put("passkeyTombstones", tombstones);
        return true;
    }

    private static boolean passkeyMatchesOperation(
        JSONObject passkey,
        PasskeyOperation.Operation operation
    ) {
        if (!operation.rpId.equals(passkey.optString("rpId"))) return false;
        String credentialId = passkey.optString("credentialId");
        return operation.credentialIds.isEmpty() || operation.credentialIds.contains(credentialId);
    }

    synchronized JSONObject changePassword(String newPassword) throws Exception {
        requirePayload();
        synchronized (VAULT_MUTATION_LOCK) {
            byte[] nextSalt = randomBytes(VaultFormat.SALT_BYTES);
            int nextIterations = DEFAULT_ITERATIONS;
            byte[] nextKey = null;
            boolean committed = false;
            try {
                JSONObject currentEnvelope = readEnvelope();
                JSONObject current = normalizePayload(decryptWithCurrentKey(currentEnvelope));
                current.put("revision", nextRevision(VaultFormat.readPayloadRevision(current)));
                current.put("updatedAt", nowSeconds());
                nextKey = deriveKey(newPassword, nextSalt, nextIterations);
                JSONObject nextEnvelope = encryptPayloadWithKey(
                    current,
                    nextKey,
                    nextSalt,
                    nextIterations,
                    randomBytes(VaultFormat.NONCE_BYTES)
                ).put("passwordless", newPassword == null || newPassword.isEmpty());
                writeEnvelope(nextEnvelope);
                setPayload(current);
                replaceSessionSecrets(nextKey, nextSalt, nextIterations);
                refreshSession();
                committed = true;
                return state();
            } catch (Exception error) {
                lock();
                throw error;
            } finally {
                if (!committed) {
                    wipeBytes(nextKey);
                    wipeBytes(nextSalt);
                }
            }
        }
    }

    synchronized JSONObject exportBackup() throws Exception {
        synchronized (VAULT_MUTATION_LOCK) {
            requirePayload();
            return new JSONObject()
                .put("content", readFile(vaultFile))
                .put("vaultPath", vaultFile.getAbsolutePath())
                .put("updatedAt", vaultFile.lastModified() / 1000);
        }
    }

    synchronized JSONObject exportBackupForPayload(JSONObject nextPayload) throws Exception {
        JSONObject current = requirePayload();
        JSONObject normalized = normalizePayload(restorePayloadFromWeb(current, nextPayload));
        requireNoPayloadDowngrade(current, normalized);
        normalized.put("updatedAt", nowSeconds());
        JSONObject envelope = encryptWithCurrentKey(normalized);
        refreshSession();
        return new JSONObject()
            .put("content", envelope.toString())
            .put("vaultPath", vaultFile.getAbsolutePath())
            .put("updatedAt", normalized.optLong("updatedAt"));
    }

    synchronized JSONObject previewBackup(String envelopeText) throws Exception {
        requirePayload();
        JSONObject envelope = validateEnvelope(envelopeText);
        JSONObject decrypted = normalizePayload(decryptWithCurrentKey(envelope));
        refreshSession();
        return exposePayloadToWeb(decrypted);
    }

    synchronized JSONObject previewBackupWithPassword(String envelopeText, String password) throws Exception {
        requirePayload();
        JSONObject envelope = validateEnvelope(envelopeText);
        DecryptedVault decrypted = null;
        try {
            decrypted = decryptPayloadForPassword(password, envelope);
            JSONObject normalized = normalizePayload(decrypted.payload);
            refreshSession();
            return exposePayloadToWeb(normalized);
        } finally {
            if (decrypted != null) {
                wipeBytes(decrypted.key);
                wipeBytes(decrypted.salt);
            }
        }
    }

    synchronized JSONObject importBackup(String envelopeText) throws Exception {
        long expectedRevision = VaultFormat.readPayloadRevision(requirePayload());
        JSONObject envelope = validateEnvelope(envelopeText);
        synchronized (VAULT_MUTATION_LOCK) {
            JSONObject currentEnvelope = readEnvelope();
            JSONObject currentPayload = normalizePayload(decryptWithCurrentKey(currentEnvelope));
            requireExpectedRevision(expectedRevision, VaultFormat.readPayloadRevision(currentPayload));
            VaultFormat.requireNoDowngrade(currentEnvelope, envelope);
            File backupPath = backupCurrentVault();
            writeEnvelope(envelope);
            lock();
            return new JSONObject()
                .put("state", state())
                .put("backupPath", backupPath == null ? "" : backupPath.getAbsolutePath())
                .put("vaultPath", vaultFile.getAbsolutePath());
        }
    }

    synchronized JSONArray queryMatches(String hostname) throws Exception {
        synchronized (VAULT_MUTATION_LOCK) {
            JSONArray matches = queryMatchesFromPayload(requirePayload(), hostname);
            refreshSession();
            return matches;
        }
    }

    synchronized JSONObject getFillPayload(String entryId) throws Exception {
        synchronized (VAULT_MUTATION_LOCK) {
            JSONObject result = getFillPayloadFromPayload(requirePayload(), entryId);
            refreshSession();
            return result;
        }
    }

    synchronized String generateTotp(String entryId) throws Exception {
        synchronized (VAULT_MUTATION_LOCK) {
            requirePayload();
            JSONObject entry = vaultIndex == null ? null : vaultIndex.getLogin(entryId);
            if (entry == null) {
                throw new IllegalArgumentException("Entry not found");
            }
            refreshSession();
            return generateTotpCode(entry.optString("totpSecret", ""));
        }
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

    static JSONObject getFillPayloadFromPayload(JSONObject sourcePayload, String entryId) throws Exception {
        JSONObject entry = VaultSessionIndex.build(sourcePayload.optJSONArray("entries")).getLogin(entryId);
        if (entry == null) {
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
        requirePayload();
        JSONObject normalized = normalizeCapture(capture);
        if (normalized.optString("password").isEmpty()) {
            throw new IllegalArgumentException("Captured password is empty");
        }
        if (identityValues(normalized).isEmpty()) {
            throw new IllegalArgumentException("Captured account is empty");
        }

        NativeMutationCommit<CaptureMutationResult> commit = mutateNativePayload(-1, workingPayload -> {
            JSONObject candidate = findCaptureCandidateInPayload(workingPayload, normalized);
            if (candidate != null && candidate.optString("password").equals(normalized.optString("password"))) {
                return new NativeMutation<>(
                    false,
                    workingPayload,
                    new CaptureMutationResult("skipped", candidate.optString("id"))
                );
            }

            JSONObject entry;
            String action;
            if (candidate != null) {
                entry = candidate;
                applyCaptureUpdate(entry, normalized);
                action = "updated";
            } else {
                entry = entryFromCapture(normalized);
                prependEntry(workingPayload, entry);
                action = "created";
            }
            return new NativeMutation<>(
                true,
                workingPayload,
                new CaptureMutationResult(action, entry.optString("id"))
            );
        });

        JSONObject savedEntry = findEntry(commit.payload.optJSONArray("entries"), commit.value.entryId);
        if (savedEntry == null) throw new IllegalStateException("Captured login was not persisted");
        refreshSession();
        return new JSONObject()
            .put("action", commit.value.action)
            .put("entry", matchSummary(savedEntry, savedEntry.optJSONArray("domains")));
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

    static JSONObject findCaptureCandidateInPayload(JSONObject sourcePayload, JSONObject capture) {
        List<JSONObject> candidates = capture.optString("hostname").isEmpty()
            ? loginEntriesFromPayload(sourcePayload)
            : matchingLoginEntriesFromPayload(sourcePayload, capture.optString("hostname"));
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
        if (payload == null || key == null || expiresAt <= 0) return false;
        if (System.currentTimeMillis() < expiresAt) return true;
        lock();
        return false;
    }

    private void refreshSession() {
        long now = System.currentTimeMillis();
        expiresAt = now > Long.MAX_VALUE - UNLOCK_SESSION_TIMEOUT_MS
            ? Long.MAX_VALUE
            : now + UNLOCK_SESSION_TIMEOUT_MS;
    }

    private void writeNewEnvelope(String password, JSONObject nextPayload) throws Exception {
        synchronized (VAULT_MUTATION_LOCK) {
            if (vaultFile.exists()) throw new IllegalStateException("Vault already exists; unlock it instead");
            JSONObject normalized = normalizePayload(nextPayload);
            byte[] nextSalt = randomBytes(VaultFormat.SALT_BYTES);
            int nextIterations = DEFAULT_ITERATIONS;
            byte[] nextKey = null;
            boolean committed = false;
            try {
                nextKey = deriveKey(password, nextSalt, nextIterations);
                JSONObject envelope = encryptPayloadWithKey(
                    normalized,
                    nextKey,
                    nextSalt,
                    nextIterations,
                    randomBytes(VaultFormat.NONCE_BYTES)
                ).put("passwordless", password == null || password.isEmpty());
                writeEnvelope(envelope);
                setPayload(normalized);
                replaceSessionSecrets(nextKey, nextSalt, nextIterations);
                refreshSession();
                committed = true;
            } catch (Exception error) {
                lock();
                throw error;
            } finally {
                if (!committed) {
                    wipeBytes(nextKey);
                    wipeBytes(nextSalt);
                }
            }
        }
    }

    private JSONObject persistNativePayload(JSONObject nextPayload, long expectedRevision) throws Exception {
        NativeMutationCommit<JSONObject> commit = mutateNativePayload(
            expectedRevision,
            latestPayload -> new NativeMutation<>(true, nextPayload, null)
        );
        return copy(commit.payload);
    }

    private <T> NativeMutationCommit<T> mutateNativePayload(
        long expectedRevision,
        NativePayloadMutation<T> mutation
    ) throws Exception {
        synchronized (VAULT_MUTATION_LOCK) {
            if (key == null || salt == null || iterations <= 0) throw new LockedException("Vault is locked");
            JSONObject currentEnvelope = readEnvelope();
            JSONObject current = normalizePayload(decryptWithCurrentKey(currentEnvelope));
            long currentRevision = VaultFormat.readPayloadRevision(current);
            requireExpectedRevision(expectedRevision, currentRevision);

            NativeMutation<T> mutationResult = mutation.apply(copy(current));
            if (mutationResult == null || mutationResult.nextPayload == null) {
                throw new IllegalArgumentException("Native vault mutation did not return a payload");
            }
            if (!mutationResult.changed) {
                setPayload(current);
                return new NativeMutationCommit<>(copy(current), mutationResult.value);
            }

            JSONObject normalized = normalizePayload(mutationResult.nextPayload);
            requireNoPayloadDowngrade(current, normalized);
            normalized.put("revision", nextRevision(currentRevision));
            normalized.put("updatedAt", nowSeconds());
            JSONObject envelope = encryptWithCurrentKey(normalized);
            preservePasswordlessMarker(currentEnvelope, envelope);
            writeEnvelope(envelope);
            setPayload(normalized);
            return new NativeMutationCommit<>(copy(normalized), mutationResult.value);
        }
    }

    static void requireExpectedRevision(long expectedRevision, long currentRevision) throws ConflictException {
        if (expectedRevision == -1) return;
        if (expectedRevision < 0 || expectedRevision > VaultFormat.MAX_REVISION) {
            throw new IllegalArgumentException("Vault expected revision is invalid");
        }
        if (expectedRevision != currentRevision) {
            throw new ConflictException(
                "Vault revision conflict: expected " + expectedRevision + ", current " + currentRevision
            );
        }
    }

    static long nextRevision(long currentRevision) throws ConflictException {
        if (currentRevision < 0 || currentRevision >= VaultFormat.MAX_REVISION) {
            throw new ConflictException("Vault revision limit has been reached");
        }
        return currentRevision + 1;
    }

    static void preservePasswordlessMarker(JSONObject sourceEnvelope, JSONObject nextEnvelope) throws JSONException {
        if (sourceEnvelope.optBoolean("passwordless", false)) nextEnvelope.put("passwordless", true);
    }

    static boolean passwordlessMarkerMatches(JSONObject envelope, boolean expected) {
        return envelope.has("passwordless") && envelope.optBoolean("passwordless", !expected) == expected;
    }

    private static void setPayload(JSONObject nextPayload) throws JSONException {
        VaultSessionIndex nextIndex = VaultSessionIndex.build(nextPayload.optJSONArray("entries"));
        payload = nextPayload;
        vaultIndex = nextIndex;
    }

    private static void replaceSessionSecrets(byte[] nextKey, byte[] nextSalt, int nextIterations) {
        byte[] previousKey = key;
        byte[] previousSalt = salt;
        key = nextKey;
        salt = nextSalt;
        iterations = nextIterations;
        if (previousKey != nextKey) wipeBytes(previousKey);
        if (previousSalt != nextSalt) wipeBytes(previousSalt);
    }

    private static void clearSessionSecrets() {
        byte[] previousKey = key;
        byte[] previousSalt = salt;
        key = null;
        salt = null;
        iterations = 0;
        wipeBytes(previousKey);
        wipeBytes(previousSalt);
    }

    static void wipeBytes(byte[] value) {
        if (value != null) Arrays.fill(value, (byte) 0);
    }

    private DecryptedVault decryptPayloadForPassword(String password, JSONObject envelope) throws Exception {
        byte[] nextKey = null;
        try {
            VaultFormat.ValidatedEnvelope validated = VaultFormat.validateEnvelope(envelope);
            nextKey = deriveKey(password, validated.salt, validated.iterations);
            return new DecryptedVault(
                decryptEnvelopeWithKey(envelope, nextKey, validated),
                nextKey,
                validated.salt,
                validated.iterations
            );
        } catch (BadPasswordException error) {
            wipeBytes(nextKey);
            throw error;
        } catch (Exception error) {
            wipeBytes(nextKey);
            throw new BadPasswordException("Wrong password or corrupted vault", error);
        }
    }

    private JSONObject decryptWithCurrentKey(JSONObject envelope) throws Exception {
        if (key == null || salt == null || iterations <= 0) {
            throw new LockedException("Vault is locked");
        }
        VaultFormat.ValidatedEnvelope validated = VaultFormat.validateEnvelope(envelope);
        if (validated.iterations != iterations || !sameBytes(validated.salt, salt)) {
            throw new BadPasswordException("Vault password changed", null);
        }

        return decryptEnvelopeWithKey(envelope, key, validated);
    }

    private boolean usesCurrentVaultKey(JSONObject envelope) {
        if (key == null || salt == null || iterations <= 0) return false;
        VaultFormat.ValidatedEnvelope validated = VaultFormat.validateEnvelope(envelope);
        return validated.iterations == iterations && sameBytes(validated.salt, salt);
    }

    static JSONObject decryptEnvelopeWithKey(JSONObject envelope, byte[] decryptKey) throws Exception {
        return decryptEnvelopeWithKey(envelope, decryptKey, VaultFormat.validateEnvelope(envelope));
    }

    private static JSONObject decryptEnvelopeWithKey(
        JSONObject envelope,
        byte[] decryptKey,
        VaultFormat.ValidatedEnvelope validated
    ) throws Exception {
        if (decryptKey == null || decryptKey.length != 32) {
            throw new IllegalArgumentException("Vault encryption key has an invalid length");
        }
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, new SecretKeySpec(decryptKey, "AES"), new GCMParameterSpec(128, validated.nonce));
        cipher.updateAAD(VaultFormat.aadForVersion(validated.version));
        byte[] plain = cipher.doFinal(validated.ciphertext);
        if (plain.length > VaultFormat.MAX_PLAINTEXT_BYTES) {
            throw new IllegalArgumentException("Vault payload is too large");
        }
        JSONObject decrypted = new JSONObject(new String(plain, StandardCharsets.UTF_8));
        VaultFormat.requireMatchingVersions(envelope, decrypted);
        VaultFormat.requireMatchingRevisions(envelope, decrypted);
        PasskeySchema.validateDecryptedState(decrypted);
        return decrypted;
    }

    private JSONObject encryptWithCurrentKey(JSONObject sourcePayload) throws Exception {
        return encryptPayloadWithKey(sourcePayload, key, salt, iterations, randomBytes(12));
    }

    static JSONObject encryptPayloadWithKey(
        JSONObject sourcePayload,
        byte[] encryptKey,
        byte[] encryptSalt,
        int encryptIterations,
        byte[] nonce
    ) throws Exception {
        int version = VaultFormat.readPayloadVersion(sourcePayload);
        PasskeySchema.requireValidEncryptionState(sourcePayload);
        if (encryptKey == null || encryptKey.length != 32) {
            throw new IllegalArgumentException("Vault encryption key has an invalid length");
        }
        if (encryptSalt == null || encryptSalt.length != VaultFormat.SALT_BYTES) {
            throw new IllegalArgumentException("Vault salt has an invalid length");
        }
        if (encryptIterations < VaultFormat.MIN_KDF_ITERATIONS || encryptIterations > VaultFormat.MAX_KDF_ITERATIONS) {
            throw new IllegalArgumentException("Vault KDF iteration count is outside the supported range");
        }
        if (nonce == null || nonce.length != VaultFormat.NONCE_BYTES) {
            throw new IllegalArgumentException("Vault nonce has an invalid length");
        }
        byte[] plain = sourcePayload.toString().getBytes(StandardCharsets.UTF_8);
        if (plain.length > VaultFormat.MAX_PLAINTEXT_BYTES) {
            throw new IllegalArgumentException("Vault payload is too large");
        }
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(encryptKey, "AES"), new GCMParameterSpec(128, nonce));
        cipher.updateAAD(VaultFormat.aadForVersion(version));
        byte[] ciphertext = cipher.doFinal(plain);

        JSONObject kdf = new JSONObject()
            .put("name", "PBKDF2-HMAC-SHA256")
            .put("iterations", encryptIterations)
            .put("salt", b64e(encryptSalt));

        return new JSONObject()
            .put("format", "mypwdmg-vault")
            .put("version", version)
            .put("revision", VaultFormat.readPayloadRevision(sourcePayload))
            .put("cipher", "AES-256-GCM")
            .put("kdf", kdf)
            .put("nonce", b64e(nonce))
            .put("ciphertext", b64e(ciphertext));
    }

    private JSONObject normalizePayload(JSONObject input) throws JSONException {
        PasskeySchema.State passkeyState = PasskeySchema.normalize(input);
        validateNativePasskeyKeyMaterial(passkeyState.passkeys);
        JSONObject settings = input.optJSONObject("settings");
        if (settings == null) settings = new JSONObject();

        JSONObject oss = settings.optJSONObject("oss");
        if (oss == null) oss = new JSONObject();
        JSONObject normalizedOss = new JSONObject()
            .put("bucketName", oss.optString("bucketName"))
            .put("accessKeyId", oss.optString("accessKeyId"))
            .put("accessKeySecret", oss.optString("accessKeySecret"))
            .put("region", oss.optString("region"))
            .put("objectName", oss.optString("objectName", "mypwdmg-vault.json"))
            .put("autoSync", oss.optBoolean("autoSync", false))
            .put("autoSyncIntervalMinutes", Math.max(1, Math.min(1440, oss.optInt("autoSyncIntervalMinutes", 1))));

        JSONObject normalizedSettings = new JSONObject().put("oss", normalizedOss);
        JSONObject normalized = new JSONObject()
            .put("version", passkeyState.version)
            .put("revision", VaultFormat.readPayloadRevision(input))
            .put("entries", normalizeEntries(input.optJSONArray("entries")))
            .put("passkeys", passkeyState.passkeys)
            .put("passkeyTombstones", passkeyState.passkeyTombstones)
            .put("settings", normalizedSettings)
            .put("updatedAt", input.optLong("updatedAt", nowSeconds()));
        if (passkeyState.version == 2) normalized.put("passkeySchemaVersion", passkeyState.schemaVersion);
        return normalized;
    }

    private static void validateNativePasskeyKeyMaterial(JSONArray passkeys) throws JSONException {
        for (int index = 0; index < passkeys.length(); index += 1) {
            JSONObject passkey = passkeys.getJSONObject(index);
            PasskeyKeyMaterial.load(
                passkey.getString("publicKeyCose"),
                passkey.getString("privateKeyPkcs8")
            );
        }
    }

    private static boolean passkeyStateChanged(JSONObject source, JSONObject normalized) throws JSONException {
        if (VaultFormat.readPayloadVersion(source) != VaultFormat.readPayloadVersion(normalized)) return true;
        if (source.optInt("passkeySchemaVersion", 0) != normalized.optInt("passkeySchemaVersion", 0)) return true;
        return !arrayOrEmpty(source, "passkeys").toString().equals(normalized.getJSONArray("passkeys").toString())
            || !arrayOrEmpty(source, "passkeyTombstones").toString()
                .equals(normalized.getJSONArray("passkeyTombstones").toString());
    }

    private static JSONArray arrayOrEmpty(JSONObject source, String key) {
        JSONArray value = source.optJSONArray(key);
        return value == null ? new JSONArray() : value;
    }

    private static void requireNoPayloadDowngrade(JSONObject current, JSONObject next) {
        if (VaultFormat.readPayloadVersion(current) == 2 && VaultFormat.readPayloadVersion(next) < 2) {
            throw new IllegalArgumentException("Refusing to downgrade a version 2 vault");
        }
    }

    static JSONArray normalizeEntries(JSONArray entries) throws JSONException {
        return normalizeEntries(entries, new HashSet<>(), "");
    }

    private static JSONArray normalizeEntries(
        JSONArray entries,
        Set<String> seenIds,
        String parentPath
    ) throws JSONException {
        JSONArray normalized = new JSONArray();
        for (int index = 0; entries != null && index < entries.length(); index += 1) {
            JSONObject entry = entries.optJSONObject(index);
            if (entry == null) continue;
            String path = parentPath.isEmpty() ? String.valueOf(index) : parentPath + "-" + index;
            normalized.put(normalizeEntry(entry, seenIds, path));
        }
        return normalized;
    }

    private static JSONObject normalizeEntry(
        JSONObject entry,
        Set<String> seenIds,
        String path
    ) throws JSONException {
        String rawKind = entry.optString("kind");
        String kind = ENTRY_KINDS.contains(rawKind) ? rawKind : "login";
        String originalId = entry.optString("id");
        if (originalId.isEmpty()) originalId = "entry-missing-" + path;
        String entryId = originalId;
        int duplicateIndex = 2;
        while (seenIds.contains(entryId)) {
            entryId = originalId + "-duplicate-" + duplicateIndex;
            duplicateIndex += 1;
        }
        seenIds.add(entryId);
        JSONObject normalized = new JSONObject()
            .put("id", entryId)
            .put("kind", kind)
            .put("title", defaultString(entry.optString("title"), "Untitled"))
            .put("status", normalizeEntryStatus(entry.optString("status")))
            .put("statusReason", entry.optString("statusReason"))
            .put("statusUpdatedAt", entry.optLong("statusUpdatedAt", 0))
            .put("deletedAt", entry.optLong("deletedAt", 0))
            .put("domains", normalizeDomains(entry.optJSONArray("domains")));

        if ("folder".equals(kind)) {
            normalized.put("children", normalizeEntries(entry.optJSONArray("children"), seenIds, path));
        } else {
            normalized
                .put("username", entry.optString("username"))
                .put("email", entry.optString("email"))
                .put("password", entry.optString("password"))
                .put("phone", entry.optString("phone"))
                .put("loginAccountSource", normalizeLoginAccountSource(entry.optString("loginAccountSource")))
                .put("note", entry.optString("note"))
                .put("totpSecret", entry.optString("totpSecret"))
                .put("customFields", normalizeCustomFields(entry.optJSONArray("customFields")))
                .put("history", entry.optJSONArray("history") == null ? new JSONArray() : new JSONArray(entry.optJSONArray("history").toString()))
                .put("children", new JSONArray());
        }
        return normalized;
    }

    private static JSONArray normalizeCustomFields(JSONArray fields) throws JSONException {
        JSONArray normalized = new JSONArray();
        for (int index = 0; fields != null && index < fields.length() && index < 100; index += 1) {
            JSONObject field = fields.optJSONObject(index);
            if (field == null) continue;
            String type = field.optString("type");
            if (!CUSTOM_FIELD_TYPES.contains(type)) type = "text";
            normalized.put(new JSONObject()
                .put("id", limitedString(defaultString(field.optString("id"), "field-" + (index + 1)), 128))
                .put("label", limitedString(defaultString(field.optString("label"), "Custom field"), 200))
                .put("value", limitedString(field.optString("value"), 65536))
                .put("type", type)
                .put("protected", field.optBoolean("protected") || "secret".equals(type)));
        }
        return normalized;
    }

    private static JSONArray normalizeDomains(JSONArray domains) {
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
            .put("objectName", "mypwdmg-vault.json")
            .put("autoSync", false)
            .put("autoSyncIntervalMinutes", 1);
        return new JSONObject()
            .put("version", 1)
            .put("revision", 1)
            .put("entries", entries)
            .put("passkeys", new JSONArray())
            .put("passkeyTombstones", new JSONArray())
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
        return validateEnvelope(new JSONObject(envelopeText));
    }

    private JSONObject validateEnvelope(JSONObject envelope) throws JSONException {
        VaultFormat.validateEnvelope(envelope);
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
        return Base64.getEncoder().encodeToString(value);
    }

    private static boolean sameBytes(byte[] left, byte[] right) {
        if (left == null || right == null || left.length != right.length) return false;
        int diff = 0;
        for (int index = 0; index < left.length; index += 1) {
            diff |= left[index] ^ right[index];
        }
        return diff == 0;
    }

    private JSONObject exposePayloadToWeb(JSONObject source) throws JSONException {
        return redactPayloadForWeb(source, webPasskeyMaterials, webAuthorizedTombstones);
    }

    private JSONObject restorePayloadFromWeb(JSONObject current, JSONObject incoming) throws JSONException {
        return rehydratePayloadFromWeb(current, incoming, webPasskeyMaterials, webAuthorizedTombstones);
    }

    static JSONObject redactPayloadForWeb(
        JSONObject source,
        Map<String, JSONObject> materials,
        Set<String> authorizedTombstones
    ) throws JSONException {
        JSONObject result = copy(source);
        JSONArray passkeys = result.optJSONArray("passkeys");
        if (passkeys == null) passkeys = new JSONArray();
        for (int index = 0; index < passkeys.length(); index += 1) {
            JSONObject passkey = passkeys.getJSONObject(index);
            String materialKey = webMaterialKey(passkey);
            materials.put(materialKey, copy(passkey));
            passkey.put("privateKeyPkcs8", WEB_REDACTED_PRIVATE_KEY);
        }
        result.put("passkeys", passkeys);

        JSONArray tombstones = result.optJSONArray("passkeyTombstones");
        if (tombstones == null) tombstones = new JSONArray();
        for (int index = 0; index < tombstones.length(); index += 1) {
            authorizedTombstones.add(webIdentityKey(tombstones.getJSONObject(index)));
        }
        result.put("passkeyTombstones", tombstones);
        return result;
    }

    static JSONObject rehydratePayloadFromWeb(
        JSONObject current,
        JSONObject incoming,
        Map<String, JSONObject> materials,
        Set<String> authorizedTombstones
    ) throws JSONException {
        JSONObject result = copy(incoming);
        JSONArray incomingPasskeys = result.optJSONArray("passkeys");
        JSONArray incomingTombstones = result.optJSONArray("passkeyTombstones");
        if (incomingPasskeys == null) incomingPasskeys = new JSONArray();
        if (incomingTombstones == null) incomingTombstones = new JSONArray();

        Set<String> liveIdentities = new HashSet<>();
        for (int index = 0; index < incomingPasskeys.length(); index += 1) {
            JSONObject passkey = incomingPasskeys.getJSONObject(index);
            if (!WEB_REDACTED_PRIVATE_KEY.equals(passkey.optString("privateKeyPkcs8"))) {
                throw new SecurityException("WebView cannot provide passkey private-key material");
            }
            JSONObject material = materials.get(webMaterialKey(passkey));
            if (material == null) throw new SecurityException("WebView passkey material handle is not authorized");
            for (String field : new String[] {
                "id", "credentialId", "rpId", "userHandle", "algorithm", "publicKeyCose",
                "privateKeyPkcs8", "createdAt"
            }) {
                passkey.put(field, material.get(field));
            }
            liveIdentities.add(webIdentityKey(passkey));
        }
        result.put("passkeys", incomingPasskeys);

        Set<String> tombstoneIdentities = new HashSet<>();
        for (int index = 0; index < incomingTombstones.length(); index += 1) {
            JSONObject tombstone = incomingTombstones.getJSONObject(index);
            String identity = webIdentityKey(tombstone);
            if (!authorizedTombstones.contains(identity)) {
                throw new SecurityException("WebView passkey tombstone is not authorized");
            }
            tombstoneIdentities.add(identity);
        }
        result.put("passkeyTombstones", incomingTombstones);

        JSONArray currentPasskeys = current.optJSONArray("passkeys");
        if (currentPasskeys != null) {
            for (int index = 0; index < currentPasskeys.length(); index += 1) {
                String identity = webIdentityKey(currentPasskeys.getJSONObject(index));
                if (!liveIdentities.contains(identity) && !tombstoneIdentities.contains(identity)) {
                    throw new SecurityException("WebView cannot remove a native passkey without an authorized tombstone");
                }
            }
        }
        JSONArray currentTombstones = current.optJSONArray("passkeyTombstones");
        if (currentTombstones != null) {
            for (int index = 0; index < currentTombstones.length(); index += 1) {
                String identity = webIdentityKey(currentTombstones.getJSONObject(index));
                if (!tombstoneIdentities.contains(identity)) {
                    throw new SecurityException("WebView cannot remove a native passkey tombstone");
                }
            }
        }
        return result;
    }

    private static String webMaterialKey(JSONObject passkey) {
        return webIdentityKey(passkey) + "\n" + passkey.optString("publicKeyCose");
    }

    private static String webIdentityKey(JSONObject value) {
        String id = value.optString("id");
        String credentialId = value.optString("credentialId");
        if (id.isEmpty() || credentialId.isEmpty()) {
            throw new SecurityException("Passkey identity is incomplete");
        }
        return id + "\n" + credentialId;
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

    private static String limitedString(String value, int maximumLength) {
        String text = value == null ? "" : value;
        return text.length() <= maximumLength ? text : text.substring(0, maximumLength);
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

        return loginEntriesFromPayload(sourcePayload);
    }

    private static List<JSONObject> loginEntriesFromPayload(JSONObject sourcePayload) {
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

        return matchingLoginEntriesFromPayload(sourcePayload, hostname);
    }

    private static List<JSONObject> matchingLoginEntriesFromPayload(JSONObject sourcePayload, String hostname) {
        String host = normalizeDomain(hostname);
        List<JSONObject> matches = new ArrayList<>();
        for (JSONObject entry : loginEntriesFromPayload(sourcePayload)) {
            JSONArray domains = entry.optJSONArray("domains");
            for (int index = 0; domains != null && index < domains.length(); index += 1) {
                String domain = domains.optString(index);
                if (domainMatches(host, domain)) {
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
        private final Set<String> ambiguousIds = new HashSet<>();
        private final List<JSONObject> loginEntries = new ArrayList<>();
        private final Map<String, List<JSONObject>> exactDomainEntries = new HashMap<>();
        private final List<JSONObject> wildcardEntries = new ArrayList<>();

        static VaultSessionIndex build(JSONArray entries) {
            VaultSessionIndex index = new VaultSessionIndex();
            index.visit(entries);
            return index;
        }

        JSONObject getLogin(String entryId) {
            if (entryId == null || ambiguousIds.contains(entryId)) return null;
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

            List<JSONObject> matches = new ArrayList<>();
            if (candidateIds.isEmpty()) return matches;
            for (JSONObject entry : loginEntries) {
                String id = entry.optString("id");
                if (candidateIds.contains(id) && !ambiguousIds.contains(id)) matches.add(entry);
            }
            return matches;
        }

        private void visit(JSONArray entries) {
            for (int index = 0; entries != null && index < entries.length(); index += 1) {
                JSONObject entry = entries.optJSONObject(index);
                if (entry == null) continue;

                String id = entry.optString("id");
                if (!id.isEmpty()) {
                    if (entriesById.containsKey(id)) ambiguousIds.add(id);
                    else entriesById.put(id, entry);
                }

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
