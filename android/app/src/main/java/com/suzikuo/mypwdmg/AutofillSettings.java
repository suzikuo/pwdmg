package com.suzikuo.mypwdmg;

import android.content.ComponentName;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.view.autofill.AutofillManager;

import org.json.JSONObject;

final class AutofillSettings {
    private static final String PREFS_NAME = "mypwdmg_autofill_settings";
    private static final String KEY_INLINE_SUGGESTIONS_ENABLED = "inline_suggestions_enabled";

    private AutofillSettings() {}

    static boolean isSupported() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.O;
    }

    static boolean isInlineSupported() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.R;
    }

    static boolean isInlineEnabled(Context context) {
        if (!isInlineSupported() || context == null) return false;
        SharedPreferences prefs = context.getApplicationContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        return prefs.getBoolean(KEY_INLINE_SUGGESTIONS_ENABLED, true);
    }

    static void setInlineEnabled(Context context, boolean enabled) {
        if (!isInlineSupported() || context == null) return;
        SharedPreferences prefs = context.getApplicationContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit().putBoolean(KEY_INLINE_SUGGESTIONS_ENABLED, enabled).apply();
    }

    static JSONObject state(Context context) throws Exception {
        boolean supported = isSupported();
        boolean enabled = false;
        if (supported && context != null) {
            AutofillManager manager = context.getSystemService(AutofillManager.class);
            enabled = manager != null && manager.hasEnabledAutofillServices();
        }
        boolean inlineSupported = isInlineSupported();
        boolean inlineEnabled = inlineSupported && isInlineEnabled(context);
        return new JSONObject()
            .put("supported", supported)
            .put("enabled", enabled)
            .put("serviceName", context == null ? "" : new ComponentName(context, PwdAutofillService.class).flattenToString())
            .put("settingsAvailable", supported)
            .put("inlineSupported", inlineSupported)
            .put("inlineEnabled", inlineEnabled);
    }
}
