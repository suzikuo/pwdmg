package com.suzikuo.mypwdmg;

import com.authlete.cbor.CBORPairList;
import com.authlete.cbor.CBORPairsBuilder;
import com.authlete.cose.COSEEC2Key;
import com.authlete.cose.COSEKeyBuilder;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.security.Signature;
import java.security.interfaces.ECPublicKey;
import java.security.spec.ECGenParameterSpec;
import java.util.Base64;

/** Native ES256 authenticator core for Android Credential Provider ceremonies. */
final class PasskeyWebAuthn {
    private static final int FLAG_UP = 0x01;
    private static final int FLAG_UV = 0x04;
    private static final int FLAG_BE = 0x08;
    private static final int FLAG_BS = 0x10;
    private static final int FLAG_AT = 0x40;
    private static final int CREDENTIAL_ID_BYTES = 32;
    private static final SecureRandom RANDOM = new SecureRandom();

    private PasskeyWebAuthn() {}

    static CreatedCredential create(PasskeyOperation.Operation operation) {
        if (operation == null || operation.kind != PasskeyOperation.Kind.CREATE || operation.user == null) {
            throw new CeremonyException("CREATE_REQUEST_INVALID");
        }
        try {
            KeyPairGenerator generator = KeyPairGenerator.getInstance("EC");
            generator.initialize(new ECGenParameterSpec("secp256r1"), RANDOM);
            KeyPair keyPair = generator.generateKeyPair();
            ECPublicKey publicKey = (ECPublicKey) keyPair.getPublic();

            byte[] credentialId = new byte[CREDENTIAL_ID_BYTES];
            RANDOM.nextBytes(credentialId);
            byte[] cosePublicKey = encodeCosePublicKey(publicKey);
            // This provider creates a backup-eligible multi-device credential, but it
            // has no persisted cross-device backup confirmation yet. Keep BS false
            // until a trusted sync/backup signal is stored with the credential.
            boolean backupState = false;
            byte[] authenticatorData = registrationAuthenticatorData(
                operation.rpId,
                credentialId,
                cosePublicKey,
                backupState
            );
            byte[] attestationObject = new CBORPairList(
                new CBORPairsBuilder()
                    .add("fmt", "none")
                    .add("authData", authenticatorData)
                    .add("attStmt", new CBORPairList(new CBORPairsBuilder().build()))
                    .build()
            ).encode();

            String credentialIdText = b64e(credentialId);
            long now = System.currentTimeMillis() / 1000L;
            JSONObject passkey = new JSONObject()
                .put("id", java.util.UUID.randomUUID().toString())
                .put("credentialId", credentialIdText)
                .put("rpId", operation.rpId)
                .put("userHandle", operation.user.id)
                .put("userName", operation.user.name)
                .put("algorithm", -7)
                .put("publicKeyCose", b64e(cosePublicKey))
                .put("privateKeyPkcs8", b64e(keyPair.getPrivate().getEncoded()))
                .put("discoverable", true)
                .put("backupEligible", true)
                .put("backupState", backupState)
                .put("transports", new JSONArray().put("internal"))
                .put("createdAt", now)
                .put("updatedAt", now);
            if (operation.rpName != null && !operation.rpName.isEmpty()) {
                passkey.put("rpName", operation.rpName);
            }
            if (!operation.user.displayName.isEmpty()) {
                passkey.put("userDisplayName", operation.user.displayName);
            }

            JSONObject response = new JSONObject()
                .put("id", credentialIdText)
                .put("rawId", credentialIdText)
                .put("type", "public-key")
                .put("authenticatorAttachment", "platform")
                .put("clientExtensionResults", new JSONObject())
                .put("response", new JSONObject()
                    .put("clientDataJSON", clientDataJson(operation))
                    .put("attestationObject", b64e(attestationObject))
                    .put("transports", new JSONArray().put("internal")));
            return new CreatedCredential(passkey, response.toString());
        } catch (CeremonyException error) {
            throw error;
        } catch (Exception error) {
            throw new CeremonyException("CREATE_FAILED");
        }
    }

