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
import android.text.InputType;
import android.util.Log;
import android.util.Pair;
import android.view.View;
import android.view.ViewStructure;
import android.view.autofill.AutofillId;
import android.view.autofill.AutofillManager;
import android.view.autofill.AutofillValue;
import android.webkit.JavascriptInterface;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
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

    private LoginFields inspectStructure(AssistStructure structure) {
        LoginFields fields = new LoginFields();
        if (structure.getActivityComponent() != null) {
            fields.targetPackageName = structure.getActivityComponent().getPackageName();
        }
        for (int i = 0; i < structure.getWindowNodeCount(); i++) {
            inspectNode(structure.getWindowNodeAt(i).getRootViewNode(), fields);
        }
        return fields;
    }

    private void inspectNode(AssistStructure.ViewNode node, LoginFields fields) {
        if (node == null) return;
        if (fields.hostname == null && node.getWebDomain() != null) {
            fields.hostname = node.getWebDomain();
        }
        AutofillId id = node.getAutofillId();
        if (id != null) {
            String text = nodeText(node);
            String[] hints = node.getAutofillHints();
            int inputType = node.getInputType();
            boolean passwordField = isPasswordHint(hints) || containsPassword(text) || isPasswordInputType(inputType);
            boolean usernameField = isUsernameHint(hints) || containsUsername(text);
            
            if (fields.passwordId == null && passwordField) {
                fields.markPassword(id);
            } else {
                if (isTextCandidate(node.getAutofillType(), inputType)) fields.addTextCandidate(id);
                if (fields.usernameId == null && usernameField) {
                    fields.usernameId = id;
                }
            }
        }
        for (int i = 0; i < node.getChildCount(); i++) {
            inspectNode(node.getChildAt(i), fields);
        }
    }

    private String nodeText(AssistStructure.ViewNode node) {
        StringBuilder builder = new StringBuilder();
        append(builder, node.getHint());
        append(builder, node.getIdEntry());
        append(builder, node.getClassName());
        append(builder, node.getContentDescription() == null ? null : node.getContentDescription().toString());
        append(builder, node.getText() == null ? null : node.getText().toString());
        appendHtmlInfo(builder, node.getHtmlInfo());
        String[] hints = node.getAutofillHints();
        if (hints != null) {
            for (String hint : hints) append(builder, hint);
        }
        return builder.toString().toLowerCase(Locale.ROOT);
    }

    private void append(StringBuilder builder, String value) {
        if (value != null) builder.append(value).append(' ');
    }

    private void appendHtmlInfo(StringBuilder builder, ViewStructure.HtmlInfo htmlInfo) {
        if (htmlInfo == null) return;
        append(builder, htmlInfo.getTag());
        List<Pair<String, String>> attrs = htmlInfo.getAttributes();
        if (attrs == null) return;
        for (Pair<String, String> attr : attrs) {
            append(builder, attr.first);
            append(builder, attr.second);
        }
    }

    private boolean isUsernameHint(String[] hints) {
        if (hints == null) return false;
        for (String h : hints) {
            String low = h.toLowerCase(Locale.ROOT);
            if (low.contains("username") || low.contains("email")) return true;
        }
        return false;
    }

    private boolean isPasswordHint(String[] hints) {
        if (hints == null) return false;
        for (String h : hints) {
            if (h.toLowerCase(Locale.ROOT).contains("password")) return true;
        }
        return false;
    }

    private boolean containsUsername(String text) {
        return text.contains("user")
            || text.contains("login")
            || text.contains("email")
            || text.contains("mail")
            || text.contains("account")
            || text.contains("phone")
            || text.contains("mobile")
            || text.contains("tel")
            || text.contains("username")
            || text.contains("用户名")
            || text.contains("账号")
            || text.contains("账户")
            || text.contains("邮箱")
            || text.contains("手机");
    }

    private boolean containsPassword(String text) {
        return text.contains("password")
            || text.contains("pass")
            || text.contains("passcode")
            || text.contains("passwd")
            || text.contains("psw")
            || text.contains("pwd")
            || text.contains("密码");
    }

    private boolean isPasswordInputType(int inputType) {
        int klass = inputType & InputType.TYPE_MASK_CLASS;
        int variation = inputType & InputType.TYPE_MASK_VARIATION;
        return (klass == InputType.TYPE_CLASS_TEXT
            && (variation == InputType.TYPE_TEXT_VARIATION_PASSWORD
                || variation == InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD
                || variation == InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD))
            || (klass == InputType.TYPE_CLASS_NUMBER && variation == InputType.TYPE_NUMBER_VARIATION_PASSWORD);
    }

    private boolean isTextCandidate(int autofillType, int inputType) {
        int klass = inputType & InputType.TYPE_MASK_CLASS;
        return autofillType == View.AUTOFILL_TYPE_TEXT
            || klass == InputType.TYPE_CLASS_TEXT
            || klass == InputType.TYPE_CLASS_NUMBER
            || klass == InputType.TYPE_CLASS_PHONE
            || inputType == 0;
    }

    private static class LoginFields {
        AutofillId usernameId;
        AutofillId passwordId;
        AutofillId textBeforePasswordId;
        List<AutofillId> textCandidates = new ArrayList<>();
        String hostname;
        String targetPackageName;

        void finish() {
            if (passwordId != null && usernameId == null) {
                usernameId = nearestBefore(passwordId);
            }
            if (usernameId == null && textBeforePasswordId != null) {
                usernameId = textBeforePasswordId;
            }
            if (usernameId == null && textCandidates.size() >= 2) {
                usernameId = firstTextExcept(passwordId);
            }
            if (usernameId == null) {
                usernameId = lastTextExcept(passwordId);
            }
            if (passwordId == null && usernameId != null) {
                passwordId = nearestAfter(usernameId);
            }
            if (passwordId == null && usernameId != null) {
                passwordId = nearestBefore(usernameId);
            }
            if (passwordId == null) {
                passwordId = lastTextExcept(usernameId);
            }

            if (passwordId != null && passwordId.equals(usernameId)) {
                passwordId = null;
            }
        }

        void markPassword(AutofillId id) {
            passwordId = id;
            if (!textCandidates.isEmpty()) {
                textBeforePasswordId = textCandidates.get(textCandidates.size() - 1);
            }
        }

        void addTextCandidate(AutofillId id) {
            if (id == null || id.equals(passwordId) || textCandidates.contains(id)) return;
            textCandidates.add(id);
        }

        private AutofillId nearestAfter(AutofillId anchor) {
            if (anchor == null) return null;
            boolean seenAnchor = false;
            for (AutofillId candidate : textCandidates) {
                if (candidate.equals(anchor)) {
                    seenAnchor = true;
                    continue;
                }
                if (!seenAnchor) continue;
                return candidate;
            }
            return null;
        }

        private AutofillId nearestBefore(AutofillId anchor) {
            if (anchor == null) return null;
            AutofillId previous = null;
            for (AutofillId candidate : textCandidates) {
                if (candidate.equals(anchor)) return previous;
                previous = candidate;
            }
            return null;
        }

        private AutofillId firstTextExcept(AutofillId excluded) {
            for (AutofillId candidate : textCandidates) {
                if (candidate.equals(excluded)) continue;
                return candidate;
            }
            return null;
        }

        private AutofillId lastTextExcept(AutofillId excluded) {
            for (int index = textCandidates.size() - 1; index >= 0; index -= 1) {
                AutofillId candidate = textCandidates.get(index);
                if (candidate.equals(excluded)) continue;
                return candidate;
            }
            return null;
        }

        String hostnameOrPackage() {
            return hostname != null && !hostname.trim().isEmpty() ? hostname : (targetPackageName != null ? targetPackageName : "");
        }

        boolean isOwnPackage(String packageName) {
            return packageName != null && packageName.equals(targetPackageName);
        }

        void setNullValues(Dataset.Builder builder) {
            if (usernameId != null) builder.setValue(usernameId, (AutofillValue) null);
            if (passwordId != null) builder.setValue(passwordId, (AutofillValue) null);
        }

        AutofillId[] autofillIds() {
            List<AutofillId> ids = new ArrayList<>();
            if (usernameId != null) ids.add(usernameId);
            if (passwordId != null) ids.add(passwordId);
            return ids.toArray(new AutofillId[0]);
        }

        void writeToIntent(Intent intent) {
            intent.putExtra(AutofillPickerActivity.EXTRA_HOSTNAME, hostname);
            intent.putExtra(AutofillPickerActivity.EXTRA_TARGET_PACKAGE, targetPackageName);
            if (usernameId != null) intent.putExtra(AutofillPickerActivity.EXTRA_USERNAME_ID, usernameId);
            if (passwordId != null) intent.putExtra(AutofillPickerActivity.EXTRA_PASSWORD_ID, passwordId);
        }

        boolean shouldFallbackToAllMatches() {
            return (hostname == null || hostname.trim().isEmpty()) && PwdAutofillService.isLikelyBrowserPackage(targetPackageName);
        }

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
