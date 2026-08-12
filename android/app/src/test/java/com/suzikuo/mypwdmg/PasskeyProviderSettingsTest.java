package com.suzikuo.mypwdmg;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import android.content.pm.PackageManager;

import org.junit.Test;

public class PasskeyProviderSettingsTest {
    @Test
    public void explicitComponentStateOverridesManifestDefault() {
        assertTrue(PasskeyProviderSettings.componentEnabledFromSetting(
            PackageManager.COMPONENT_ENABLED_STATE_ENABLED,
            false
        ));
        assertFalse(PasskeyProviderSettings.componentEnabledFromSetting(
            PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
            true
        ));
    }

    @Test
    public void defaultComponentStateUsesManifestValue() {
        assertFalse(PasskeyProviderSettings.componentEnabledFromSetting(
            PackageManager.COMPONENT_ENABLED_STATE_DEFAULT,
            false
        ));
        assertTrue(PasskeyProviderSettings.componentEnabledFromSetting(
            PackageManager.COMPONENT_ENABLED_STATE_DEFAULT,
            true
        ));
    }
}