    static String assertCredential(PasskeyOperation.Operation operation, JSONObject passkey) {
        if (operation == null || operation.kind != PasskeyOperation.Kind.GET || passkey == null) {
            throw new CeremonyException("GET_REQUEST_INVALID");
        }
        try {
            String credentialId = passkey.getString("credentialId");
            if (!operation.rpId.equals(passkey.getString("rpId"))) {
                throw new CeremonyException("RP_MISMATCH");
            }
            if (!operation.credentialIds.isEmpty() && !operation.credentialIds.contains(credentialId)) {
                throw new CeremonyException("CREDENTIAL_NOT_ALLOWED");
            }
            PasskeyKeyMaterial.ValidatedKeyPair keyPair = PasskeyKeyMaterial.load(
                passkey.getString("publicKeyCose"),
                passkey.getString("privateKeyPkcs8")
            );
            byte[] authenticatorData = assertionAuthenticatorData(
                operation.rpId,
                passkey.optBoolean("backupState", false)
            );
            byte[] clientDataHash = b64d(operation.clientDataHash);
            byte[] signedData = concatenate(authenticatorData, clientDataHash);
            Signature signer = Signature.getInstance("SHA256withECDSA");
            signer.initSign(keyPair.privateKey, RANDOM);
            signer.update(signedData);
            byte[] signature = signer.sign();

            return new JSONObject()
                .put("id", credentialId)
                .put("rawId", credentialId)
                .put("type", "public-key")
                .put("authenticatorAttachment", "platform")
                .put("clientExtensionResults", new JSONObject())
                .put("response", new JSONObject()
                    .put("clientDataJSON", clientDataJson(operation))
                    .put("authenticatorData", b64e(authenticatorData))
                    .put("signature", b64e(signature))
                    .put("userHandle", passkey.getString("userHandle")))
                .toString();
        } catch (CeremonyException error) {
            throw error;
        } catch (Exception error) {
            throw new CeremonyException("ASSERTION_FAILED");
        }
    }

    private static byte[] encodeCosePublicKey(ECPublicKey publicKey) throws Exception {
        COSEEC2Key key = new COSEKeyBuilder()
            .ktyEC2()
            .alg(-7)
            .ec2CrvP256()
            .ec2X(unsignedCoordinate(publicKey.getW().getAffineX()))
            .ec2Y(unsignedCoordinate(publicKey.getW().getAffineY()))
            .buildEC2Key();
        return key.encode();
    }

    private static byte[] registrationAuthenticatorData(
        String rpId,
        byte[] credentialId,
        byte[] cosePublicKey,
        boolean backupState
    ) throws Exception {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        output.write(rpIdHash(rpId));
        output.write(FLAG_UP | FLAG_UV | FLAG_BE | (backupState ? FLAG_BS : 0) | FLAG_AT);
        output.write(new byte[4]);
        output.write(new byte[16]);
        output.write((credentialId.length >>> 8) & 0xff);
        output.write(credentialId.length & 0xff);
        output.write(credentialId);
        output.write(cosePublicKey);
        return output.toByteArray();
    }

    private static byte[] assertionAuthenticatorData(String rpId, boolean backupState) throws Exception {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        output.write(rpIdHash(rpId));
        output.write(FLAG_UP | FLAG_UV | FLAG_BE | (backupState ? FLAG_BS : 0));
        output.write(new byte[4]);
        return output.toByteArray();
    }

    private static byte[] rpIdHash(String rpId) throws Exception {
        return MessageDigest.getInstance("SHA-256").digest(rpId.getBytes(StandardCharsets.UTF_8));
    }

    private static byte[] unsignedCoordinate(BigInteger coordinate) {
        byte[] encoded = coordinate.toByteArray();
        if (encoded.length == 33 && encoded[0] == 0) {
            byte[] trimmed = new byte[32];
            System.arraycopy(encoded, 1, trimmed, 0, 32);
            return trimmed;
        }
        if (encoded.length > 32) throw new CeremonyException("PUBLIC_KEY_INVALID");
        byte[] padded = new byte[32];
        System.arraycopy(encoded, 0, padded, 32 - encoded.length, encoded.length);
        return padded;
    }

    private static String clientDataJson(PasskeyOperation.Operation operation) {
        return b64e(operation.clientDataJson.getBytes(StandardCharsets.UTF_8));
    }

    private static byte[] concatenate(byte[] left, byte[] right) {
        byte[] result = new byte[left.length + right.length];
        System.arraycopy(left, 0, result, 0, left.length);
        System.arraycopy(right, 0, result, left.length, right.length);
        return result;
    }

    private static String b64e(byte[] value) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(value);
    }

    private static byte[] b64d(String value) {
        return Base64.getUrlDecoder().decode(value);
    }

    static final class CreatedCredential {
        final JSONObject passkey;
        final String responseJson;

        CreatedCredential(JSONObject passkey, String responseJson) {
            this.passkey = passkey;
            this.responseJson = responseJson;
        }
    }

    static final class CeremonyException extends IllegalStateException {
        final String code;

        CeremonyException(String code) {
            super(code);
            this.code = code;
        }
    }
}
