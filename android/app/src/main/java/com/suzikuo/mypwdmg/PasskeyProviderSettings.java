package com.suzikuo.mypwdmg;

import android.annotation.TargetApi;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ComponentName;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.credentials.CredentialManager;
import android.os.Build;
import android.provider.Settings;

import org.json.JSONObject;

/** Controls provider component availability separately from the user's system selection. */
final class PasskeyProviderSettings {
    private PasskeyProviderSettings() {}

    static JSONObject state(Activity activity) throws Exception {
        ComponentName service = serviceName(activity);
        boolean supported = Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE;
        boolean componentEnabled = supported && isComponentEnabled(activity.getPackageManager(), service);
        boolean systemEnabled = supported && componentEnabled && isSystemProviderEnabled(activity, service);
        return new JSONObject()
            .put("supported", supported)
            .put("componentEnabled", componentEnabled)
            .put("systemEnabled", systemEnabled)
            .put("serviceName", service.flattenToString())
            .put("settingsAvailable", supported);
    }

    static JSONObject setComponentEnabled(Activity activity, boolean enabled) throws Exception {
        requireSupported();
        ComponentName service = serviceName(activity);
        activity.getPackageManager().setComponentEnabledSetting(
            service,
            enabled
                ? PackageManager.COMPONENT_ENABLED_STATE_ENABLED
                : PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
            PackageManager.DONT_KILL_APP
        );
        if (!enabled) PasskeyOperationBroker.getInstance().clear();
        return state(activity);
    }

    static JSONObject openSystemSettings(Activity activity) throws Exception {
        requireSupported();
        JSONObject current = state(activity);
        if (!current.getBoolean("componentEnabled")) {
            throw new IllegalStateException("请先开启通行密钥提供方");
        }
        activity.runOnUiThread(() -> {
            try {
                activity.startActivity(new Intent(Settings.ACTION_CREDENTIAL_PROVIDER));
            } catch (ActivityNotFoundException error) {
                activity.startActivity(new Intent(Settings.ACTION_SETTINGS));
            }
        });
        return current;
    }

    static boolean componentEnabledFromSetting(int setting, boolean manifestEnabled) {
        if (setting == PackageManager.COMPONENT_ENABLED_STATE_ENABLED) return true;
        if (setting == PackageManager.COMPONENT_ENABLED_STATE_DISABLED
            || setting == PackageManager.COMPONENT_ENABLED_STATE_DISABLED_USER
            || setting == PackageManager.COMPONENT_ENABLED_STATE_DISABLED_UNTIL_USED) {
            return false;
        }
        return manifestEnabled;
    }

    private static boolean isComponentEnabled(PackageManager manager, ComponentName service) throws Exception {
        int setting = manager.getComponentEnabledSetting(service);
        boolean manifestEnabled = manager.getServiceInfo(service, PackageManager.ComponentInfoFlags.of(0)).enabled;
        return componentEnabledFromSetting(setting, manifestEnabled);
    }

    @TargetApi(Build.VERSION_CODES.UPSIDE_DOWN_CAKE)
    private static boolean isSystemProviderEnabled(Activity activity, ComponentName service) {
        CredentialManager manager = activity.getSystemService(CredentialManager.class);
        return manager != null && manager.isEnabledCredentialProviderService(service);
    }

    private static ComponentName serviceName(Activity activity) {
        return new ComponentName(activity, PasskeyCredentialProviderService.class);
    }

    private static void requireSupported() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            throw new IllegalStateException("Android 14 以下不支持通行密钥提供方");
        }
    }
}
