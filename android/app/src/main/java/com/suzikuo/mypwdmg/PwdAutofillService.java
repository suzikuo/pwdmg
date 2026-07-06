package com.suzikuo.mypwdmg;

import android.app.PendingIntent;
import android.app.assist.AssistStructure;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.CancellationSignal;
import android.service.autofill.AutofillService;
import android.service.autofill.Dataset;
import android.service.autofill.FillCallback;
import android.service.autofill.FillContext;
import android.service.autofill.FillRequest;
import android.service.autofill.FillResponse;
import android.service.autofill.SaveCallback;
import android.service.autofill.SaveRequest;
import android.text.InputType;
import android.util.Log;
import android.util.Pair;
import android.view.View;
import android.view.ViewStructure;
import android.view.autofill.AutofillId;
import android.view.autofill.AutofillManager;
import android.view.autofill.AutofillValue;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;

public class PwdAutofillService extends AutofillService {
    private static final String TAG = "PwdAutofill";
    static final String ACCOUNT_KIND_GENERIC = "generic";
    static final String ACCOUNT_KIND_USERNAME = "username";
    static final String ACCOUNT_KIND_EMAIL = "email";
    static final String ACCOUNT_KIND_PHONE = "phone";
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
            Log.d(TAG, "Fill request for: " + target);
            Log.d(TAG, "Fields found - Username: " + (fields.usernameId != null)
                + ", Password: " + (fields.passwordId != null)
                + ", OTP: " + (fields.otpId != null)
                + ", TextCandidates: " + fields.textCandidates.size());

            if (fields.isOwnPackage(getPackageName())) {
                Log.d(TAG, "Skipping autofill for own app");
                callback.onSuccess(null);
                return;
            }

            // If we can't find even a password field, we might not be on a login page
            if (fields.passwordId == null && fields.usernameId == null) {
                Log.d(TAG, "No login fields detected, skipping");
                callback.onSuccess(null);
                return;
            }

            AndroidVaultStore store = new AndroidVaultStore(this);
            JSONObject payload = store.tryUnlockWithEmptyPasswordForAutofill();
            if (payload == null) {
                Log.d(TAG, "Vault locked, showing unlock suggestion");
                callback.onSuccess(buildUnlockResponse(fields, request));
                return;
            }

            boolean includeAll = fields.shouldFallbackToAllMatches();
            JSONArray matches = store.queryMatchesFromPayload(payload, target, includeAll);
            if (matches.length() == 0) {
                Log.d(TAG, "No matches found for: " + target + ", includeAll=" + includeAll);
                // Even if no matches, we could show an "Add new" or just nothing
                callback.onSuccess(null);
                return;
            }

            Log.d(TAG, "Found " + matches.length() + " matches");
            FillResponse.Builder response = new FillResponse.Builder();
            int datasetCount = addDirectDatasets(response, store, payload, fields, matches);
            if (datasetCount == 0) {
                Log.d(TAG, "No fillable datasets built");
                callback.onSuccess(null);
                return;
            }

