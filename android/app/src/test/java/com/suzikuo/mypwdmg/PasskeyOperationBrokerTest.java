package com.suzikuo.mypwdmg;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;

import org.junit.Test;

import java.security.SecureRandom;
import java.util.Collections;

public class PasskeyOperationBrokerTest {
    @Test
    public void ticketIsBoundSingleUseCancelableAndExpiring() {
        PasskeyOperationBroker broker = new PasskeyOperationBroker(new SecureRandom());
        PasskeyOperation.Operation operation = operation("example.com");
        PasskeyOperationBroker.Ticket ticket = broker.issue(operation, "package\norigin", "credential", 1_000L);

        PasskeyOperationBroker.Ticket consumed = broker.consume(
            ticket.nativeOperation.operationId,
            "package\norigin",
            Collections.singletonList(operation),
            2_000L
        );
        assertEquals("credential", consumed.credentialId);
        assertThrows(
            PasskeyOperationBroker.BrokerException.class,
            () -> broker.consume(
                ticket.nativeOperation.operationId,
                "package\norigin",
                Collections.singletonList(operation),
                2_001L
            )
        );

        PasskeyOperationBroker.Ticket cancelled = broker.issue(operation, "package\norigin", null, 3_000L);
        broker.cancel(cancelled.nativeOperation.operationId);
        assertEquals(0, broker.activeTicketCount(3_001L));

        PasskeyOperationBroker.Ticket expired = broker.issue(operation, "package\norigin", null, 4_000L);
        assertEquals(0, broker.activeTicketCount(expired.nativeOperation.expiresAt));
    }

    @Test
    public void callerAndRequestMismatchConsumeTheTicket() {
        PasskeyOperationBroker broker = new PasskeyOperationBroker(new SecureRandom());
        PasskeyOperation.Operation operation = operation("example.com");
        PasskeyOperationBroker.Ticket callerMismatch = broker.issue(operation, "caller-a", null, 10_000L);
        assertEquals(
            "CALLER_MISMATCH",
            assertThrows(
                PasskeyOperationBroker.BrokerException.class,
                () -> broker.consume(
                    callerMismatch.nativeOperation.operationId,
                    "caller-b",
                    Collections.singletonList(operation),
                    10_001L
                )
            ).code
        );
        assertEquals(0, broker.activeTicketCount(10_002L));

        PasskeyOperationBroker.Ticket requestMismatch = broker.issue(operation, "caller-a", null, 11_000L);
        assertEquals(
            "REQUEST_MISMATCH",
            assertThrows(
                PasskeyOperationBroker.BrokerException.class,
                () -> broker.consume(
                    requestMismatch.nativeOperation.operationId,
                    "caller-a",
                    Collections.singletonList(operation("other.example")),
                    11_001L
                )
            ).code
        );
        assertEquals(0, broker.activeTicketCount(11_002L));
    }

    @Test
    public void callerRateLimitRecoversAfterWindow() {
        PasskeyOperationBroker broker = new PasskeyOperationBroker(new SecureRandom());
        for (int index = 0; index < 12; index += 1) {
            broker.issue(operation("site" + index + ".example"), "caller", null, 100_000L + index);
        }
        assertEquals(
            "RATE_LIMITED",
            assertThrows(
                PasskeyOperationBroker.BrokerException.class,
                () -> broker.issue(operation("rate-limited.example"), "caller", null, 100_100L)
            ).code
        );
        broker.issue(operation("recovered.example"), "caller", null, 160_012L);
    }

    @Test
    public void oneCeremonyCanIssueManyCredentialEntriesWithoutSelfRateLimiting() {
        PasskeyOperationBroker broker = new PasskeyOperationBroker(new SecureRandom());
        PasskeyOperation.Operation operation = operation("example.com");
        for (int index = 0; index < 50; index += 1) {
            broker.issue(operation, "caller", "credential-" + index, 200_000L + index);
        }
        assertEquals(50, broker.activeTicketCount(200_100L));
    }

    private static PasskeyOperation.Operation operation(String rpId) {
        return PasskeyOperation.parse(
            PasskeyOperation.Kind.GET,
            "{\"challenge\":\"AAECAwQFBgcICQoLDA0ODw\",\"rpId\":\"" + rpId + "\"}",
            "https://example.com",
            "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8"
        );
    }
}
