package com.suzikuo.mypwdmg;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.service.autofill.Dataset;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.view.autofill.AutofillId;
import android.view.autofill.AutofillManager;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

public class AutofillPickerActivity extends Activity {
    private static final String TAG = "AutofillPicker";
    public static final String EXTRA_TARGET = "com.suzikuo.mypwdmg.extra.AUTOFILL_TARGET";
    public static final String EXTRA_INCLUDE_ALL = "com.suzikuo.mypwdmg.extra.AUTOFILL_INCLUDE_ALL";
    public static final String EXTRA_HOSTNAME = "com.suzikuo.mypwdmg.extra.AUTOFILL_HOSTNAME";
    public static final String EXTRA_TARGET_PACKAGE = "com.suzikuo.mypwdmg.extra.AUTOFILL_TARGET_PACKAGE";
    public static final String EXTRA_USERNAME_ID = "com.suzikuo.mypwdmg.extra.AUTOFILL_USERNAME_ID";
    public static final String EXTRA_PASSWORD_ID = "com.suzikuo.mypwdmg.extra.AUTOFILL_PASSWORD_ID";
    public static final String EXTRA_OTP_ID = "com.suzikuo.mypwdmg.extra.AUTOFILL_OTP_ID";
    public static final String EXTRA_ACCOUNT_KIND = "com.suzikuo.mypwdmg.extra.AUTOFILL_ACCOUNT_KIND";

    private AndroidVaultStore store;
    private PwdAutofillService.LoginFields fields;
    private JSONObject payload;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        configureFloatingWindow();
        setFinishOnTouchOutside(true);
        store = new AndroidVaultStore(this);

        fields = fieldsFromIntent(getIntent());
        if (!fields.hasFillableFields()) {
            finish();
            return;
        }
        if (fields.isOwnPackage(getPackageName())) {
            finish();
            return;
        }

        payload = store.tryUnlockWithEmptyPasswordForAutofill();
        if (payload == null) {
            showMessage("需要先解锁", "请先回到 My Password 解锁保险库");
            return;
        }

