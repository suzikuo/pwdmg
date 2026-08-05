package com.suzikuo.mypwdmg;

import android.annotation.TargetApi;
import android.os.Build;
import android.os.CancellationSignal;
import android.os.OutcomeReceiver;

import androidx.credentials.exceptions.ClearCredentialException;
import androidx.credentials.exceptions.CreateCredentialException;
import androidx.credentials.exceptions.GetCredentialException;
import androidx.credentials.exceptions.CreateCredentialUnknownException;
import androidx.credentials.exceptions.GetCredentialUnknownException;
import androidx.credentials.provider.BeginCreateCredentialRequest;
import androidx.credentials.provider.BeginCreateCredentialResponse;
import androidx.credentials.provider.BeginGetCredentialRequest;
import androidx.credentials.provider.BeginGetCredentialResponse;
import androidx.credentials.provider.CredentialProviderService;
import androidx.credentials.provider.ProviderClearCredentialStateRequest;

/**
 * Android 14+ Credential Provider registration point.
 *
 * The manifest keeps this service disabled until Android 14+ device interoperability passes.
 */
@TargetApi(Build.VERSION_CODES.UPSIDE_DOWN_CAKE)
public final class PasskeyCredentialProviderService extends CredentialProviderService {
    @Override
    public void onBeginGetCredentialRequest(
        BeginGetCredentialRequest request,
        CancellationSignal cancellationSignal,
        OutcomeReceiver<BeginGetCredentialResponse, GetCredentialException> callback
    ) {
        if (cancellationSignal.isCanceled()) return;
        PasskeyOperationBroker broker = PasskeyOperationBroker.getInstance();
        PasskeyProviderCoordinator.BeginResult<BeginGetCredentialResponse> result;
        try {
            result = PasskeyProviderCoordinator.beginGet(
                this,
                request,
                new AndroidVaultStore(this),
                broker
            );
        } catch (Exception error) {
            if (!cancellationSignal.isCanceled()) callback.onError(new GetCredentialUnknownException());
            return;
        }
        cancellationSignal.setOnCancelListener(() -> broker.cancelAll(result.ticketIds));
        if (!cancellationSignal.isCanceled()) callback.onResult(result.response);
    }

    @Override
    public void onBeginCreateCredentialRequest(
        BeginCreateCredentialRequest request,
        CancellationSignal cancellationSignal,
        OutcomeReceiver<BeginCreateCredentialResponse, CreateCredentialException> callback
    ) {
        if (cancellationSignal.isCanceled()) return;
        PasskeyOperationBroker broker = PasskeyOperationBroker.getInstance();
        PasskeyProviderCoordinator.BeginResult<BeginCreateCredentialResponse> result;
        try {
            result = PasskeyProviderCoordinator.beginCreate(
                this,
                request,
                new AndroidVaultStore(this),
                broker
            );
        } catch (Exception error) {
            if (!cancellationSignal.isCanceled()) callback.onError(new CreateCredentialUnknownException());
            return;
        }
        cancellationSignal.setOnCancelListener(() -> broker.cancelAll(result.ticketIds));
        if (!cancellationSignal.isCanceled()) callback.onResult(result.response);
    }

    @Override
    public void onClearCredentialStateRequest(
        ProviderClearCredentialStateRequest request,
        CancellationSignal cancellationSignal,
        OutcomeReceiver<Void, ClearCredentialException> callback
    ) {
        if (cancellationSignal.isCanceled()) return;
        PasskeyOperationBroker.getInstance().clear();
        callback.onResult(null);
    }
}
