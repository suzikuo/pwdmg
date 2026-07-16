package com.suzikuo.mypwdmg;

import android.app.Activity;
import android.app.assist.AssistStructure;
import android.content.ActivityNotFoundException;
import android.content.ComponentName;
import android.content.Intent;
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
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

public final class AndroidPasswordBridge {
    private static final String TAG = "PwdAutofillBridge";
    private final Activity activity;
    private final AndroidVaultStore store;
    private final AndroidUpdateManager updater;
    private final ExecutorService updateExecutor = Executors.newSingleThreadExecutor();
    private final Map<String, UpdateTask> updateTasks = new ConcurrentHashMap<>();

    AndroidPasswordBridge(Activity activity) {
        this.activity = activity;
        this.store = new AndroidVaultStore(activity);
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
    public String writeVaultEnvelope(String envelopeText, boolean protectBackup) {
        return result(() -> store.writeVaultEnvelope(envelopeText, protectBackup));
    }

    @JavascriptInterface
    public String readLegacyLocalStorage() {
        return result(() -> store.readLegacyLocalStorage());
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
        activity.runOnUiThread(() -> {
            if (android.os.Build.VERSION.SDK_INT >= 21) {
                activity.finishAndRemoveTask();
            } else {
                activity.finish();
            }
        });
        return ok(JSONObject.NULL);
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
        fields.usernameId = (AutofillId) intent.getParcelableExtra(AutofillPickerActivity.EXTRA_USERNAME_ID);
        fields.passwordId = (AutofillId) intent.getParcelableExtra(AutofillPickerActivity.EXTRA_PASSWORD_ID);
        fields.otpId = (AutofillId) intent.getParcelableExtra(AutofillPickerActivity.EXTRA_OTP_ID);
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

