package com.suzikuo.mypwdmg;

import android.app.Activity;
import android.app.AlertDialog;
import android.hardware.biometrics.BiometricManager;
import android.hardware.biometrics.BiometricPrompt;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.text.InputType;
import android.view.View;
import android.view.WindowManager;
import android.widget.EditText;

import androidx.credentials.CreatePublicKeyCredentialRequest;
import androidx.credentials.CreatePublicKeyCredentialResponse;
import androidx.credentials.CredentialOption;
import androidx.credentials.GetCredentialResponse;
import androidx.credentials.GetPublicKeyCredentialOption;
import androidx.credentials.PublicKeyCredential;
import androidx.credentials.exceptions.CreateCredentialCancellationException;
import androidx.credentials.exceptions.CreateCredentialException;
import androidx.credentials.exceptions.CreateCredentialUnknownException;
import androidx.credentials.exceptions.GetCredentialCancellationException;
import androidx.credentials.exceptions.GetCredentialException;
import androidx.credentials.exceptions.GetCredentialUnknownException;
import androidx.credentials.exceptions.domerrors.DataError;
import androidx.credentials.exceptions.domerrors.InvalidStateError;
import androidx.credentials.exceptions.domerrors.NotAllowedError;
import androidx.credentials.exceptions.domerrors.NotSupportedError;
import androidx.credentials.exceptions.domerrors.OperationError;
import androidx.credentials.exceptions.domerrors.SecurityError;
import androidx.credentials.exceptions.domerrors.TimeoutError;
import androidx.credentials.exceptions.publickeycredential.CreatePublicKeyCredentialDomException;
import androidx.credentials.exceptions.publickeycredential.GetPublicKeyCredentialDomException;
import androidx.credentials.provider.BeginGetCredentialRequest;
import androidx.credentials.provider.CallingAppInfo;
import androidx.credentials.provider.PendingIntentHandler;
import androidx.credentials.provider.ProviderCreateCredentialRequest;
import androidx.credentials.provider.ProviderGetCredentialRequest;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/** Native-only unlock and user-verification boundary for passkey ceremonies. */
public final class PasskeyCompletionActivity extends Activity {
    static final String ACTION_COMPLETE = "com.suzikuo.mypwdmg.action.PASSKEY_COMPLETE";
    static final String ACTION_UNLOCK_GET = "com.suzikuo.mypwdmg.action.PASSKEY_UNLOCK_GET";
    static final String EXTRA_MODE = "com.suzikuo.mypwdmg.extra.PASSKEY_MODE";
    static final String EXTRA_TICKET_ID = "com.suzikuo.mypwdmg.extra.PASSKEY_TICKET";
    static final String EXTRA_CREDENTIAL_ID = "com.suzikuo.mypwdmg.extra.PASSKEY_CREDENTIAL";
    static final String MODE_CREATE = "create";
    static final String MODE_GET = "get";
    static final String MODE_UNLOCK_GET = "unlock-get";

    private AndroidVaultStore store;
    private PasskeyOperationBroker broker;
    private String mode;
    private String ticketId;
    private CancellationSignal biometricCancellation;
    private boolean finished;
    private boolean changingConfigurations;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        store = new AndroidVaultStore(this);
        broker = PasskeyOperationBroker.getInstance();
        mode = getIntent().getStringExtra(EXTRA_MODE);
        ticketId = getIntent().getStringExtra(EXTRA_TICKET_ID);

