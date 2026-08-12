import { describe, expect, it, vi } from "vitest";
import { createInMemoryPayrollOutboxStore, listPayrollOutboxEvents } from "../../../payroll/outbox";
import type { PayrollMutationSuccess, PayrollSessionContext } from "../../../payroll/api";

const baseScope = {
  organizationId: "88888888-8888-8888-8888-888888888888",
  userId: "99999999-9999-9999-9999-999999999999",
  localDate: "2026-08-12",
};

const baseContext: PayrollSessionContext = {
  sessionId: "77777777-7777-7777-7777-777777777777",
  organizationId: baseScope.organizationId,
  employmentProfileId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  employmentTimezone: "America/Los_Angeles",
  actorIsAssignedEmployee: true,
  canClockSelf: true,
  canonicalWorkLocation: "client_site",
  activeShiftEventId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
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

  it("uses separate stable keys for clock-in and session start, refetches context, and never emits shift_ended", async () => {
    const store = createInMemoryPayrollOutboxStore();
    const fetchSessionContext = vi
      .fn()
      .mockResolvedValueOnce({ ...baseContext, activeShiftEventId: null })
      .mockResolvedValueOnce({ ...baseContext, activeShiftEventId: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee" });
    const timeEventTypes: string[] = [];
    const attendanceLinks: Array<string | null | undefined> = [];

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
        attendanceLinks.push(input.event.data.employeeTimeEventId);
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

    expect(fetchSessionContext).toHaveBeenCalledTimes(2);
    expect(timeEventTypes).toEqual(["shift_started"]);
    expect(timeEventTypes).not.toContain("shift_ended");
    expect(attendanceLinks).toEqual(["eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee"]);
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
});
