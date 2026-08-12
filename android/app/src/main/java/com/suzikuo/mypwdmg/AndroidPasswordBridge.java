package com.suzikuo.mypwdmg;

import android.app.Activity;
import android.app.assist.AssistStructure;
import android.content.ActivityNotFoundException;
import android.content.ComponentName;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.service.autofill.Dataset;
import android.service.autofill.FillResponse;
import android.util.Log;
import android.view.autofill.AutofillId;
import android.view.autofill.AutofillManager;
import android.webkit.JavascriptInterface;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.Arrays;
import java.util.Base64;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

public final class AndroidPasswordBridge {
    private static final String TAG = "PwdAutofillBridge";
    static final int ATTACHMENT_EXPORT_REQUEST_CODE = 7431;
    private static final int VAULT_EXPORT_REQUEST_CODE = 7432;
    private static final int MAX_VAULT_EXPORT_BYTES = 24 * 1024 * 1024;
    private static final long DOCUMENT_EXPORT_TIMEOUT_MINUTES = 5;
    private final Activity activity;
    private final AndroidVaultStore store;
    private final AndroidAttachmentStore attachmentStore;
    private final AndroidUpdateManager updater;
    private final ExecutorService updateExecutor = Executors.newSingleThreadExecutor();
    private final ExecutorService documentIoExecutor = Executors.newSingleThreadExecutor();
    private final ScheduledExecutorService documentExportTimeoutExecutor = Executors.newSingleThreadScheduledExecutor();
    private final Map<String, UpdateTask> updateTasks = new ConcurrentHashMap<>();
    private final Map<String, DocumentExportTask> documentExportTasks = new ConcurrentHashMap<>();

    AndroidPasswordBridge(Activity activity) {
        this.activity = activity;
        this.store = new AndroidVaultStore(activity);
        this.attachmentStore = new AndroidAttachmentStore(new java.io.File(activity.getFilesDir(), "attachments"));
        this.updater = new AndroidUpdateManager(activity);
    }

    @JavascriptInterface
    public String getState() {
        return result(() -> store.state());
    }

    @JavascriptInterface
    public String getStorageState() {
        return result(() -> store.storageState());
    }

    @JavascriptInterface
    public String getAppInfo() {
        return result(() -> new JSONObject()
            .put("version", BuildConfig.VERSION_NAME)
            .put("versionCode", BuildConfig.VERSION_CODE)
            .put("platform", "android"));
    }

    @JavascriptInterface
    public String setSystemBarsTheme(String theme) {
        return result(() -> {
            if (activity instanceof MainActivity) {
                activity.runOnUiThread(() -> ((MainActivity) activity).applySystemBarsTheme(theme));
            }
            return new JSONObject().put("theme", theme == null ? "" : theme);
        });
    }

    @JavascriptInterface
    public String readVaultEnvelope() {
        return result(() -> store.readVaultEnvelope());
    }

    @JavascriptInterface
    public String writeVaultEnvelope(String envelopeText, boolean protectBackup, long expectedRevision) {
        return result(() -> store.writeVaultEnvelope(envelopeText, protectBackup, expectedRevision));
    }

    @JavascriptInterface
    public String readLegacyLocalStorage() {
        return result(() -> store.readLegacyLocalStorage());
    }

    @JavascriptInterface
    public String getAttachmentStorageState() {
        return result(() -> attachmentStore.state());
    }

    @JavascriptInterface
    public String readAttachmentObject(String attachmentId) {
        return result(() -> attachmentStore.read(attachmentId));
    }

    @JavascriptInterface
    public String writeAttachmentObject(String attachmentId, String objectText) {
        return result(() -> attachmentStore.write(attachmentId, objectText));
    }

    @JavascriptInterface
    public String retainAttachmentObject(String attachmentId) {
        return result(() -> attachmentStore.retain(attachmentId));
    }

    @JavascriptInterface
    public String collectAttachmentObjects(String referencedIdsJson) {
        return result(() -> attachmentStore.collect(referencedIdsJson));
    }

    @JavascriptInterface
    public String startAttachmentExport(String displayName, String mimeType, String contentBase64) {
        return result(() -> startDocumentExportTask(
            displayName, mimeType, contentBase64, AndroidAttachmentStore.MAX_ATTACHMENT_FILE_BYTES,
            ATTACHMENT_EXPORT_REQUEST_CODE, "ATTACHMENT_EXPORT_FAILED"
        ));
    }

