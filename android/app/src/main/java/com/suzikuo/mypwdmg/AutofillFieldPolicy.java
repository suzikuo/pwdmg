package com.suzikuo.mypwdmg;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/** Pure-Java autofill field policy so role resolution can be regression tested on the JVM. */
final class AutofillFieldPolicy {
    static final String ACCOUNT_KIND_GENERIC = "generic";
    static final String ACCOUNT_KIND_USERNAME = "username";
    static final String ACCOUNT_KIND_EMAIL = "email";
    static final String ACCOUNT_KIND_PHONE = "phone";

    enum Role {
        NONE,
        ACCOUNT,
        PASSWORD,
        CURRENT_PASSWORD,
        NEW_PASSWORD,
        CONFIRM_PASSWORD,
        OTP
    }

    static final class Decision {
        final Role role;
        final String accountKind;
        final int accountScore;
        final int passwordScore;
        final int otpScore;
        final boolean textCandidate;

        Decision(
            Role role,
            String accountKind,
            int accountScore,
            int passwordScore,
            int otpScore,
            boolean textCandidate
        ) {
            this.role = role;
            this.accountKind = accountKind;
            this.accountScore = accountScore;
            this.passwordScore = passwordScore;
            this.otpScore = otpScore;
            this.textCandidate = textCandidate;
        }
    }

    static final class Candidate<T> {
        final T id;
        final Decision decision;
        final int order;

        Candidate(T id, Decision decision, int order) {
            this.id = id;
            this.decision = decision;
            this.order = order;
        }
    }

    static final class Resolved<T> {
        T accountId;
        T currentPasswordId;
        T newPasswordId;
        T confirmPasswordId;
        T otpId;
        String accountKind = ACCOUNT_KIND_GENERIC;
        int accountScore;
        int currentPasswordScore;
        int otpScore;

        T savePasswordId() {
            return newPasswordId != null ? newPasswordId : currentPasswordId;
        }
    }

    private AutofillFieldPolicy() {}

    static Decision classify(
        String text,
        String[] hints,
        boolean textCandidate,
        boolean passwordInputType,
        boolean emailInputType,
        boolean phoneInputType,
        boolean visibleAndEnabled
    ) {
        if (!visibleAndEnabled || !textCandidate) {
            return new Decision(Role.NONE, ACCOUNT_KIND_GENERIC, 0, 0, 0, false);
        }

        String evidence = evidence(text, hints);
        String compact = compact(evidence);
        boolean passwordHint = isPasswordHint(hints);
        boolean otpHint = isOtpHint(hints);
        boolean accountHint = isAccountHint(hints);
        boolean passwordText = containsPassword(evidence, compact);
        boolean otpText = containsOtp(evidence, compact);
        boolean accountText = containsAccount(evidence, compact);

        int accountScore = 0;
        if (accountHint) accountScore += 110;
        if (emailInputType || phoneInputType) accountScore += 105;
        if (containsSpecificAccount(evidence, compact)) accountScore += 70;
        else if (accountText) accountScore += 45;
        if (containsLoginIdentifier(evidence, compact)) accountScore += 25;
        if (containsSearch(evidence, compact)) accountScore -= 120;
        if (passwordText || passwordHint || passwordInputType) accountScore -= 100;
        if (otpText || otpHint) accountScore -= 100;
        accountScore = Math.max(accountScore, 0);

        int passwordScore = 0;
        if (passwordInputType) passwordScore += 125;
        if (passwordHint) passwordScore += 110;
        if (passwordText) passwordScore += 80;
        if (containsSecret(evidence, compact)) passwordScore += 35;
        if (containsPin(evidence, compact)) passwordScore += 25;
        if (emailInputType || phoneInputType) passwordScore -= 160;
        if (otpText || otpHint) passwordScore -= 130;
        if (containsSearch(evidence, compact)) passwordScore -= 100;
        passwordScore = Math.max(passwordScore, 0);

        int otpScore = 0;
        if (otpHint) otpScore += 125;
        if (containsStrongOtp(evidence, compact)) otpScore += 105;
        else if (otpText) otpScore += 55;
        if (containsCaptcha(evidence, compact)) otpScore -= 160;
        if (passwordText || passwordHint) otpScore -= 100;
        if (passwordInputType) otpScore -= 170;
        otpScore = Math.max(otpScore, 0);

        boolean strongPasswordEvidence = passwordInputType || passwordHint || passwordText;
        Role role = Role.NONE;
        if (otpScore >= 80 && otpScore >= passwordScore + 15 && otpScore >= accountScore + 15) {
            role = Role.OTP;
        } else if (strongPasswordEvidence
            && passwordScore >= 80
            && passwordScore >= otpScore + 15
            && passwordScore >= accountScore + 15) {
            role = passwordRole(evidence, compact, hints);
        } else if (accountScore >= 55
            && accountScore >= passwordScore
            && accountScore >= otpScore + 10) {
            role = Role.ACCOUNT;
        }

        return new Decision(
            role,
            accountKind(evidence, compact, hints, emailInputType, phoneInputType),
            accountScore,
            passwordScore,
            otpScore,
            true
        );
    }

