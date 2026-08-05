package com.suzikuo.mypwdmg;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import org.json.JSONObject;
import org.junit.Test;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Base64;

public class PasskeyCallerPolicyTest {
    @Test
    public void androidOriginUsesCanonicalSha256Base64Url() throws Exception {
        byte[] certificate = "test-signing-certificate".getBytes(StandardCharsets.US_ASCII);
        String expected = "android:apk-key-hash:" + Base64.getUrlEncoder().withoutPadding().encodeToString(
            MessageDigest.getInstance("SHA-256").digest(certificate)
        );
        assertEquals(expected, PasskeyCallerPolicy.androidOrigin(certificate));
    }

    @Test
    public void reviewedAllowlistContainsOnlyStableChromeAndEdgePackages() throws Exception {
        JSONObject allowlist = new JSONObject(PasskeyCallerPolicy.privilegedAllowlistForTest());
        String text = allowlist.toString();
        assertTrue(text.contains("com.android.chrome"));
        assertTrue(text.contains("com.microsoft.emmx"));
        assertEquals(2, allowlist.getJSONArray("apps").length());
    }

    @Test
    public void nativeAppsFailClosedUntilDigitalAssetLinksAreVerified() {
        PasskeyCallerPolicy.CallerException error = assertThrows(
            PasskeyCallerPolicy.CallerException.class,
            () -> PasskeyCallerPolicy.requireVerifiedWebOrigin(false)
        );
        assertEquals("NATIVE_APP_DAL_REQUIRED", error.code);
        PasskeyCallerPolicy.requireVerifiedWebOrigin(true);
    }
}