        try {
            String target = getIntent().getStringExtra(EXTRA_TARGET);
            if (target == null || target.trim().isEmpty()) target = fields.hostnameOrPackage();
            boolean includeAll = getIntent().getBooleanExtra(EXTRA_INCLUDE_ALL, fields.shouldFallbackToAllMatches());
            JSONArray matches = store.queryMatchesFromPayload(payload, target, includeAll);
            if (matches.length() == 0) {
                showMessage("没有匹配账号", target);
                return;
            }
            showMatches(target, matches);
        } catch (Exception error) {
            showMessage("无法读取账号", error.getMessage() == null ? "" : error.getMessage());
        }
    }

    private void showMatches(String target, JSONArray matches) throws Exception {
        FrameLayout shell = shell();
        LinearLayout root = card();

        LinearLayout header = new LinearLayout(this);
        header.setGravity(Gravity.CENTER_VERTICAL);
        header.setOrientation(LinearLayout.HORIZONTAL);

        LinearLayout titles = new LinearLayout(this);
        titles.setOrientation(LinearLayout.VERTICAL);
        titles.setLayoutParams(new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));

        TextView title = text("选择账号", 20, Color.rgb(25, 28, 33), Typeface.BOLD);
        TextView subtitle = text(target, 13, Color.rgb(100, 108, 119), Typeface.NORMAL);
        subtitle.setSingleLine(true);
        titles.addView(title);
        titles.addView(subtitle);

        TextView close = text("取消", 14, Color.rgb(74, 105, 189), Typeface.BOLD);
        close.setGravity(Gravity.CENTER);
        close.setPadding(dp(12), dp(8), dp(4), dp(8));
        close.setOnClickListener(view -> finish());

        header.addView(titles);
        header.addView(close);
        root.addView(header);

        ScrollView scroll = new MaxHeightScrollView(this, Math.min(dp(420), getResources().getDisplayMetrics().heightPixels / 2));
        LinearLayout list = new LinearLayout(this);
        list.setOrientation(LinearLayout.VERTICAL);
        list.setPadding(0, dp(14), 0, 0);
        scroll.addView(list);
        root.addView(scroll, new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        ));

        for (int index = 0; index < matches.length(); index += 1) {
            JSONObject match = matches.getJSONObject(index);
            list.addView(rowFor(match));
        }

        shell.addView(root);
        setContentView(shell);
        configureFloatingWindow();
    }

    private View rowFor(JSONObject match) {
        LinearLayout row = new LinearLayout(this);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setPadding(dp(14), dp(12), dp(12), dp(12));

        GradientDrawable background = new GradientDrawable();
        background.setColor(Color.WHITE);
        background.setCornerRadius(dp(8));
        row.setBackground(background);

        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        );
        params.setMargins(0, 0, 0, dp(10));
        row.setLayoutParams(params);

        LinearLayout texts = new LinearLayout(this);
        texts.setOrientation(LinearLayout.VERTICAL);
        texts.setLayoutParams(new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));

        TextView title = text(match.optString("title", "My Password"), 16, Color.rgb(29, 33, 41), Typeface.BOLD);
        title.setSingleLine(true);
        TextView subtitle = text(subtitleFor(match), 13, Color.rgb(116, 124, 135), Typeface.NORMAL);
        subtitle.setSingleLine(true);
        texts.addView(title);
        texts.addView(subtitle);

        TextView arrow = text("›", 24, Color.rgb(144, 149, 158), Typeface.NORMAL);
        arrow.setGravity(Gravity.CENTER);

        row.addView(texts);
        row.addView(arrow, new LinearLayout.LayoutParams(dp(28), LinearLayout.LayoutParams.WRAP_CONTENT));
        row.setOnClickListener(view -> fill(match.optString("id")));
        return row;
    }

    private String subtitleFor(JSONObject match) {
        String username = match.optString("username");
        if (!username.isEmpty()) return username;
        String email = match.optString("email");
        if (!email.isEmpty()) return email;
        String phone = match.optString("phone");
        if (!phone.isEmpty()) return phone;
        JSONArray domains = match.optJSONArray("domains");
        if (domains != null && domains.length() > 0) return domains.optString(0);
        return "点击填充";
    }

    private void fill(String entryId) {
        try {
            JSONObject match = findMatch(entryId);
            JSONObject fill = store.getFillPayloadFromPayload(payload, entryId);
            Dataset dataset = PwdAutofillService.buildDataset(this, fields, match, fill, PwdAutofillService.labelFor(match));
            if (dataset == null) {
                Log.d(TAG, "No dataset built. usernameId=" + (fields.usernameId != null) + ", passwordId=" + (fields.passwordId != null) + ", otpId=" + (fields.otpId != null));
                finish();
                return;
            }
            Intent result = new Intent();
            result.putExtra(AutofillManager.EXTRA_AUTHENTICATION_RESULT, dataset);
            setResult(Activity.RESULT_OK, result);
            Log.d(TAG, "Returning dataset. usernameId=" + (fields.usernameId != null) + ", passwordId=" + (fields.passwordId != null) + ", otpId=" + (fields.otpId != null));
            finish();
        } catch (Exception error) {
            showMessage("填充失败", error.getMessage() == null ? "" : error.getMessage());
        }
    }

    private JSONObject findMatch(String entryId) throws Exception {
        String target = getIntent().getStringExtra(EXTRA_TARGET);
        if (target == null || target.trim().isEmpty()) target = fields.hostnameOrPackage();
        boolean includeAll = getIntent().getBooleanExtra(EXTRA_INCLUDE_ALL, fields.shouldFallbackToAllMatches());
        JSONArray matches = store.queryMatchesFromPayload(payload, target, includeAll);
        for (int index = 0; index < matches.length(); index += 1) {
            JSONObject match = matches.getJSONObject(index);
            if (entryId.equals(match.optString("id"))) return match;
        }
        throw new IllegalArgumentException("账号不存在");
    }

    private void showMessage(String titleText, String messageText) {
        FrameLayout shell = shell();
        LinearLayout root = card();
        root.setGravity(Gravity.CENTER);

        TextView title = text(titleText, 20, Color.rgb(25, 28, 33), Typeface.BOLD);
        title.setGravity(Gravity.CENTER);
        TextView message = text(messageText == null ? "" : messageText, 14, Color.rgb(100, 108, 119), Typeface.NORMAL);
        message.setGravity(Gravity.CENTER);
        message.setPadding(0, dp(8), 0, dp(18));
        TextView close = text("关闭", 15, Color.rgb(74, 105, 189), Typeface.BOLD);
        close.setGravity(Gravity.CENTER);
        close.setPadding(dp(18), dp(10), dp(18), dp(10));
        close.setOnClickListener(view -> finish());

        root.addView(title);
        root.addView(message);
        root.addView(close);
        shell.addView(root);
        setContentView(shell);
        configureFloatingWindow();
    }

    private FrameLayout shell() {
        FrameLayout shell = new FrameLayout(this);
        shell.setPadding(dp(12), dp(8), dp(12), dp(14));
        shell.setBackgroundColor(Color.TRANSPARENT);
        shell.setOnClickListener(view -> finish());
        return shell;
    }

    private LinearLayout card() {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(18), dp(14), dp(18), dp(18));
        card.setClickable(true);

        GradientDrawable background = new GradientDrawable();
        background.setColor(Color.rgb(247, 248, 250));
        background.setCornerRadius(dp(18));
        card.setBackground(background);
        card.setElevation(dp(10));

        card.setLayoutParams(new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.WRAP_CONTENT,
            Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL
        ));
        return card;
    }

    private void configureFloatingWindow() {
        Window window = getWindow();
        if (window == null) return;
        window.setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));
        window.setGravity(Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL);
        window.setDimAmount(0.18f);
        window.addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);
        window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);

        WindowManager.LayoutParams attrs = window.getAttributes();
        attrs.width = WindowManager.LayoutParams.MATCH_PARENT;
        attrs.height = WindowManager.LayoutParams.MATCH_PARENT;
        attrs.gravity = Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL;
        attrs.y = 0;
        window.setAttributes(attrs);
    }

    private TextView text(String value, int sp, int color, int style) {
        TextView view = new TextView(this);
        view.setText(value == null ? "" : value);
        view.setTextSize(sp);
        view.setTextColor(color);
        view.setTypeface(Typeface.DEFAULT, style);
        return view;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private PwdAutofillService.LoginFields fieldsFromIntent(Intent intent) {
        PwdAutofillService.LoginFields next = new PwdAutofillService.LoginFields();
        next.hostname = intent.getStringExtra(EXTRA_HOSTNAME);
        next.targetPackageName = intent.getStringExtra(EXTRA_TARGET_PACKAGE);
        next.usernameId = (AutofillId) intent.getParcelableExtra(EXTRA_USERNAME_ID);
        next.passwordId = (AutofillId) intent.getParcelableExtra(EXTRA_PASSWORD_ID);
        next.otpId = (AutofillId) intent.getParcelableExtra(EXTRA_OTP_ID);
        return next;
    }

    private static class MaxHeightScrollView extends ScrollView {
        private final int maxHeight;

        MaxHeightScrollView(Context context, int maxHeight) {
            super(context);
            this.maxHeight = maxHeight;
        }

        @Override
        protected void onMeasure(int widthMeasureSpec, int heightMeasureSpec) {
            int nextHeight = MeasureSpec.makeMeasureSpec(maxHeight, MeasureSpec.AT_MOST);
            super.onMeasure(widthMeasureSpec, nextHeight);
        }
    }
}
