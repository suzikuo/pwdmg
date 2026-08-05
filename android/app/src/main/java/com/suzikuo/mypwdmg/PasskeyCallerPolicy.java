package com.suzikuo.mypwdmg;

import androidx.credentials.provider.CallingAppInfo;

import java.security.MessageDigest;
import java.util.Base64;

/** Resolves platform-authenticated callers without trusting Intent extras or request JSON origins. */
final class PasskeyCallerPolicy {
    private static final String PRIVILEGED_ALLOWLIST = "{\"apps\":["
        + "{\"type\":\"android\",\"info\":{\"package_name\":\"com.android.chrome\",\"signatures\":["
        + "{\"build\":\"release\",\"cert_fingerprint_sha256\":\"F0:FD:6C:5B:41:0F:25:CB:25:C3:B5:33:46:C8:97:2F:AE:30:F8:EE:74:11:DF:91:04:80:AD:6B:2D:60:DB:83\"}]}},"
        + "{\"type\":\"android\",\"info\":{\"package_name\":\"com.microsoft.emmx\",\"signatures\":["
        + "{\"build\":\"release\",\"cert_fingerprint_sha256\":\"01:E1:99:97:10:A8:2C:27:49:B4:D5:0C:44:5D:C8:5D:67:0B:61:36:08:9D:0A:76:6A:73:82:7C:82:A1:EA:C9\"}]}}]}";

    private PasskeyCallerPolicy() {}

    static AuthorizedRequest authorize(
        PasskeyOperation.Kind kind,
        String requestJson,
        byte[] clientDataHash,
        CallingAppInfo callingAppInfo
    ) {
        if (callingAppInfo == null) throw new CallerException("CALLER_MISSING");
        try {
            boolean privileged = callingAppInfo.isOriginPopulated();
            requireVerifiedWebOrigin(privileged);
            if (clientDataHash == null || clientDataHash.length != 32) {
                throw new CallerException("CLIENT_DATA_HASH_MISSING");
            }
            String origin = callingAppInfo.getOrigin(PRIVILEGED_ALLOWLIST);
            if (origin == null || origin.isEmpty()) throw new CallerException("ORIGIN_UNAUTHORIZED");
            PasskeyOperation.Operation operation = PasskeyOperation.parsePlatform(
                kind,
                requestJson,
                origin,
                clientDataHash
            );
            return new AuthorizedRequest(
                operation,
                callingAppInfo.getPackageName() + "\n" + origin,
                callingAppInfo.getPackageName(),
                privileged
            );
        } catch (CallerException | PasskeyOperation.OperationException error) {
            throw error;
        } catch (Exception error) {
            throw new CallerException("CALLER_UNAUTHORIZED");
        }
    }

    static String androidOrigin(byte[] signingCertificate) {
        if (signingCertificate == null || signingCertificate.length == 0) {
            throw new CallerException("CALLER_SIGNATURE_MISSING");
        }
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(signingCertificate);
            return "android:apk-key-hash:"
                + Base64.getUrlEncoder().withoutPadding().encodeToString(digest);
        } catch (Exception error) {
            throw new CallerException("CALLER_SIGNATURE_INVALID");
        }
    }

    static void requireVerifiedWebOrigin(boolean privileged) {
        if (!privileged) {
            // Native Android callers require RP-specific Digital Asset Links verification.
            throw new CallerException("NATIVE_APP_DAL_REQUIRED");
        }
    }

    static String privilegedAllowlistForTest() {
        return PRIVILEGED_ALLOWLIST;
    }

    static final class AuthorizedRequest {
        final PasskeyOperation.Operation operation;
        final String callerBinding;
        final String packageName;
        final boolean privileged;

        AuthorizedRequest(
            PasskeyOperation.Operation operation,
            String callerBinding,
            String packageName,
            boolean privileged
        ) {
            this.operation = operation;
            this.callerBinding = callerBinding;
            this.packageName = packageName;
            this.privileged = privileged;
        }
    }

    static final class CallerException extends SecurityException {
        final String code;

        CallerException(String code) {
            super(code);
            this.code = code;
        }
    }
}
