package com.suzikuo.mypwdmg;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.net.URI;
import java.net.URISyntaxException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Strict boundary between platform-supplied WebAuthn request JSON and native passkey operations.
 * This class deliberately keeps no raw request JSON and has no access to vault private keys.
 */
final class PasskeyOperation {
    static final int PROTOCOL_VERSION = 1;

    private static final Pattern BASE64URL_PATTERN = Pattern.compile("^[A-Za-z0-9_-]+$");
    private static final String ANDROID_ORIGIN_PREFIX = "android:apk-key-hash:";
    private static final Pattern DOMAIN_LABEL_PATTERN = Pattern.compile(
        "^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$"
    );
    private static final Object MISSING = new Object();
    private static final int MAX_REQUEST_BYTES = 64 * 1024;
    private static final int MAX_ORIGIN_BYTES = 2 * 1024;
    private static final int MIN_CHALLENGE_BYTES = 16;
    private static final int MAX_CHALLENGE_BYTES = 1024;
    private static final int MAX_CREDENTIAL_ID_BYTES = 2048;
    private static final int MAX_CREDENTIAL_DESCRIPTORS = 100;
    private static final int MAX_USER_ID_BYTES = 64;
    private static final int MAX_USER_TEXT_BYTES = 512;
    private static final int MAX_RP_TEXT_BYTES = 512;
    private static final long DEFAULT_TIMEOUT_MS = 60_000L;
    private static final long MIN_TIMEOUT_MS = 15_000L;
    private static final long MAX_TIMEOUT_MS = 120_000L;
    private static final int MIN_OPERATION_ID_BYTES = 16;
    private static final int MAX_OPERATION_ID_BYTES = 64;
    private static final long MAX_SAFE_INTEGER = (1L << 53) - 1;

    private PasskeyOperation() {}

    enum Kind {
        CREATE,
        GET;

        static Kind fromWireValue(String value) {
            if ("create".equals(value)) return CREATE;
            if ("get".equals(value)) return GET;
            throw new OperationException("INVALID_REQUEST_JSON");
        }
    }

    enum Status {
        SUCCEEDED,
        CANCELLED,
        REJECTED,
        FAILED
    }

    static final class OperationException extends IllegalArgumentException {
        final String code;

        OperationException(String code) {
            super(code);
            this.code = code;
        }
    }

    static final class CreateUser {
        final String id;
        final String name;
        final String displayName;

        CreateUser(String id, String name, String displayName) {
            this.id = id;
            this.name = name;
            this.displayName = displayName;
        }
    }

    static final class Operation {
        final int protocolVersion;
        final Kind kind;
        final String origin;
        final String rpId;
        final String challenge;
        final String clientDataHash;
        final String clientDataJson;
        final long timeoutMs;
        final List<String> credentialIds;
        final boolean requiresUserVerification;
        final String rpName;
        final CreateUser user;
        final int algorithm;
        final boolean discoverable;

        Operation(
            Kind kind,
            String origin,
            String rpId,
            String challenge,
            String clientDataHash,
            long timeoutMs,
            List<String> credentialIds,
            String rpName,
            CreateUser user,
            int algorithm,
            boolean discoverable,
            String clientDataJson
        ) {
            this.protocolVersion = PROTOCOL_VERSION;
            this.kind = kind;
            this.origin = origin;
            this.rpId = rpId;
            this.challenge = challenge;
            this.clientDataHash = clientDataHash;
            this.clientDataJson = clientDataJson;
            this.timeoutMs = timeoutMs;
            this.credentialIds = Collections.unmodifiableList(new ArrayList<>(credentialIds));
            this.requiresUserVerification = true;
            this.rpName = rpName;
            this.user = user;
            this.algorithm = algorithm;
            this.discoverable = discoverable;
        }
    }

    static final class NativeOperation {
        final Operation operation;
        final String operationId;
        final long issuedAt;
        final long expiresAt;

        NativeOperation(Operation operation, String operationId, long issuedAt, long expiresAt) {
            this.operation = operation;
            this.operationId = operationId;
            this.issuedAt = issuedAt;
            this.expiresAt = expiresAt;
        }
    }

    static final class Outcome {
        final Kind kind;
        final String operationId;
        final Status status;
        final String platformResponseJson;

