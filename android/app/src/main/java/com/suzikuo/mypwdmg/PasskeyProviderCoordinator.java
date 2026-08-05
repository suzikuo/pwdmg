package com.suzikuo.mypwdmg;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.graphics.drawable.Icon;

import androidx.credentials.provider.AuthenticationAction;
import androidx.credentials.provider.BeginCreateCredentialRequest;
import androidx.credentials.provider.BeginCreateCredentialResponse;
import androidx.credentials.provider.BeginCreatePublicKeyCredentialRequest;
import androidx.credentials.provider.BeginGetCredentialOption;
import androidx.credentials.provider.BeginGetCredentialRequest;
import androidx.credentials.provider.BeginGetCredentialResponse;
import androidx.credentials.provider.BeginGetPublicKeyCredentialOption;
import androidx.credentials.provider.CreateEntry;
import androidx.credentials.provider.PublicKeyCredentialEntry;

import org.json.JSONArray;
import org.json.JSONObject;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

/** Builds provider entries while keeping request JSON and vault keys out of Intent extras. */
final class PasskeyProviderCoordinator {
    private static final int MAX_VISIBLE_CREDENTIALS = 50;
    private static final AtomicInteger REQUEST_CODES = new AtomicInteger(10_000);

    private PasskeyProviderCoordinator() {}

    static BeginResult<BeginCreateCredentialResponse> beginCreate(
        Context context,
        BeginCreateCredentialRequest request,
        AndroidVaultStore store,
        PasskeyOperationBroker broker
    ) throws Exception {
        BeginCreateCredentialResponse.Builder response = new BeginCreateCredentialResponse.Builder();
        List<String> ticketIds = new ArrayList<>();
        try {
            if (!(request instanceof BeginCreatePublicKeyCredentialRequest)) {
                return new BeginResult<>(response.build(), ticketIds);
            }
            BeginCreatePublicKeyCredentialRequest publicKey = (BeginCreatePublicKeyCredentialRequest) request;
            PasskeyCallerPolicy.AuthorizedRequest authorized = PasskeyCallerPolicy.authorize(
                PasskeyOperation.Kind.CREATE,
                publicKey.getRequestJson(),
                publicKey.getClientDataHash(),
                publicKey.getCallingAppInfo()
            );
            if (store.isUnlockedForPasskeys() && store.hasExcludedPasskey(authorized.operation)) {
                return new BeginResult<>(response.build(), ticketIds);
            }

            PasskeyOperationBroker.Ticket ticket = broker.issue(
                authorized.operation,
                authorized.callerBinding,
                null,
                System.currentTimeMillis()
            );
            ticketIds.add(ticket.nativeOperation.operationId);
            PendingIntent pendingIntent = completionPendingIntent(
                context,
                PasskeyCompletionActivity.MODE_CREATE,
                ticket.nativeOperation.operationId,
                null
            );
            String title = authorized.operation.user == null
                ? context.getString(R.string.app_name)
                : authorized.operation.user.name;
            CreateEntry entry = new CreateEntry.Builder(title, pendingIntent)
                .setDescription(authorized.operation.rpName == null ? authorized.operation.rpId : authorized.operation.rpName)
                .setIcon(Icon.createWithResource(context, R.mipmap.ic_launcher))
                .setAutoSelectAllowed(false)
                .build();
            response.addCreateEntry(entry);
            return new BeginResult<>(response.build(), ticketIds);
        } catch (Exception error) {
            broker.cancelAll(ticketIds);
            throw error;
        }
    }

