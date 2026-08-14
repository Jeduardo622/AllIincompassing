import { describe, expect, it, vi } from "vitest";
import {
  clearRetainedPayrollOutboxEvent,
  createInMemoryPayrollOutboxStore,
  drainPayrollOutbox,
  enqueuePayrollOutboxEvent,
  listPayrollOutboxEvents,
  reconfirmRetainedPayrollOutboxEvent,
} from "../../../payroll/outbox";
import type { PayrollMutationSuccess, PayrollSessionContext } from "../../../payroll/api";

const baseScope = {
  organizationId: "88888888-8888-8888-8888-888888888888",
  userId: "99999999-9999-9999-9999-999999999999",
  localDate: "2026-08-12",
};

const baseContext: PayrollSessionContext = {
  state: "ok",
  sessionId: "77777777-7777-7777-7777-777777777777",
  organizationId: baseScope.organizationId,
  employmentProfileId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  employmentTimezone: "America/Los_Angeles",
  actorIsAssignedEmployee: true,
  canClockSelf: true,
  canonicalWorkLocation: "client_site",
  activeShiftEventId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
};
const { state: _ignoredBaseContextState, ...legacyBaseContext } = baseContext;

const disabledContext = {
  state: "feature_disabled" as const,
  sessionId: baseContext.sessionId,
  organizationId: baseScope.organizationId,
};

const startRequest = {
  sessionId: baseContext.sessionId,
  programId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
  goalId: "dddddddd-dddd-dddd-dddd-dddddddddddd",
};

const completeRequest = {
  sessionId: baseContext.sessionId,
  outcome: "completed" as const,
  notes: "Clinical close",
};

const confirmed = (idempotencyKey: string): PayrollMutationSuccess => ({
  idempotencyKey,
});

