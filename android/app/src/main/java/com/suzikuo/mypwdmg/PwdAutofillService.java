package com.suzikuo.mypwdmg;

import android.app.PendingIntent;
import android.app.assist.AssistStructure;
import android.content.Context;
import android.content.Intent;
import android.graphics.drawable.Icon;
import android.os.Build;
import android.os.CancellationSignal;
import android.service.autofill.AutofillService;
import android.service.autofill.Dataset;
import android.service.autofill.FillCallback;
import android.service.autofill.FillContext;
import android.service.autofill.FillRequest;
import android.service.autofill.FillResponse;
import android.service.autofill.InlinePresentation;
import android.service.autofill.SaveCallback;
import android.service.autofill.SaveInfo;
import android.service.autofill.SaveRequest;
import android.text.InputType;
import android.util.Log;
import android.util.Pair;
import android.view.View;
import android.view.ViewStructure;
import android.view.autofill.AutofillId;
import android.view.autofill.AutofillManager;
import android.view.autofill.AutofillValue;
import android.view.inputmethod.InlineSuggestionsRequest;
import android.widget.RemoteViews;
import android.widget.inline.InlinePresentationSpec;

import androidx.autofill.inline.v1.InlineSuggestionUi;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;

public class PwdAutofillService extends AutofillService {
    private static final String TAG = "PwdAutofill";
    static final String ACCOUNT_KIND_GENERIC = AutofillFieldPolicy.ACCOUNT_KIND_GENERIC;
    static final String ACCOUNT_KIND_USERNAME = AutofillFieldPolicy.ACCOUNT_KIND_USERNAME;
    static final String ACCOUNT_KIND_EMAIL = AutofillFieldPolicy.ACCOUNT_KIND_EMAIL;
    static final String ACCOUNT_KIND_PHONE = AutofillFieldPolicy.ACCOUNT_KIND_PHONE;
    private static final String SOURCE_AUTO = "auto";
    private static final String SOURCE_USERNAME = "username";
    private static final String SOURCE_EMAIL = "email";
    private static final String SOURCE_PHONE = "phone";

    @Override
    public void onFillRequest(FillRequest request, CancellationSignal cancellationSignal, FillCallback callback) {
        try {
            List<FillContext> contexts = request.getFillContexts();
            if (contexts.isEmpty()) {
                callback.onSuccess(null);
                return;
            }

            AssistStructure structure = contexts.get(contexts.size() - 1).getStructure();
            LoginFields fields = inspectStructure(structure);
            fields.finish();

            String target = fields.hostnameOrPackage();
            if (BuildConfig.DEBUG) {
                Log.d(TAG, "Fill request for: " + target);
                Log.d(TAG, "Fields found - Username: " + (fields.usernameId != null)
                    + ", Password: " + (fields.passwordId != null)
                    + ", OTP: " + (fields.otpId != null)
                    + ", Candidates: " + fields.candidateCount()
                    + ", UsernameScore: " + fields.usernameScore
                    + ", PasswordScore: " + fields.passwordScore
                    + ", OtpScore: " + fields.otpScore);
            }

            if (fields.isOwnPackage(getPackageName())) {
                if (BuildConfig.DEBUG) {
                    Log.d(TAG, "Skipping autofill for own app");
                }
                callback.onSuccess(null);
                return;
            }

            if (!fields.shouldOfferAutofill()) {
                if (BuildConfig.DEBUG) {
                    Log.d(TAG, "No safely fillable credential fields detected");
                }
                callback.onSuccess(buildSaveOnlyResponse(fields));
                return;
            }

            AndroidVaultStore store = new AndroidVaultStore(this);
            JSONObject payload = store.tryUnlockWithEmptyPasswordForAutofill();
            InlineSuggestionsRequest inlineRequest = activeInlineSuggestionsRequest(request);
            if (payload == null) {
                if (BuildConfig.DEBUG) {
                    Log.d(TAG, "Vault locked, showing unlock suggestion");
                }
                callback.onSuccess(buildUnlockResponse(fields, inlineRequest));
                return;
            }

            boolean includeAll = fields.shouldFallbackToAllMatches();
            JSONArray matches = store.queryMatchesFromPayload(payload, target, includeAll);
            if (BuildConfig.DEBUG) {
                Log.d(TAG, "Found " + matches.length() + " matches for: " + target + ", includeAll=" + includeAll);
            }
            FillResponse.Builder response = new FillResponse.Builder();
            InlineSpecAllocator inlineAllocator = new InlineSpecAllocator(inlineRequest);
            int maxDirectInline = inlineAllocator.maxDirectSuggestions();
            int datasetCount = addDirectDatasets(this, response, store, payload, fields, matches, inlineAllocator, maxDirectInline);
            Dataset pickerDataset = buildPickerDataset(this, fields, target, includeAll, inlineAllocator.nextSpec());
            if (pickerDataset != null) response.addDataset(pickerDataset);
            if (datasetCount == 0 && pickerDataset == null) {
                if (BuildConfig.DEBUG) {
                    Log.d(TAG, "No fillable datasets built");
                }
                callback.onSuccess(buildSaveOnlyResponse(fields));
                return;
            }

            configureFillDialog(this, response, fields, request);
            configureSaveInfo(response, fields);
            callback.onSuccess(response.build());
        } catch (Exception error) {
            Log.e(TAG, "Error in onFillRequest", error);
            callback.onFailure(error.getMessage());
        }
    }