    static <T> Resolved<T> resolve(List<Candidate<T>> candidates) {
        Resolved<T> result = new Resolved<>();
        Candidate<T> account = bestForRole(candidates, Role.ACCOUNT);
        Candidate<T> explicitCurrent = bestForRole(candidates, Role.CURRENT_PASSWORD);
        Candidate<T> newPassword = bestForRole(candidates, Role.NEW_PASSWORD);
        Candidate<T> confirmPassword = bestForRole(candidates, Role.CONFIRM_PASSWORD);
        Candidate<T> otp = bestForRole(candidates, Role.OTP);

        List<Candidate<T>> genericPasswords = allForRole(candidates, Role.PASSWORD);
        Candidate<T> current = explicitCurrent;
        if (current == null
            && genericPasswords.size() == 1
            && newPassword == null
            && confirmPassword == null) {
            current = genericPasswords.get(0);
        }

        // A generic password immediately paired with an explicit confirmation is a new
        // password for saving, never a current-password target for filling.
        if (newPassword == null && confirmPassword != null && genericPasswords.size() == 1) {
            newPassword = genericPasswords.get(0);
        }

        if (account == null && current != null) {
            account = bestAccountBefore(candidates, current.order, 35);
        }

        if (account != null) {
            result.accountId = account.id;
            result.accountKind = account.decision.accountKind;
            result.accountScore = account.decision.accountScore;
        }
        if (current != null) {
            result.currentPasswordId = current.id;
            result.currentPasswordScore = current.decision.passwordScore;
        }
        if (newPassword != null) result.newPasswordId = newPassword.id;
        if (confirmPassword != null) result.confirmPasswordId = confirmPassword.id;
        if (otp != null) {
            result.otpId = otp.id;
            result.otpScore = otp.decision.otpScore;
        }
        return result;
    }

    private static Role passwordRole(String evidence, String compact, String[] hints) {
        if (isConfirmPassword(evidence, compact)) return Role.CONFIRM_PASSWORD;
        if (isNewPassword(evidence, compact, hints)) return Role.NEW_PASSWORD;
        if (isCurrentPassword(evidence, compact, hints)) return Role.CURRENT_PASSWORD;
        return Role.PASSWORD;
    }

    private static boolean isConfirmPassword(String evidence, String compact) {
        return compact.contains("confirmpassword")
            || compact.contains("passwordconfirmation")
            || compact.contains("repeatpassword")
            || compact.contains("retypepassword")
            || compact.contains("verifypassword")
            || ((containsWord(evidence, "confirm")
                || containsWord(evidence, "repeat")
                || containsWord(evidence, "retype"))
                && containsPassword(evidence, compact));
    }

    private static boolean isNewPassword(String evidence, String compact, String[] hints) {
        if (hasCompactHint(hints, "newpassword")) return true;
        return compact.contains("newpassword")
            || compact.contains("createpassword")
            || compact.contains("choosepassword")
            || compact.contains("setpassword")
            || compact.contains("resetpassword");
    }

    private static boolean isCurrentPassword(String evidence, String compact, String[] hints) {
        if (hasCompactHint(hints, "currentpassword")) return true;
        return compact.contains("currentpassword")
            || compact.contains("oldpassword")
            || compact.contains("existingpassword");
    }

