package com.suzikuo.mypwdmg;

import com.authlete.cbor.CBORParser;
import com.authlete.cose.COSEEC2Key;
import com.authlete.cose.COSEKey;

import java.security.KeyFactory;
import java.security.PrivateKey;
import java.security.PublicKey;
import java.security.SecureRandom;
import java.security.Signature;
import java.security.interfaces.ECPrivateKey;
import java.security.interfaces.ECPublicKey;
import java.security.spec.PKCS8EncodedKeySpec;
import java.util.Arrays;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Native-only loader for a synced ES256 passkey's public COSE key and private PKCS#8 key.
 * It intentionally exposes JCA key objects only to code in this package.
 */
final class PasskeyKeyMaterial {
    private static final int COSE_ES256 = -7;
    private static final int COSE_P256 = 1;
    private static final int P256_COORDINATE_BYTES = 32;
    private static final int MAX_KEY_BYTES = 16_384;
    private static final Pattern BASE64URL_PATTERN = Pattern.compile("^[A-Za-z0-9_-]+$");
    private static final SecureRandom RANDOM = new SecureRandom();

    private PasskeyKeyMaterial() {}

    static ValidatedKeyPair load(String publicKeyCose, String privateKeyPkcs8) {
        byte[] privateKeyBytes = null;
        try {
            byte[] coseBytes = decodeBase64Url(publicKeyCose);
            privateKeyBytes = decodeBase64Url(privateKeyPkcs8);
            ECPublicKey publicKey = readPublicKey(coseBytes);
            PrivateKey privateKey = KeyFactory.getInstance("EC")
                .generatePrivate(new PKCS8EncodedKeySpec(privateKeyBytes));
            if (!(privateKey instanceof ECPrivateKey)) throw new KeyMaterialException();
            requireMatchingPair(privateKey, publicKey);
            return new ValidatedKeyPair(privateKey, publicKey);
        } catch (KeyMaterialException error) {
            throw error;
        } catch (Exception error) {
            throw new KeyMaterialException();
        } finally {
            if (privateKeyBytes != null) Arrays.fill(privateKeyBytes, (byte) 0);
        }
    }

    private static ECPublicKey readPublicKey(byte[] coseBytes) throws Exception {
        List<Object> decodedItems = new CBORParser(coseBytes).all();
        if (decodedItems.size() != 1 || !(decodedItems.get(0) instanceof Map)) {
            throw new KeyMaterialException();
        }
        @SuppressWarnings("unchecked")
        Map<Object, Object> decodedMap = (Map<Object, Object>) decodedItems.get(0);
        COSEKey parsedKey = COSEKey.build(decodedMap);
        if (!(parsedKey instanceof COSEEC2Key)) throw new KeyMaterialException();

        COSEEC2Key ec2Key = (COSEEC2Key) parsedKey;
        if (ec2Key.isPrivate()
            || !hasExactInteger(parsedKey.getAlg(), COSE_ES256)
            || !hasExactInteger(ec2Key.getCrv(), COSE_P256)
            || ec2Key.getX() == null
            || ec2Key.getX().length != P256_COORDINATE_BYTES
            || !(ec2Key.getY() instanceof byte[])
            || ((byte[]) ec2Key.getY()).length != P256_COORDINATE_BYTES) {
            throw new KeyMaterialException();
        }

        PublicKey publicKey = ec2Key.createPublicKey();
        if (!(publicKey instanceof ECPublicKey)) throw new KeyMaterialException();
        return (ECPublicKey) publicKey;
    }

    private static boolean hasExactInteger(Object value, int expected) {
        if (!(value instanceof Byte
            || value instanceof Short
            || value instanceof Integer
            || value instanceof Long)) {
            return false;
        }
        return ((Number) value).longValue() == expected;
    }

    private static void requireMatchingPair(PrivateKey privateKey, PublicKey publicKey) throws Exception {
        byte[] proof = new byte[32];
        byte[] signature = null;
        RANDOM.nextBytes(proof);
        try {
            Signature signer = Signature.getInstance("SHA256withECDSA");
            signer.initSign(privateKey);
            signer.update(proof);
            signature = signer.sign();

            Signature verifier = Signature.getInstance("SHA256withECDSA");
            verifier.initVerify(publicKey);
            verifier.update(proof);
            if (!verifier.verify(signature)) throw new KeyMaterialException();
        } finally {
            Arrays.fill(proof, (byte) 0);
            if (signature != null) Arrays.fill(signature, (byte) 0);
        }
    }

    private static byte[] decodeBase64Url(String value) {
        if (value == null || value.isEmpty() || !BASE64URL_PATTERN.matcher(value).matches()) {
            throw new KeyMaterialException();
        }
        int maxEncodedLength = ((MAX_KEY_BYTES + 2) / 3) * 4;
        if (value.length() > maxEncodedLength) throw new KeyMaterialException();
        byte[] decoded;
        try {
            decoded = Base64.getUrlDecoder().decode(value);
        } catch (IllegalArgumentException error) {
            throw new KeyMaterialException();
        }
        if (decoded.length == 0
            || decoded.length > MAX_KEY_BYTES
            || !Base64.getUrlEncoder().withoutPadding().encodeToString(decoded).equals(value)) {
            Arrays.fill(decoded, (byte) 0);
            throw new KeyMaterialException();
        }
        return decoded;
    }

    static final class ValidatedKeyPair {
        final PrivateKey privateKey;
        final ECPublicKey publicKey;

        ValidatedKeyPair(PrivateKey privateKey, ECPublicKey publicKey) {
            this.privateKey = privateKey;
            this.publicKey = publicKey;
        }
    }

    static final class KeyMaterialException extends IllegalArgumentException {
        KeyMaterialException() {
            super("INVALID_PASSKEY_KEY_MATERIAL");
        }
    }
}
