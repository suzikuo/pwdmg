package com.suzikuo.mypwdmg;

import static org.junit.Assert.assertTrue;

import androidx.credentials.exceptions.CreateCredentialUnknownException;
import androidx.credentials.exceptions.GetCredentialUnknownException;
import androidx.credentials.exceptions.domerrors.InvalidStateError;
import androidx.credentials.exceptions.domerrors.NotAllowedError;
import androidx.credentials.exceptions.domerrors.SecurityError;
import androidx.credentials.exceptions.domerrors.TimeoutError;
import androidx.credentials.exceptions.publickeycredential.CreatePublicKeyCredentialDomException;
import androidx.credentials.exceptions.publickeycredential.GetPublicKeyCredentialDomException;

import org.junit.Test;

public class PasskeyCompletionErrorMappingTest {
    @Test
    public void mapsKnownCreateFailuresToWebAuthnDomErrors() {
        CreatePublicKeyCredentialDomException excluded = (CreatePublicKeyCredentialDomException)
            PasskeyCompletionActivity.createExceptionFor(
                new IllegalArgumentException("EXCLUDED_CREDENTIAL_EXISTS")
            );
        assertTrue(excluded.getDomError() instanceof InvalidStateError);

        CreatePublicKeyCredentialDomException expired = (CreatePublicKeyCredentialDomException)
            PasskeyCompletionActivity.createExceptionFor(
                new PasskeyOperationBroker.BrokerException("TICKET_EXPIRED")
            );
        assertTrue(expired.getDomError() instanceof TimeoutError);

        CreatePublicKeyCredentialDomException security = (CreatePublicKeyCredentialDomException)
            PasskeyCompletionActivity.createExceptionFor(new SecurityException("CALLER_MISMATCH"));
        assertTrue(security.getDomError() instanceof SecurityError);
    }

    @Test
    public void mapsKnownGetFailuresAndKeepsUnknownFailuresGeneric() {
        GetPublicKeyCredentialDomException notAllowed = (GetPublicKeyCredentialDomException)
            PasskeyCompletionActivity.getExceptionFor(new IllegalArgumentException("PASSKEY_NOT_FOUND"));
        assertTrue(notAllowed.getDomError() instanceof NotAllowedError);

        assertTrue(
            PasskeyCompletionActivity.createExceptionFor(new IllegalStateException("unexpected"))
                instanceof CreateCredentialUnknownException
        );
        assertTrue(
            PasskeyCompletionActivity.getExceptionFor(new IllegalStateException("unexpected"))
                instanceof GetCredentialUnknownException
        );
    }
}