    private static boolean isAccountHint(String[] hints) {
        if (hints == null) return false;
        for (String hint : hints) {
            String value = compact(normalize(hint));
            if (value.contains("username")
                || value.contains("userid")
                || value.contains("email")
                || value.contains("identifier")
                || value.contains("account")
                || value.contains("login")
                || value.contains("phone")
                || value.contains("mobile")
                || value.equals("tel")) return true;
        }
        return false;
    }

    private static boolean isPasswordHint(String[] hints) {
        if (hints == null) return false;
        for (String hint : hints) {
            String value = compact(normalize(hint));
            if (value.contains("password")
                || value.contains("passwd")
                || value.equals("pwd")) return true;
        }
        return false;
    }

    private static boolean isOtpHint(String[] hints) {
        if (hints == null) return false;
        for (String hint : hints) {
            String value = compact(normalize(hint));
            if (value.contains("otp")
                || value.contains("onetime")
                || value.contains("totp")
                || value.contains("smscode")
                || value.contains("mfocode")
                || value.contains("mfacode")
                || value.contains("2facode")) return true;
        }
        return false;
    }

    private static boolean hasCompactHint(String[] hints, String expected) {
        if (hints == null) return false;
        for (String hint : hints) {
            if (compact(normalize(hint)).contains(expected)) return true;
        }
        return false;
    }

    private static String accountKind(
        String evidence,
        String compact,
        String[] hints,
        boolean emailInputType,
        boolean phoneInputType
    ) {
        if (emailInputType || hasHintPart(hints, "email")) return ACCOUNT_KIND_EMAIL;
        if (phoneInputType || hasHintPart(hints, "phone") || hasHintPart(hints, "tel")) {
            return ACCOUNT_KIND_PHONE;
        }
        if (hasHintPart(hints, "username") || hasHintPart(hints, "userid")) {
            return ACCOUNT_KIND_USERNAME;
        }

        boolean email = containsEmail(evidence, compact);
        boolean phone = containsPhone(evidence, compact);
        boolean username = containsUsername(evidence, compact);
        if (email && !phone && !username) return ACCOUNT_KIND_EMAIL;
        if (phone && !email && !username) return ACCOUNT_KIND_PHONE;
        if (username && !email && !phone) return ACCOUNT_KIND_USERNAME;
        return ACCOUNT_KIND_GENERIC;
    }

    private static boolean hasHintPart(String[] hints, String part) {
        if (hints == null) return false;
        for (String hint : hints) {
            if (compact(normalize(hint)).contains(part)) return true;
        }
        return false;
    }

    private static boolean containsSpecificAccount(String evidence, String compact) {
        return containsEmail(evidence, compact)
            || containsPhone(evidence, compact)
            || containsUsername(evidence, compact);
    }

    private static boolean containsAccount(String evidence, String compact) {
        return containsSpecificAccount(evidence, compact)
            || compact.contains("account")
            || compact.contains("login")
            || compact.contains("identifier")
            || compact.contains("membername")
            || compact.contains("screenname")
            || containsWord(evidence, "uid");
    }

    private static boolean containsUsername(String evidence, String compact) {
        return compact.contains("username")
            || compact.contains("userid")
            || compact.contains("loginid")
            || compact.contains("userhandle")
            || containsWord(evidence, "user");
    }

    private static boolean containsEmail(String evidence, String compact) {
        return compact.contains("email")
            || compact.contains("mailaddress")
            || containsWord(evidence, "mail");
    }

    private static boolean containsPhone(String evidence, String compact) {
        return compact.contains("phone")
            || compact.contains("mobile")
            || compact.contains("telephone")
            || compact.contains("msisdn")
            || containsWord(evidence, "tel");
    }

    private static boolean containsPassword(String evidence, String compact) {
        return compact.contains("password")
            || compact.contains("passwd")
            || compact.contains("passphrase")
            || compact.contains("passcode")
            || containsWord(evidence, "pwd")
            || containsWord(evidence, "psw")
            || containsWord(evidence, "pass");
    }