    @Override
    public void onSaveRequest(SaveRequest request, SaveCallback callback) {
        try {
            List<FillContext> contexts = request.getFillContexts();
            if (contexts.isEmpty()) {
                callback.onSuccess();
                return;
            }

            AssistStructure structure = contexts.get(contexts.size() - 1).getStructure();
            LoginFields fields = inspectStructure(structure);
            fields.finish();
            if (fields.isOwnPackage(getPackageName()) || !fields.hasSavableFields()) {
                callback.onSuccess();
                return;
            }

            JSONObject capture = captureLogin(structure, fields);
            if (capture.optString("password").isEmpty()) {
                if (BuildConfig.DEBUG) {
                    Log.d(TAG, "Skipping save request without password");
                }
                callback.onSuccess();
                return;
            }

            AndroidVaultStore store = new AndroidVaultStore(this);
            store.tryUnlockWithEmptyPasswordForAutofill();
            JSONObject saved = store.saveCapturedLogin(capture);
            if (BuildConfig.DEBUG) {
                Log.d(TAG, "Saved captured login: " + saved.optString("action"));
            }
            callback.onSuccess();
        } catch (AndroidVaultStore.LockedException locked) {
            if (BuildConfig.DEBUG) {
                Log.d(TAG, "Skipping save request because vault is locked");
            }
            callback.onSuccess();
        } catch (Exception error) {
            Log.e(TAG, "Error in onSaveRequest", error);
            callback.onFailure(error.getMessage());
        }
    }