        Outcome(Kind kind, String operationId, Status status, String platformResponseJson) {
            this.kind = kind;
            this.operationId = operationId;
            this.status = status;
            this.platformResponseJson = platformResponseJson;
        }
    }

    static final class Diagnostic {
        final Kind kind;
        final Status status;
        final String code;

        Diagnostic(Kind kind, Status status, String code) {
            this.kind = kind;
            this.status = status;
            this.code = code;
        }
    }

    static Operation parse(Kind kind, String requestJson, String trustedOrigin, String clientDataHash) {
        TrustedOrigin origin = readTrustedOrigin(trustedOrigin);
        String canonicalClientDataHash = readBase64Url(
            clientDataHash,
            "INVALID_CLIENT_DATA_HASH",
            32,
            32
        );
        JSONObject request = readRequestJson(requestJson);
        JSONObject rp = kind == Kind.CREATE ? readObject(field(request, "rp"), "INVALID_RP") : null;
        String rpId = readRpId(kind == Kind.CREATE ? field(rp, "id") : field(request, "rpId"), origin.host);
        List<String> credentialIds = readCredentialDescriptors(
            kind == Kind.CREATE ? field(request, "excludeCredentials") : field(request, "allowCredentials")
        );
        String challenge = readBase64Url(
            field(request, "challenge"),
            "INVALID_CHALLENGE",
            MIN_CHALLENGE_BYTES,
            MAX_CHALLENGE_BYTES
        );
        long timeoutMs = readTimeout(field(request, "timeout"));

        if (kind == Kind.GET) {
            readUserVerification(field(request, "userVerification"));
            return new Operation(
                kind,
                origin.value,
                rpId,
                challenge,
                canonicalClientDataHash,
                timeoutMs,
                credentialIds,
                null,
                null,
                0,
                false,
                "{}"
            );
        }

        JSONObject user = readObject(field(request, "user"), "INVALID_USER");
        readCreateSelection(field(request, "authenticatorSelection"));
        requireEs256(field(request, "pubKeyCredParams"));
        return new Operation(
            kind,
            origin.value,
            rpId,
            challenge,
            canonicalClientDataHash,
            timeoutMs,
            credentialIds,
            readWireText(field(rp, "name"), "INVALID_RP", MAX_RP_TEXT_BYTES),
            new CreateUser(
                readBase64Url(field(user, "id"), "INVALID_USER", 1, MAX_USER_ID_BYTES),
                readWireText(field(user, "name"), "INVALID_USER", MAX_USER_TEXT_BYTES),
                readWireText(field(user, "displayName"), "INVALID_USER", MAX_USER_TEXT_BYTES)
            ),
            -7,
            true,
            "{}"
        );
    }

    static Operation parse(Kind kind, String requestJson, String trustedOrigin, byte[] clientDataHash) {
        if (clientDataHash == null || clientDataHash.length != 32) {
            throw new OperationException("INVALID_CLIENT_DATA_HASH");
        }
        return parse(
            kind,
            requestJson,
            trustedOrigin,
            Base64.getUrlEncoder().withoutPadding().encodeToString(clientDataHash)
        );
    }

    static Operation parsePlatform(
        Kind kind,
        String requestJson,
        String trustedOrigin,
        byte[] suppliedClientDataHash
    ) {
        if (suppliedClientDataHash != null) {
            return parse(kind, requestJson, trustedOrigin, suppliedClientDataHash);
        }
        try {
            Operation provisional = parse(kind, requestJson, trustedOrigin, new byte[32]);
            String clientDataJson = new JSONObject()
                .put("type", kind == Kind.CREATE ? "webauthn.create" : "webauthn.get")
                .put("challenge", provisional.challenge)
                .put("origin", provisional.origin)
                .put("crossOrigin", false)
                .toString();
            String clientDataHash = Base64.getUrlEncoder().withoutPadding().encodeToString(
                MessageDigest.getInstance("SHA-256").digest(clientDataJson.getBytes(StandardCharsets.UTF_8))
            );
            return copyWithClientData(provisional, clientDataHash, clientDataJson);
        } catch (OperationException error) {
            throw error;
        } catch (Exception error) {
            throw new OperationException("INVALID_CLIENT_DATA_HASH");
        }
    }