    private static boolean containsOtp(String evidence, String compact) {
        return compact.contains("otp")
            || compact.contains("totp")
            || compact.contains("onetimecode")
            || compact.contains("verificationcode")
            || compact.contains("securitycode")
            || compact.contains("smscode")
            || compact.contains("2facode")
            || compact.contains("mfacode")
            || (containsWord(evidence, "code")
                && (containsWord(evidence, "verification")
                    || containsWord(evidence, "security")
                    || containsWord(evidence, "sms")));
    }

    private static boolean containsStrongOtp(String evidence, String compact) {
        return compact.contains("otp")
            || compact.contains("totp")
            || compact.contains("onetimecode")
            || compact.contains("verificationcode")
            || compact.contains("smscode")
            || compact.contains("2facode")
            || compact.contains("mfacode");
    }

    private static boolean containsLoginIdentifier(String evidence, String compact) {
        return compact.contains("loginid")
            || compact.contains("loginname")
            || compact.contains("accountid")
            || compact.contains("membername")
            || compact.contains("identifier");
    }

    private static boolean containsSecret(String evidence, String compact) {
        return compact.contains("secret") || containsWord(evidence, "key");
    }

    private static boolean containsPin(String evidence, String compact) {
        return compact.contains("pincode") || containsWord(evidence, "pin");
    }

    private static boolean containsCaptcha(String evidence, String compact) {
        return compact.contains("captcha") || compact.contains("recaptcha");
    }

    private static boolean containsSearch(String evidence, String compact) {
        return compact.contains("search")
            || compact.contains("query")
            || containsWord(evidence, "find");
    }

    private static String evidence(String text, String[] hints) {
        StringBuilder builder = new StringBuilder(normalize(text));
        if (hints != null) {
            for (String hint : hints) builder.append(' ').append(normalize(hint));
        }
        return builder.toString().trim();
    }

    private static String normalize(String value) {
        if (value == null) return "";
        return value.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]+", " ").trim();
    }

    private static String compact(String value) {
        return value == null ? "" : value.replace(" ", "");
    }

    private static boolean containsWord(String evidence, String word) {
        if (evidence == null || evidence.isEmpty()) return false;
        String padded = " " + evidence + " ";
        return padded.contains(" " + word + " ");
    }

    private static <T> Candidate<T> bestForRole(List<Candidate<T>> candidates, Role role) {
        Candidate<T> best = null;
        for (Candidate<T> candidate : candidates) {
            if (candidate == null || candidate.id == null || candidate.decision.role != role) continue;
            if (best == null || scoreForRole(candidate.decision, role) > scoreForRole(best.decision, role)) {
                best = candidate;
            }
        }
        return best;
    }

    private static <T> List<Candidate<T>> allForRole(List<Candidate<T>> candidates, Role role) {
        List<Candidate<T>> result = new ArrayList<>();
        for (Candidate<T> candidate : candidates) {
            if (candidate != null && candidate.id != null && candidate.decision.role == role) result.add(candidate);
        }
        return result;
    }

    private static int scoreForRole(Decision decision, Role role) {
        if (role == Role.ACCOUNT) return decision.accountScore;
        if (role == Role.OTP) return decision.otpScore;
        return decision.passwordScore;
    }

    private static <T> Candidate<T> bestAccountBefore(
        List<Candidate<T>> candidates,
        int passwordOrder,
        int minimumScore
    ) {
        Candidate<T> best = null;
        for (Candidate<T> candidate : candidates) {
            if (candidate == null
                || candidate.id == null
                || candidate.order >= passwordOrder
                || !candidate.decision.textCandidate
                || candidate.decision.accountScore < minimumScore
                || candidate.decision.role == Role.PASSWORD
                || candidate.decision.role == Role.CURRENT_PASSWORD
                || candidate.decision.role == Role.NEW_PASSWORD
                || candidate.decision.role == Role.CONFIRM_PASSWORD
                || candidate.decision.role == Role.OTP) continue;
            if (best == null
                || candidate.decision.accountScore > best.decision.accountScore
                || (candidate.decision.accountScore == best.decision.accountScore
                    && candidate.order > best.order)) {
                best = candidate;
            }
        }
        return best;
    }
}
