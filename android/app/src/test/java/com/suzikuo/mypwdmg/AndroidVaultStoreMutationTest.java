package com.suzikuo.mypwdmg;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.assertArrayEquals;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

public class AndroidVaultStoreMutationTest {
    @Test
    public void sensitiveByteArraysAreClearedInPlace() {
        byte[] value = new byte[] {1, 2, 3, 4};

        AndroidVaultStore.wipeBytes(value);

        assertArrayEquals(new byte[] {0, 0, 0, 0}, value);
        AndroidVaultStore.wipeBytes(null);
    }

    @Test
    public void passwordlessMarkerMustBePresentAndMatchTheUnlockMode() throws Exception {
        assertTrue(AndroidVaultStore.passwordlessMarkerMatches(
            new JSONObject().put("passwordless", true),
            true
        ));
        assertTrue(AndroidVaultStore.passwordlessMarkerMatches(
            new JSONObject().put("passwordless", false),
            false
        ));
        assertFalse(AndroidVaultStore.passwordlessMarkerMatches(new JSONObject(), false));
        assertFalse(AndroidVaultStore.passwordlessMarkerMatches(
            new JSONObject().put("passwordless", true),
            false
        ));
    }

    @Test
    public void captureCandidateReadsTheSuppliedLatestPayload() throws Exception {
        JSONObject latestPayload = new JSONObject()
            .put("entries", new JSONArray().put(new JSONObject()
                .put("id", "latest-login")
                .put("kind", "login")
                .put("status", "active")
                .put("username", "alice@example.com")
                .put("password", "old-password")
                .put("domains", new JSONArray().put("login.example.com"))));
        JSONObject capture = new JSONObject()
            .put("hostname", "login.example.com")
            .put("username", "alice@example.com")
            .put("password", "new-password");

        JSONObject candidate = AndroidVaultStore.findCaptureCandidateInPayload(latestPayload, capture);

        assertEquals("latest-login", candidate.getString("id"));
        assertEquals("old-password", candidate.getString("password"));
    }

    @Test
    public void domainMatchingDoesNotCrossSiblingOrMultiTenantSubdomains() throws Exception {
        JSONObject siblingPayload = payloadWithLogin("accounts.example.com");
        JSONObject siblingCapture = captureFor("login.example.com");
        assertNull(AndroidVaultStore.findCaptureCandidateInPayload(siblingPayload, siblingCapture));

        JSONObject tenantPayload = payloadWithLogin("tenant-a.github.io");
        JSONObject tenantCapture = captureFor("tenant-b.github.io");
        assertNull(AndroidVaultStore.findCaptureCandidateInPayload(tenantPayload, tenantCapture));
    }

    @Test
    public void savedParentDomainStillMatchesItsSubdomains() throws Exception {
        JSONObject candidate = AndroidVaultStore.findCaptureCandidateInPayload(
            payloadWithLogin("example.com"),
            captureFor("login.example.com")
        );
        assertNotNull(candidate);
        assertEquals("login", candidate.getString("id"));
    }

    @Test
    public void autofillModesUseStrictHostBoundariesAndFailClosedForUrlPrefixes() {
        assertTrue(AndroidVaultStore.autofillRuleMatches("login.example.com", "example.com", "base-domain"));
        assertFalse(AndroidVaultStore.autofillRuleMatches("login.example.com", "example.com", "exact-host"));
        assertTrue(AndroidVaultStore.autofillRuleMatches("login.example.com", "example.com", "subdomain"));
        assertFalse(AndroidVaultStore.autofillRuleMatches("example.com", "example.com", "subdomain"));
        assertFalse(AndroidVaultStore.autofillRuleMatches("example.com", "https://example.com/account", "url-prefix"));
        assertFalse(AndroidVaultStore.autofillRuleMatches("example.com", "example.com", "never"));
        assertTrue(AndroidVaultStore.autofillRuleMatches("www.example.com", "www.example.com", "exact-host"));
        assertFalse(AndroidVaultStore.autofillRuleMatches("example.com", "www.example.com", "exact-host"));
    }

    @Test
    public void normalizationPreservesUrlPrefixesAndDefaultsLegacyEntries() throws Exception {
        JSONObject prefix = login("prefix", "https://Example.com/account#fragment")
            .put("autofillMatchMode", "url-prefix");
        JSONArray normalized = AndroidVaultStore.normalizeEntries(new JSONArray()
            .put(prefix)
            .put(login("legacy", "example.com")));

        assertEquals("https://example.com/account", normalized.getJSONObject(0).getJSONArray("domains").getString(0));
        assertEquals("url-prefix", normalized.getJSONObject(0).getString("autofillMatchMode"));
        assertEquals("base-domain", normalized.getJSONObject(1).getString("autofillMatchMode"));
    }

    @Test
    public void neverFillEntriesAreExcludedFromHostAndFallbackQueries() throws Exception {
        JSONObject never = login("never", "example.com").put("autofillMatchMode", "never");
        JSONObject payload = new JSONObject().put("entries", new JSONArray().put(never));
        assertEquals(0, AndroidVaultStore.queryMatchesFromPayload(payload, "example.com").length());
        assertEquals(0, AndroidVaultStore.queryMatchesFromPayload(payload, "", true).length());
    }

    @Test
    public void normalizationRepairsMissingAndDuplicateIdsAcrossTheWholeTree() throws Exception {
        JSONArray entries = new JSONArray()
            .put(login("duplicate", "example.com"))
            .put(new JSONObject()
                .put("id", "folder")
                .put("kind", "folder")
                .put("children", new JSONArray()
                    .put(login("duplicate", "example.com"))
                    .put(login("", "example.com"))));

        JSONArray normalized = AndroidVaultStore.normalizeEntries(entries);
        JSONArray children = normalized.getJSONObject(1).getJSONArray("children");
        assertEquals("duplicate", normalized.getJSONObject(0).getString("id"));
        assertEquals("duplicate-duplicate-2", children.getJSONObject(0).getString("id"));
        assertEquals("entry-missing-1-1", children.getJSONObject(1).getString("id"));
    }

    @Test
    public void directFillRejectsInactiveAncestorsAndAmbiguousIds() throws Exception {
        JSONObject inactiveTree = new JSONObject().put("entries", new JSONArray().put(new JSONObject()
            .put("id", "archived")
            .put("kind", "folder")
            .put("status", "disabled")
            .put("children", new JSONArray().put(login("nested", "example.com")))));
        assertThrows(
            IllegalArgumentException.class,
            () -> AndroidVaultStore.getFillPayloadFromPayload(inactiveTree, "nested")
        );

        JSONObject duplicates = new JSONObject().put("entries", new JSONArray()
            .put(login("duplicate", "example.com"))
            .put(login("duplicate", "example.com")));
        assertThrows(
            IllegalArgumentException.class,
            () -> AndroidVaultStore.getFillPayloadFromPayload(duplicates, "duplicate")
        );
    }

    private static JSONObject payloadWithLogin(String domain) throws Exception {
        return new JSONObject().put("entries", new JSONArray().put(login("login", domain)));
    }

    private static JSONObject login(String id, String domain) throws Exception {
        return new JSONObject()
            .put("id", id)
            .put("kind", "login")
            .put("status", "active")
            .put("username", "alice@example.com")
            .put("password", "old-password")
            .put("domains", new JSONArray().put(domain));
    }

    private static JSONObject captureFor(String hostname) throws Exception {
        return new JSONObject()
            .put("hostname", hostname)
            .put("username", "alice@example.com")
            .put("password", "new-password");
    }
}