    static boolean sameCeremony(Operation left, Operation right) {
        return left != null
            && right != null
            && left.kind == right.kind
            && left.origin.equals(right.origin)
            && left.rpId.equals(right.rpId)
            && left.challenge.equals(right.challenge)
            && left.clientDataHash.equals(right.clientDataHash)
            && left.credentialIds.equals(right.credentialIds)
            && sameText(left.rpName, right.rpName)
            && sameUser(left.user, right.user)
            && left.algorithm == right.algorithm
            && left.discoverable == right.discoverable;
    }

    private static Operation copyWithClientData(Operation source, String hash, String json) {
        return new Operation(
            source.kind,
            source.origin,
            source.rpId,
            source.challenge,
            hash,
            source.timeoutMs,
            source.credentialIds,
            source.rpName,
            source.user,
            source.algorithm,
            source.discoverable,
            json
        );
    }

    private static boolean sameUser(CreateUser left, CreateUser right) {
        if (left == null || right == null) return left == right;
        return left.id.equals(right.id)
            && left.name.equals(right.name)
            && left.displayName.equals(right.displayName);
    }

    private static boolean sameText(String left, String right) {
        return left == null ? right == null : left.equals(right);
    }

    static NativeOperation bindNativeOperation(Operation operation, String operationId, long issuedAt) {
        String canonicalId = readBase64Url(
            operationId,
            "INVALID_OPERATION_ID",
            MIN_OPERATION_ID_BYTES,
            MAX_OPERATION_ID_BYTES
        );
        if (issuedAt <= 0 || issuedAt > MAX_SAFE_INTEGER - operation.timeoutMs) {
            throw new OperationException("INVALID_OPERATION_TICKET");
        }
        return new NativeOperation(operation, canonicalId, issuedAt, issuedAt + operation.timeoutMs);
    }

    static boolean isExpired(NativeOperation ticket, long now) {
        if (now <= 0) throw new OperationException("INVALID_OPERATION_TICKET");
        return now >= ticket.expiresAt;
    }

    static Outcome createSucceededOutcome(NativeOperation ticket, String platformResponseJson) {
        readPlatformResponseJson(platformResponseJson);
        return new Outcome(ticket.operation.kind, ticket.operationId, Status.SUCCEEDED, platformResponseJson);
    }

    static Outcome createCancelledOutcome(NativeOperation ticket) {
        return createTerminalOutcome(ticket, Status.CANCELLED);
    }

    static Outcome createRejectedOutcome(NativeOperation ticket) {
        return createTerminalOutcome(ticket, Status.REJECTED);
    }

    static Outcome createFailedOutcome(NativeOperation ticket) {
        return createTerminalOutcome(ticket, Status.FAILED);
    }

    static Diagnostic toDiagnostic(Outcome outcome) {
        String code;
        switch (outcome.status) {
            case SUCCEEDED:
                code = "SUCCESS";
                break;
            case CANCELLED:
                code = "CANCELLED";
                break;
            case REJECTED:
                code = "REJECTED";
                break;
            default:
                code = "FAILED";
                break;
        }
        return new Diagnostic(outcome.kind, outcome.status, code);
    }

    private static Outcome createTerminalOutcome(NativeOperation ticket, Status status) {
        return new Outcome(ticket.operation.kind, ticket.operationId, status, null);
    }

    private static JSONObject readRequestJson(String value) {
        String requestJson = readWireText(value, "INVALID_REQUEST_JSON", MAX_REQUEST_BYTES);
        try {
            return new JSONObject(requestJson);
        } catch (JSONException error) {
            throw new OperationException("INVALID_REQUEST_JSON");
        }
    }

    private static TrustedOrigin readTrustedOrigin(String value) {
        String origin = readWireText(value, "INVALID_ORIGIN", MAX_ORIGIN_BYTES);
        if (origin.startsWith(ANDROID_ORIGIN_PREFIX)) {
            readBase64Url(
                origin.substring(ANDROID_ORIGIN_PREFIX.length()),
                "INVALID_ORIGIN",
                32,
                32
            );
            return new TrustedOrigin(origin, null);
        }
        final URI uri;
        try {
            uri = new URI(origin);
        } catch (URISyntaxException error) {
            throw new OperationException("INVALID_ORIGIN");
        }
        String scheme = uri.getScheme();
        String host = uri.getHost();
        if (scheme == null || host == null) throw new OperationException("INVALID_ORIGIN");
        scheme = scheme.toLowerCase(Locale.ROOT);
        host = host.toLowerCase(Locale.ROOT);
        if (uri.isOpaque()
            || uri.getRawUserInfo() != null
            || uri.getRawPath() != null && !uri.getRawPath().isEmpty()
            || uri.getRawQuery() != null
            || uri.getRawFragment() != null
            || !("https".equals(scheme) || "http".equals(scheme))
            || !isWebAuthnDomain(host)) {
            throw new OperationException("INVALID_ORIGIN");
        }
        if ("http".equals(scheme) && !"localhost".equals(host)) {
            throw new OperationException("INVALID_ORIGIN");
        }
        int port = uri.getPort();
        String canonicalPort = "";
        if (port != -1 && !("https".equals(scheme) && port == 443) && !("http".equals(scheme) && port == 80)) {
            canonicalPort = ":" + port;
        }
        String canonical = scheme + "://" + host + canonicalPort;
        if (!origin.equals(canonical)) throw new OperationException("INVALID_ORIGIN");
        return new TrustedOrigin(origin, host);
    }

