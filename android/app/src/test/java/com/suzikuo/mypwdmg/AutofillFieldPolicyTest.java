package com.suzikuo.mypwdmg;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;

import org.junit.Test;

import java.util.ArrayList;
import java.util.List;

public class AutofillFieldPolicyTest {
    @Test
    public void phoneFieldWinsOverNearbyPasswordText() {
        AutofillFieldPolicy.Decision decision = classify(
            "phone password",
            new String[] { "phone" },
            false,
            false,
            true,
            true
        );

        assertEquals(AutofillFieldPolicy.Role.ACCOUNT, decision.role);
        assertEquals(AutofillFieldPolicy.ACCOUNT_KIND_PHONE, decision.accountKind);
    }

    @Test
    public void usernameNeverCreatesPasswordFromAdjacentPlainText() {
        List<AutofillFieldPolicy.Candidate<String>> candidates = new ArrayList<>();
        candidates.add(candidate("username", classify("username", new String[] { "username" }, false, false, false, true), 0));
        candidates.add(candidate("phone", classify("mobile number", null, false, false, true, true), 1));

        AutofillFieldPolicy.Resolved<String> resolved = AutofillFieldPolicy.resolve(candidates);

        assertEquals("username", resolved.accountId);
        assertNull(resolved.currentPasswordId);
        assertNull(resolved.savePasswordId());
    }

    @Test
    public void moderateAccountProximityRequiresConfirmedPassword() {
        AutofillFieldPolicy.Decision login = classify("login", null, false, false, false, true);
        assertEquals(AutofillFieldPolicy.Role.NONE, login.role);

        List<AutofillFieldPolicy.Candidate<String>> withoutPassword = new ArrayList<>();
        withoutPassword.add(candidate("login", login, 0));
        assertNull(AutofillFieldPolicy.resolve(withoutPassword).accountId);

        List<AutofillFieldPolicy.Candidate<String>> withPassword = new ArrayList<>(withoutPassword);
        withPassword.add(candidate("password", classify("password", null, true, false, false, true), 1));
        AutofillFieldPolicy.Resolved<String> resolved = AutofillFieldPolicy.resolve(withPassword);
        assertEquals("login", resolved.accountId);
        assertEquals("password", resolved.currentPasswordId);
    }

    @Test
    public void currentNewAndConfirmationHaveSeparateTargets() {
        List<AutofillFieldPolicy.Candidate<String>> candidates = new ArrayList<>();
        candidates.add(candidate("account", classify("email", new String[] { "email" }, false, true, false, true), 0));
        candidates.add(candidate("current", classify("current password", new String[] { "currentPassword" }, true, false, false, true), 1));
        candidates.add(candidate("new", classify("new password", new String[] { "newPassword" }, true, false, false, true), 2));
        candidates.add(candidate("confirm", classify("confirm password", new String[] { "newPassword" }, true, false, false, true), 3));

        AutofillFieldPolicy.Resolved<String> resolved = AutofillFieldPolicy.resolve(candidates);

        assertEquals("current", resolved.currentPasswordId);
        assertEquals("new", resolved.newPasswordId);
        assertEquals("confirm", resolved.confirmPasswordId);
        assertEquals("new", resolved.savePasswordId());
    }

    @Test
    public void registrationPasswordIsSavedButNeverFilledAsCurrent() {
        List<AutofillFieldPolicy.Candidate<String>> candidates = new ArrayList<>();
        candidates.add(candidate("new", classify("new password", new String[] { "newPassword" }, true, false, false, true), 0));
        candidates.add(candidate("confirm", classify("confirm password", new String[] { "newPassword" }, true, false, false, true), 1));

        AutofillFieldPolicy.Resolved<String> resolved = AutofillFieldPolicy.resolve(candidates);

        assertNull(resolved.currentPasswordId);
        assertEquals("new", resolved.savePasswordId());
    }

    @Test
    public void genericPasswordWithConfirmationIsTreatedAsNewForSaving() {
        List<AutofillFieldPolicy.Candidate<String>> candidates = new ArrayList<>();
        candidates.add(candidate("password", classify("password", null, true, false, false, true), 0));
        candidates.add(candidate("confirm", classify("confirm password", null, true, false, false, true), 1));

        AutofillFieldPolicy.Resolved<String> resolved = AutofillFieldPolicy.resolve(candidates);

        assertNull(resolved.currentPasswordId);
        assertEquals("password", resolved.newPasswordId);
        assertEquals("password", resolved.savePasswordId());
    }

    @Test
    public void multipleAmbiguousPasswordFieldsAreNotFilledOrSaved() {
        List<AutofillFieldPolicy.Candidate<String>> candidates = new ArrayList<>();
        candidates.add(candidate("first", classify("password", null, true, false, false, true), 0));
        candidates.add(candidate("second", classify("password", null, true, false, false, true), 1));

        AutofillFieldPolicy.Resolved<String> resolved = AutofillFieldPolicy.resolve(candidates);

        assertNull(resolved.currentPasswordId);
        assertNull(resolved.savePasswordId());
    }

    @Test
    public void otpIsMutuallyExclusiveWithPassword() {
        AutofillFieldPolicy.Decision decision = classify(
            "sms verification code",
            new String[] { "smsOTPCode" },
            false,
            false,
            false,
            true
        );

        assertEquals(AutofillFieldPolicy.Role.OTP, decision.role);
        assertFalse(decision.passwordScore > decision.otpScore);
    }

    @Test
    public void hiddenAndDisabledFieldsAreRejected() {
        AutofillFieldPolicy.Decision hiddenPassword = classify(
            "password",
            new String[] { "password" },
            true,
            false,
            false,
            false
        );

        assertEquals(AutofillFieldPolicy.Role.NONE, hiddenPassword.role);
        assertFalse(hiddenPassword.textCandidate);
    }

    private static AutofillFieldPolicy.Decision classify(
        String text,
        String[] hints,
        boolean passwordInput,
        boolean emailInput,
        boolean phoneInput,
        boolean visibleAndEnabled
    ) {
        return AutofillFieldPolicy.classify(
            text,
            hints,
            true,
            passwordInput,
            emailInput,
            phoneInput,
            visibleAndEnabled
        );
    }

    private static AutofillFieldPolicy.Candidate<String> candidate(
        String id,
        AutofillFieldPolicy.Decision decision,
        int order
    ) {
        return new AutofillFieldPolicy.Candidate<>(id, decision, order);
    }
}