            configureFillDialog(response, fields, request);
            callback.onSuccess(response.build());
        } catch (Exception error) {
            Log.e(TAG, "Error in onFillRequest", error);
            callback.onFailure(error.getMessage());
        }
    }

    @Override
    public void onSaveRequest(SaveRequest request, SaveCallback callback) {
        callback.onSuccess();
    }

    private FillResponse buildUnlockResponse(LoginFields fields, FillRequest request) {
        Intent intent = new Intent(this, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        // Pass the request so the activity knows it's an autofill auth request
        List<FillContext> contexts = request.getFillContexts();
        intent.putExtra(AutofillManager.EXTRA_ASSIST_STRUCTURE, contexts.get(contexts.size() - 1).getStructure());
        
        PendingIntent pendingIntent = PendingIntent.getActivity(
            this,
            1001,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE
        );

        return new FillResponse.Builder()
            .setAuthentication(fields.autofillIds(), pendingIntent.getIntentSender(), presentation(this, "点击解锁 My Password"))
            .build();
    }

    private int addDirectDatasets(FillResponse.Builder response, AndroidVaultStore store, JSONObject payload, LoginFields fields, JSONArray matches) {
        int added = 0;
        for (int index = 0; index < matches.length(); index += 1) {
            try {
                JSONObject match = matches.getJSONObject(index);
                String entryId = match.optString("id");
                if (entryId.isEmpty()) {
                    Log.d(TAG, "Skipping match without id");
                    continue;
                }

                JSONObject fill = store.getFillPayloadFromPayload(payload, entryId);
                Dataset dataset = buildDataset(this, fields, match, fill, labelFor(match));
                if (dataset == null) {
                    Log.d(TAG, "Skipping empty dataset. usernameId=" + (fields.usernameId != null)
                        + ", passwordId=" + (fields.passwordId != null)
                        + ", hasUsername=" + !fill.optString("username").isEmpty()
                        + ", hasEmail=" + !fill.optString("email").isEmpty()
                        + ", hasPhone=" + !fill.optString("phone").isEmpty()
                        + ", hasPassword=" + !fill.optString("password").isEmpty());
                    continue;
                }

                response.addDataset(dataset);
                added += 1;
            } catch (Exception error) {
                Log.w(TAG, "Could not build dataset for match " + index, error);
            }
        }
        Log.d(TAG, "Added " + added + " direct autofill datasets");
        return added;
    }

    private void configureFillDialog(FillResponse.Builder response, LoginFields fields, FillRequest request) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return;
        if ((request.getFlags() & FillRequest.FLAG_SUPPORTS_FILL_DIALOG) == 0) return;
        AutofillId[] ids = fields.autofillIds();
        if (ids.length == 0) return;
        response.setDialogHeader(presentation(this, "选择 My Password 账号"));
        response.setFillDialogTriggerIds(ids);
    }

    static Dataset buildDataset(Context context, LoginFields fields, JSONObject match, JSONObject fill, String label) {
        Dataset.Builder builder = new Dataset.Builder(presentation(context, label));
        boolean hasValue = false;
        String username = resolveAccountValue(fill, fields.usernameKind);
        String pwd = fill.optString("password");

        Log.d(TAG, "Build dataset: usernameId=" + (fields.usernameId != null)
            + ", passwordTargets=" + fields.passwordIds().size()
            + ", otpId=" + (fields.otpId != null)
            + ", usernameKind=" + fields.usernameKind
            + ", usernameLen=" + username.length()
            + ", passwordLen=" + pwd.length());

        if (fields.usernameId != null) {
            if (!username.isEmpty()) {
                builder.setValue(fields.usernameId, AutofillValue.forText(username));
                hasValue = true;
            }
        }
        if (!pwd.isEmpty()) {
            for (AutofillId passwordId : fields.passwordIds()) {
                builder.setValue(passwordId, AutofillValue.forText(pwd));
                hasValue = true;
            }
        }
        if (fields.otpId != null && !fill.optString("totp").isEmpty()) {
            builder.setValue(fields.otpId, AutofillValue.forText(fill.optString("totp")));
            hasValue = true;
        }

        return hasValue ? builder.build() : null;
    }

    static LoginFields inspectStructure(AssistStructure structure) {
        LoginFields fields = new LoginFields();
        if (structure.getActivityComponent() != null) {
            fields.targetPackageName = structure.getActivityComponent().getPackageName();
        }
        for (int index = 0; index < structure.getWindowNodeCount(); index += 1) {
            inspectNode(structure.getWindowNodeAt(index).getRootViewNode(), fields);
        }
        return fields;
    }

    private static void inspectNode(AssistStructure.ViewNode node, LoginFields fields) {
        if (node == null) return;

        // Log node details for debugging
        String idEntry = node.getIdEntry();
        String hint = node.getHint();
        String[] hints = node.getAutofillHints();
        int type = node.getAutofillType();
        
        if (idEntry != null || hint != null || hints != null) {
            Log.v(TAG, String.format("Node: id=%s, hint=%s, hints=%s, type=%d", 
                idEntry, hint, Arrays.toString(hints), type));
        }

        if (fields.hostname == null && node.getWebDomain() != null) {
            fields.hostname = node.getWebDomain();
            Log.d(TAG, "Found web domain: " + fields.hostname);
        }

        AutofillId autofillId = node.getAutofillId();
        // Allow AUTOFILL_TYPE_NONE for some fields that might be improperly typed but have hints
        if (autofillId != null) {
            String text = nodeText(node);
            int inputType = node.getInputType();
            boolean passwordField = isPasswordHint(hints) || containsPassword(text) || isPasswordInputType(inputType);
            boolean otpField = isOtpHint(hints) || containsOtp(text);
            boolean usernameField = isUsernameHint(hints) || containsUsername(text);
            String accountKind = accountFieldKind(text, hints, inputType);

            if (passwordField) {
                fields.markPassword(autofillId);
                Log.d(TAG, "Identified password field: " + idEntry + ", inputType=" + inputType);
            } else if (fields.otpId == null && otpField) {
                fields.otpId = autofillId;
                Log.d(TAG, "Identified OTP field: " + idEntry);
            } else {
                if (isTextCandidate(type, inputType)) fields.addTextCandidate(autofillId, accountKind);
                if (fields.usernameId == null && usernameField) {
                    fields.setUsernameId(autofillId);
                    Log.d(TAG, "Identified username field: " + idEntry);
                }
            }
        }

        for (int index = 0; index < node.getChildCount(); index += 1) {
            inspectNode(node.getChildAt(index), fields);
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
            if (low.contains("username") || low.contains("email") || low.contains("userid")) return true;
        }
        return false;
    }

    private static boolean isPasswordHint(String[] hints) {
        if (hints == null) return false;
        for (String h : hints) {
            if (h.toLowerCase(Locale.ROOT).contains("password")) return true;
        }
        return false;
    }

    private static boolean isOtpHint(String[] hints) {
        if (hints == null) return false;
        for (String h : hints) {
            String low = h.toLowerCase(Locale.ROOT);
            if (low.contains("otp") || low.contains("code")) return true;
        }
        return false;
    }

    private static String accountFieldKind(String text, String[] hints, int inputType) {
        if (isEmailHint(hints) || isEmailInputType(inputType)) return ACCOUNT_KIND_EMAIL;
        if (isPhoneHint(hints) || isPhoneInputType(inputType)) return ACCOUNT_KIND_PHONE;
        if (isSpecificUsernameHint(hints)) return ACCOUNT_KIND_USERNAME;

        boolean hasEmail = containsEmail(text);
        boolean hasPhone = containsPhone(text);
        boolean hasUsername = containsSpecificUsername(text);
        boolean hasChoiceText = text.contains(" or ")
            || text.contains(" and ")
            || text.contains("/")
            || text.contains("|")
            || text.contains(",")
            || text.contains("，")
            || text.contains("、")
            || text.contains("或")
            || text.contains("或者");

        if (hasEmail && !hasPhone && !(hasUsername && hasChoiceText)) return ACCOUNT_KIND_EMAIL;
        if (hasPhone && !hasEmail && !(hasUsername && hasChoiceText)) return ACCOUNT_KIND_PHONE;
        if (hasUsername && !hasEmail && !hasPhone) return ACCOUNT_KIND_USERNAME;
        return ACCOUNT_KIND_GENERIC;
    }

    private static boolean isEmailHint(String[] hints) {
        if (hints == null) return false;
        for (String h : hints) {
            String low = h.toLowerCase(Locale.ROOT);
            if (low.contains("email") || low.contains("mail")) return true;
        }
        return false;
    }

    private static boolean isPhoneHint(String[] hints) {
        if (hints == null) return false;
        for (String h : hints) {
            String low = h.toLowerCase(Locale.ROOT);
            if (low.contains("phone") || low.contains("mobile") || low.contains("tel")) return true;
        }
        return false;
    }

    private static boolean isSpecificUsernameHint(String[] hints) {
        if (hints == null) return false;
        for (String h : hints) {
            String low = h.toLowerCase(Locale.ROOT);
            if (low.contains("username") || low.contains("userid")) return true;
        }
        return false;
    }

    private static boolean containsUsername(String text) {
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

    private static boolean containsPassword(String text) {
        return text.contains("password")
            || text.contains("pass")
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
            || text.contains("邮箱")
            || text.contains("郵箱")
            || text.contains("閭");
    }

    private static boolean containsPhone(String text) {
        return text.contains("phone")
            || text.contains("mobile")
            || text.contains("tel")
            || text.contains("手机")
            || text.contains("手机号")
            || text.contains("鎵嬫満");
    }

    private static boolean containsSpecificUsername(String text) {
        return text.contains("username")
            || text.contains("userid")
            || text.contains("user")
            || text.contains("用户名")
            || text.contains("用户")
            || text.contains("鐢ㄦ埛鍚?");
    }

    private static boolean containsOtp(String text) {
        return text.contains("otp")
            || text.contains("totp")
            || text.contains("2fa")
            || text.contains("mfa")
            || text.contains("code")
            || text.contains("one-time-code")
            || text.contains("verification")
            || text.contains("验证码")
            || text.contains("动态")
            || text.contains("二次")
            || text.contains("安全码");
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

    private static boolean isTextCandidate(int autofillType, int inputType) {
        int klass = inputType & InputType.TYPE_MASK_CLASS;
        return autofillType == View.AUTOFILL_TYPE_TEXT
            || klass == InputType.TYPE_CLASS_TEXT
            || klass == InputType.TYPE_CLASS_NUMBER
            || inputType == 0;
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
        AutofillId textBeforePasswordId;
        List<AutofillId> textCandidates = new ArrayList<>();
        List<String> textCandidateKinds = new ArrayList<>();
        List<AutofillId> passwordCandidates = new ArrayList<>();
        String usernameKind = ACCOUNT_KIND_GENERIC;
        String hostname;
        String targetPackageName;

        void finish() {
            if (passwordId != null && usernameId == null) {
                setUsernameId(nearestBefore(passwordId));
            }
            if (usernameId == null && textBeforePasswordId != null) {
                setUsernameId(textBeforePasswordId);
            }
            if (usernameId == null && textCandidates.size() >= 2) {
                setUsernameId(firstTextExcept(passwordId, otpId));
            }
            if (usernameId == null) {
                setUsernameId(lastTextExcept(passwordId, otpId));
            }
            if (passwordId == null && usernameId != null) {
                passwordId = nearestAfter(usernameId);
            }
            if (passwordId == null && usernameId != null) {
                passwordId = nearestBefore(usernameId);
            }
            if (passwordId == null) {
                passwordId = lastTextExcept(usernameId, otpId);
            }

            if (passwordId != null && passwordId.equals(usernameId)) {
                passwordId = null;
            }
        }

        void markPassword(AutofillId id) {
            if (passwordId == null) {
                passwordId = id;
            }
            addUnique(passwordCandidates, id);
            if (textBeforePasswordId == null && !textCandidates.isEmpty()) {
                textBeforePasswordId = textCandidates.get(textCandidates.size() - 1);
            }
        }

        void addTextCandidate(AutofillId id, String kind) {
            if (id == null || id.equals(passwordId) || id.equals(otpId) || textCandidates.contains(id)) return;
            textCandidates.add(id);
            textCandidateKinds.add(kind == null ? ACCOUNT_KIND_GENERIC : kind);
        }

        void setUsernameId(AutofillId id) {
            if (id == null) return;
            usernameId = id;
            usernameKind = kindFor(id);
        }

        private String kindFor(AutofillId id) {
            for (int index = 0; index < textCandidates.size(); index += 1) {
                if (textCandidates.get(index).equals(id)) return textCandidateKinds.get(index);
            }
            return ACCOUNT_KIND_GENERIC;
        }

        private AutofillId nearestAfter(AutofillId anchor) {
            if (anchor == null) return null;
            boolean seenAnchor = false;
            for (AutofillId candidate : textCandidates) {
                if (candidate.equals(anchor)) {
                    seenAnchor = true;
                    continue;
                }
                if (!seenAnchor || candidate.equals(otpId)) continue;
                return candidate;
            }
            return null;
        }

        private AutofillId nearestBefore(AutofillId anchor) {
            if (anchor == null) return null;
            AutofillId previous = null;
            for (AutofillId candidate : textCandidates) {
                if (candidate.equals(anchor)) return previous;
                if (!candidate.equals(otpId)) previous = candidate;
            }
            return null;
        }

        private AutofillId firstTextExcept(AutofillId firstExcluded, AutofillId secondExcluded) {
            for (AutofillId candidate : textCandidates) {
                if (candidate.equals(firstExcluded) || candidate.equals(secondExcluded)) continue;
                return candidate;
            }
            return null;
        }

        private AutofillId lastTextExcept(AutofillId firstExcluded, AutofillId secondExcluded) {
            for (int index = textCandidates.size() - 1; index >= 0; index -= 1) {
                AutofillId candidate = textCandidates.get(index);
                if (candidate.equals(firstExcluded) || candidate.equals(secondExcluded)) continue;
                return candidate;
            }
            return null;
        }

        AutofillId[] autofillIds() {
            List<AutofillId> ids = new ArrayList<>();
            if (usernameId != null) ids.add(usernameId);
            for (AutofillId id : passwordIds()) addUnique(ids, id);
            if (otpId != null) ids.add(otpId);
            return ids.toArray(new AutofillId[0]);
        }

        void setNullValues(Dataset.Builder builder) {
            if (usernameId != null) builder.setValue(usernameId, (AutofillValue) null);
            for (AutofillId id : passwordIds()) builder.setValue(id, (AutofillValue) null);
            if (otpId != null) builder.setValue(otpId, (AutofillValue) null);
        }

        boolean hasFillableFields() {
            return usernameId != null || !passwordIds().isEmpty() || otpId != null;
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
            for (AutofillId id : passwordCandidates) addUnique(ids, id);
            return ids;
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