describe("sessionPayrollLifecycle", () => {
  it("returns an explicit clock-choice-required preparation only for the assigned employee without an active shift", async () => {
    const { createSessionPayrollLifecycle } = await import("../sessionPayrollLifecycle");
    const lifecycle = createSessionPayrollLifecycle({
      store: createInMemoryPayrollOutboxStore(),
      fetchSessionContext: vi
        .fn()
        .mockResolvedValueOnce({ ...baseContext, activeShiftEventId: null, actorIsAssignedEmployee: true })
        .mockResolvedValueOnce({ ...baseContext, activeShiftEventId: null, actorIsAssignedEmployee: false }),
      drainOutbox: vi.fn(),
      enqueueOutboxEvent: vi.fn(),
      reconfirmRetainedEvent: vi.fn(),
      clearRetainedEvent: vi.fn(),
      findRetainedEvent: vi.fn(async () => null),
      recordTimeEvent: vi.fn(),
      recordSessionAttendance: vi.fn(),
      startClinicalSession: vi.fn(),
      completeClinicalSession: vi.fn(),
      revalidateTerminalOutcome: vi.fn(),
      isOnline: vi.fn(() => true),
      createIdempotencyKey: vi.fn(() => "generated-key"),
      now: vi.fn(() => "2026-08-12T16:00:00.000Z"),
    });

    await expect(
      lifecycle.prepareStart({ scope: baseScope, sessionId: baseContext.sessionId }),
    ).resolves.toMatchObject({
      kind: "clock_choice_required",
      attendance: {
        idempotencyKey: "generated-key",
        occurredAt: "2026-08-12T16:00:00.000Z",
      },
    });

    await expect(
      lifecycle.prepareStart({ scope: baseScope, sessionId: baseContext.sessionId }),
    ).resolves.toMatchObject({
      kind: "ready",
      mode: "delegated",
    });
  });

  it("returns payroll_disabled from prepareStart without payroll or clinical side effects", async () => {
    const store = createInMemoryPayrollOutboxStore();
    const findRetainedEvent = vi.fn();
    const enqueueOutboxEvent = vi.fn();
    const drainOutbox = vi.fn();
    const recordTimeEvent = vi.fn();
    const recordSessionAttendance = vi.fn();
    const startClinicalSession = vi.fn();

    const { createSessionPayrollLifecycle } = await import("../sessionPayrollLifecycle");
    const lifecycle = createSessionPayrollLifecycle({
      store,
      fetchSessionContext: vi.fn(async () => disabledContext),
      enqueueOutboxEvent,
      drainOutbox,
      findRetainedEvent,
      reconfirmRetainedEvent: vi.fn(),
      clearRetainedEvent: vi.fn(),
      recordTimeEvent,
      recordSessionAttendance,
      startClinicalSession,
      completeClinicalSession: vi.fn(),
      revalidateTerminalOutcome: vi.fn(),
      isOnline: vi.fn(() => true),
      createIdempotencyKey: vi.fn(() => "unused-disabled-key"),
      now: vi.fn(() => "2026-08-12T16:04:00.000Z"),
    });

    await expect(
      lifecycle.prepareStart({ scope: baseScope, sessionId: baseContext.sessionId }),
    ).resolves.toEqual({ kind: "payroll_disabled" });

    expect(findRetainedEvent).not.toHaveBeenCalled();
    expect(enqueueOutboxEvent).not.toHaveBeenCalled();
    expect(drainOutbox).not.toHaveBeenCalled();
    expect(recordTimeEvent).not.toHaveBeenCalled();
    expect(recordSessionAttendance).not.toHaveBeenCalled();
    expect(startClinicalSession).not.toHaveBeenCalled();
    await expect(listPayrollOutboxEvents(store, baseScope)).resolves.toEqual([]);
  });

  it("propagates generic context fetch failures instead of treating them as disabled bypasses", async () => {
    const contextError = new Error("context fetch failed");
    const findRetainedEvent = vi.fn();
    const enqueueOutboxEvent = vi.fn();

    const { createSessionPayrollLifecycle } = await import("../sessionPayrollLifecycle");
    const lifecycle = createSessionPayrollLifecycle({
      store: createInMemoryPayrollOutboxStore(),
      fetchSessionContext: vi.fn(async () => {
        throw contextError;
      }),
      enqueueOutboxEvent,
      drainOutbox: vi.fn(),
      findRetainedEvent,
      reconfirmRetainedEvent: vi.fn(),
      clearRetainedEvent: vi.fn(),
      recordTimeEvent: vi.fn(),
      recordSessionAttendance: vi.fn(),
      startClinicalSession: vi.fn(),
      completeClinicalSession: vi.fn(),
      revalidateTerminalOutcome: vi.fn(),
      isOnline: vi.fn(() => true),
      createIdempotencyKey: vi.fn(() => "unused-error-key"),
      now: vi.fn(() => "2026-08-12T16:04:30.000Z"),
    });

    await expect(
      lifecycle.prepareStart({ scope: baseScope, sessionId: baseContext.sessionId }),
    ).rejects.toBe(contextError);

    expect(findRetainedEvent).not.toHaveBeenCalled();
    expect(enqueueOutboxEvent).not.toHaveBeenCalled();
  });

  it("rejects malformed session context responses before any payroll or clinical side effects", async () => {
    const malformedCases = [
      {
        name: "unexpected discriminant",
        context: { ...baseContext, state: "unexpected_state" },
      },
      {
        name: "malformed ok",
        context: { ...baseContext, state: "ok", canonicalWorkLocation: "invalid_location", unexpected: true },
      },
      {
        name: "malformed feature_disabled",
        context: {
          state: "feature_disabled",
          sessionId: baseContext.sessionId,
          organizationId: baseScope.organizationId,
          unexpected: true,
        },
      },
      {
        name: "malformed legacy no-state",
        context: { ...legacyBaseContext, activeShiftEventId: "not-a-uuid" },
      },
    ];

    for (const malformedCase of malformedCases) {
      const store = createInMemoryPayrollOutboxStore();
      const findRetainedEvent = vi.fn();
      const enqueueOutboxEvent = vi.fn();
      const drainOutbox = vi.fn();
      const recordTimeEvent = vi.fn();
      const recordSessionAttendance = vi.fn();
      const startClinicalSession = vi.fn();
      const completeClinicalSession = vi.fn();

      const { createSessionPayrollLifecycle } = await import("../sessionPayrollLifecycle");
      const lifecycle = createSessionPayrollLifecycle({
        store,
        fetchSessionContext: vi.fn(async () => malformedCase.context as PayrollSessionContext),
        enqueueOutboxEvent,
        drainOutbox,
        findRetainedEvent,
        reconfirmRetainedEvent: vi.fn(),
        clearRetainedEvent: vi.fn(),
        recordTimeEvent,
        recordSessionAttendance,
        startClinicalSession,
        completeClinicalSession,
        revalidateTerminalOutcome: vi.fn(),
        isOnline: vi.fn(() => true),
        createIdempotencyKey: vi.fn(() => "unused-malformed-key"),
        now: vi.fn(() => "2026-08-12T16:04:45.000Z"),
      });

      await expect(
        lifecycle.prepareStart({ scope: baseScope, sessionId: baseContext.sessionId }),
        malformedCase.name,
      ).rejects.toThrow(/payroll session context/i);

      expect(findRetainedEvent, malformedCase.name).not.toHaveBeenCalled();
      expect(enqueueOutboxEvent, malformedCase.name).not.toHaveBeenCalled();
      expect(drainOutbox, malformedCase.name).not.toHaveBeenCalled();
      expect(recordTimeEvent, malformedCase.name).not.toHaveBeenCalled();
      expect(recordSessionAttendance, malformedCase.name).not.toHaveBeenCalled();
      expect(startClinicalSession, malformedCase.name).not.toHaveBeenCalled();
      expect(completeClinicalSession, malformedCase.name).not.toHaveBeenCalled();
      await expect(listPayrollOutboxEvents(store, baseScope), malformedCase.name).resolves.toEqual([]);
    }
  });

  it("records delegated attendance only, never offers clock-in, and clears the retained row after clinical start success", async () => {
    const store = createInMemoryPayrollOutboxStore();
    const callOrder: string[] = [];
    const enqueueOutboxEvent = vi.fn(async (input) => {
      callOrder.push(`enqueue:${input.idempotencyKey}:${input.payload.data.eventType}`);
      const { enqueuePayrollOutboxEvent } = await import("../../../payroll/outbox");
      return enqueuePayrollOutboxEvent(input);
    });
    const drainOutbox = vi.fn(async (input) => {
      callOrder.push("drain");
      const { drainPayrollOutbox } = await import("../../../payroll/outbox");
      return drainPayrollOutbox(input);
    });
    const startClinicalSession = vi.fn(async () => {
      callOrder.push("clinical");
      return { outcome: "started" as const };
    });

    const { createSessionPayrollLifecycle } = await import("../sessionPayrollLifecycle");
    const lifecycle = createSessionPayrollLifecycle({
      store,
      fetchSessionContext: vi.fn(async () => ({ ...baseContext, actorIsAssignedEmployee: false, activeShiftEventId: null })),
      enqueueOutboxEvent,
      drainOutbox,
      findRetainedEvent: vi.fn(async () => null),
      reconfirmRetainedEvent: vi.fn(),
      clearRetainedEvent: vi.fn(async (input) => {
        callOrder.push(`clear:${input.idempotencyKey}`);
        const { clearRetainedPayrollOutboxEvent } = await import("../../../payroll/outbox");
        return clearRetainedPayrollOutboxEvent(input);
      }),
      recordTimeEvent: vi.fn(async () => confirmed("unused-time-key")),
      recordSessionAttendance: vi.fn(async (input) => {
        callOrder.push(`attendance:${input.idempotencyKey}:${String(input.event.data.employeeTimeEventId ?? "none")}`);
        return confirmed(input.idempotencyKey);
      }),
      startClinicalSession,
      completeClinicalSession: vi.fn(),
      revalidateTerminalOutcome: vi.fn(),
      isOnline: vi.fn(() => true),
      createIdempotencyKey: vi.fn(() => "delegated-attendance-key"),
      now: vi.fn(() => "2026-08-12T16:05:00.000Z"),
    });

    const prepared = await lifecycle.prepareStart({ scope: baseScope, sessionId: baseContext.sessionId });
    expect(prepared).toMatchObject({ kind: "ready", mode: "delegated" });

    await expect(
      lifecycle.executeStart({
        scope: baseScope,
        prepared,
        choice: "delegated",
        request: startRequest,
      }),
    ).resolves.toMatchObject({
      kind: "started",
      attendanceIdempotencyKey: "delegated-attendance-key",
    });

    expect(callOrder).toEqual([
      "enqueue:delegated-attendance-key:session_started",
      "drain",
      "attendance:delegated-attendance-key:none",
      "clinical",
      "clear:delegated-attendance-key",
    ]);
    expect(startClinicalSession).toHaveBeenCalledTimes(1);
    expect(await listPayrollOutboxEvents(store, baseScope)).toEqual([]);
  });

  it("adopts a retained attendance descriptor discovered after preparation for confirmation, clear, and result", async () => {
    const store = createInMemoryPayrollOutboxStore();
    const clearRetainedEvent = vi.fn(clearRetainedPayrollOutboxEvent);
    const recordSessionAttendance = vi.fn(async (input) => confirmed(input.idempotencyKey));
    const startClinicalSession = vi.fn(async () => ({ outcome: "started" as const }));

    const { createSessionPayrollLifecycle } = await import("../sessionPayrollLifecycle");
    const lifecycle = createSessionPayrollLifecycle({
      store,
      fetchSessionContext: vi.fn(async () => baseContext),
      enqueueOutboxEvent: enqueuePayrollOutboxEvent,
      drainOutbox: drainPayrollOutbox,
      findRetainedEvent: undefined,
      reconfirmRetainedEvent: reconfirmRetainedPayrollOutboxEvent,
      clearRetainedEvent,
      recordTimeEvent: vi.fn(async (input) => confirmed(input.idempotencyKey)),
      recordSessionAttendance,
      startClinicalSession,
      completeClinicalSession: vi.fn(),
      revalidateTerminalOutcome: vi.fn(),
      isOnline: vi.fn(() => true),
      createIdempotencyKey: vi.fn(() => "prepared-attendance-key-a"),
      now: vi.fn(() => "2026-08-12T16:06:00.000Z"),
    });

    const prepared = await lifecycle.prepareStart({ scope: baseScope, sessionId: baseContext.sessionId });
    expect(prepared.attendance).toEqual({
      idempotencyKey: "prepared-attendance-key-a",
      occurredAt: "2026-08-12T16:06:00.000Z",
    });

    await enqueuePayrollOutboxEvent({
      store,
      ...baseScope,
      action: "record_session_attendance",
      idempotencyKey: "retained-attendance-key-b",
      occurredAt: "2026-08-12T16:05:30.000Z",
      payload: {
        occurredAt: "2026-08-12T16:05:30.000Z",
        timezone: baseContext.employmentTimezone,
        workLocation: baseContext.canonicalWorkLocation,
        data: {
          eventType: "session_started",
          sessionId: baseContext.sessionId,
          employeeTimeEventId: baseContext.activeShiftEventId,
        },
      },
      retainForClinical: true,
    });

    const result = await lifecycle.executeStart({
      scope: baseScope,
      prepared,
      choice: "active",
      request: startRequest,
    });

    expect(result).toEqual({
      kind: "started",
      attendanceIdempotencyKey: "retained-attendance-key-b",
    });
    expect(recordSessionAttendance).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: "retained-attendance-key-b",
      event: expect.objectContaining({ occurredAt: "2026-08-12T16:05:30.000Z" }),
    }));
    expect(startClinicalSession).toHaveBeenCalledTimes(1);
    expect(clearRetainedEvent).toHaveBeenCalledTimes(1);
    expect(clearRetainedEvent).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: "retained-attendance-key-b",
      confirmedServerIdempotencyKey: "retained-attendance-key-b",
    }));
    expect(clearRetainedEvent).not.toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: "prepared-attendance-key-a",
    }));
    expect(await listPayrollOutboxEvents(store, baseScope)).toEqual([]);
  });

  it("uses separate stable keys for clock-in and session start, refetches context, and never emits shift_ended", async () => {
    const store = createInMemoryPayrollOutboxStore();
    const fetchSessionContext = vi
      .fn()
      .mockResolvedValueOnce({ ...baseContext, activeShiftEventId: null })
      .mockResolvedValueOnce({ ...baseContext, activeShiftEventId: null })
      .mockResolvedValueOnce({ ...baseContext, activeShiftEventId: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee" });
    const timeEventTypes: string[] = [];
    const attendancePayloads: unknown[] = [];

    const { createSessionPayrollLifecycle } = await import("../sessionPayrollLifecycle");
    const lifecycle = createSessionPayrollLifecycle({
      store,
      fetchSessionContext,
      enqueueOutboxEvent: vi.fn(async (input) => {
        const { enqueuePayrollOutboxEvent } = await import("../../../payroll/outbox");
        return enqueuePayrollOutboxEvent(input);
      }),
      drainOutbox: vi.fn(async (input) => {
        const { drainPayrollOutbox } = await import("../../../payroll/outbox");
        return drainPayrollOutbox(input);
      }),
      findRetainedEvent: vi.fn(async () => null),
      reconfirmRetainedEvent: vi.fn(),
      clearRetainedEvent: vi.fn(async (input) => {
        const { clearRetainedPayrollOutboxEvent } = await import("../../../payroll/outbox");
        return clearRetainedPayrollOutboxEvent(input);
      }),
      recordTimeEvent: vi.fn(async (input) => {
        timeEventTypes.push(input.event.data.eventType);
        return confirmed(input.idempotencyKey);
      }),
      recordSessionAttendance: vi.fn(async (input) => {
        attendancePayloads.push(input.event);
        return confirmed(input.idempotencyKey);
      }),
      startClinicalSession: vi.fn(async () => ({ outcome: "started" as const })),
      completeClinicalSession: vi.fn(),
      revalidateTerminalOutcome: vi.fn(),
      isOnline: vi.fn(() => true),
      createIdempotencyKey: vi
        .fn()
        .mockReturnValueOnce("shift-started-key")
        .mockReturnValueOnce("session-started-key"),
      now: vi.fn(() => "2026-08-12T16:10:00.000Z"),
    });

    const prepared = await lifecycle.prepareStart({ scope: baseScope, sessionId: baseContext.sessionId });
    expect(prepared).toMatchObject({ kind: "clock_choice_required" });

    await lifecycle.executeStart({
      scope: baseScope,
      prepared,
      choice: "clock_in",
      request: startRequest,
    });

    expect(fetchSessionContext).toHaveBeenCalledTimes(3);
    expect(timeEventTypes).toEqual(["shift_started"]);
    expect(timeEventTypes).not.toContain("shift_ended");
    expect(attendancePayloads).toEqual([{
      occurredAt: "2026-08-12T16:10:00.000Z",
      data: {
        eventType: "session_started",
        sessionId: baseContext.sessionId,
      },
    }]);
  });

  it("rejects invalid executeStart choices before enqueueing any payroll or clinical side effects", async () => {
    const { createSessionPayrollLifecycle } = await import("../sessionPayrollLifecycle");
    const invalidCases = [
      {
        name: "ready active rejects delegated",
        prepared: {
          kind: "ready" as const,
          mode: "active" as const,
          context: baseContext,
          attendance: {
            idempotencyKey: "invalid-active-key",
            occurredAt: "2026-08-12T16:12:00.000Z",
          },
        },
        choice: "delegated" as const,
      },
      {
        name: "ready delegated rejects active",
        prepared: {
          kind: "ready" as const,
          mode: "delegated" as const,
          context: { ...baseContext, actorIsAssignedEmployee: false, activeShiftEventId: null },
          attendance: {
            idempotencyKey: "invalid-delegated-key",
            occurredAt: "2026-08-12T16:13:00.000Z",
          },
        },
        choice: "active" as const,
      },
      {
        name: "clock choice rejects active",
        prepared: {
          kind: "clock_choice_required" as const,
          context: { ...baseContext, activeShiftEventId: null },
          attendance: {
            idempotencyKey: "invalid-clock-choice-key",
            occurredAt: "2026-08-12T16:14:00.000Z",
          },
        },
        choice: "active" as const,
      },
      {
        name: "clock in rejects delegated actor",
        prepared: {
          kind: "clock_choice_required" as const,
          context: { ...baseContext, actorIsAssignedEmployee: false, activeShiftEventId: null },
          attendance: {
            idempotencyKey: "invalid-clock-in-key",
            occurredAt: "2026-08-12T16:15:00.000Z",
          },
        },
        choice: "clock_in" as const,
      },
      {
        name: "clock in rejects actor without self-clock permission",
        prepared: {
          kind: "clock_choice_required" as const,
          context: { ...baseContext, activeShiftEventId: null, canClockSelf: false },
          attendance: {
            idempotencyKey: "invalid-clock-permission-key",
            occurredAt: "2026-08-12T16:16:00.000Z",
          },
        },
        choice: "clock_in" as const,
      },
    ];

    for (const invalidCase of invalidCases) {
      const store = createInMemoryPayrollOutboxStore();
      const enqueueOutboxEvent = vi.fn();
      const drainOutbox = vi.fn();
      const recordTimeEvent = vi.fn();
      const recordSessionAttendance = vi.fn();
      const startClinicalSession = vi.fn();
      const lifecycle = createSessionPayrollLifecycle({
        store,
        fetchSessionContext: vi.fn(async () => invalidCase.prepared.context),
        enqueueOutboxEvent,
        drainOutbox,
        findRetainedEvent: vi.fn(async () => null),
        reconfirmRetainedEvent: vi.fn(),
        clearRetainedEvent: vi.fn(),
        recordTimeEvent,
        recordSessionAttendance,
        startClinicalSession,
        completeClinicalSession: vi.fn(),
        revalidateTerminalOutcome: vi.fn(),
        isOnline: vi.fn(() => true),
        createIdempotencyKey: vi.fn(() => "unused-key"),
        now: vi.fn(() => invalidCase.prepared.attendance.occurredAt),
      });

      await expect(
        lifecycle.executeStart({
          scope: baseScope,
          prepared: invalidCase.prepared,
          choice: invalidCase.choice,
          request: startRequest,
        }),
        invalidCase.name,
      ).rejects.toThrow();

      expect(enqueueOutboxEvent, invalidCase.name).not.toHaveBeenCalled();
      expect(drainOutbox, invalidCase.name).not.toHaveBeenCalled();
      expect(recordTimeEvent, invalidCase.name).not.toHaveBeenCalled();
      expect(recordSessionAttendance, invalidCase.name).not.toHaveBeenCalled();
      expect(startClinicalSession, invalidCase.name).not.toHaveBeenCalled();
      await expect(listPayrollOutboxEvents(store, baseScope), invalidCase.name).resolves.toEqual([]);
    }
  });

  it("rejects stale or mismatched prepared context before any executeStart side effects", async () => {
    const { createSessionPayrollLifecycle } = await import("../sessionPayrollLifecycle");
    const cases = [
      {
        name: "prepared session mismatch",
        prepared: {
          kind: "ready" as const,
          mode: "active" as const,
          context: { ...baseContext, sessionId: "12121212-1212-1212-1212-121212121212" },
          attendance: {
            idempotencyKey: "stale-session-mismatch-key",
            occurredAt: "2026-08-12T16:16:30.000Z",
          },
        },
        request: startRequest,
        freshContext: baseContext,
        choice: "active" as const,
      },
      {
        name: "fresh context invalidates stale active preparation",
        prepared: {
          kind: "ready" as const,
          mode: "active" as const,
          context: baseContext,
          attendance: {
            idempotencyKey: "stale-active-key",
            occurredAt: "2026-08-12T16:16:31.000Z",
          },
        },
        request: startRequest,
        freshContext: { ...baseContext, activeShiftEventId: null },
        choice: "active" as const,
      },
    ];

    for (const testCase of cases) {
      const store = createInMemoryPayrollOutboxStore();
      const enqueueOutboxEvent = vi.fn();
      const drainOutbox = vi.fn();
      const recordTimeEvent = vi.fn();
      const recordSessionAttendance = vi.fn();
      const startClinicalSession = vi.fn();
      const lifecycle = createSessionPayrollLifecycle({
        store,
        fetchSessionContext: vi.fn(async () => testCase.freshContext),
        enqueueOutboxEvent,
        drainOutbox,
        findRetainedEvent: vi.fn(async () => null),
        reconfirmRetainedEvent: vi.fn(),
        clearRetainedEvent: vi.fn(),
        recordTimeEvent,
        recordSessionAttendance,
        startClinicalSession,
        completeClinicalSession: vi.fn(),
        revalidateTerminalOutcome: vi.fn(),
        isOnline: vi.fn(() => true),
        createIdempotencyKey: vi.fn(() => "unused-key"),
        now: vi.fn(() => testCase.prepared.attendance.occurredAt),
      });

      await expect(
        lifecycle.executeStart({
          scope: baseScope,
          prepared: testCase.prepared,
          choice: testCase.choice,
          request: testCase.request,
        }),
        testCase.name,
      ).rejects.toThrow();

      expect(enqueueOutboxEvent, testCase.name).not.toHaveBeenCalled();
      expect(drainOutbox, testCase.name).not.toHaveBeenCalled();
      expect(recordTimeEvent, testCase.name).not.toHaveBeenCalled();
      expect(recordSessionAttendance, testCase.name).not.toHaveBeenCalled();
      expect(startClinicalSession, testCase.name).not.toHaveBeenCalled();
      await expect(listPayrollOutboxEvents(store, baseScope), testCase.name).resolves.toEqual([]);
    }
  });

  it("fails closed when the authoritative post-clock-in context still lacks an active shift link", async () => {
    const store = createInMemoryPayrollOutboxStore();
    const fetchSessionContext = vi
      .fn()
      .mockResolvedValueOnce({ ...baseContext, activeShiftEventId: null })
      .mockResolvedValueOnce({ ...baseContext, activeShiftEventId: null });
    const recordTimeEvent = vi.fn(async (input) => confirmed(input.idempotencyKey));
    const recordSessionAttendance = vi.fn(async (input) => confirmed(input.idempotencyKey));
    const startClinicalSession = vi.fn();

    const { createSessionPayrollLifecycle } = await import("../sessionPayrollLifecycle");
    const lifecycle = createSessionPayrollLifecycle({
      store,
      fetchSessionContext,
      enqueueOutboxEvent: vi.fn(async (input) => {
        const { enqueuePayrollOutboxEvent } = await import("../../../payroll/outbox");
        return enqueuePayrollOutboxEvent(input);
      }),
      drainOutbox: vi.fn(async (input) => {
        const { drainPayrollOutbox } = await import("../../../payroll/outbox");
        return drainPayrollOutbox(input);
      }),
      findRetainedEvent: vi.fn(async () => null),
      reconfirmRetainedEvent: vi.fn(),
      clearRetainedEvent: vi.fn(),
      recordTimeEvent,
      recordSessionAttendance,
      startClinicalSession,
      completeClinicalSession: vi.fn(),
      revalidateTerminalOutcome: vi.fn(),
      isOnline: vi.fn(() => true),
      createIdempotencyKey: vi
        .fn()
        .mockReturnValueOnce("shift-started-missing-link-key")
        .mockReturnValueOnce("session-started-missing-link-key"),
      now: vi.fn(() => "2026-08-12T16:17:00.000Z"),
    });

    const prepared = await lifecycle.prepareStart({ scope: baseScope, sessionId: baseContext.sessionId });
    await expect(
      lifecycle.executeStart({
        scope: baseScope,
        prepared,
        choice: "clock_in",
        request: startRequest,
      }),
    ).rejects.toThrow();

    expect(recordTimeEvent).toHaveBeenCalledTimes(1);
    expect(recordSessionAttendance).not.toHaveBeenCalled();
    expect(startClinicalSession).not.toHaveBeenCalled();
    await expect(listPayrollOutboxEvents(store, baseScope)).resolves.toEqual([]);
  });

  it("defers pending retained attendance until clock-in is confirmed without caller-supplied authority", async () => {
    const store = createInMemoryPayrollOutboxStore();
    const initialLifecycleFetch = vi.fn(async () => ({ ...baseContext, activeShiftEventId: null }));
    const { createSessionPayrollLifecycle } = await import("../sessionPayrollLifecycle");
    const firstLifecycle = createSessionPayrollLifecycle({
      store,
      fetchSessionContext: initialLifecycleFetch,
      enqueueOutboxEvent: vi.fn(async (input) => {
        const { enqueuePayrollOutboxEvent } = await import("../../../payroll/outbox");
        return enqueuePayrollOutboxEvent(input);
      }),
      drainOutbox: vi.fn(async () => ({ confirmedKeys: [] })),
      findRetainedEvent: undefined,
      reconfirmRetainedEvent: vi.fn(),
      clearRetainedEvent: vi.fn(),
      recordTimeEvent: vi.fn(async (input) => confirmed(input.idempotencyKey)),
      recordSessionAttendance: vi.fn(async (input) => confirmed(input.idempotencyKey)),
      startClinicalSession: vi.fn(),
      completeClinicalSession: vi.fn(),
      revalidateTerminalOutcome: vi.fn(),
      isOnline: vi.fn(() => false),
      createIdempotencyKey: vi.fn(() => "retained-upgrade-key"),
      now: vi.fn(() => "2026-08-12T16:18:00.000Z"),
    });

    const preparedOffline = await firstLifecycle.prepareStart({ scope: baseScope, sessionId: baseContext.sessionId });
    await expect(
      firstLifecycle.executeStart({
        scope: baseScope,
        prepared: preparedOffline,
        choice: "continue_without_clock_in",
        request: startRequest,
      }),
    ).resolves.toMatchObject({
      kind: "attendance_not_confirmed",
      attendanceIdempotencyKey: "retained-upgrade-key",
    });

    const retainedPending = await listPayrollOutboxEvents(store, baseScope);
    expect(retainedPending).toHaveLength(1);
    expect(retainedPending[0]).toMatchObject({
      idempotencyKey: "retained-upgrade-key",
      state: "pending",
    });
    expect((retainedPending[0].payload as { data?: Record<string, unknown> }).data).not.toHaveProperty("employeeTimeEventId");

    const recordSessionAttendance = vi.fn(async (input) => confirmed(input.idempotencyKey));
    const secondLifecycle = createSessionPayrollLifecycle({
      store,
      fetchSessionContext: vi
        .fn()
        .mockResolvedValueOnce({ ...baseContext, activeShiftEventId: null })
        .mockResolvedValueOnce({ ...baseContext, activeShiftEventId: null })
        .mockResolvedValueOnce({ ...baseContext, activeShiftEventId: "f1f1f1f1-f1f1-f1f1-f1f1-f1f1f1f1f1f1" }),
      enqueueOutboxEvent: vi.fn(async (input) => {
        const { enqueuePayrollOutboxEvent } = await import("../../../payroll/outbox");
        return enqueuePayrollOutboxEvent(input);
      }),
      drainOutbox: vi.fn(async (input) => {
        const { drainPayrollOutbox } = await import("../../../payroll/outbox");
        return drainPayrollOutbox(input);
      }),
      findRetainedEvent: undefined,
      reconfirmRetainedEvent: vi.fn(async (input) => {
        const { reconfirmRetainedPayrollOutboxEvent } = await import("../../../payroll/outbox");
        return reconfirmRetainedPayrollOutboxEvent(input);
      }),
      clearRetainedEvent: vi.fn(async (input) => {
        const { clearRetainedPayrollOutboxEvent } = await import("../../../payroll/outbox");
        return clearRetainedPayrollOutboxEvent(input);
      }),
      recordTimeEvent: vi.fn(async (input) => confirmed(input.idempotencyKey)),
      recordSessionAttendance,
      startClinicalSession: vi.fn(async () => ({ outcome: "started" as const })),
      completeClinicalSession: vi.fn(),
      revalidateTerminalOutcome: vi.fn(),
      isOnline: vi.fn(() => true),
      createIdempotencyKey: vi.fn(() => "shift-upgrade-key"),
      now: vi.fn(() => "2026-08-12T16:19:00.000Z"),
    });

    const preparedOnline = await secondLifecycle.prepareStart({ scope: baseScope, sessionId: baseContext.sessionId });
    expect(preparedOnline.attendance).toEqual({
      idempotencyKey: "retained-upgrade-key",
      occurredAt: "2026-08-12T16:18:00.000Z",
    });

    await expect(
      secondLifecycle.executeStart({
        scope: baseScope,
        prepared: preparedOnline,
        choice: "clock_in",
        request: startRequest,
      }),
    ).resolves.toMatchObject({
      kind: "started",
      attendanceIdempotencyKey: "retained-upgrade-key",
      shiftIdempotencyKey: "shift-upgrade-key",
    });

    expect(recordSessionAttendance).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: "retained-upgrade-key",
      event: {
        occurredAt: "2026-08-12T16:18:00.000Z",
        data: {
          eventType: "session_started",
          sessionId: baseContext.sessionId,
        },
      },
    }));
    expect(await listPayrollOutboxEvents(store, baseScope)).toEqual([]);
  });

  it("fails closed on clock_in retry when the retained attendance is already confirmed for the original unlinked choice", async () => {
    const store = createInMemoryPayrollOutboxStore();
    const { createSessionPayrollLifecycle } = await import("../sessionPayrollLifecycle");
    const firstLifecycle = createSessionPayrollLifecycle({
      store,
      fetchSessionContext: vi.fn(async () => ({ ...baseContext, activeShiftEventId: null })),
      enqueueOutboxEvent: vi.fn(async (input) => {
        const { enqueuePayrollOutboxEvent } = await import("../../../payroll/outbox");
        return enqueuePayrollOutboxEvent(input);
      }),
      drainOutbox: vi.fn(async (input) => {
        const { drainPayrollOutbox } = await import("../../../payroll/outbox");
        return drainPayrollOutbox(input);
      }),
      findRetainedEvent: undefined,
      reconfirmRetainedEvent: vi.fn(async (input) => {
        const { reconfirmRetainedPayrollOutboxEvent } = await import("../../../payroll/outbox");
        return reconfirmRetainedPayrollOutboxEvent(input);
      }),
      clearRetainedEvent: vi.fn(),
      recordTimeEvent: vi.fn(async (input) => confirmed(input.idempotencyKey)),
      recordSessionAttendance: vi.fn(async (input) => confirmed(input.idempotencyKey)),
      startClinicalSession: vi.fn(async () => {
        throw new Error("clinical start failed");
      }),
      completeClinicalSession: vi.fn(),
      revalidateTerminalOutcome: vi.fn(),
      isOnline: vi.fn(() => true),
      createIdempotencyKey: vi.fn(() => "confirmed-unlinked-key"),
      now: vi.fn(() => "2026-08-12T16:20:00.000Z"),
    });

    const preparedContinue = await firstLifecycle.prepareStart({ scope: baseScope, sessionId: baseContext.sessionId });
    await expect(
      firstLifecycle.executeStart({
        scope: baseScope,
        prepared: preparedContinue,
        choice: "continue_without_clock_in",
        request: startRequest,
      }),
    ).rejects.toThrow("clinical start failed");

    const recordTimeEvent = vi.fn(async (input) => confirmed(input.idempotencyKey));
    const recordSessionAttendance = vi.fn(async (input) => confirmed(input.idempotencyKey));
    const startClinicalSession = vi.fn();
    const retryLifecycle = createSessionPayrollLifecycle({
      store,
      fetchSessionContext: vi.fn(async () => ({ ...baseContext, activeShiftEventId: null })),
      enqueueOutboxEvent: vi.fn(async (input) => {
        const { enqueuePayrollOutboxEvent } = await import("../../../payroll/outbox");
        return enqueuePayrollOutboxEvent(input);
      }),
      drainOutbox: vi.fn(async (input) => {
        const { drainPayrollOutbox } = await import("../../../payroll/outbox");
        return drainPayrollOutbox(input);
      }),
      findRetainedEvent: undefined,
      reconfirmRetainedEvent: vi.fn(async (input) => {
        const { reconfirmRetainedPayrollOutboxEvent } = await import("../../../payroll/outbox");
        return reconfirmRetainedPayrollOutboxEvent(input);
      }),
      clearRetainedEvent: vi.fn(),
      recordTimeEvent,
      recordSessionAttendance,
      startClinicalSession,
      completeClinicalSession: vi.fn(),
      revalidateTerminalOutcome: vi.fn(),
      isOnline: vi.fn(() => true),
      createIdempotencyKey: vi.fn(() => "should-not-be-used"),
      now: vi.fn(() => "2026-08-12T16:21:00.000Z"),
    });

    const preparedRetry = await retryLifecycle.prepareStart({ scope: baseScope, sessionId: baseContext.sessionId });
    expect(preparedRetry.attendance).toEqual({
      idempotencyKey: "confirmed-unlinked-key",
      occurredAt: "2026-08-12T16:20:00.000Z",
    });

    await expect(
      retryLifecycle.executeStart({
        scope: baseScope,
        prepared: preparedRetry,
        choice: "clock_in",
        request: startRequest,
      }),
    ).rejects.toThrow();

    expect(recordTimeEvent).not.toHaveBeenCalled();
    expect(recordSessionAttendance).not.toHaveBeenCalled();
    expect(startClinicalSession).not.toHaveBeenCalled();
    const retainedConfirmed = await listPayrollOutboxEvents(store, baseScope);
    expect(retainedConfirmed).toHaveLength(1);
    expect(retainedConfirmed[0]).toMatchObject({
      idempotencyKey: "confirmed-unlinked-key",
      state: "confirmed_pending_clinical",
    });
    expect((retainedConfirmed[0].payload as { data?: Record<string, unknown> }).data).not.toHaveProperty("employeeTimeEventId");
  });

  it("reuses the retained session_started key and occurredAt across reloads and preserves the row on clinical failure", async () => {
    const store = createInMemoryPayrollOutboxStore();
    const { createSessionPayrollLifecycle } = await import("../sessionPayrollLifecycle");
    const sharedDeps = {
      store,
      fetchSessionContext: vi.fn(async () => ({ ...baseContext, activeShiftEventId: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee" })),
      enqueueOutboxEvent: vi.fn(async (input) => {
        const { enqueuePayrollOutboxEvent } = await import("../../../payroll/outbox");
        return enqueuePayrollOutboxEvent(input);
      }),
      drainOutbox: vi.fn(async (input) => {
        const { drainPayrollOutbox } = await import("../../../payroll/outbox");
        return drainPayrollOutbox(input);
      }),
      findRetainedEvent: undefined,
      reconfirmRetainedEvent: vi.fn(async (input) => {
        const { reconfirmRetainedPayrollOutboxEvent } = await import("../../../payroll/outbox");
        return reconfirmRetainedPayrollOutboxEvent(input);
      }),
      clearRetainedEvent: vi.fn(async (input) => {
        const { clearRetainedPayrollOutboxEvent } = await import("../../../payroll/outbox");
        return clearRetainedPayrollOutboxEvent(input);
      }),
      recordTimeEvent: vi.fn(async () => confirmed("unused-time-key")),
      recordSessionAttendance: vi.fn(async (input) => confirmed(input.idempotencyKey)),
      completeClinicalSession: vi.fn(),
      revalidateTerminalOutcome: vi.fn(),
      isOnline: vi.fn(() => true),
      createIdempotencyKey: vi.fn(() => "retained-session-start-key"),
      now: vi.fn(() => "2026-08-12T16:15:00.000Z"),
    };

    const firstLifecycle = createSessionPayrollLifecycle({
      ...sharedDeps,
      startClinicalSession: vi.fn(async () => {
        throw new Error("clinical start failed");
      }),
    });
    const firstPrepared = await firstLifecycle.prepareStart({ scope: baseScope, sessionId: baseContext.sessionId });
    await expect(
      firstLifecycle.executeStart({
        scope: baseScope,
        prepared: firstPrepared,
        choice: "active",
        request: startRequest,
      }),
    ).rejects.toThrow("clinical start failed");

    const retainedAfterFailure = await listPayrollOutboxEvents(store, baseScope);
    expect(retainedAfterFailure).toEqual([
      expect.objectContaining({
        idempotencyKey: "retained-session-start-key",
        occurredAt: "2026-08-12T16:15:00.000Z",
        state: "confirmed_pending_clinical",
      }),
    ]);

    const secondLifecycle = createSessionPayrollLifecycle({
      ...sharedDeps,
      startClinicalSession: vi.fn(async () => ({ outcome: "started" as const })),
    });
    const secondPrepared = await secondLifecycle.prepareStart({ scope: baseScope, sessionId: baseContext.sessionId });
    expect(secondPrepared.attendance).toEqual({
      idempotencyKey: "retained-session-start-key",
      occurredAt: "2026-08-12T16:15:00.000Z",
    });

    await secondLifecycle.executeStart({
      scope: baseScope,
      prepared: secondPrepared,
      choice: "active",
      request: startRequest,
    });

    expect(await listPayrollOutboxEvents(store, baseScope)).toEqual([]);
  });

  it("fails closed when attendance is queued or not confirmed and does not invoke the clinical callback", async () => {
    const store = createInMemoryPayrollOutboxStore();
    const startClinicalSession = vi.fn();

    const { createSessionPayrollLifecycle } = await import("../sessionPayrollLifecycle");
    const lifecycle = createSessionPayrollLifecycle({
      store,
      fetchSessionContext: vi.fn(async () => baseContext),
      enqueueOutboxEvent: vi.fn(async (input) => {
        const { enqueuePayrollOutboxEvent } = await import("../../../payroll/outbox");
        return enqueuePayrollOutboxEvent(input);
      }),
      drainOutbox: vi.fn(async () => ({ confirmedKeys: [] })),
      findRetainedEvent: vi.fn(async () => null),
      reconfirmRetainedEvent: vi.fn(),
      clearRetainedEvent: vi.fn(),
      recordTimeEvent: vi.fn(async (input) => confirmed(input.idempotencyKey)),
      recordSessionAttendance: vi.fn(async (input) => confirmed(input.idempotencyKey)),
      startClinicalSession,
      completeClinicalSession: vi.fn(),
      revalidateTerminalOutcome: vi.fn(),
      isOnline: vi.fn(() => false),
      createIdempotencyKey: vi.fn(() => "offline-attendance-key"),
      now: vi.fn(() => "2026-08-12T16:20:00.000Z"),
    });

    const prepared = await lifecycle.prepareStart({ scope: baseScope, sessionId: baseContext.sessionId });
    await expect(
      lifecycle.executeStart({
        scope: baseScope,
        prepared,
        choice: "active",
        request: startRequest,
      }),
    ).resolves.toMatchObject({
      kind: "attendance_not_confirmed",
      reason: "offline",
      attendanceIdempotencyKey: "offline-attendance-key",
    });

    expect(startClinicalSession).not.toHaveBeenCalled();
    await expect(listPayrollOutboxEvents(store, baseScope)).resolves.toEqual([
      expect.objectContaining({
        idempotencyKey: "offline-attendance-key",
        state: "pending",
      }),
    ]);
  });

  it("prepareCloseSession records and confirms retained close attendance without invoking clinical completion or clearing", async () => {
    const store = createInMemoryPayrollOutboxStore();
    const callOrder: string[] = [];
    const completeClinicalSession = vi.fn(async () => {
      callOrder.push("clinical-close");
    });
    const clearRetainedEvent = vi.fn(async (input) => {
      callOrder.push(`clear:${input.idempotencyKey}`);
      const { clearRetainedPayrollOutboxEvent } = await import("../../../payroll/outbox");
      return clearRetainedPayrollOutboxEvent(input);
    });

    const { createSessionPayrollLifecycle } = await import("../sessionPayrollLifecycle");
    const lifecycle = createSessionPayrollLifecycle({
      store,
      fetchSessionContext: vi.fn(async () => baseContext),
      enqueueOutboxEvent: vi.fn(async (input) => {
        callOrder.push(`enqueue:${input.idempotencyKey}:${input.localDate}:${input.payload.data.eventType}`);
        const { enqueuePayrollOutboxEvent } = await import("../../../payroll/outbox");
        return enqueuePayrollOutboxEvent(input);
      }),
      drainOutbox: vi.fn(async (input) => {
        callOrder.push("drain");
        const { drainPayrollOutbox } = await import("../../../payroll/outbox");
        return drainPayrollOutbox(input);
      }),
      findRetainedEvent: undefined,
      reconfirmRetainedEvent: vi.fn(async (input) => {
        const { reconfirmRetainedPayrollOutboxEvent } = await import("../../../payroll/outbox");
        return reconfirmRetainedPayrollOutboxEvent(input);
      }),
      clearRetainedEvent,
      recordTimeEvent: vi.fn(async (input) => confirmed(input.idempotencyKey)),
      recordSessionAttendance: vi.fn(async (input) => {
        callOrder.push(`attendance:${input.idempotencyKey}:${input.event.data.eventType}:${input.localDate}`);
        return confirmed(input.idempotencyKey);
      }),
      startClinicalSession: vi.fn(),
      completeClinicalSession,
      revalidateTerminalOutcome: vi.fn(),
      isOnline: vi.fn(() => true),
      createIdempotencyKey: vi.fn(() => "prepared-close-key"),
      now: vi.fn(() => "2026-08-12T16:22:00.000Z"),
    });

    await expect(
      lifecycle.prepareCloseSession({
        scope: baseScope,
        sessionId: baseContext.sessionId,
      }),
    ).resolves.toEqual({
      kind: "ready",
      preparation: {
        kind: "session_close_preparation",
        attendanceIdempotencyKey: "prepared-close-key",
        occurredAt: "2026-08-12T16:22:00.000Z",
      },
    });

    expect(callOrder).toEqual([
      "enqueue:prepared-close-key:2026-08-12:session_ended",
      "drain",
      "attendance:prepared-close-key:session_ended:2026-08-12",
    ]);
    expect(completeClinicalSession).not.toHaveBeenCalled();
    expect(clearRetainedEvent).not.toHaveBeenCalled();
    await expect(listPayrollOutboxEvents(store, baseScope)).resolves.toEqual([
      expect.objectContaining({
        idempotencyKey: "prepared-close-key",
        occurredAt: "2026-08-12T16:22:00.000Z",
        localDate: "2026-08-12",
        state: "confirmed_pending_clinical",
      }),
    ]);
  });

  it("completePreparedClose reuses the retained close key and occurredAt before clinical completion and clearing", async () => {
    const store = createInMemoryPayrollOutboxStore();
    const recordSessionAttendance = vi.fn(async (input) => confirmed(input.idempotencyKey));
    const completeClinicalSession = vi.fn(async () => undefined);

    const { createSessionPayrollLifecycle } = await import("../sessionPayrollLifecycle");
    const lifecycle = createSessionPayrollLifecycle({
      store,
      fetchSessionContext: vi.fn(async () => baseContext),
      enqueueOutboxEvent: vi.fn(async (input) => {
        const { enqueuePayrollOutboxEvent } = await import("../../../payroll/outbox");
        return enqueuePayrollOutboxEvent(input);
      }),
      drainOutbox: vi.fn(async (input) => {
        const { drainPayrollOutbox } = await import("../../../payroll/outbox");
        return drainPayrollOutbox(input);
      }),
      findRetainedEvent: undefined,
      reconfirmRetainedEvent: vi.fn(async (input) => {
        const { reconfirmRetainedPayrollOutboxEvent } = await import("../../../payroll/outbox");
        return reconfirmRetainedPayrollOutboxEvent(input);
      }),
      clearRetainedEvent: vi.fn(async (input) => {
        const { clearRetainedPayrollOutboxEvent } = await import("../../../payroll/outbox");
        return clearRetainedPayrollOutboxEvent(input);
      }),
      recordTimeEvent: vi.fn(async (input) => confirmed(input.idempotencyKey)),
      recordSessionAttendance,
      startClinicalSession: vi.fn(),
      completeClinicalSession,
      revalidateTerminalOutcome: vi.fn(),
      isOnline: vi.fn(() => true),
      createIdempotencyKey: vi.fn(() => "retained-close-key"),
      now: vi.fn(() => "2026-08-12T16:23:00.000Z"),
    });

    const prepared = await lifecycle.prepareCloseSession({
      scope: baseScope,
      sessionId: baseContext.sessionId,
    });
    expect(prepared).toEqual({
      kind: "ready",
      preparation: {
        kind: "session_close_preparation",
        attendanceIdempotencyKey: "retained-close-key",
        occurredAt: "2026-08-12T16:23:00.000Z",
      },
    });

    await expect(
      lifecycle.completePreparedClose({
        scope: baseScope,
        request: completeRequest,
        preparation: prepared.kind === "ready" ? prepared.preparation : undefined,
      }),
    ).resolves.toEqual({
      kind: "completed",
      attendanceIdempotencyKey: "retained-close-key",
      reconciledWithTerminalStatus: false,
    });

    expect(recordSessionAttendance).toHaveBeenLastCalledWith(expect.objectContaining({
      idempotencyKey: "retained-close-key",
      localDate: "2026-08-12",
      event: expect.objectContaining({
        occurredAt: "2026-08-12T16:23:00.000Z",
      }),
    }));
    expect(completeClinicalSession).toHaveBeenCalledTimes(1);
    expect(await listPayrollOutboxEvents(store, baseScope)).toEqual([]);
  });

  it("can complete a retained close row after reload from a fresh lifecycle instance", async () => {
    const store = createInMemoryPayrollOutboxStore();
    const { createSessionPayrollLifecycle } = await import("../sessionPayrollLifecycle");
    const firstLifecycle = createSessionPayrollLifecycle({
      store,
      fetchSessionContext: vi.fn(async () => baseContext),
      enqueueOutboxEvent: vi.fn(async (input) => {
        const { enqueuePayrollOutboxEvent } = await import("../../../payroll/outbox");
        return enqueuePayrollOutboxEvent(input);
      }),
      drainOutbox: vi.fn(async (input) => {
        const { drainPayrollOutbox } = await import("../../../payroll/outbox");
        return drainPayrollOutbox(input);
      }),
      findRetainedEvent: undefined,
      reconfirmRetainedEvent: vi.fn(async (input) => {
        const { reconfirmRetainedPayrollOutboxEvent } = await import("../../../payroll/outbox");
        return reconfirmRetainedPayrollOutboxEvent(input);
      }),
      clearRetainedEvent: vi.fn(async (input) => {
        const { clearRetainedPayrollOutboxEvent } = await import("../../../payroll/outbox");
        return clearRetainedPayrollOutboxEvent(input);
      }),
      recordTimeEvent: vi.fn(async (input) => confirmed(input.idempotencyKey)),
      recordSessionAttendance: vi.fn(async (input) => confirmed(input.idempotencyKey)),
      startClinicalSession: vi.fn(),
      completeClinicalSession: vi.fn(),
      revalidateTerminalOutcome: vi.fn(),
      isOnline: vi.fn(() => true),
      createIdempotencyKey: vi.fn(() => "reload-close-key"),
      now: vi.fn(() => "2026-08-12T16:24:00.000Z"),
    });

    await firstLifecycle.prepareCloseSession({
      scope: baseScope,
      sessionId: baseContext.sessionId,
    });

    const secondLifecycle = createSessionPayrollLifecycle({
      store,
      fetchSessionContext: vi.fn(async () => baseContext),
      enqueueOutboxEvent: vi.fn(async (input) => {
        const { enqueuePayrollOutboxEvent } = await import("../../../payroll/outbox");
        return enqueuePayrollOutboxEvent(input);
      }),
      drainOutbox: vi.fn(async (input) => {
        const { drainPayrollOutbox } = await import("../../../payroll/outbox");
        return drainPayrollOutbox(input);
      }),
      findRetainedEvent: undefined,
      reconfirmRetainedEvent: vi.fn(async (input) => {
        const { reconfirmRetainedPayrollOutboxEvent } = await import("../../../payroll/outbox");
        return reconfirmRetainedPayrollOutboxEvent(input);
      }),
      clearRetainedEvent: vi.fn(async (input) => {
        const { clearRetainedPayrollOutboxEvent } = await import("../../../payroll/outbox");
        return clearRetainedPayrollOutboxEvent(input);
      }),
      recordTimeEvent: vi.fn(async (input) => confirmed(input.idempotencyKey)),
      recordSessionAttendance: vi.fn(async (input) => confirmed(input.idempotencyKey)),
      startClinicalSession: vi.fn(),
      completeClinicalSession: vi.fn(async () => undefined),
      revalidateTerminalOutcome: vi.fn(),
      isOnline: vi.fn(() => true),
      createIdempotencyKey: vi.fn(() => "should-not-be-used"),
      now: vi.fn(() => "2026-08-12T16:29:00.000Z"),
    });

    await expect(
      secondLifecycle.completePreparedClose({
        scope: baseScope,
        request: completeRequest,
      }),
    ).resolves.toMatchObject({
      kind: "completed",
      attendanceIdempotencyKey: "reload-close-key",
    });

    expect(await listPayrollOutboxEvents(store, baseScope)).toEqual([]);
  });

  it("fails closed when the retained close row changes after preparation and does not call clinical completion or clear", async () => {
    const store = createInMemoryPayrollOutboxStore();
    const completeClinicalSession = vi.fn(async () => undefined);
    const clearRetainedEvent = vi.fn(async (input) => {
      const { clearRetainedPayrollOutboxEvent } = await import("../../../payroll/outbox");
      return clearRetainedPayrollOutboxEvent(input);
    });
    const { createSessionPayrollLifecycle } = await import("../sessionPayrollLifecycle");
    const lifecycle = createSessionPayrollLifecycle({
      store,
      fetchSessionContext: vi.fn(async () => baseContext),
      enqueueOutboxEvent: vi.fn(async (input) => {
        const { enqueuePayrollOutboxEvent } = await import("../../../payroll/outbox");
        return enqueuePayrollOutboxEvent(input);
      }),
      drainOutbox: vi.fn(async (input) => {
        const { drainPayrollOutbox } = await import("../../../payroll/outbox");
        return drainPayrollOutbox(input);
      }),
      findRetainedEvent: undefined,
      reconfirmRetainedEvent: vi.fn(async (input) => {
        const { reconfirmRetainedPayrollOutboxEvent } = await import("../../../payroll/outbox");
        return reconfirmRetainedPayrollOutboxEvent(input);
      }),
      clearRetainedEvent,
      recordTimeEvent: vi.fn(async (input) => confirmed(input.idempotencyKey)),
      recordSessionAttendance: vi.fn(async (input) => confirmed(input.idempotencyKey)),
      startClinicalSession: vi.fn(),
      completeClinicalSession,
      revalidateTerminalOutcome: vi.fn(),
      isOnline: vi.fn(() => true),
      createIdempotencyKey: vi.fn(() => "prepared-then-changed-key"),
      now: vi
        .fn()
        .mockReturnValueOnce("2026-08-12T16:26:00.000Z")
        .mockReturnValueOnce("2026-08-12T16:27:00.000Z"),
    });

    const prepared = await lifecycle.prepareCloseSession({
      scope: baseScope,
      sessionId: baseContext.sessionId,
    });
    expect(prepared).toMatchObject({
      kind: "ready",
      preparation: {
        attendanceIdempotencyKey: "prepared-then-changed-key",
        occurredAt: "2026-08-12T16:26:00.000Z",
      },
    });

    await enqueuePayrollOutboxEvent({
      store,
      ...baseScope,
      action: "record_session_attendance",
      idempotencyKey: "changed-after-prepare-key",
      occurredAt: "2026-08-12T16:27:00.000Z",
      payload: {
        occurredAt: "2026-08-12T16:27:00.000Z",
        timezone: baseContext.employmentTimezone,
        workLocation: baseContext.canonicalWorkLocation,
        data: {
          eventType: "session_ended",
          sessionId: baseContext.sessionId,
        },
      },
      retainForClinical: true,
    });
    await clearRetainedPayrollOutboxEvent({
      store,
      organizationId: baseScope.organizationId,
      userId: baseScope.userId,
      idempotencyKey: "prepared-then-changed-key",
      confirmedServerIdempotencyKey: "prepared-then-changed-key",
    });

    await expect(
      lifecycle.completePreparedClose({
        scope: baseScope,
        request: completeRequest,
        preparation: prepared.kind === "ready" ? prepared.preparation : undefined,
      }),
    ).rejects.toThrow(/prepared payroll close attendance is stale/i);

    expect(completeClinicalSession).not.toHaveBeenCalled();
    expect(clearRetainedEvent).not.toHaveBeenCalled();
    await expect(listPayrollOutboxEvents(store, baseScope)).resolves.toEqual([
      expect.objectContaining({
        idempotencyKey: "changed-after-prepare-key",
        occurredAt: "2026-08-12T16:27:00.000Z",
      }),
    ]);
  });

  it("fails closed when duplicate retained close siblings match the same session before clinical completion or clear", async () => {
    const duplicateRetainedRows = [
      {
        storageKey: '["88888888-8888-8888-8888-888888888888","99999999-9999-9999-9999-999999999999","duplicate-close-key-1"]',
        idempotencyKey: "duplicate-close-key-1",
        action: "record_session_attendance" as const,
        organizationId: baseScope.organizationId,
        userId: baseScope.userId,
        localDate: "2026-08-12",
        occurredAt: "2026-08-12T16:28:00.000Z",
        payload: {
          occurredAt: "2026-08-12T16:28:00.000Z",
          timezone: baseContext.employmentTimezone,
          workLocation: baseContext.canonicalWorkLocation,
          data: {
            eventType: "session_ended" as const,
            sessionId: baseContext.sessionId,
          },
        },
        enqueueSequence: 1,
        enqueuedAt: "2026-08-12T16:28:01.000Z",
        state: "confirmed_pending_clinical" as const,
        safeCode: null,
        retainForClinical: true,
      },
      {
        storageKey: '["88888888-8888-8888-8888-888888888888","99999999-9999-9999-9999-999999999999","duplicate-close-key-2"]',
        idempotencyKey: "duplicate-close-key-2",
        action: "record_session_attendance" as const,
        organizationId: baseScope.organizationId,
        userId: baseScope.userId,
        localDate: "2026-08-12",
        occurredAt: "2026-08-12T16:28:02.000Z",
        payload: {
          occurredAt: "2026-08-12T16:28:02.000Z",
          timezone: baseContext.employmentTimezone,
          workLocation: baseContext.canonicalWorkLocation,
          data: {
            eventType: "session_ended" as const,
            sessionId: baseContext.sessionId,
          },
        },
        enqueueSequence: 2,
        enqueuedAt: "2026-08-12T16:28:03.000Z",
        state: "confirmed_pending_clinical" as const,
        safeCode: null,
        retainForClinical: true,
      },
    ];
    const store = createInMemoryPayrollOutboxStore(duplicateRetainedRows);
    const completeClinicalSession = vi.fn(async () => undefined);
    const clearRetainedEvent = vi.fn(async (input) => {
      const { clearRetainedPayrollOutboxEvent } = await import("../../../payroll/outbox");
      return clearRetainedPayrollOutboxEvent(input);
    });

    const { createSessionPayrollLifecycle } = await import("../sessionPayrollLifecycle");
    const lifecycle = createSessionPayrollLifecycle({
      store,
      fetchSessionContext: vi.fn(async () => baseContext),
      enqueueOutboxEvent: vi.fn(async (input) => {
        const { enqueuePayrollOutboxEvent } = await import("../../../payroll/outbox");
        return enqueuePayrollOutboxEvent(input);
      }),
      drainOutbox: vi.fn(async (input) => {
        const { drainPayrollOutbox } = await import("../../../payroll/outbox");
        return drainPayrollOutbox(input);
      }),
      findRetainedEvent: undefined,
      reconfirmRetainedEvent: vi.fn(async (input) => {
        const { reconfirmRetainedPayrollOutboxEvent } = await import("../../../payroll/outbox");
        return reconfirmRetainedPayrollOutboxEvent(input);
      }),
      clearRetainedEvent,
      recordTimeEvent: vi.fn(async (input) => confirmed(input.idempotencyKey)),
      recordSessionAttendance: vi.fn(async (input) => confirmed(input.idempotencyKey)),
      startClinicalSession: vi.fn(),
      completeClinicalSession,
      revalidateTerminalOutcome: vi.fn(),
      isOnline: vi.fn(() => true),
      createIdempotencyKey: vi.fn(() => "unused-duplicate-close-key"),
      now: vi.fn(() => "2026-08-12T16:28:30.000Z"),
    });

    await expect(
      lifecycle.closeSession({
        scope: baseScope,
        request: completeRequest,
      }),
    ).rejects.toThrow("Multiple retained payroll attendance events matched the requested scope.");

    expect(completeClinicalSession).not.toHaveBeenCalled();
    expect(clearRetainedEvent).not.toHaveBeenCalled();
    await expect(listPayrollOutboxEvents(store, baseScope)).resolves.toEqual([
      expect.objectContaining({ idempotencyKey: "duplicate-close-key-1" }),
      expect.objectContaining({ idempotencyKey: "duplicate-close-key-2" }),
    ]);
  });

  it("bypasses payroll close writes when session payroll is explicitly disabled and completes clinical close directly", async () => {
    const store = createInMemoryPayrollOutboxStore();
    const enqueueOutboxEvent = vi.fn();
    const drainOutbox = vi.fn();
    const recordTimeEvent = vi.fn();
    const recordSessionAttendance = vi.fn();
    const clearRetainedEvent = vi.fn();
    const completeClinicalSession = vi.fn(async () => undefined);

    const { createSessionPayrollLifecycle } = await import("../sessionPayrollLifecycle");
    const lifecycle = createSessionPayrollLifecycle({
      store,
      fetchSessionContext: vi.fn(async () => disabledContext),
      enqueueOutboxEvent,
      drainOutbox,
      findRetainedEvent: vi.fn(),
      reconfirmRetainedEvent: vi.fn(),
      clearRetainedEvent,
      recordTimeEvent,
      recordSessionAttendance,
      startClinicalSession: vi.fn(),
      completeClinicalSession,
      revalidateTerminalOutcome: vi.fn(),
      isOnline: vi.fn(() => true),
      createIdempotencyKey: vi.fn(() => "unused-disabled-close-key"),
      now: vi.fn(() => "2026-08-12T16:24:30.000Z"),
    });

    await expect(
      lifecycle.completePreparedClose({
        scope: baseScope,
        request: completeRequest,
      }),
    ).resolves.toEqual({
      kind: "completed",
      reconciledWithTerminalStatus: false,
    });

    expect(completeClinicalSession).toHaveBeenCalledTimes(1);
    expect(enqueueOutboxEvent).not.toHaveBeenCalled();
    expect(drainOutbox).not.toHaveBeenCalled();
    expect(recordTimeEvent).not.toHaveBeenCalled();
    expect(recordSessionAttendance).not.toHaveBeenCalled();
    expect(clearRetainedEvent).not.toHaveBeenCalled();
    await expect(listPayrollOutboxEvents(store, baseScope)).resolves.toEqual([]);
  });

  it("derives retained close localDate from occurredAt in the authoritative employment timezone", async () => {
    const store = createInMemoryPayrollOutboxStore();
    const timezoneScope = {
      ...baseScope,
      localDate: "2099-12-31",
    };

    const { createSessionPayrollLifecycle } = await import("../sessionPayrollLifecycle");
    const lifecycle = createSessionPayrollLifecycle({
      store,
      fetchSessionContext: vi.fn(async () => ({
        ...baseContext,
        employmentTimezone: "America/Los_Angeles",
      })),
      enqueueOutboxEvent: vi.fn(async (input) => {
        const { enqueuePayrollOutboxEvent } = await import("../../../payroll/outbox");
        return enqueuePayrollOutboxEvent(input);
      }),
      drainOutbox: vi.fn(async () => ({ confirmedKeys: [] })),
      findRetainedEvent: undefined,
      reconfirmRetainedEvent: vi.fn(),
      clearRetainedEvent: vi.fn(),
      recordTimeEvent: vi.fn(async (input) => confirmed(input.idempotencyKey)),
      recordSessionAttendance: vi.fn(async (input) => confirmed(input.idempotencyKey)),
      startClinicalSession: vi.fn(),
      completeClinicalSession: vi.fn(),
      revalidateTerminalOutcome: vi.fn(),
      isOnline: vi.fn(() => false),
      createIdempotencyKey: vi.fn(() => "timezone-close-key"),
      now: vi.fn(() => "2026-03-08T07:30:00.000Z"),
    });

    await expect(
      lifecycle.prepareCloseSession({
        scope: timezoneScope,
        sessionId: baseContext.sessionId,
      }),
    ).resolves.toEqual({
      kind: "attendance_not_confirmed",
      reason: "offline",
    });

    await expect(listPayrollOutboxEvents(store, timezoneScope)).resolves.toEqual([
      expect.objectContaining({
        idempotencyKey: "timezone-close-key",
        occurredAt: "2026-03-08T07:30:00.000Z",
        localDate: "2026-03-07",
      }),
    ]);
  });

  it("captures close attendance before the completion callback, clears on success, and never emits shift_ended", async () => {
    const store = createInMemoryPayrollOutboxStore();
    const callOrder: string[] = [];

    const { createSessionPayrollLifecycle } = await import("../sessionPayrollLifecycle");
    const lifecycle = createSessionPayrollLifecycle({
      store,
      fetchSessionContext: vi.fn(async () => baseContext),
      enqueueOutboxEvent: vi.fn(async (input) => {
        callOrder.push(`enqueue:${input.idempotencyKey}:${input.payload.data.eventType}`);
        const { enqueuePayrollOutboxEvent } = await import("../../../payroll/outbox");
        return enqueuePayrollOutboxEvent(input);
      }),
      drainOutbox: vi.fn(async (input) => {
        callOrder.push("drain");
        const { drainPayrollOutbox } = await import("../../../payroll/outbox");
        return drainPayrollOutbox(input);
      }),
      findRetainedEvent: vi.fn(async () => null),
      reconfirmRetainedEvent: vi.fn(),
      clearRetainedEvent: vi.fn(async (input) => {
        callOrder.push(`clear:${input.idempotencyKey}`);
        const { clearRetainedPayrollOutboxEvent } = await import("../../../payroll/outbox");
        return clearRetainedPayrollOutboxEvent(input);
      }),
      recordTimeEvent: vi.fn(async (input) => {
        callOrder.push(`time:${input.event.data.eventType}`);
        return confirmed(input.idempotencyKey);
      }),
      recordSessionAttendance: vi.fn(async (input) => {
        callOrder.push(`attendance:${input.idempotencyKey}:${input.event.data.eventType}`);
        return confirmed(input.idempotencyKey);
      }),
      startClinicalSession: vi.fn(),
      completeClinicalSession: vi.fn(async () => {
        callOrder.push("clinical-close");
      }),
      revalidateTerminalOutcome: vi.fn(),
      isOnline: vi.fn(() => true),
      createIdempotencyKey: vi.fn(() => "session-ended-key"),
      now: vi.fn(() => "2026-08-12T16:25:00.000Z"),
    });

    await expect(
      lifecycle.closeSession({
        scope: baseScope,
        request: completeRequest,
      }),
    ).resolves.toMatchObject({
      kind: "completed",
      attendanceIdempotencyKey: "session-ended-key",
    });

    expect(callOrder).toEqual([
      "enqueue:session-ended-key:session_ended",
      "drain",
      "attendance:session-ended-key:session_ended",
      "clinical-close",
      "clear:session-ended-key",
    ]);
    expect(callOrder).not.toContain("time:shift_ended");
    expect(await listPayrollOutboxEvents(store, baseScope)).toEqual([]);
  });

  it("supports unbound closeSession invocation without relying on method-call this", async () => {
    const store = createInMemoryPayrollOutboxStore();
    const completeClinicalSession = vi.fn(async () => undefined);

    const { createSessionPayrollLifecycle } = await import("../sessionPayrollLifecycle");
    const lifecycle = createSessionPayrollLifecycle({
      store,
      fetchSessionContext: vi.fn(async () => baseContext),
      enqueueOutboxEvent: vi.fn(async (input) => {
        const { enqueuePayrollOutboxEvent } = await import("../../../payroll/outbox");
        return enqueuePayrollOutboxEvent(input);
      }),
      drainOutbox: vi.fn(async (input) => {
        const { drainPayrollOutbox } = await import("../../../payroll/outbox");
        return drainPayrollOutbox(input);
      }),
      findRetainedEvent: vi.fn(async () => null),
      reconfirmRetainedEvent: vi.fn(),
      clearRetainedEvent: vi.fn(async (input) => {
        const { clearRetainedPayrollOutboxEvent } = await import("../../../payroll/outbox");
        return clearRetainedPayrollOutboxEvent(input);
      }),
      recordTimeEvent: vi.fn(async (input) => confirmed(input.idempotencyKey)),
      recordSessionAttendance: vi.fn(async (input) => confirmed(input.idempotencyKey)),
      startClinicalSession: vi.fn(),
      completeClinicalSession,
      revalidateTerminalOutcome: vi.fn(),
      isOnline: vi.fn(() => true),
      createIdempotencyKey: vi.fn(() => "unbound-close-key"),
      now: vi.fn(() => "2026-08-12T16:25:30.000Z"),
    });

    const { closeSession } = lifecycle;

    await expect(
      closeSession({
        scope: baseScope,
        request: completeRequest,
      }),
    ).resolves.toMatchObject({
      kind: "completed",
      attendanceIdempotencyKey: "unbound-close-key",
    });

    expect(completeClinicalSession).toHaveBeenCalledTimes(1);
  });

  it("revalidates ALREADY_TERMINAL exactly, clears only on a compatible match, and preserves retained close rows otherwise", async () => {
    const { createSessionPayrollLifecycle } = await import("../sessionPayrollLifecycle");
    const baseCloseDeps = {
      fetchSessionContext: vi.fn(async () => baseContext),
      enqueueOutboxEvent: vi.fn(async (input) => {
        const { enqueuePayrollOutboxEvent } = await import("../../../payroll/outbox");
        return enqueuePayrollOutboxEvent(input);
      }),
      drainOutbox: vi.fn(async (input) => {
        const { drainPayrollOutbox } = await import("../../../payroll/outbox");
        return drainPayrollOutbox(input);
      }),
      findRetainedEvent: vi.fn(async () => null),
      reconfirmRetainedEvent: vi.fn(),
      clearRetainedEvent: vi.fn(async (input) => {
        const { clearRetainedPayrollOutboxEvent } = await import("../../../payroll/outbox");
        return clearRetainedPayrollOutboxEvent(input);
      }),
      recordTimeEvent: vi.fn(async (input) => confirmed(input.idempotencyKey)),
      recordSessionAttendance: vi.fn(async (input) => confirmed(input.idempotencyKey)),
      startClinicalSession: vi.fn(),
      completeClinicalSession: vi.fn(async () => {
        throw Object.assign(new Error("already terminal"), { code: "ALREADY_TERMINAL", status: 409 });
      }),
      isOnline: vi.fn(() => true),
      createIdempotencyKey: vi.fn(() => "close-terminal-key"),
      now: vi.fn(() => "2026-08-12T16:30:00.000Z"),
    };

    const exactStore = createInMemoryPayrollOutboxStore();
    const exactLifecycle = createSessionPayrollLifecycle({
      ...baseCloseDeps,
      store: exactStore,
      revalidateTerminalOutcome: vi.fn(async () => true),
    });

    await expect(
      exactLifecycle.closeSession({
        scope: baseScope,
        request: completeRequest,
      }),
    ).resolves.toMatchObject({
      kind: "completed",
      reconciledWithTerminalStatus: true,
    });
    expect(await listPayrollOutboxEvents(exactStore, baseScope)).toEqual([]);

    const mismatchStore = createInMemoryPayrollOutboxStore();
    const mismatchLifecycle = createSessionPayrollLifecycle({
      ...baseCloseDeps,
      store: mismatchStore,
      revalidateTerminalOutcome: vi.fn(async () => false),
    });

    await expect(
      mismatchLifecycle.closeSession({
        scope: baseScope,
        request: completeRequest,
      }),
    ).rejects.toMatchObject({ code: "ALREADY_TERMINAL" });
    await expect(listPayrollOutboxEvents(mismatchStore, baseScope)).resolves.toEqual([
      expect.objectContaining({
        idempotencyKey: "close-terminal-key",
        state: "confirmed_pending_clinical",
      }),
    ]);

    const revalidationFailure = new Error("revalidation failed");
    const failureStore = createInMemoryPayrollOutboxStore();
    const failureLifecycle = createSessionPayrollLifecycle({
      ...baseCloseDeps,
      store: failureStore,
      revalidateTerminalOutcome: vi.fn(async () => {
        throw revalidationFailure;
      }),
    });

    await expect(
      failureLifecycle.closeSession({
        scope: baseScope,
        request: completeRequest,
      }),
    ).rejects.toBe(revalidationFailure);
    await expect(listPayrollOutboxEvents(failureStore, baseScope)).resolves.toEqual([
      expect.objectContaining({
        idempotencyKey: "close-terminal-key",
        state: "confirmed_pending_clinical",
      }),
    ]);
  });

  it("throws an explicit unwired close error after confirmed attendance and preserves the retained row", async () => {
    const store = createInMemoryPayrollOutboxStore();
    const { createSessionPayrollLifecycle } = await import("../sessionPayrollLifecycle");
    const lifecycle = createSessionPayrollLifecycle({
      store,
      fetchSessionContext: vi.fn(async () => baseContext),
      enqueueOutboxEvent: vi.fn(async (input) => {
        const { enqueuePayrollOutboxEvent } = await import("../../../payroll/outbox");
        return enqueuePayrollOutboxEvent(input);
      }),
      drainOutbox: vi.fn(async (input) => {
        const { drainPayrollOutbox } = await import("../../../payroll/outbox");
        return drainPayrollOutbox(input);
      }),
      findRetainedEvent: vi.fn(async () => null),
      reconfirmRetainedEvent: vi.fn(),
      clearRetainedEvent: vi.fn(async (input) => {
        const { clearRetainedPayrollOutboxEvent } = await import("../../../payroll/outbox");
        return clearRetainedPayrollOutboxEvent(input);
      }),
      recordTimeEvent: vi.fn(async (input) => confirmed(input.idempotencyKey)),
      recordSessionAttendance: vi.fn(async (input) => confirmed(input.idempotencyKey)),
      startClinicalSession: vi.fn(),
      revalidateTerminalOutcome: vi.fn(),
      isOnline: vi.fn(() => true),
      createIdempotencyKey: vi.fn(() => "close-unwired-key"),
      now: vi.fn(() => "2026-08-12T16:35:00.000Z"),
    });

    await expect(
      lifecycle.closeSession({
        scope: baseScope,
        request: completeRequest,
      }),
    ).rejects.toThrow(/completeClinicalSession/i);

    await expect(listPayrollOutboxEvents(store, baseScope)).resolves.toEqual([
      expect.objectContaining({
        idempotencyKey: "close-unwired-key",
        state: "confirmed_pending_clinical",
      }),
    ]);
  });
});