    private InlineSuggestionsRequest activeInlineSuggestionsRequest(FillRequest request) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R || request == null) return null;
        if (!AutofillSettings.isInlineEnabled(this)) return null;
        return request.getInlineSuggestionsRequest();
    }

    private FillResponse buildUnlockResponse(LoginFields fields, InlineSuggestionsRequest inlineRequest) {
        Intent intent = new Intent(this, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);

        PendingIntent pendingIntent = PendingIntent.getActivity(
            this,
            1001,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE
        );

        FillResponse.Builder builder = new FillResponse.Builder();
        InlineSpecAllocator inlineAllocator = new InlineSpecAllocator(inlineRequest);
        InlinePresentation inlinePresentation = buildInlinePresentation(
            this,
            inlineAllocator.nextSpec(),
            "解锁 My Password",
            "点击解锁以自动填充",
            pendingIntent
        );
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && inlinePresentation != null) {
            builder.setAuthentication(
                fields.autofillIds(),
                pendingIntent.getIntentSender(),
                presentation(this, "点击解锁 My Password"),
                inlinePresentation
            );
        } else {
            builder.setAuthentication(
                fields.autofillIds(),
                pendingIntent.getIntentSender(),
                presentation(this, "点击解锁 My Password")
            );
        }
        return builder.build();
    }

    private FillResponse buildSaveOnlyResponse(LoginFields fields) {
        if (!fields.hasSavableFields()) return null;
        FillResponse.Builder builder = new FillResponse.Builder();
        configureSaveInfo(builder, fields);
        return builder.build();
    }

    static Dataset buildPickerDataset(
        Context context,
        LoginFields fields,
        String target,
        boolean includeAll,
        InlinePresentationSpec inlineSpec
    ) {
        if (!fields.hasFillableFields()) return null;
        Intent intent = new Intent(context, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        intent.putExtra(MainActivity.EXTRA_AUTOFILL_PICKER, true);
        fields.writeToIntent(intent);
        intent.putExtra(AutofillPickerActivity.EXTRA_TARGET, target);
        intent.putExtra(AutofillPickerActivity.EXTRA_INCLUDE_ALL, includeAll);

        PendingIntent pendingIntent = PendingIntent.getActivity(
            context,
            2001,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE
        );

        RemoteViews menuPresentation = presentation(context, "选择 My Password 账号");
        Dataset.Builder builder = new Dataset.Builder(menuPresentation);
        InlinePresentation inlinePresentation = buildInlinePresentation(
            context,
            inlineSpec,
            "选择账号",
            "My Password",
            pendingIntent
        );
        fields.setNullValues(builder, menuPresentation, inlinePresentation);
        builder.setAuthentication(pendingIntent.getIntentSender());
        return builder.build();
    }

    static void configureSaveInfo(FillResponse.Builder response, LoginFields fields) {
        AutofillId[] ids = fields.saveIds();
        if (ids.length == 0) return;
        response.setSaveInfo(new SaveInfo.Builder(SaveInfo.SAVE_DATA_TYPE_PASSWORD, ids).build());
    }

    static int addDirectDatasets(
        Context context,
        FillResponse.Builder response,
        AndroidVaultStore store,
        JSONObject payload,
        LoginFields fields,
        JSONArray matches,
        InlineSpecAllocator inlineAllocator,
        int maxDirectInline
    ) {
        int added = 0;
        for (int index = 0; index < matches.length(); index += 1) {
            try {
                JSONObject match = matches.getJSONObject(index);
                String entryId = match.optString("id");
                if (entryId.isEmpty()) {
                    if (BuildConfig.DEBUG) {
                        Log.d(TAG, "Skipping match without id");
                    }
                    continue;
                }

                JSONObject fill = store.getFillPayloadFromPayload(payload, entryId);
                InlinePresentationSpec inlineSpec = (inlineAllocator != null && added < maxDirectInline)
                    ? inlineAllocator.nextSpec()
                    : null;
                Dataset dataset = buildDataset(context, fields, match, fill, labelFor(match), inlineSpec);
                if (dataset == null) {
                    if (BuildConfig.DEBUG) {
                        Log.d(TAG, "Skipping empty dataset. usernameId=" + (fields.usernameId != null)
                            + ", passwordId=" + (fields.passwordId != null)
                            + ", hasUsername=" + !fill.optString("username").isEmpty()
                            + ", hasEmail=" + !fill.optString("email").isEmpty()
                            + ", hasPhone=" + !fill.optString("phone").isEmpty()
                            + ", hasPassword=" + !fill.optString("password").isEmpty());
                    }
                    continue;
                }

                response.addDataset(dataset);
                added += 1;
            } catch (Exception error) {
                Log.w(TAG, "Could not build dataset for match " + index, error);
            }
        }
        if (BuildConfig.DEBUG) {
            Log.d(TAG, "Added " + added + " direct autofill datasets");
        }
        return added;
    }

    static void configureFillDialog(Context context, FillResponse.Builder response, LoginFields fields, FillRequest request) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return;
        if (request != null && (request.getFlags() & FillRequest.FLAG_SUPPORTS_FILL_DIALOG) == 0) return;
        AutofillId[] ids = fields.autofillIds();
        if (ids.length == 0) return;
        response.setDialogHeader(presentation(context, "选择 My Password 账号"));
        response.setFillDialogTriggerIds(ids);
    }

    static InlinePresentation buildInlinePresentation(
        Context context,
        InlinePresentationSpec spec,
        String title,
        String subtitle,
        PendingIntent attributionIntent
    ) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R || spec == null || context == null) return null;
        try {
            PendingIntent attribution = attributionIntent;
            if (attribution == null) {
                Intent intent = new Intent(context, MainActivity.class);
                intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                attribution = PendingIntent.getActivity(
                    context,
                    3001,
                    intent,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                );
            }
            InlineSuggestionUi.Content.Builder contentBuilder = InlineSuggestionUi.newContentBuilder(attribution)
                .setTitle(title == null || title.trim().isEmpty() ? "My Password" : title.trim())
                .setStartIcon(Icon.createWithResource(context, R.mipmap.ic_launcher));
            if (subtitle != null && !subtitle.trim().isEmpty()) {
                contentBuilder.setSubtitle(subtitle.trim());
            }
            return new InlinePresentation(contentBuilder.build().getSlice(), spec, false);
        } catch (Throwable error) {
            if (BuildConfig.DEBUG) {
                Log.w(TAG, "Could not build inline presentation", error);
            }
            return null;
        }
    }

    static final class InlineSpecAllocator {
        private final List<InlinePresentationSpec> specs;
        private final int maxCount;
        private int cursor;

        InlineSpecAllocator(InlineSuggestionsRequest request) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && request != null) {
                List<InlinePresentationSpec> list = request.getInlinePresentationSpecs();
                this.specs = list == null ? new ArrayList<>() : list;
                int max = request.getMaxSuggestionCount();
                this.maxCount = max == InlineSuggestionsRequest.SUGGESTION_COUNT_UNLIMITED
                    ? Integer.MAX_VALUE
                    : Math.max(0, max);
            } else {
                this.specs = new ArrayList<>();
                this.maxCount = 0;
            }
        }

        int maxDirectSuggestions() {
            if (specs.isEmpty() || maxCount <= 1) return 0;
            return maxCount == Integer.MAX_VALUE ? Integer.MAX_VALUE : maxCount - 1;
        }

        InlinePresentationSpec nextSpec() {
            if (specs.isEmpty() || cursor >= maxCount) return null;
            InlinePresentationSpec spec = specs.get(Math.min(cursor, specs.size() - 1));
            cursor += 1;
            return spec;
        }
    }

    private static JSONObject captureLogin(AssistStructure structure, LoginFields fields) throws Exception {
        String target = fields.hostnameOrPackage();
        String account = textValueFor(structure, fields.usernameId);
        String password = "";
        for (AutofillId passwordId : fields.savePasswordIds()) {
            password = textValueFor(structure, passwordId);
            if (!password.isEmpty()) break;
        }

        return new JSONObject()
            .put("hostname", target)
            .put("title", pageTitleForStructure(structure, target))
            .put("account", account)
            .put("accountKind", fields.usernameKind)
            .put("password", password);
    }

    private static String pageTitleForStructure(AssistStructure structure, String target) {
        String fallback = titleForTarget(target);
        String normalizedTarget = normalizeTarget(target);
        if (structure == null) return fallback;

        String htmlTitle = htmlTitleForStructure(structure, normalizedTarget);
        if (!htmlTitle.isEmpty()) return htmlTitle;

        for (int index = 0; index < structure.getWindowNodeCount(); index += 1) {
            AssistStructure.WindowNode windowNode = structure.getWindowNodeAt(index);
            String title = cleanPageTitle(
                windowNode.getTitle() == null ? "" : windowNode.getTitle().toString(),
                normalizedTarget
            );
            if (!title.isEmpty()) return title;
        }
        return fallback;
    }

    private static String htmlTitleForStructure(AssistStructure structure, String normalizedTarget) {
        for (int index = 0; index < structure.getWindowNodeCount(); index += 1) {
            String title = htmlTitleForNode(structure.getWindowNodeAt(index).getRootViewNode(), normalizedTarget);
            if (!title.isEmpty()) return title;
        }
        return "";
    }

    private static String htmlTitleForNode(AssistStructure.ViewNode node, String normalizedTarget) {
        if (node == null) return "";
        ViewStructure.HtmlInfo htmlInfo = node.getHtmlInfo();
        if (htmlInfo != null && htmlInfo.getTag() != null && "title".equalsIgnoreCase(htmlInfo.getTag())) {
            String title = cleanPageTitle(node.getText() == null ? "" : node.getText().toString(), normalizedTarget);
            if (!title.isEmpty()) return title;
        }
        for (int index = 0; index < node.getChildCount(); index += 1) {
            String title = htmlTitleForNode(node.getChildAt(index), normalizedTarget);
            if (!title.isEmpty()) return title;
        }
        return "";
    }

    private static String cleanPageTitle(String value, String normalizedTarget) {
        if (value == null) return "";
        String title = value.replace('\u0000', ' ').trim().replaceAll("\\s+", " ");
        if (title.isEmpty()) return "";
        String normalizedTitle = normalizeTarget(title);
        if (!normalizedTarget.isEmpty() && normalizedTitle.equals(normalizedTarget)) return "";
        if (!normalizedTarget.isEmpty() && title.equalsIgnoreCase(normalizedTarget)) return "";
        if (isBrowserShellTitle(title)) return "";
        return title.length() > 120 ? title.substring(0, 120).trim() : title;
    }

    private static boolean isBrowserShellTitle(String title) {
        String value = title == null ? "" : title.trim().toLowerCase(Locale.ROOT);
        return value.equals("chrome")
            || value.equals("google chrome")
            || value.equals("edge")
            || value.equals("microsoft edge")
            || value.equals("firefox")
            || value.equals("opera")
            || value.equals("brave")
            || value.equals("vivaldi")
            || value.equals("browser")
            || value.equals("浏览器");
    }

    private static String textValueFor(AssistStructure structure, AutofillId id) {
        if (structure == null || id == null) return "";
        for (int index = 0; index < structure.getWindowNodeCount(); index += 1) {
            String value = textValueFor(structure.getWindowNodeAt(index).getRootViewNode(), id);
            if (!value.isEmpty()) return value;
        }
        return "";
    }

    private static String textValueFor(AssistStructure.ViewNode node, AutofillId id) {
        if (node == null || id == null) return "";
        AutofillId nodeId = node.getAutofillId();
        if (nodeId != null && nodeId.equals(id)) {
            AutofillValue value = node.getAutofillValue();
            if (value != null && value.isText() && value.getTextValue() != null) {
                return value.getTextValue().toString();
            }
            if (node.getText() != null) return node.getText().toString();
            return "";
        }
        for (int index = 0; index < node.getChildCount(); index += 1) {
            String value = textValueFor(node.getChildAt(index), id);
            if (!value.isEmpty()) return value;
        }
        return "";
    }

    static String titleForTarget(String target) {
        String normalized = normalizeTarget(target);
        if (normalized.isEmpty()) return "Untitled";
        int dotIndex = normalized.lastIndexOf('.');
        if (dotIndex > 0) {
            String[] parts = normalized.split("\\.");
            if (parts.length >= 2) return capitalize(parts[parts.length - 2]);
        }
        return capitalize(normalized);
    }

    static String searchTermForTarget(String target) {
        String normalized = normalizeTarget(target);
        if (normalized.isEmpty()) return "";
        if (normalized.contains("xiaoheihe")) return "xiaoheihe";
        String[] parts = normalized.split("\\.");
        if (parts.length >= 2) return parts[parts.length - 2];
        int packageIndex = normalized.lastIndexOf('.');
        return packageIndex >= 0 && packageIndex < normalized.length() - 1
            ? normalized.substring(packageIndex + 1)
            : normalized;
    }

    private static String normalizeTarget(String target) {
        if (target == null) return "";
        String normalized = target.trim().toLowerCase(Locale.ROOT);
        int schemeIndex = normalized.indexOf("://");
        if (schemeIndex >= 0) normalized = normalized.substring(schemeIndex + 3);
        int slashIndex = normalized.indexOf('/');
        if (slashIndex >= 0) normalized = normalized.substring(0, slashIndex);
        int atIndex = normalized.lastIndexOf('@');
        if (atIndex >= 0) normalized = normalized.substring(atIndex + 1);
        int portIndex = normalized.indexOf(':');
        if (portIndex >= 0) normalized = normalized.substring(0, portIndex);
        if (normalized.startsWith("www.")) normalized = normalized.substring(4);
        return normalized;
    }

    private static String capitalize(String value) {
        if (value == null || value.isEmpty()) return "Untitled";
        return value.substring(0, 1).toUpperCase(Locale.ROOT) + value.substring(1);
    }

    static Dataset buildDataset(Context context, LoginFields fields, JSONObject match, JSONObject fill, String label) {
        return buildDataset(context, fields, match, fill, label, null);
    }

    static Dataset buildDataset(
        Context context,
        LoginFields fields,
        JSONObject match,
        JSONObject fill,
        String label,
        InlinePresentationSpec inlineSpec
    ) {
        RemoteViews menuPresentation = presentation(context, label);
        String username = resolveAccountValue(fill, fields.usernameKind);
        String pwd = fill.optString("password");
        InlinePresentation inlinePresentation = buildInlinePresentation(
            context,
            inlineSpec,
            match.optString("title", "My Password"),
            username,
            null
        );
        Dataset.Builder builder = new Dataset.Builder(menuPresentation);
        boolean hasValue = false;

        if (BuildConfig.DEBUG) {
            Log.d(TAG, "Build dataset: usernameId=" + (fields.usernameId != null)
                + ", passwordTargets=" + fields.passwordIds().size()
                + ", otpId=" + (fields.otpId != null)
                + ", usernameKind=" + fields.usernameKind
                + ", usernameLen=" + username.length()
                + ", passwordLen=" + pwd.length()
                + ", inline=" + (inlinePresentation != null));
        }

        if (fields.usernameId != null && !username.isEmpty()) {
            setDatasetFieldValue(builder, fields.usernameId, AutofillValue.forText(username), menuPresentation, inlinePresentation);
            hasValue = true;
        }
        if (!pwd.isEmpty()) {
            for (AutofillId passwordId : fields.passwordIds()) {
                setDatasetFieldValue(builder, passwordId, AutofillValue.forText(pwd), menuPresentation, inlinePresentation);
                hasValue = true;
            }
        }
        if (fields.otpId != null && !fill.optString("totp").isEmpty()) {
            setDatasetFieldValue(builder, fields.otpId, AutofillValue.forText(fill.optString("totp")), menuPresentation, inlinePresentation);
            hasValue = true;
        }

        return hasValue ? builder.build() : null;
    }

    private static void setDatasetFieldValue(
        Dataset.Builder builder,
        AutofillId id,
        AutofillValue value,
        RemoteViews presentation,
        InlinePresentation inlinePresentation
    ) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && inlinePresentation != null) {
            builder.setValue(id, value, presentation, inlinePresentation);
        } else {
            builder.setValue(id, value);
        }
    }

    static LoginFields inspectStructure(AssistStructure structure) {
        LoginFields fields = new LoginFields();
        if (structure.getActivityComponent() != null) {
            fields.targetPackageName = structure.getActivityComponent().getPackageName();
        }
        for (int index = 0; index < structure.getWindowNodeCount(); index += 1) {
            inspectNode(structure.getWindowNodeAt(index).getRootViewNode(), fields, true);
        }
        return fields;
    }

    private static void inspectNode(AssistStructure.ViewNode node, LoginFields fields, boolean ancestorsEligible) {
        if (node == null) return;

        // Log node details for debugging
        String idEntry = node.getIdEntry();
        String hint = node.getHint();
        String[] hints = node.getAutofillHints();
        int type = node.getAutofillType();
        
        if (BuildConfig.DEBUG && (idEntry != null || hint != null || hints != null)) {
            Log.v(TAG, String.format("Node: id=%s, hint=%s, hints=%s, type=%d",
                idEntry, hint, Arrays.toString(hints), type));
        }

        if (fields.hostname == null && node.getWebDomain() != null) {
            fields.hostname = node.getWebDomain();
            if (BuildConfig.DEBUG) {
                Log.d(TAG, "Found web domain: " + fields.hostname);
            }
        }

        boolean visibleAndEnabled = ancestorsEligible
            && node.getVisibility() == View.VISIBLE
            && node.isEnabled();
        String labelText = labelText(node);
        if (visibleAndEnabled && autofillIdCanUseLabel(node)) {
            fields.rememberLabel(labelText);
        }

        AutofillId autofillId = node.getAutofillId();
        if (autofillId != null && visibleAndEnabled) {
            String text = nodeText(node);
            String contextualText = fields.contextualText(text);
            int inputType = node.getInputType();
            boolean textCandidate = isTextCandidate(node, contextualText);
            AutofillFieldPolicy.Decision decision = AutofillFieldPolicy.classify(
                contextualText,
                hints,
                textCandidate,
                isPasswordInputType(inputType),
                isEmailInputType(inputType),
                isPhoneInputType(inputType),
                true
            );
            fields.addCandidate(autofillId, decision);
            if (textCandidate) fields.clearRecentLabel();
            if (BuildConfig.DEBUG) {
                Log.d(TAG, "Field role: " + idEntry
                    + ", role=" + decision.role
                    + ", accountScore=" + decision.accountScore
                    + ", passwordScore=" + decision.passwordScore
                    + ", otpScore=" + decision.otpScore);
            }
        }

        for (int index = 0; index < node.getChildCount(); index += 1) {
            inspectNode(node.getChildAt(index), fields, visibleAndEnabled);
        }
    }

    private static String nodeText(AssistStructure.ViewNode node) {
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

    private static String labelText(AssistStructure.ViewNode node) {
        StringBuilder builder = new StringBuilder();
        append(builder, node.getHint());
        append(builder, node.getContentDescription() == null ? null : node.getContentDescription().toString());
        append(builder, node.getText() == null ? null : node.getText().toString());
        appendHtmlInfo(builder, node.getHtmlInfo());
        return builder.toString().toLowerCase(Locale.ROOT).trim();
    }

    private static boolean autofillIdCanUseLabel(AssistStructure.ViewNode node) {
        String text = labelText(node);
        if (text.isEmpty() || text.length() > 80) return false;
        if (node.getAutofillId() != null && isTextCandidate(node, text)) return false;
        return containsUsername(text)
            || containsPassword(text)
            || containsEmail(text)
            || containsPhone(text)
            || containsOtp(text);
    }

    private static void append(StringBuilder builder, String value) {
        if (value != null) builder.append(value).append(' ');
    }

    private static void appendHtmlInfo(StringBuilder builder, ViewStructure.HtmlInfo htmlInfo) {
        if (htmlInfo == null) return;
        append(builder, htmlInfo.getTag());
        List<Pair<String, String>> attrs = htmlInfo.getAttributes();
        if (attrs == null) return;
        for (Pair<String, String> attr : attrs) {
            append(builder, attr.first);
            append(builder, attr.second);
        }
    }

    private static boolean isUsernameHint(String[] hints) {
        if (hints == null) return false;
        for (String h : hints) {
            String low = h.toLowerCase(Locale.ROOT);
            if (low.contains("username")
                || low.contains("email")
                || low.contains("userid")
                || low.contains("user_id")
                || low.contains("identifier")
                || low.contains("account")
                || low.contains("acct")
                || low.contains("login")
                || low.contains("loginfmt")
                || low.contains("credential")
                || low.contains("phone")
                || low.contains("mobile")
                || low.contains("tel")) return true;
        }
        return false;
    }

    private static boolean isPasswordHint(String[] hints) {
        if (hints == null) return false;
        for (String h : hints) {
            String low = h.toLowerCase(Locale.ROOT);
            if (low.contains("password")
                || low.contains("passwd")
                || low.contains("pwd")
                || low.contains("secret")
                || low.contains("pin")) return true;
        }
        return false;
    }

    private static boolean isOtpHint(String[] hints) {
        if (hints == null) return false;
        for (String h : hints) {
            String low = h.toLowerCase(Locale.ROOT);
            if (low.contains("otp")
                || low.contains("one-time")
                || low.contains("sms")
                || low.contains("totp")
                || low.contains("mfa")
                || low.contains("2fa")
                || low.contains("code")) return true;
        }
        return false;
    }

    private static boolean containsUsername(String text) {
        return text.contains("user")
            || text.contains("login")
            || text.contains("loginname")
            || text.contains("login-name")
            || text.contains("login_name")
            || text.contains("loginid")
            || text.contains("login_id")
            || text.contains("identifier")
            || text.contains("identifierid")
            || text.contains("identifier_id")
            || text.contains("loginfmt")
            || text.contains("email")
            || text.contains("mail")
            || text.contains("account")
            || text.contains("accountname")
            || text.contains("account-name")
            || text.contains("account_name")
            || text.contains("accountid")
            || text.contains("account_id")
            || text.contains("acct")
            || text.contains("credential")
            || text.contains("principal")
            || text.contains("membername")
            || text.contains("member-name")
            || text.contains("screenname")
            || text.contains("screen-name")
            || text.contains("nickname")
            || text.contains("handle")
            || text.contains("uid")
            || text.contains("phone")
            || text.contains("mobile")
            || text.contains("tel")
            || text.contains("username")
            || text.contains("用户名")
            || text.contains("账号")
            || text.contains("账户")
            || text.contains("邮箱")
            || text.contains("手机")
            || text.contains("手机号码")
            || text.contains("手机号");
    }

    private static boolean containsPassword(String text) {
        return text.contains("password")
            || text.contains("pass-word")
            || text.contains("pass_word")
            || text.contains("passphrase")
            || containsWord(text, "pass")
            || text.contains("passcode")
            || text.contains("passwd")
            || text.contains("psw")
            || text.contains("pwd")
            || text.contains("密码");
    }

    private static boolean containsEmail(String text) {
        return text.contains("email")
            || text.contains("e-mail")
            || text.contains("mail")
            || text.contains("mailaddress")
            || text.contains("mail-address")
            || text.contains("mail_address")
            || text.contains("emailaddress")
            || text.contains("email-address")
            || text.contains("email_address")
            || text.contains("loginfmt")
            || text.contains("邮箱")
            || text.contains("郵箱")
            || text.contains("電子郵件");
    }

    private static boolean containsPhone(String text) {
        return text.contains("phone")
            || text.contains("mobile")
            || text.contains("mobilephone")
            || text.contains("mobile-phone")
            || text.contains("mobile_phone")
            || text.contains("cellphone")
            || text.contains("cell-phone")
            || text.contains("telephone")
            || text.contains("msisdn")
            || text.contains("tel")
            || text.contains("手机")
            || text.contains("手机号")
            || text.contains("手机号码")
            || text.contains("手機");
    }

    private static boolean containsOtp(String text) {
        return containsStrongOtp(text)
            || containsWord(text, "code")
            || text.contains("验证码")
            || text.contains("校验码")
            || text.contains("动态码")
            || text.contains("安全码");
    }

    private static boolean containsStrongOtp(String text) {
        return text.contains("otp")
            || text.contains("totp")
            || text.contains("2fa")
            || text.contains("mfa")
            || text.contains("one-time-code")
            || text.contains("one time code")
            || text.contains("onetimecode")
            || text.contains("verification")
            || text.contains("verificationcode")
            || text.contains("verification-code")
            || text.contains("verification_code")
            || text.contains("authcode")
            || text.contains("auth-code")
            || text.contains("auth_code")
            || text.contains("smscode")
            || text.contains("sms-code")
            || text.contains("sms_code")
            || text.contains("securitycode")
            || text.contains("security-code")
            || text.contains("security_code")
            || text.contains("验证码")
            || text.contains("动态")
            || text.contains("二次")
            || text.contains("安全码");
    }

    private static boolean containsSecret(String text) {
        return text.contains("secret")
            || text.contains("passphrase")
            || text.contains("口令");
    }

    private static boolean containsSearch(String text) {
        return text.contains("search")
            || text.contains("query")
            || text.contains("keyword")
            || text.contains("find")
            || text.contains("搜索")
            || text.contains("查询");
    }

    private static boolean containsNonCredentialText(String text) {
        return text.contains("comment")
            || text.contains("reply")
            || text.contains("message")
            || text.contains("post")
            || text.contains("article")
            || text.contains("content")
            || text.contains("body")
            || text.contains("caption")
            || text.contains("feedback")
            || text.contains("review")
            || text.contains("compose")
            || text.contains("editor")
            || text.contains("chat")
            || text.contains("remark")
            || text.contains("note");
    }

    private static boolean containsCredentialText(String text) {
        return containsUsername(text)
            || containsPassword(text)
            || containsEmail(text)
            || containsPhone(text)
            || containsOtp(text)
            || containsSecret(text);
    }

    private static boolean containsWord(String text, String word) {
        int start = text.indexOf(word);
        while (start >= 0) {
            int end = start + word.length();
            boolean leftOk = start == 0 || !Character.isLetterOrDigit(text.charAt(start - 1));
            boolean rightOk = end >= text.length() || !Character.isLetterOrDigit(text.charAt(end));
            if (leftOk && rightOk) return true;
            start = text.indexOf(word, end);
        }
        return false;
    }

    private static boolean isPasswordInputType(int inputType) {
        int klass = inputType & InputType.TYPE_MASK_CLASS;
        int variation = inputType & InputType.TYPE_MASK_VARIATION;
        return (klass == InputType.TYPE_CLASS_TEXT
            && (variation == (InputType.TYPE_TEXT_VARIATION_PASSWORD & InputType.TYPE_MASK_VARIATION)
                || variation == (InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD & InputType.TYPE_MASK_VARIATION)
                || variation == (InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD & InputType.TYPE_MASK_VARIATION)))
            || (klass == InputType.TYPE_CLASS_NUMBER
                && variation == (InputType.TYPE_NUMBER_VARIATION_PASSWORD & InputType.TYPE_MASK_VARIATION));
    }

    private static boolean isEmailInputType(int inputType) {
        int klass = inputType & InputType.TYPE_MASK_CLASS;
        int variation = inputType & InputType.TYPE_MASK_VARIATION;
        return klass == InputType.TYPE_CLASS_TEXT
            && variation == (InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS & InputType.TYPE_MASK_VARIATION);
    }

    private static boolean isPhoneInputType(int inputType) {
        int klass = inputType & InputType.TYPE_MASK_CLASS;
        return klass == InputType.TYPE_CLASS_PHONE;
    }

    private static boolean isTextCandidate(AssistStructure.ViewNode node, String text) {
        int autofillType = node.getAutofillType();
        int inputType = node.getInputType();
        int klass = inputType & InputType.TYPE_MASK_CLASS;
        String[] hints = node.getAutofillHints();
        if (containsNonCredentialText(text)
            && !containsCredentialText(text)
            && !isUsernameHint(hints)
            && !isPasswordHint(hints)
            && !isOtpHint(hints)) return false;
        if (autofillType == View.AUTOFILL_TYPE_TEXT) {
            if (inputType == 0
                && !isHtmlTextField(node.getHtmlInfo())
                && !looksEditableClass(node.getClassName())
                && looksStaticTextClass(node.getClassName())) return false;
            return !containsSearch(text);
        }
        if (klass == InputType.TYPE_CLASS_TEXT
            || klass == InputType.TYPE_CLASS_NUMBER
            || klass == InputType.TYPE_CLASS_PHONE) return true;
        if (hints != null && hints.length > 0) return true;
        if (isHtmlTextField(node.getHtmlInfo())) return true;
        return looksEditableClass(node.getClassName())
            && (containsUsername(text) || containsPassword(text) || containsOtp(text));
    }

    private static boolean isHtmlTextField(ViewStructure.HtmlInfo htmlInfo) {
        if (htmlInfo == null || htmlInfo.getTag() == null) return false;
        String tag = htmlInfo.getTag().toLowerCase(Locale.ROOT);
        if ("textarea".equals(tag)) return true;
        if (!"input".equals(tag)) return false;
        List<Pair<String, String>> attrs = htmlInfo.getAttributes();
        if (attrs == null) return true;
        for (Pair<String, String> attr : attrs) {
            if (attr.first == null || attr.second == null) continue;
            if (!"type".equals(attr.first.toLowerCase(Locale.ROOT))) continue;
            String type = attr.second.toLowerCase(Locale.ROOT);
            return !type.equals("button")
                && !type.equals("submit")
                && !type.equals("reset")
                && !type.equals("hidden")
                && !type.equals("checkbox")
                && !type.equals("radio");
        }
        return true;
    }

    private static boolean looksEditableClass(String className) {
        if (className == null) return false;
        String value = className.toLowerCase(Locale.ROOT);
        return value.contains("edittext")
            || value.contains("textfield")
            || value.contains("textinput")
            || value.contains("autocomplete")
            || value.contains("edit");
    }

    private static boolean looksStaticTextClass(String className) {
        if (className == null) return false;
        String value = className.toLowerCase(Locale.ROOT);
        return value.contains("textview")
            || value.contains("button")
            || value.contains("label");
    }

    static RemoteViews presentation(Context context, String text) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.autofill_dataset);
        views.setTextViewText(R.id.autofill_text, text);
        return views;
    }

    static String labelFor(JSONObject match) {
        String username = firstNotEmpty(match.optString("username"), match.optString("email"), match.optString("phone"));
        if (username.isEmpty()) return match.optString("title", "My Password");
        return match.optString("title", "My Password") + " - " + username;
    }

    private static String resolveAccountValue(JSONObject fill, String fieldKind) {
        String fallback = firstNotEmpty(fill.optString("username"), fill.optString("email"), fill.optString("phone"));
        if (ACCOUNT_KIND_EMAIL.equals(fieldKind)) return firstNotEmpty(fill.optString("email"), fallback);
        if (ACCOUNT_KIND_PHONE.equals(fieldKind)) return firstNotEmpty(fill.optString("phone"), fallback);
        if (ACCOUNT_KIND_USERNAME.equals(fieldKind)) return firstNotEmpty(fill.optString("username"), fallback);

        String source = fill.optString("loginAccountSource", SOURCE_AUTO);
        if (SOURCE_EMAIL.equals(source)) return firstNotEmpty(fill.optString("email"), fallback);
        if (SOURCE_PHONE.equals(source)) return firstNotEmpty(fill.optString("phone"), fallback);
        if (SOURCE_USERNAME.equals(source)) return firstNotEmpty(fill.optString("username"), fallback);
        return fallback;
    }

    private static String firstNotEmpty(String... values) {
        for (String value : values) {
            if (value != null && !value.isEmpty()) return value;
        }
        return "";
    }

    static class LoginFields {
        AutofillId usernameId;
        AutofillId passwordId;
        AutofillId otpId;
        AutofillId newPasswordId;
        AutofillId confirmPasswordId;
        AutofillId savePasswordId;
        List<AutofillFieldPolicy.Candidate<AutofillId>> fieldCandidates = new ArrayList<>();
        String usernameKind = ACCOUNT_KIND_GENERIC;
        int usernameScore;
        int passwordScore;
        int otpScore;
        String recentLabelText = "";
        String hostname;
        String targetPackageName;

        void finish() {
            if (fieldCandidates.isEmpty()) return;
            AutofillFieldPolicy.Resolved<AutofillId> resolved = AutofillFieldPolicy.resolve(fieldCandidates);
            usernameId = resolved.accountId;
            passwordId = resolved.currentPasswordId;
            newPasswordId = resolved.newPasswordId;
            confirmPasswordId = resolved.confirmPasswordId;
            otpId = resolved.otpId;
            savePasswordId = resolved.savePasswordId();
            usernameKind = resolved.accountKind;
            usernameScore = resolved.accountScore;
            passwordScore = resolved.currentPasswordScore;
            otpScore = resolved.otpScore;
        }

        void addCandidate(AutofillId id, AutofillFieldPolicy.Decision decision) {
            if (id == null || decision == null) return;
            fieldCandidates.add(new AutofillFieldPolicy.Candidate<>(id, decision, fieldCandidates.size()));
        }

        int candidateCount() {
            return fieldCandidates.size();
        }

        void rememberLabel(String label) {
            if (label == null) return;
            String value = label.trim();
            if (value.isEmpty()) return;
            recentLabelText = value.length() > 120 ? value.substring(0, 120) : value;
        }

        String contextualText(String text) {
            if (recentLabelText == null || recentLabelText.isEmpty()) return text == null ? "" : text;
            return recentLabelText + " " + (text == null ? "" : text);
        }

        void clearRecentLabel() {
            recentLabelText = "";
        }

        AutofillId[] autofillIds() {
            List<AutofillId> ids = new ArrayList<>();
            if (usernameId != null) ids.add(usernameId);
            for (AutofillId id : passwordIds()) addUnique(ids, id);
            if (otpId != null) ids.add(otpId);
            return ids.toArray(new AutofillId[0]);
        }

        void setNullValues(Dataset.Builder builder, RemoteViews presentation, InlinePresentation inlinePresentation) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && inlinePresentation != null) {
                if (usernameId != null) builder.setValue(usernameId, null, presentation, inlinePresentation);
                for (AutofillId id : passwordIds()) builder.setValue(id, null, presentation, inlinePresentation);
                if (otpId != null) builder.setValue(otpId, null, presentation, inlinePresentation);
                return;
            }
            if (usernameId != null) builder.setValue(usernameId, (AutofillValue) null);
            for (AutofillId id : passwordIds()) builder.setValue(id, (AutofillValue) null);
            if (otpId != null) builder.setValue(otpId, (AutofillValue) null);
        }

        boolean hasFillableFields() {
            return usernameId != null || !passwordIds().isEmpty() || otpId != null;
        }

        boolean shouldOfferAutofill() {
            if (!passwordIds().isEmpty() && passwordScore >= 60) return true;
            if (otpId != null && otpScore >= 60) return true;
            if (usernameId != null && usernameScore >= 70) return true;
            return false;
        }

        boolean hasSavableFields() {
            return !savePasswordIds().isEmpty();
        }

        AutofillId[] saveIds() {
            List<AutofillId> ids = new ArrayList<>();
            if (usernameId != null) ids.add(usernameId);
            for (AutofillId id : savePasswordIds()) addUnique(ids, id);
            return ids.toArray(new AutofillId[0]);
        }

        void writeToIntent(Intent intent) {
            intent.putExtra(AutofillPickerActivity.EXTRA_HOSTNAME, hostname);
            intent.putExtra(AutofillPickerActivity.EXTRA_TARGET_PACKAGE, targetPackageName);
            if (usernameId != null) intent.putExtra(AutofillPickerActivity.EXTRA_USERNAME_ID, usernameId);
            if (passwordId != null) intent.putExtra(AutofillPickerActivity.EXTRA_PASSWORD_ID, passwordId);
            if (otpId != null) intent.putExtra(AutofillPickerActivity.EXTRA_OTP_ID, otpId);
            intent.putExtra(AutofillPickerActivity.EXTRA_ACCOUNT_KIND, usernameKind);
        }

        String hostnameOrPackage() {
            return hostname != null && !hostname.trim().isEmpty() ? hostname : (targetPackageName != null ? targetPackageName : "");
        }

        boolean isOwnPackage(String packageName) {
            return packageName != null && packageName.equals(targetPackageName);
        }

        boolean shouldFallbackToAllMatches() {
            return (hostname == null || hostname.trim().isEmpty()) && isLikelyBrowserPackage(targetPackageName);
        }

        List<AutofillId> passwordIds() {
            List<AutofillId> ids = new ArrayList<>();
            if (passwordId != null) addUnique(ids, passwordId);
            return ids;
        }

        List<AutofillId> savePasswordIds() {
            List<AutofillId> ids = new ArrayList<>();
            if (newPasswordId != null) addUnique(ids, newPasswordId);
            if (confirmPasswordId != null) addUnique(ids, confirmPasswordId);
            if (savePasswordId != null) addUnique(ids, savePasswordId);
            if (currentPasswordIdForSavingFallback() != null) addUnique(ids, currentPasswordIdForSavingFallback());
            return ids;
        }

        private AutofillId currentPasswordIdForSavingFallback() {
            return newPasswordId == null && confirmPasswordId == null ? passwordId : null;
        }

        private static void addUnique(List<AutofillId> ids, AutofillId id) {
            if (id == null || ids.contains(id)) return;
            ids.add(id);
        }

    }

    static boolean isLikelyBrowserPackage(String packageName) {
        if (packageName == null) return false;
        String value = packageName.toLowerCase(Locale.ROOT);
        return value.contains("browser")
            || value.contains("chrome")
            || value.contains("firefox")
            || value.contains("edge")
            || value.contains("opera")
            || value.contains("brave")
            || value.contains("vivaldi")
            || value.contains("duckduckgo")
            || value.contains("sbrowser")
            || value.contains("webview")
            || value.contains("quark")
            || value.contains("ucmobile")
            || value.contains("mibrowser")
            || value.contains("miuibrowser");
    }
}