    @JavascriptInterface
    public String getAttachmentExportTaskState(String taskId) {
        return result(() -> getDocumentExportTaskState(taskId));
    }

    @JavascriptInterface
    public String startVaultExport(String displayName, String mimeType, String contentBase64) {
        return result(() -> startDocumentExportTask(
            displayName, mimeType, contentBase64, MAX_VAULT_EXPORT_BYTES,
            VAULT_EXPORT_REQUEST_CODE, "VAULT_EXPORT_FAILED"
        ));
    }

    @JavascriptInterface
    public String getVaultExportTaskState(String taskId) {
        return result(() -> getDocumentExportTaskState(taskId));
    }

    @JavascriptInterface
    public String createVault(String password, boolean importLegacy) {
        return result(() -> {
            JSONObject res = store.createVault(password, importLegacy);
            checkAndHandleAutofillAuth();
            return res;
        });
    }

    @JavascriptInterface
    public String unlock(String password) {
        return result(() -> {
            JSONObject res = store.unlock(password);
            checkAndHandleAutofillAuth();
            return res;
        });
    }

    private void checkAndHandleAutofillAuth() {
        if (!(activity instanceof MainActivity)) return;
        if (activity.getIntent().getBooleanExtra(MainActivity.EXTRA_AUTOFILL_PICKER, false)) return;
        AssistStructure structure = ((MainActivity) activity).getAutofillStructure();
        if (structure == null) return;

        Log.d(TAG, "Handling Autofill Auth completion");
        try {
            PwdAutofillService.LoginFields fields = PwdAutofillService.inspectStructure(structure);
            fields.finish();

            if (fields.isOwnPackage(activity.getPackageName())) {
                Log.d(TAG, "Skipping Autofill Auth completion for own app");
                return;
            }

            JSONObject payload = store.getVault();
            boolean includeAll = fields.shouldFallbackToAllMatches();
            JSONArray matches = store.queryMatchesFromPayload(payload, fields.hostnameOrPackage(), includeAll);

            if (matches.length() > 0) {
                FillResponse.Builder responseBuilder = new FillResponse.Builder();
                int datasetCount = addDirectDatasets(responseBuilder, payload, fields, matches);
                if (datasetCount == 0) {
                    Log.d(TAG, "No direct datasets during Autofill Auth completion");
                    return;
                }
                configureFillDialog(responseBuilder, fields);

                Intent result = new Intent();
                result.putExtra(AutofillManager.EXTRA_AUTHENTICATION_RESULT, responseBuilder.build());
                activity.setResult(Activity.RESULT_OK, result);
                Log.d(TAG, "Autofill result set, finishing activity");
                activity.finish();
            } else {
                Log.d(TAG, "No matches found during Autofill Auth completion");
            }
        } catch (Exception e) {
            Log.e(TAG, "Error handling Autofill Auth", e);
        }
    }

    private Dataset buildDataset(PwdAutofillService.LoginFields fields, JSONObject match, JSONObject fill) {
        return PwdAutofillService.buildDataset(activity, fields, match, fill, PwdAutofillService.labelFor(match));
    }

    private int addDirectDatasets(FillResponse.Builder response, JSONObject payload, PwdAutofillService.LoginFields fields, JSONArray matches) {
        int added = 0;
        for (int index = 0; index < matches.length(); index += 1) {
            try {
                JSONObject match = matches.getJSONObject(index);
                String entryId = match.optString("id");
                if (entryId.isEmpty()) {
                    Log.d(TAG, "Skipping auth match without id");
                    continue;
                }

                JSONObject fill = store.getFillPayloadFromPayload(payload, entryId);
                Dataset dataset = buildDataset(fields, match, fill);
                if (dataset == null) {
                    Log.d(TAG, "Skipping auth empty dataset. usernameId=" + (fields.usernameId != null)
                        + ", passwordId=" + (fields.passwordId != null)
                        + ", hasUsername=" + !fill.optString("username").isEmpty()
                        + ", hasPhone=" + !fill.optString("phone").isEmpty()
                        + ", hasPassword=" + !fill.optString("password").isEmpty());
                    continue;
                }

                response.addDataset(dataset);
                added += 1;
            } catch (Exception error) {
                Log.w(TAG, "Could not build auth dataset for match " + index, error);
            }
        }
        Log.d(TAG, "Added " + added + " direct auth datasets");
        return added;
    }