    private static String readRpId(Object value, String originHost) {
        if (value == MISSING && originHost == null) throw new OperationException("INVALID_RP_ID");
        String rpId = value == MISSING
            ? originHost
            : readWireText(value, "INVALID_RP_ID", 253).toLowerCase(Locale.ROOT);
        if (!isWebAuthnDomain(rpId)) throw new OperationException("INVALID_RP_ID");
        return rpId;
    }

    private static List<String> readCredentialDescriptors(Object value) {
        if (value == MISSING) return Collections.emptyList();
        if (!(value instanceof JSONArray)) throw new OperationException("INVALID_CREDENTIAL_DESCRIPTOR");
        JSONArray descriptors = (JSONArray) value;
        if (descriptors.length() > MAX_CREDENTIAL_DESCRIPTORS) {
            throw new OperationException("INVALID_CREDENTIAL_DESCRIPTOR");
        }
        List<String> ids = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        for (int index = 0; index < descriptors.length(); index += 1) {
            final Object valueAtIndex;
            try {
                valueAtIndex = descriptors.get(index);
            } catch (JSONException error) {
                throw new OperationException("INVALID_CREDENTIAL_DESCRIPTOR");
            }
            JSONObject descriptor = readObject(valueAtIndex, "INVALID_CREDENTIAL_DESCRIPTOR");
            if (!"public-key".equals(field(descriptor, "type"))) {
                throw new OperationException("INVALID_CREDENTIAL_DESCRIPTOR");
            }
            String credentialId = readBase64Url(
                field(descriptor, "id"),
                "INVALID_CREDENTIAL_DESCRIPTOR",
                1,
                MAX_CREDENTIAL_ID_BYTES
            );
            if (!seen.add(credentialId)) throw new OperationException("DUPLICATE_CREDENTIAL_ID");
            ids.add(credentialId);
        }
        return ids;
    }

    private static void readCreateSelection(Object value) {
        if (value == MISSING) return;
        JSONObject selection = readObject(value, "UNSUPPORTED_RESIDENT_KEY");
        Object residentKey = field(selection, "residentKey");
        if (residentKey != MISSING) {
            if (!("required".equals(residentKey) || "preferred".equals(residentKey) || "discouraged".equals(residentKey))) {
                throw new OperationException("UNSUPPORTED_RESIDENT_KEY");
            }
            if ("discouraged".equals(residentKey)) throw new OperationException("UNSUPPORTED_RESIDENT_KEY");
        }
        Object requireResidentKey = field(selection, "requireResidentKey");
        if (requireResidentKey != MISSING && !(requireResidentKey instanceof Boolean)) {
            throw new OperationException("UNSUPPORTED_RESIDENT_KEY");
        }
        Object authenticatorAttachment = field(selection, "authenticatorAttachment");
        if (authenticatorAttachment != MISSING && !"platform".equals(authenticatorAttachment)) {
            throw new OperationException("UNSUPPORTED_AUTHENTICATOR_ATTACHMENT");
        }
        readUserVerification(field(selection, "userVerification"));
    }

    private static void readUserVerification(Object value) {
        if (value == MISSING) return;
        if (!("required".equals(value) || "preferred".equals(value) || "discouraged".equals(value))) {
            throw new OperationException("INVALID_USER_VERIFICATION");
        }
    }