        if (MODE_UNLOCK_GET.equals(mode)) {
            BeginGetCredentialRequest request = PendingIntentHandler.retrieveBeginGetCredentialRequest(getIntent());
            if (request == null) {
                finishCancelled();
                return;
            }
            withUnlocked(() -> returnUnlockedGetResponse(request));
            return;
        }
        if (!MODE_CREATE.equals(mode) && !MODE_GET.equals(mode)) {
            finishCancelled();
            return;
        }
        if (ticketId == null || ticketId.isEmpty()) {
            finishCredentialError(false);
            return;
        }
        withUnlocked(this::validateAndVerifyCeremony);
    }

    private void withUnlocked(Runnable action) {
        if (store.isUnlockedForPasskeys()) {
            action.run();
            return;
        }
        showPasswordPrompt(action);
    }

    private void showPasswordPrompt(Runnable action) {
        EditText input = new EditText(this);
        input.setSingleLine(true);
        input.setHint(R.string.passkey_master_password_hint);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        input.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);
        input.setSaveEnabled(false);
        int padding = Math.round(24 * getResources().getDisplayMetrics().density);
        input.setPadding(padding, 0, padding, 0);

        AlertDialog dialog = new AlertDialog.Builder(this)
            .setTitle(R.string.passkey_unlock_title)
            .setView(input)
            .setNegativeButton(android.R.string.cancel, (ignored, which) -> finishCredentialError(true))
            .setPositiveButton(R.string.passkey_unlock_action, null)
            .setOnCancelListener(ignored -> finishCredentialError(true))
            .create();
        dialog.setOnShowListener(ignored -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(view -> {
            try {
                store.unlockForPasskeys(input.getText() == null ? "" : input.getText().toString());
                input.setText("");
                dialog.dismiss();
                action.run();
            } catch (Exception error) {
                input.setText("");
                if (MODE_CREATE.equals(mode) || MODE_GET.equals(mode)) {
                    finishCredentialError(false, error);
                    return;
                }
                input.setError(getString(R.string.passkey_unlock_failed));
            }
        }));
        dialog.show();
    }

    private void returnUnlockedGetResponse(BeginGetCredentialRequest request) {
        try {
            PasskeyProviderCoordinator.BeginResult<androidx.credentials.provider.BeginGetCredentialResponse> result =
                PasskeyProviderCoordinator.beginGet(this, request, store, broker);
            android.content.Intent response = new android.content.Intent();
            PendingIntentHandler.setBeginGetCredentialResponse(response, result.response);
            setResult(RESULT_OK, response);
            finished = true;
            finish();
        } catch (Exception error) {
            finishCancelled();
        }
    }

    private void validateAndVerifyCeremony() {
        try {
            if (MODE_CREATE.equals(mode)) validateCreateAndVerify();
            else validateGetAndVerify();
        } catch (Exception error) {
            finishCredentialError(false, error);
        }
    }

    private void validateCreateAndVerify() {
        ProviderCreateCredentialRequest providerRequest =
            PendingIntentHandler.retrieveProviderCreateCredentialRequest(getIntent());
        if (providerRequest == null
            || !(providerRequest.getCallingRequest() instanceof CreatePublicKeyCredentialRequest)) {
            throw new IllegalArgumentException("CREATE_REQUEST_MISSING");
        }
        CreatePublicKeyCredentialRequest request =
            (CreatePublicKeyCredentialRequest) providerRequest.getCallingRequest();
        PasskeyCallerPolicy.AuthorizedRequest authorized = PasskeyCallerPolicy.authorize(
            PasskeyOperation.Kind.CREATE,
            request.getRequestJson(),
            request.getClientDataHash(),
            providerRequest.getCallingAppInfo()
        );
        promptUserVerification(
            getString(R.string.passkey_create_verify, authorized.operation.rpId),
            () -> {
                PasskeyOperationBroker.Ticket ticket = broker.consume(
                    ticketId,
                    authorized.callerBinding,
                    Collections.singletonList(authorized.operation),
                    System.currentTimeMillis()
                );
                completeCreate(ticket.nativeOperation.operation);
            }
        );
    }

    private void validateGetAndVerify() {
        ProviderGetCredentialRequest providerRequest =
            PendingIntentHandler.retrieveProviderGetCredentialRequest(getIntent());
        if (providerRequest == null) throw new IllegalArgumentException("GET_REQUEST_MISSING");
        CallingAppInfo caller = providerRequest.getCallingAppInfo();
        List<PasskeyOperation.Operation> operations = new ArrayList<>();
        String binding = null;
        for (CredentialOption rawOption : providerRequest.getCredentialOptions()) {
            if (!(rawOption instanceof GetPublicKeyCredentialOption)) continue;
            GetPublicKeyCredentialOption option = (GetPublicKeyCredentialOption) rawOption;
            PasskeyCallerPolicy.AuthorizedRequest authorized = PasskeyCallerPolicy.authorize(
                PasskeyOperation.Kind.GET,
                option.getRequestJson(),
                option.getClientDataHash(),
                caller
            );
            if (binding == null) binding = authorized.callerBinding;
            if (!binding.equals(authorized.callerBinding)) throw new SecurityException("CALLER_MISMATCH");
            operations.add(authorized.operation);
        }
        if (operations.isEmpty()) throw new IllegalArgumentException("GET_OPTIONS_MISSING");
        String intentCredentialId = getIntent().getStringExtra(EXTRA_CREDENTIAL_ID);
        String callerBinding = binding == null ? "" : binding;
        promptUserVerification(
            getString(R.string.passkey_get_verify, operations.get(0).rpId),
            () -> {
                PasskeyOperationBroker.Ticket ticket = broker.consume(
                    ticketId,
                    callerBinding,
                    operations,
                    System.currentTimeMillis()
                );
                if (ticket.credentialId == null
                    || intentCredentialId == null
                    || !ticket.credentialId.equals(intentCredentialId)) {
                    throw new SecurityException("CREDENTIAL_MISMATCH");
                }
                completeGet(ticket.nativeOperation.operation, ticket.credentialId);
            }
        );
    }

    private void promptUserVerification(String subtitle, Runnable success) {
        biometricCancellation = new CancellationSignal();
        BiometricPrompt prompt = new BiometricPrompt.Builder(this)
            .setTitle(getString(R.string.passkey_verify_title))
            .setSubtitle(subtitle)
            .setConfirmationRequired(true)
            .setAllowedAuthenticators(
                BiometricManager.Authenticators.BIOMETRIC_STRONG
                    | BiometricManager.Authenticators.DEVICE_CREDENTIAL
            )
            .build();
        prompt.authenticate(
            biometricCancellation,
            getMainExecutor(),
            new BiometricPrompt.AuthenticationCallback() {
                @Override
                public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                    if (changingConfigurations || finished) return;
                    try {
                        success.run();
                    } catch (Exception error) {
                        finishCredentialError(false, error);
                    }
                }

                @Override
                public void onAuthenticationError(int errorCode, CharSequence errorString) {
                    if (changingConfigurations || finished) return;
                    finishCredentialError(
                        errorCode == BiometricPrompt.BIOMETRIC_ERROR_CANCELED
                            || errorCode == BiometricPrompt.BIOMETRIC_ERROR_USER_CANCELED
                    );
                }
            }
        );
    }

    private void completeCreate(PasskeyOperation.Operation operation) {
        try {
            if (store.hasExcludedPasskey(operation)) throw new IllegalArgumentException("EXCLUDED_CREDENTIAL_EXISTS");
            PasskeyWebAuthn.CreatedCredential created = PasskeyWebAuthn.create(operation);
            store.storeCreatedPasskey(created.passkey, operation);
            android.content.Intent response = new android.content.Intent();
            PendingIntentHandler.setCreateCredentialResponse(
                response,
                new CreatePublicKeyCredentialResponse(created.responseJson)
            );
            setResult(RESULT_OK, response);
            finished = true;
            finish();
        } catch (Exception error) {
            finishCredentialError(false, error);
        }
    }

    private void completeGet(PasskeyOperation.Operation operation, String credentialId) {
        try {
            String responseJson = PasskeyWebAuthn.assertCredential(
                operation,
                store.passkeyForAssertion(credentialId, operation)
            );
            android.content.Intent response = new android.content.Intent();
            PendingIntentHandler.setGetCredentialResponse(
                response,
                new GetCredentialResponse(new PublicKeyCredential(responseJson))
            );
            setResult(RESULT_OK, response);
            finished = true;
            finish();
        } catch (Exception error) {
            finishCredentialError(false, error);
        }
    }

    private void finishCredentialError(boolean cancelled) {
        finishCredentialError(cancelled, null);
    }

    private void finishCredentialError(boolean cancelled, Throwable error) {
        if (finished) return;
        finished = true;
        broker.cancel(ticketId);
        if (MODE_UNLOCK_GET.equals(mode)) {
            setResult(RESULT_CANCELED);
        } else {
            android.content.Intent response = new android.content.Intent();
            if (MODE_CREATE.equals(mode)) {
                if (cancelled) {
                    PendingIntentHandler.setCreateCredentialException(
                        response,
                        new CreateCredentialCancellationException()
                    );
                } else {
                    PendingIntentHandler.setCreateCredentialException(
                        response,
                        createExceptionFor(error)
                    );
                }
            } else {
                if (cancelled) {
                    PendingIntentHandler.setGetCredentialException(
                        response,
                        new GetCredentialCancellationException()
                    );
                } else {
                    PendingIntentHandler.setGetCredentialException(
                        response,
                        getExceptionFor(error)
                    );
                }
            }
            setResult(RESULT_OK, response);
        }
        finish();
    }

    static CreateCredentialException createExceptionFor(Throwable error) {
        String code = errorCode(error);
        if ("EXCLUDED_CREDENTIAL_EXISTS".equals(code)
            || "PASSKEY_ID_COLLISION".equals(code)
            || "PASSKEY_TOMBSTONE_COLLISION".equals(code)) {
            return new CreatePublicKeyCredentialDomException(new InvalidStateError());
        }
        if ("TICKET_EXPIRED".equals(code)) {
            return new CreatePublicKeyCredentialDomException(new TimeoutError());
        }
        if (error instanceof PasskeyCallerPolicy.CallerException || error instanceof SecurityException) {
            return new CreatePublicKeyCredentialDomException(new SecurityError());
        }
        if (code.startsWith("UNSUPPORTED_")) {
            return new CreatePublicKeyCredentialDomException(new NotSupportedError());
        }
        if (error instanceof PasskeyOperation.OperationException) {
            return new CreatePublicKeyCredentialDomException(new DataError());
        }
        if (error instanceof PasskeyOperationBroker.BrokerException) {
            return new CreatePublicKeyCredentialDomException(new NotAllowedError());
        }
        if (error instanceof PasskeyWebAuthn.CeremonyException) {
            return new CreatePublicKeyCredentialDomException(new OperationError());
        }
        return new CreateCredentialUnknownException();
    }

    static GetCredentialException getExceptionFor(Throwable error) {
        String code = errorCode(error);
        if ("TICKET_EXPIRED".equals(code)) {
            return new GetPublicKeyCredentialDomException(new TimeoutError());
        }
        if (error instanceof PasskeyCallerPolicy.CallerException || error instanceof SecurityException) {
            return new GetPublicKeyCredentialDomException(new SecurityError());
        }
        if (code.startsWith("UNSUPPORTED_")) {
            return new GetPublicKeyCredentialDomException(new NotSupportedError());
        }
        if (error instanceof PasskeyOperation.OperationException) {
            return new GetPublicKeyCredentialDomException(new DataError());
        }
        if (error instanceof PasskeyOperationBroker.BrokerException
            || "PASSKEY_NOT_FOUND".equals(code)
            || "RP_MISMATCH".equals(code)
            || "CREDENTIAL_NOT_ALLOWED".equals(code)) {
            return new GetPublicKeyCredentialDomException(new NotAllowedError());
        }
        if (error instanceof PasskeyWebAuthn.CeremonyException) {
            return new GetPublicKeyCredentialDomException(new OperationError());
        }
        return new GetCredentialUnknownException();
    }

    private static String errorCode(Throwable error) {
        if (error instanceof PasskeyOperationBroker.BrokerException) {
            return ((PasskeyOperationBroker.BrokerException) error).code;
        }
        if (error instanceof PasskeyCallerPolicy.CallerException) {
            return ((PasskeyCallerPolicy.CallerException) error).code;
        }
        if (error instanceof PasskeyOperation.OperationException) {
            return ((PasskeyOperation.OperationException) error).code;
        }
        if (error instanceof PasskeyWebAuthn.CeremonyException) {
            return ((PasskeyWebAuthn.CeremonyException) error).code;
        }
        return error == null || error.getMessage() == null ? "" : error.getMessage();
    }

    private void finishCancelled() {
        if (finished) return;
        finished = true;
        broker.cancel(ticketId);
        setResult(RESULT_CANCELED);
        finish();
    }

    @Override
    public void onBackPressed() {
        finishCredentialError(true);
    }

    @Override
    protected void onDestroy() {
        changingConfigurations = isChangingConfigurations();
        if (biometricCancellation != null && !finished) biometricCancellation.cancel();
        if (!finished && !changingConfigurations) broker.cancel(ticketId);
        super.onDestroy();
    }
}
