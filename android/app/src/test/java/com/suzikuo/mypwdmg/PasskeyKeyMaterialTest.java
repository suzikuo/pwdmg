package com.suzikuo.mypwdmg;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import com.authlete.cose.COSEEC2Key;
import com.authlete.cose.COSEKeyBuilder;

import org.junit.Test;

import java.math.BigInteger;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.interfaces.ECPublicKey;
import java.security.spec.ECGenParameterSpec;
import java.util.Base64;

public class PasskeyKeyMaterialTest {
    @Test
    public void loadsAndProvesAValidEs256P256Pair() throws Exception {
        KeyPair original = generateKeyPair();
        ECPublicKey originalPublicKey = (ECPublicKey) original.getPublic();

        PasskeyKeyMaterial.ValidatedKeyPair loaded = PasskeyKeyMaterial.load(
            coseFor(originalPublicKey),
            base64Url(original.getPrivate().getEncoded())
        );

        assertTrue(loaded.privateKey instanceof java.security.interfaces.ECPrivateKey);
        assertArrayEquals(
            unsignedCoordinate(originalPublicKey.getW().getAffineX()),
            unsignedCoordinate(loaded.publicKey.getW().getAffineX())
        );
        assertArrayEquals(
            unsignedCoordinate(originalPublicKey.getW().getAffineY()),
            unsignedCoordinate(loaded.publicKey.getW().getAffineY())
        );
    }

    @Test
    public void rejectsAPrivateKeyThatDoesNotMatchTheCosePublicKey() throws Exception {
        KeyPair publicPair = generateKeyPair();
        KeyPair privatePair = generateKeyPair();

        PasskeyKeyMaterial.KeyMaterialException error = assertThrows(
            PasskeyKeyMaterial.KeyMaterialException.class,
            () -> PasskeyKeyMaterial.load(
                coseFor((ECPublicKey) publicPair.getPublic()),
                base64Url(privatePair.getPrivate().getEncoded())
            )
        );

        assertEquals("INVALID_PASSKEY_KEY_MATERIAL", error.getMessage());
    }

    @Test
    public void rejectsNonCanonicalKeyEncodingWithoutExposingInput() throws Exception {
        KeyPair original = generateKeyPair();

        PasskeyKeyMaterial.KeyMaterialException error = assertThrows(
            PasskeyKeyMaterial.KeyMaterialException.class,
            () -> PasskeyKeyMaterial.load("AQIDBA=", base64Url(original.getPrivate().getEncoded()))
        );

        assertEquals("INVALID_PASSKEY_KEY_MATERIAL", error.getMessage());
        assertTrue(!error.getMessage().contains("AQIDBA"));
    }

    private static KeyPair generateKeyPair() throws Exception {
        KeyPairGenerator generator = KeyPairGenerator.getInstance("EC");
        generator.initialize(new ECGenParameterSpec("secp256r1"));
        return generator.generateKeyPair();
    }

    private static String coseFor(ECPublicKey publicKey) {
        COSEEC2Key coseKey = new COSEKeyBuilder()
            .ktyEC2()
            .alg(-7)
            .ec2CrvP256()
            .ec2X(unsignedCoordinate(publicKey.getW().getAffineX()))
            .ec2Y(unsignedCoordinate(publicKey.getW().getAffineY()))
            .buildEC2Key();
        return base64Url(coseKey.encode());
    }

    private static String base64Url(byte[] value) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(value);
    }

    private static byte[] unsignedCoordinate(BigInteger coordinate) {
        byte[] encoded = coordinate.toByteArray();
        if (encoded.length == 33 && encoded[0] == 0) {
            byte[] trimmed = new byte[32];
            System.arraycopy(encoded, 1, trimmed, 0, trimmed.length);
            return trimmed;
        }
        if (encoded.length == 32) return encoded;
        throw new IllegalStateException("Unexpected P-256 coordinate length");
    }
}