    private static void requireEs256(Object value) {
        if (!(value instanceof JSONArray)) throw new OperationException("UNSUPPORTED_ALGORITHM");
        JSONArray parameters = (JSONArray) value;
        if (parameters.length() == 0 || parameters.length() > 32) {
            throw new OperationException("UNSUPPORTED_ALGORITHM");
        }
        for (int index = 0; index < parameters.length(); index += 1) {
            try {
                Object valueAtIndex = parameters.get(index);
                if (!(valueAtIndex instanceof JSONObject)) continue;
                JSONObject parameter = (JSONObject) valueAtIndex;
                if ("public-key".equals(field(parameter, "type")) && isIntegerValue(field(parameter, "alg"), -7)) {
                    return;
                }
            } catch (JSONException error) {
                throw new OperationException("UNSUPPORTED_ALGORITHM");
            }
        }
        throw new OperationException("UNSUPPORTED_ALGORITHM");
    }

    private static long readTimeout(Object value) {
        if (value == MISSING) return DEFAULT_TIMEOUT_MS;
        long timeout = readSafePositiveInteger(value, "INVALID_TIMEOUT");
        return Math.max(MIN_TIMEOUT_MS, Math.min(MAX_TIMEOUT_MS, timeout));
    }

    private static void readPlatformResponseJson(String value) {
        String responseJson = readWireText(value, "INVALID_PLATFORM_RESPONSE", MAX_REQUEST_BYTES);
        try {
            new JSONObject(responseJson);
        } catch (JSONException error) {
            throw new OperationException("INVALID_PLATFORM_RESPONSE");
        }
    }

    private static JSONObject readObject(Object value, String code) {
        if (!(value instanceof JSONObject)) throw new OperationException(code);
        return (JSONObject) value;
    }

    private static Object field(JSONObject object, String key) {
        if (!object.has(key)) return MISSING;
        try {
            return object.get(key);
        } catch (JSONException error) {
            throw new OperationException("INVALID_REQUEST_JSON");
        }
    }

    private static String readWireText(Object value, String code, int maxBytes) {
        if (!(value instanceof String)) throw new OperationException(code);
        String text = (String) value;
        if (text.isEmpty() || hasEdgeWhitespace(text) || text.getBytes(StandardCharsets.UTF_8).length > maxBytes) {
            throw new OperationException(code);
        }
        return text;
    }

    private static String readBase64Url(Object value, String code, int minBytes, int maxBytes) {
        String text = readWireText(value, code, maxBytes * 2);
        if (!BASE64URL_PATTERN.matcher(text).matches()) throw new OperationException(code);
        final byte[] decoded;
        try {
            decoded = Base64.getUrlDecoder().decode(text);
        } catch (IllegalArgumentException error) {
            throw new OperationException(code);
        }
        String canonical = Base64.getUrlEncoder().withoutPadding().encodeToString(decoded);
        if (!canonical.equals(text) || decoded.length < minBytes || decoded.length > maxBytes) {
            throw new OperationException(code);
        }
        return text;
    }

    private static long readSafePositiveInteger(Object value, String code) {
        if (!(value instanceof Number)) throw new OperationException(code);
        double number = ((Number) value).doubleValue();
        if (!Double.isFinite(number)
            || number != Math.rint(number)
            || number <= 0
            || number > MAX_SAFE_INTEGER) {
            throw new OperationException(code);
        }
        return (long) number;
    }

    private static boolean isIntegerValue(Object value, int expected) {
        if (!(value instanceof Number)) return false;
        double number = ((Number) value).doubleValue();
        return Double.isFinite(number) && number == expected;
    }

    private static boolean isWebAuthnDomain(String value) {
        if (value == null || value.isEmpty() || value.length() > 253 || value.endsWith(".")) return false;
        String[] labels = value.split("\\.", -1);
        if (!"localhost".equals(value) && labels.length < 2) return false;
        for (String label : labels) {
            if (!DOMAIN_LABEL_PATTERN.matcher(label).matches()) return false;
        }
        return true;
    }

    private static boolean hasEdgeWhitespace(String value) {
        int first = value.codePointAt(0);
        int last = value.codePointBefore(value.length());
        return Character.isWhitespace(first) || Character.isSpaceChar(first)
            || Character.isWhitespace(last) || Character.isSpaceChar(last);
    }

    private static final class TrustedOrigin {
        final String value;
        final String host;

        TrustedOrigin(String value, String host) {
            this.value = value;
            this.host = host;
        }
    }
}
