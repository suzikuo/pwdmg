package com.suzikuo.mypwdmg;

import java.security.SecureRandom;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Deque;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** Process-local, fail-closed handoff between provider query and completion activities. */
final class PasskeyOperationBroker {
    private static final long RATE_WINDOW_MS = 60_000L;
    private static final int MAX_OPERATIONS_PER_WINDOW = 12;
    private static final int MAX_ACTIVE_TICKETS = 128;
    private static final PasskeyOperationBroker INSTANCE = new PasskeyOperationBroker(new SecureRandom());

    private final SecureRandom random;
    private final Map<String, Ticket> tickets = new HashMap<>();
    private final Map<String, Deque<Long>> rateWindows = new HashMap<>();

    PasskeyOperationBroker(SecureRandom random) {
        if (random == null) throw new IllegalArgumentException("Secure random is required");
        this.random = random;
    }

    static PasskeyOperationBroker getInstance() {
        return INSTANCE;
    }

    synchronized Ticket issue(
        PasskeyOperation.Operation operation,
        String callerBinding,
        String credentialId,
        long now
    ) {
        requireNow(now);
        requireBinding(callerBinding);
        purge(now);
        boolean existingCeremony = false;
        for (Ticket active : tickets.values()) {
            if (active.callerBinding.equals(callerBinding)
                && PasskeyOperation.sameCeremony(active.nativeOperation.operation, operation)) {
                existingCeremony = true;
                break;
            }
        }
        if (!existingCeremony) enforceRateLimit(callerBinding, now);
        if (tickets.size() >= MAX_ACTIVE_TICKETS) throw new BrokerException("BROKER_CAPACITY");

        byte[] idBytes = new byte[32];
        String id;
        do {
            random.nextBytes(idBytes);
            id = Base64.getUrlEncoder().withoutPadding().encodeToString(idBytes);
        } while (tickets.containsKey(id));

        PasskeyOperation.NativeOperation nativeOperation = PasskeyOperation.bindNativeOperation(operation, id, now);
        Ticket ticket = new Ticket(nativeOperation, callerBinding, emptyToNull(credentialId));
        tickets.put(id, ticket);
        return ticket;
    }

    synchronized Ticket consume(
        String ticketId,
        String callerBinding,
        List<PasskeyOperation.Operation> finalOperations,
        long now
    ) {
        requireNow(now);
        requireBinding(callerBinding);
        Ticket ticket = tickets.remove(String.valueOf(ticketId));
        if (ticket == null) throw new BrokerException("TICKET_INVALID");
        if (PasskeyOperation.isExpired(ticket.nativeOperation, now)) throw new BrokerException("TICKET_EXPIRED");
        if (!ticket.callerBinding.equals(callerBinding)) throw new BrokerException("CALLER_MISMATCH");
        if (finalOperations == null || finalOperations.isEmpty()) throw new BrokerException("REQUEST_MISMATCH");
        for (PasskeyOperation.Operation operation : finalOperations) {
            if (PasskeyOperation.sameCeremony(ticket.nativeOperation.operation, operation)) return ticket;
        }
        throw new BrokerException("REQUEST_MISMATCH");
    }

    synchronized void cancel(String ticketId) {
        if (ticketId != null) tickets.remove(ticketId);
    }

    synchronized void cancelAll(List<String> ticketIds) {
        if (ticketIds == null) return;
        for (String ticketId : ticketIds) cancel(ticketId);
    }

    synchronized void clear() {
        tickets.clear();
        rateWindows.clear();
    }

    synchronized int activeTicketCount(long now) {
        requireNow(now);
        purge(now);
        return tickets.size();
    }

    private void enforceRateLimit(String callerBinding, long now) {
        Deque<Long> window = rateWindows.computeIfAbsent(callerBinding, ignored -> new ArrayDeque<>());
        while (!window.isEmpty() && now - window.peekFirst() >= RATE_WINDOW_MS) window.removeFirst();
        if (window.size() >= MAX_OPERATIONS_PER_WINDOW) throw new BrokerException("RATE_LIMITED");
        window.addLast(now);
    }

    private void purge(long now) {
        List<String> expired = new ArrayList<>();
        for (Map.Entry<String, Ticket> item : tickets.entrySet()) {
            if (PasskeyOperation.isExpired(item.getValue().nativeOperation, now)) expired.add(item.getKey());
        }
        for (String id : expired) tickets.remove(id);

        List<String> emptyWindows = new ArrayList<>();
        for (Map.Entry<String, Deque<Long>> item : rateWindows.entrySet()) {
            Deque<Long> window = item.getValue();
            while (!window.isEmpty() && now - window.peekFirst() >= RATE_WINDOW_MS) window.removeFirst();
            if (window.isEmpty()) emptyWindows.add(item.getKey());
        }
        for (String binding : emptyWindows) rateWindows.remove(binding);
    }

    private static void requireNow(long now) {
        if (now <= 0) throw new BrokerException("INVALID_TIME");
    }

    private static void requireBinding(String value) {
        if (value == null || value.isEmpty() || value.length() > 4096) {
            throw new BrokerException("CALLER_INVALID");
        }
    }

    private static String emptyToNull(String value) {
        return value == null || value.isEmpty() ? null : value;
    }

    static final class Ticket {
        final PasskeyOperation.NativeOperation nativeOperation;
        final String callerBinding;
        final String credentialId;

        Ticket(PasskeyOperation.NativeOperation nativeOperation, String callerBinding, String credentialId) {
            this.nativeOperation = nativeOperation;
            this.callerBinding = callerBinding;
            this.credentialId = credentialId;
        }
    }

    static final class BrokerException extends IllegalStateException {
        final String code;

        BrokerException(String code) {
            super(code);
            this.code = code;
        }
    }
}
