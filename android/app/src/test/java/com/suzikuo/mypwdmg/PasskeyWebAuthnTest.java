package com.suzikuo.mypwdmg;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import com.authlete.cbor.CBORParser;

import org.json.JSONObject;
import org.junit.Test;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.Signature;
import java.util.Base64;
import java.util.Map;

public class PasskeyWebAuthnTest {
    @Test
    public void creationBuildsNoneAttestationAndValidatedPortableKeyMaterial() throws Exception {
        PasskeyOperation.Operation operation = createOperation();
        PasskeyWebAuthn.CreatedCredential created = PasskeyWebAuthn.create(operation);
        PasskeyKeyMaterial.load(
            created.passkey.getString("publicKeyCose"),
            created.passkey.getString("privateKeyPkcs8")
        );

        JSONObject response = new JSONObject(created.responseJson);
        assertEquals(created.passkey.getString("credentialId"), response.getString("rawId"));
        JSONObject authenticatorResponse = response.getJSONObject("response");
        byte[] clientDataJson = b64d(authenticatorResponse.getString("clientDataJSON"));
        assertArrayEquals(b64d(operation.clientDataHash), sha256(clientDataJson));

        Object attestationValue = new CBORParser(b64d(authenticatorResponse.getString("attestationObject"))).next();
        assertTrue(attestationValue instanceof Map);
        @SuppressWarnings("unchecked")
        Map<Object, Object> attestation = (Map<Object, Object>) attestationValue;
        assertEquals("none", attestation.get("fmt"));
        byte[] authenticatorData = (byte[]) attestation.get("authData");
        assertArrayEquals(sha256("example.com".getBytes(StandardCharsets.UTF_8)), slice(authenticatorData, 0, 32));
        assertEquals(0x4d, authenticatorData[32] & 0xff);
    }

    @Test
    public void assertionSignsAuthenticatorDataAndSuppliedClientHash() throws Exception {
        PasskeyWebAuthn.CreatedCredential created = PasskeyWebAuthn.create(createOperation());
        PasskeyOperation.Operation get = getOperation(created.passkey.getString("credentialId"));
        JSONObject response = new JSONObject(PasskeyWebAuthn.assertCredential(get, created.passkey));
        JSONObject authenticatorResponse = response.getJSONObject("response");

        byte[] authenticatorData = b64d(authenticatorResponse.getString("authenticatorData"));
        assertEquals(0x0d, authenticatorData[32] & 0xff);
        byte[] signed = concatenate(authenticatorData, b64d(get.clientDataHash));
        Signature verifier = Signature.getInstance("SHA256withECDSA");
        verifier.initVerify(PasskeyKeyMaterial.load(
            created.passkey.getString("publicKeyCose"),
            created.passkey.getString("privateKeyPkcs8")
        ).publicKey);
        verifier.update(signed);
        assertTrue(verifier.verify(b64d(authenticatorResponse.getString("signature"))));
        assertEquals(created.passkey.getString("userHandle"), authenticatorResponse.getString("userHandle"));
    }

    @Test
    public void privilegedBrowserFlowUsesSuppliedHashAndPlaceholderClientData() throws Exception {
        byte[] suppliedHash = sha256("browser-owned-client-data".getBytes(StandardCharsets.UTF_8));
        PasskeyOperation.Operation create = PasskeyOperation.parsePlatform(
            PasskeyOperation.Kind.CREATE,
            "{\"challenge\":\"AAECAwQFBgcICQoLDA0ODw\","
                + "\"rp\":{\"id\":\"example.com\",\"name\":\"Example\"},"
                + "\"user\":{\"id\":\"dXNlci0x\",\"name\":\"alice@example.com\",\"displayName\":\"Alice\"},"
                + "\"pubKeyCredParams\":[{\"type\":\"public-key\",\"alg\":-7}]}",
            "https://login.example.com",
            suppliedHash
        );
        PasskeyWebAuthn.CreatedCredential created = PasskeyWebAuthn.create(create);
        JSONObject createResponse = new JSONObject(created.responseJson).getJSONObject("response");
        assertEquals("{}", new String(b64d(createResponse.getString("clientDataJSON")), StandardCharsets.UTF_8));
        assertArrayEquals(suppliedHash, b64d(create.clientDataHash));

        PasskeyOperation.Operation get = PasskeyOperation.parsePlatform(
            PasskeyOperation.Kind.GET,
            "{\"challenge\":\"EBESExQVFhcYGRobHB0eHw\",\"rpId\":\"example.com\","
                + "\"allowCredentials\":[{\"type\":\"public-key\",\"id\":\""
                + created.passkey.getString("credentialId") + "\"}]}",
            "https://login.example.com",
            suppliedHash
        );
        JSONObject getResponse = new JSONObject(PasskeyWebAuthn.assertCredential(get, created.passkey))
            .getJSONObject("response");
        assertEquals("{}", new String(b64d(getResponse.getString("clientDataJSON")), StandardCharsets.UTF_8));
        byte[] authenticatorData = b64d(getResponse.getString("authenticatorData"));
        Signature verifier = Signature.getInstance("SHA256withECDSA");
        verifier.initVerify(PasskeyKeyMaterial.load(
            created.passkey.getString("publicKeyCose"),
            created.passkey.getString("privateKeyPkcs8")
        ).publicKey);
        verifier.update(concatenate(authenticatorData, suppliedHash));
        assertTrue(verifier.verify(b64d(getResponse.getString("signature"))));
    }

    private static PasskeyOperation.Operation createOperation() {
        return PasskeyOperation.parsePlatform(
            PasskeyOperation.Kind.CREATE,
            "{\"challenge\":\"AAECAwQFBgcICQoLDA0ODw\","
                + "\"rp\":{\"id\":\"example.com\",\"name\":\"Example\"},"
                + "\"user\":{\"id\":\"dXNlci0x\",\"name\":\"alice@example.com\",\"displayName\":\"Alice\"},"
                + "\"pubKeyCredParams\":[{\"type\":\"public-key\",\"alg\":-7}]}",
            "android:apk-key-hash:AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",
            null
        );
    }

    private static PasskeyOperation.Operation getOperation(String credentialId) {
        return PasskeyOperation.parsePlatform(
            PasskeyOperation.Kind.GET,
            "{\"challenge\":\"EBESExQVFhcYGRobHB0eHw\",\"rpId\":\"example.com\","
                + "\"allowCredentials\":[{\"type\":\"public-key\",\"id\":\"" + credentialId + "\"}]}",
            "android:apk-key-hash:AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",
            null
        );
    }

    private static byte[] sha256(byte[] value) throws Exception {
        return MessageDigest.getInstance("SHA-256").digest(value);
    }

    private static byte[] b64d(String value) {
        return Base64.getUrlDecoder().decode(value);
    }

    private static byte[] slice(byte[] source, int offset, int length) {
        byte[] result = new byte[length];
        System.arraycopy(source, offset, result, 0, length);
        return result;
    }

    private static byte[] concatenate(byte[] left, byte[] right) {
        byte[] result = new byte[left.length + right.length];
        System.arraycopy(left, 0, result, 0, left.length);
        System.arraycopy(right, 0, result, left.length, right.length);
        return result;
    }
}
