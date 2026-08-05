package com.suzikuo.mypwdmg;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import com.authlete.cbor.CBORParser;
import com.authlete.cose.COSEEC2Key;
import com.authlete.cose.COSEKey;
import com.authlete.cose.COSEKeyBuilder;

import org.junit.Test;

import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.PublicKey;
import java.security.Signature;
import java.security.interfaces.ECPublicKey;
import java.security.spec.ECGenParameterSpec;
import java.util.Map;

public class PasskeyCryptoSmokeTest {
    @Test
    public void coseEc2PublicKeyRoundTripsWithPlatformJcaP256() throws Exception {
        KeyPairGenerator generator = KeyPairGenerator.getInstance("EC");
        generator.initialize(new ECGenParameterSpec("secp256r1"));
        KeyPair keyPair = generator.generateKeyPair();
        ECPublicKey originalPublicKey = (ECPublicKey) keyPair.getPublic();

        byte[] x = unsignedCoordinate(originalPublicKey.getW().getAffineX());
        byte[] y = unsignedCoordinate(originalPublicKey.getW().getAffineY());
        COSEEC2Key originalCoseKey = new COSEKeyBuilder()
            .ktyEC2()
            .alg(-7)
            .ec2CrvP256()
            .ec2X(x)
            .ec2Y(y)
            .buildEC2Key();

        Object decoded = new CBORParser(originalCoseKey.encode()).next();
        assertTrue(decoded instanceof Map);
        @SuppressWarnings("unchecked")
        Map<Object, Object> decodedMap = (Map<Object, Object>) decoded;
        COSEKey parsedKey = COSEKey.build(decodedMap);
        assertTrue(parsedKey instanceof COSEEC2Key);
        assertEquals(-7, ((Number) parsedKey.getAlg()).intValue());

        COSEEC2Key parsedEc2Key = (COSEEC2Key) parsedKey;
        assertArrayEquals(x, parsedEc2Key.getX());
        assertArrayEquals(y, (byte[]) parsedEc2Key.getY());

        PublicKey reconstructedPublicKey = parsedEc2Key.createPublicKey();
        byte[] message = "passkey-cbor-smoke".getBytes(StandardCharsets.US_ASCII);
        Signature signer = Signature.getInstance("SHA256withECDSA");
        signer.initSign(keyPair.getPrivate());
        signer.update(message);
        byte[] signature = signer.sign();

        Signature verifier = Signature.getInstance("SHA256withECDSA");
        verifier.initVerify(reconstructedPublicKey);
        verifier.update(message);
        assertTrue(verifier.verify(signature));
    }

    private static byte[] unsignedCoordinate(BigInteger coordinate) {
        byte[] encoded = coordinate.toByteArray();
        if (encoded.length == 33 && encoded[0] == 0) {
            byte[] trimmed = new byte[32];
            System.arraycopy(encoded, 1, trimmed, 0, trimmed.length);
            return trimmed;
        }
        if (encoded.length > 32) throw new IllegalStateException("Unexpected P-256 coordinate length");
        byte[] padded = new byte[32];
        System.arraycopy(encoded, 0, padded, 32 - encoded.length, encoded.length);
        return padded;
    }
}