    private void configureFillDialog(FillResponse.Builder response, PwdAutofillService.LoginFields fields) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return;
        AutofillId[] ids = fields.autofillIds();
        if (ids.length == 0) return;
        response.setDialogHeader(PwdAutofillService.presentation(activity, "选择 My Password 账号"));
        response.setFillDialogTriggerIds(ids);
    }

    @JavascriptInterface
    public String lock() {
        return result(() -> {
            store.lock();
            return store.state();
        });
    }

    @JavascriptInterface
    public String getVault() {
        return result(() -> store.getVault());
    }

    @JavascriptInterface
    public String saveVault(String payloadJson) {
        return result(() -> store.saveVault(new JSONObject(payloadJson)));
    }

    @JavascriptInterface
    public String deletePasskey(String passkeyId) {
        return result(() -> store.deletePasskeyForWeb(passkeyId));
    }

    @JavascriptInterface
    public String changePassword(String newPassword) {
        return result(() -> store.changePassword(newPassword));
    }

    @JavascriptInterface
    public String exportVaultBackup() {
        return result(() -> store.exportBackup());
    }

    @JavascriptInterface
    public String exportVaultBackupForPayload(String payloadJson) {
        return result(() -> store.exportBackupForPayload(new JSONObject(payloadJson)));
    }

    @JavascriptInterface
    public String previewVaultBackup(String envelopeText) {
        return result(() -> store.previewBackup(envelopeText));
    }

    @JavascriptInterface
    public String previewVaultBackupWithPassword(String envelopeText, String password) {
        return result(() -> store.previewBackupWithPassword(envelopeText, password));
    }

    @JavascriptInterface
    public String importVaultBackup(String envelopeText) {
        return result(() -> store.importBackup(envelopeText));
    }

    @JavascriptInterface
    public String queryMatches(String hostname) {
        return result(() -> store.queryMatches(hostname));
    }

    @JavascriptInterface
    public String getFillPayload(String entryId) {
        return result(() -> store.getFillPayload(entryId));
    }

    @JavascriptInterface
    public String getAutofillLaunchContext() {
        return result(this::autofillLaunchContext);
    }

    @JavascriptInterface
    public String completeAutofillWithEntry(String entryId) {
        return result(() -> {
            if (!activity.getIntent().getBooleanExtra(MainActivity.EXTRA_AUTOFILL_PICKER, false)) {
                throw new IllegalStateException("Not an autofill picker launch");
            }
            PwdAutofillService.LoginFields fields = autofillFieldsFromIntent(activity.getIntent());
            if (!fields.hasFillableFields()) {
                throw new IllegalStateException("No fillable fields");
            }

            JSONObject payload = store.getVault();
            JSONObject fill = store.getFillPayloadFromPayload(payload, entryId);
            JSONObject match = findAutofillMatch(payload, fields, entryId);
            if (match == null) match = fill;
            Dataset dataset = PwdAutofillService.buildDataset(activity, fields, match, fill, PwdAutofillService.labelFor(match));
            if (dataset == null) {
                throw new IllegalStateException("No dataset was built");
            }

            Intent result = new Intent();
            result.putExtra(AutofillManager.EXTRA_AUTHENTICATION_RESULT, dataset);
            activity.setResult(Activity.RESULT_OK, result);
            activity.runOnUiThread(activity::finish);
            return new JSONObject().put("filled", true);
        });
    }

    @JavascriptInterface
    public String generateTotp(String entryId) {
        return result(() -> store.generateTotp(entryId));
    }

    @JavascriptInterface
    public String getAutofillState() {
        return result(this::autofillState);
    }

    @JavascriptInterface
    public String openAutofillSettings() {
        return result(() -> {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
                throw new IllegalStateException("Android 8.0 以下不支持系统自动填充服务");
            }

            ComponentName service = new ComponentName(activity, PwdAutofillService.class);
            Intent intent = new Intent(Settings.ACTION_REQUEST_SET_AUTOFILL_SERVICE)
                .putExtra("android.provider.extra.AUTOFILL_SERVICE", service.flattenToString());

            activity.runOnUiThread(() -> {
                try {
                    activity.startActivity(intent);
                } catch (ActivityNotFoundException error) {
                    activity.startActivity(new Intent(Settings.ACTION_SETTINGS));
                }
            });
            return autofillState();
        });
    }

    @JavascriptInterface
    public String getPasskeyProviderState() {
        return result(() -> PasskeyProviderSettings.state(activity));
    }

    @JavascriptInterface
    public String setPasskeyProviderEnabled(boolean enabled) {
        return result(() -> PasskeyProviderSettings.setComponentEnabled(activity, enabled));
    }

    @JavascriptInterface
    public String openPasskeyProviderSettings() {
        return result(() -> PasskeyProviderSettings.openSystemSettings(activity));
    }

    @JavascriptInterface
    public String checkAppUpdate(String manifestUrl) {
        return result(() -> updater.check(manifestUrl));
    }

    @JavascriptInterface
    public String downloadAppUpdate(String manifestUrl) {
        return result(() -> updater.download(manifestUrl));
    }

    @JavascriptInterface
    public String startUpdateTask(String action, String value) {
        return result(() -> {
            String normalizedAction = action == null ? "" : action.trim().toLowerCase(Locale.ROOT);
            if (!normalizedAction.equals("check") && !normalizedAction.equals("download")) {
                throw new IllegalArgumentException("Unsupported update task: " + action);
            }

            UpdateTask task = new UpdateTask(normalizedAction);
            updateTasks.put(task.id, task);
            Future<?> future = updateExecutor.submit(() -> runUpdateTask(task, value));
            task.setFuture(future);
            return task.toJson();
        });
    }

    @JavascriptInterface
    public String getUpdateTaskState(String taskId) {
        return result(() -> {
            UpdateTask task = updateTasks.get(taskId);
            if (task == null) throw new IllegalArgumentException("Update task was not found");
            JSONObject state = task.toJson();
            if (task.isFinished()) updateTasks.remove(taskId);
            return state;
        });
    }

    @JavascriptInterface
    public String applyAppUpdate(String packagePath) {
        return result(() -> updater.apply(packagePath));
    }

    @JavascriptInterface
    public String safeExit() {
        store.lock();
        activity.runOnUiThread(() -> {
            if (android.os.Build.VERSION.SDK_INT >= 21) {
                activity.finishAndRemoveTask();
            } else {
                activity.finish();
            }
        });
        return ok(JSONObject.NULL);
    }

    void handleActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode != ATTACHMENT_EXPORT_REQUEST_CODE && requestCode != VAULT_EXPORT_REQUEST_CODE) return;
        DocumentExportTask task = null;
        for (DocumentExportTask candidate : documentExportTasks.values()) {
            if (candidate.requestCode == requestCode && candidate.isWaiting()) {
                task = candidate;
                break;
            }
        }
        if (task == null) return;
        if (resultCode != Activity.RESULT_OK || data == null || data.getData() == null) {
            task.complete(false, "");
            return;
        }
        task.beginWriting();
        DocumentExportTask selected = task;
        documentIoExecutor.submit(() -> writeDocumentExport(selected, data.getData()));
    }

    void close() {
        for (DocumentExportTask task : documentExportTasks.values()) task.fail("CANCELLED", "Document export was cancelled");
        updateExecutor.shutdownNow();
        documentIoExecutor.shutdownNow();
        documentExportTimeoutExecutor.shutdownNow();
    }

    private JSONObject autofillState() throws Exception {
        boolean supported = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O;
        boolean enabled = false;
        if (supported) {
            AutofillManager manager = activity.getSystemService(AutofillManager.class);
            enabled = manager != null && manager.hasEnabledAutofillServices();
        }
        return new JSONObject()
            .put("supported", supported)
            .put("enabled", enabled)
            .put("serviceName", new ComponentName(activity, PwdAutofillService.class).flattenToString())
            .put("settingsAvailable", supported);
    }

    private JSONObject startDocumentExportTask(
        String displayName,
        String mimeType,
        String contentBase64,
        int maxBytes,
        int requestCode,
        String failureCode
    ) throws Exception {
        for (Map.Entry<String, DocumentExportTask> entry : documentExportTasks.entrySet()) {
            DocumentExportTask task = entry.getValue();
            if (task.isFinished()) {
                documentExportTasks.remove(entry.getKey(), task);
                continue;
            }
            throw new IllegalStateException("Another document export is already running");
        }
        byte[] content = decodeExportContent(contentBase64, maxBytes);
        String name = normalizeExportName(displayName);
        String type = normalizeExportMimeType(mimeType);
        DocumentExportTask task = new DocumentExportTask(name, type, content, requestCode, failureCode);
        documentExportTasks.put(task.id, task);
        try {
            task.setTimeoutFuture(documentExportTimeoutExecutor.schedule(
                () -> task.fail("DOCUMENT_EXPORT_TIMEOUT", "Document export timed out"),
                DOCUMENT_EXPORT_TIMEOUT_MINUTES,
                TimeUnit.MINUTES
            ));
            Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT)
                .addCategory(Intent.CATEGORY_OPENABLE)
                .setType(type)
                .putExtra(Intent.EXTRA_TITLE, name);
            activity.runOnUiThread(() -> {
                try {
                    activity.startActivityForResult(intent, requestCode);
                } catch (Exception error) {
                    task.fail(failureCode, error.getMessage());
                }
            });
            return task.toJson();
        } catch (Exception error) {
            task.fail(failureCode, error.getMessage());
            throw error;
        }
    }

    private JSONObject getDocumentExportTaskState(String taskId) throws Exception {
        DocumentExportTask task = documentExportTasks.get(taskId == null ? "" : taskId);
        if (task == null) throw new IllegalArgumentException("Document export task was not found");
        JSONObject state = task.toJson();
        if (task.isFinished()) documentExportTasks.remove(task.id, task);
        return state;
    }

    private void writeDocumentExport(DocumentExportTask task, Uri uri) {
        byte[] content = task.takeContent();
        if (content == null) {
            task.fail(task.failureCode, "Document content is unavailable");
            return;
        }
        try (java.io.OutputStream output = activity.getContentResolver().openOutputStream(uri, "w")) {
            if (output == null) throw new IllegalStateException("Could not open selected file");
            output.write(content);
            output.flush();
            task.complete(true, uri.toString());
        } catch (Exception error) {
            task.fail(task.failureCode, error.getMessage());
        } finally {
            Arrays.fill(content, (byte) 0);
        }
    }

    private static byte[] decodeExportContent(String contentBase64, int maxBytes) {
        String value = contentBase64 == null ? "" : contentBase64;
        if (value.length() > ((maxBytes + 2) / 3) * 4 + 4) {
            throw new IllegalArgumentException("Document is too large");
        }
        byte[] content;
        try {
            content = Base64.getDecoder().decode(value);
        } catch (IllegalArgumentException error) {
            throw new IllegalArgumentException("Document content is invalid", error);
        }
        if (content.length > maxBytes) {
            Arrays.fill(content, (byte) 0);
            throw new IllegalArgumentException("Document is too large");
        }
        return content;
    }

    private static String normalizeExportName(String value) {
        String name = String.valueOf(value == null ? "" : value).replace('\\', '/');
        int slash = name.lastIndexOf('/');
        if (slash >= 0) name = name.substring(slash + 1);
        name = name.replace("\u0000", "").trim();
        if (name.isEmpty()) name = "document";
        if (name.length() > 255 || ".".equals(name) || "..".equals(name)) throw new IllegalArgumentException("Document name is invalid");
        return name;
    }

    private static String normalizeExportMimeType(String value) {
        String mimeType = String.valueOf(value == null ? "" : value).trim().toLowerCase(Locale.ROOT);
        if (mimeType.length() > 127 || !mimeType.matches("[a-z0-9][a-z0-9!#$&^_.+-]*/[a-z0-9][a-z0-9!#$&^_.+-]*")) {
            return "application/octet-stream";
        }
        return mimeType;
    }

    private JSONObject autofillLaunchContext() throws Exception {
        Intent intent = activity.getIntent();
        boolean active = intent.getBooleanExtra(MainActivity.EXTRA_AUTOFILL_PICKER, false);
        if (!active) return new JSONObject().put("active", false);
        PwdAutofillService.LoginFields fields = autofillFieldsFromIntent(intent);
        String target = intent.getStringExtra(AutofillPickerActivity.EXTRA_TARGET);
        if (target == null || target.trim().isEmpty()) target = fields.hostnameOrPackage();
        boolean includeAll = intent.getBooleanExtra(AutofillPickerActivity.EXTRA_INCLUDE_ALL, fields.shouldFallbackToAllMatches());
        boolean targetIsOnlyBrowserPackage = includeAll && (fields.hostname == null || fields.hostname.trim().isEmpty());
        return new JSONObject()
            .put("active", true)
            .put("target", target)
            .put("searchTerm", targetIsOnlyBrowserPackage ? "" : PwdAutofillService.searchTermForTarget(target))
            .put("includeAll", includeAll);
    }

    private PwdAutofillService.LoginFields autofillFieldsFromIntent(Intent intent) {
        PwdAutofillService.LoginFields fields = new PwdAutofillService.LoginFields();
        fields.hostname = intent.getStringExtra(AutofillPickerActivity.EXTRA_HOSTNAME);
        fields.targetPackageName = intent.getStringExtra(AutofillPickerActivity.EXTRA_TARGET_PACKAGE);
        fields.usernameId = AndroidIntentCompat.getParcelableExtra(intent, AutofillPickerActivity.EXTRA_USERNAME_ID, AutofillId.class);
        fields.passwordId = AndroidIntentCompat.getParcelableExtra(intent, AutofillPickerActivity.EXTRA_PASSWORD_ID, AutofillId.class);
        fields.otpId = AndroidIntentCompat.getParcelableExtra(intent, AutofillPickerActivity.EXTRA_OTP_ID, AutofillId.class);
        fields.usernameKind = intent.getStringExtra(AutofillPickerActivity.EXTRA_ACCOUNT_KIND);
        if (fields.usernameKind == null || fields.usernameKind.trim().isEmpty()) {
            fields.usernameKind = PwdAutofillService.ACCOUNT_KIND_GENERIC;
        }
        return fields;
    }

    private JSONObject findAutofillMatch(JSONObject payload, PwdAutofillService.LoginFields fields, String entryId) throws Exception {
        Intent intent = activity.getIntent();
        String target = intent.getStringExtra(AutofillPickerActivity.EXTRA_TARGET);
        if (target == null || target.trim().isEmpty()) target = fields.hostnameOrPackage();
        boolean includeAll = intent.getBooleanExtra(AutofillPickerActivity.EXTRA_INCLUDE_ALL, fields.shouldFallbackToAllMatches());
        JSONArray matches = store.queryMatchesFromPayload(payload, target, includeAll);
        for (int index = 0; index < matches.length(); index += 1) {
            JSONObject match = matches.getJSONObject(index);
            if (entryId.equals(match.optString("id"))) return match;
        }
        return null;
    }

    private String result(BridgeCall call) {
        try {
            return ok(call.run());
        } catch (AndroidVaultStore.LockedException error) {
            return error("LOCKED", error.getMessage());
        } catch (AndroidVaultStore.BadPasswordException error) {
            return error("BAD_PASSWORD", error.getMessage());
        } catch (AndroidVaultStore.ConflictException error) {
            return error("CONFLICT", error.getMessage());
        } catch (Exception error) {
            return error("ERROR", error.getMessage());
        }
    }

    private String ok(Object data) {
        try {
            return new JSONObject()
                .put("ok", true)
                .put("data", data == null ? JSONObject.NULL : data)
                .toString();
        } catch (Exception error) {
            return error("ERROR", error.getMessage());
        }
    }

    private String error(String code, String message) {
        try {
            return new JSONObject()
                .put("ok", false)
                .put("code", code)
                .put("message", message == null ? "" : message)
                .toString();
        } catch (Exception ignored) {
            return "{\"ok\":false,\"code\":\"ERROR\",\"message\":\"JSON error\"}";
        }
    }

    private interface BridgeCall {
        Object run() throws Exception;
    }

    private static final class DocumentExportTask {
        final String id = UUID.randomUUID().toString();
        final String name;
        final String mimeType;
        final int requestCode;
        final String failureCode;
        private byte[] content;
        private Future<?> timeoutFuture;
        private String status = "waiting";
        private JSONObject result;
        private String errorCode = "";
        private String errorMessage = "";

        DocumentExportTask(String name, String mimeType, byte[] content, int requestCode, String failureCode) {
            this.name = name;
            this.mimeType = mimeType;
            this.content = content;
            this.requestCode = requestCode;
            this.failureCode = failureCode;
        }

        synchronized boolean isWaiting() {
            return "waiting".equals(status);
        }

        synchronized boolean isFinished() {
            return "done".equals(status) || "error".equals(status);
        }

        synchronized void setTimeoutFuture(Future<?> future) {
            if (isFinished()) {
                future.cancel(false);
                return;
            }
            timeoutFuture = future;
        }

        synchronized void beginWriting() {
            if (!"waiting".equals(status)) return;
            status = "running";
            cancelTimeout();
        }

        synchronized byte[] takeContent() {
            byte[] value = content;
            content = null;
            return value;
        }

        synchronized void complete(boolean saved, String path) {
            if (isFinished()) return;
            cancelTimeout();
            try {
                JSONObject completed = new JSONObject()
                    .put("saved", saved)
                    .put("path", path == null ? "" : path);
                status = "done";
                result = completed;
            } catch (Exception error) {
                status = "error";
                errorCode = failureCode;
                errorMessage = error.getMessage() == null ? "" : error.getMessage();
            }
            if (content != null) {
                Arrays.fill(content, (byte) 0);
                content = null;
            }
        }

        synchronized void fail(String code, String message) {
            if (isFinished()) return;
            cancelTimeout();
            status = "error";
            errorCode = code == null ? failureCode : code;
            errorMessage = message == null ? "" : message;
            if (content != null) {
                Arrays.fill(content, (byte) 0);
                content = null;
            }
        }

        private void cancelTimeout() {
            if (timeoutFuture == null) return;
            timeoutFuture.cancel(false);
            timeoutFuture = null;
        }

        synchronized JSONObject toJson() throws Exception {
            JSONObject state = new JSONObject()
                .put("id", id)
                .put("name", name)
                .put("mimeType", mimeType)
                .put("status", status);
            if (result != null) state.put("result", result);
            if (!errorCode.isEmpty()) state.put("errorCode", errorCode);
            if (!errorMessage.isEmpty()) state.put("errorMessage", errorMessage);
            return state;
        }
    }

    private void runUpdateTask(UpdateTask task, String value) {
        try {
            task.progress("check", 0, 0, task.action.equals("download") ? "正在检查更新" : "正在获取版本信息");
            JSONObject result;
            if (task.action.equals("download")) {
                result = updater.download(value, task::progress);
            } else {
                result = updater.check(value);
            }
            task.complete(result);
        } catch (Exception error) {
            task.fail("ERROR", error.getMessage());
        }
    }

    private static final class UpdateTask {
        final String id = UUID.randomUUID().toString();
        final String action;
        private Future<?> future;
        private String status = "running";
        private String phase = "check";
        private long downloaded = 0;
        private long total = 0;
        private int progress = 0;
        private String message = "";
        private JSONObject result = null;
        private String errorCode = "";
        private String errorMessage = "";

        UpdateTask(String action) {
            this.action = action;
        }

        synchronized void setFuture(Future<?> future) {
            this.future = future;
        }

        synchronized void progress(String phase, long downloaded, long total, String message) {
            if (!"running".equals(status)) return;
            this.phase = phase == null ? "" : phase;
            this.downloaded = Math.max(0, downloaded);
            this.total = Math.max(0, total);
            if (this.total > 0 && this.downloaded > 0) {
                this.progress = Math.max(1, Math.min(99, (int) ((this.downloaded * 100) / this.total)));
            } else if ("check".equals(this.phase)) {
                this.progress = 8;
            } else if ("verify".equals(this.phase)) {
                this.progress = 96;
            }
            this.message = message == null ? "" : message;
        }

        synchronized void complete(JSONObject result) {
            this.status = "done";
            this.result = result;
            this.progress = 100;
            this.message = "完成";
        }

        synchronized void fail(String code, String message) {
            this.status = "error";
            this.errorCode = code == null ? "ERROR" : code;
            this.errorMessage = message == null ? "" : message;
        }

        synchronized boolean isFinished() {
            return !"running".equals(status) || (future != null && future.isDone());
        }

        synchronized JSONObject toJson() throws Exception {
            JSONObject data = new JSONObject()
                .put("id", id)
                .put("action", action)
                .put("status", status)
                .put("phase", phase)
                .put("downloaded", downloaded)
                .put("total", total)
                .put("progress", progress)
                .put("message", message);
            if (result != null) data.put("result", result);
            if (!errorCode.isEmpty()) data.put("errorCode", errorCode);
            if (!errorMessage.isEmpty()) data.put("errorMessage", errorMessage);
            return data;
        }
    }
}