    static BeginResult<BeginGetCredentialResponse> beginGet(
        Context context,
        BeginGetCredentialRequest request,
        AndroidVaultStore store,
        PasskeyOperationBroker broker
    ) throws Exception {
        if (!store.isUnlockedForPasskeys()) return lockedGetResponse(context, request);

        BeginGetCredentialResponse.Builder response = new BeginGetCredentialResponse.Builder();
        List<String> ticketIds = new ArrayList<>();
        try {
            int visible = 0;
            for (BeginGetCredentialOption rawOption : request.getBeginGetCredentialOptions()) {
                if (!(rawOption instanceof BeginGetPublicKeyCredentialOption)) continue;
                BeginGetPublicKeyCredentialOption option = (BeginGetPublicKeyCredentialOption) rawOption;
                PasskeyCallerPolicy.AuthorizedRequest authorized = PasskeyCallerPolicy.authorize(
                    PasskeyOperation.Kind.GET,
                    option.getRequestJson(),
                    option.getClientDataHash(),
                    request.getCallingAppInfo()
                );
                JSONArray passkeys = store.listPasskeysForOperation(authorized.operation);
                for (int index = 0; index < passkeys.length() && visible < MAX_VISIBLE_CREDENTIALS; index += 1) {
                    JSONObject passkey = passkeys.getJSONObject(index);
                    PasskeyOperationBroker.Ticket ticket = broker.issue(
                        authorized.operation,
                        authorized.callerBinding,
                        passkey.getString("credentialId"),
                        System.currentTimeMillis()
                    );
                    ticketIds.add(ticket.nativeOperation.operationId);
                    PendingIntent pendingIntent = completionPendingIntent(
                        context,
                        PasskeyCompletionActivity.MODE_GET,
                        ticket.nativeOperation.operationId,
                        passkey.getString("credentialId")
                    );
                    String userName = passkey.optString("userName", context.getString(R.string.app_name));
                    PublicKeyCredentialEntry.Builder entry = new PublicKeyCredentialEntry.Builder(
                        context,
                        userName,
                        pendingIntent,
                        option
                    )
                        .setDisplayName(passkey.optString("userDisplayName", userName))
                        .setIcon(Icon.createWithResource(context, R.mipmap.ic_launcher))
                        .setAutoSelectAllowed(false);
                    long updatedAt = passkey.optLong("updatedAt", 0);
                    if (updatedAt > 0) entry.setLastUsedTime(Instant.ofEpochSecond(updatedAt));
                    response.addCredentialEntry(entry.build());
                    visible += 1;
                }
            }
            return new BeginResult<>(response.build(), ticketIds);
        } catch (Exception error) {
            broker.cancelAll(ticketIds);
            throw error;
        }
    }

    private static BeginResult<BeginGetCredentialResponse> lockedGetResponse(
        Context context,
        BeginGetCredentialRequest request
    ) {
        boolean hasAuthorizedOption = false;
        for (BeginGetCredentialOption rawOption : request.getBeginGetCredentialOptions()) {
            if (!(rawOption instanceof BeginGetPublicKeyCredentialOption)) continue;
            BeginGetPublicKeyCredentialOption option = (BeginGetPublicKeyCredentialOption) rawOption;
            PasskeyCallerPolicy.authorize(
                PasskeyOperation.Kind.GET,
                option.getRequestJson(),
                option.getClientDataHash(),
                request.getCallingAppInfo()
            );
            hasAuthorizedOption = true;
        }
        BeginGetCredentialResponse.Builder response = new BeginGetCredentialResponse.Builder();
        if (hasAuthorizedOption) {
            Intent intent = new Intent(context, PasskeyCompletionActivity.class)
                .setAction(PasskeyCompletionActivity.ACTION_UNLOCK_GET)
                .putExtra(PasskeyCompletionActivity.EXTRA_MODE, PasskeyCompletionActivity.MODE_UNLOCK_GET);
            PendingIntent pendingIntent = PendingIntent.getActivity(
                context,
                nextRequestCode(),
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE
            );
            response.addAuthenticationAction(
                new AuthenticationAction.Builder(context.getString(R.string.passkey_unlock_action), pendingIntent).build()
            );
        }
        return new BeginResult<>(response.build(), new ArrayList<>());
    }

    private static PendingIntent completionPendingIntent(
        Context context,
        String mode,
        String ticketId,
        String credentialId
    ) {
        Intent intent = new Intent(context, PasskeyCompletionActivity.class)
            .setAction(PasskeyCompletionActivity.ACTION_COMPLETE)
            .putExtra(PasskeyCompletionActivity.EXTRA_MODE, mode)
            .putExtra(PasskeyCompletionActivity.EXTRA_TICKET_ID, ticketId);
        if (credentialId != null) {
            intent.putExtra(PasskeyCompletionActivity.EXTRA_CREDENTIAL_ID, credentialId);
        }
        return PendingIntent.getActivity(
            context,
            nextRequestCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE
        );
    }

    private static int nextRequestCode() {
        return REQUEST_CODES.updateAndGet(value -> value == Integer.MAX_VALUE ? 10_000 : value + 1);
    }

    static final class BeginResult<T> {
        final T response;
        final List<String> ticketIds;

        BeginResult(T response, List<String> ticketIds) {
            this.response = response;
            this.ticketIds = ticketIds;
        }
    }
}
