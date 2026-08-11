import { describe, expect, it, vi } from "vitest";
import {
  createInMemoryPayrollOutboxStore,
  drainPayrollOutbox,
  enqueuePayrollOutboxEvent,
  listPayrollOutboxEvents,
  recoverPayrollOutbox,
  type PendingPayrollEvent,
} from "../outbox";

const baseEvent = {
  organizationId: "org-1",
  userId: "user-1",
  localDate: "2026-08-11",
  occurredAt: "2026-08-11T16:00:00.000Z",
  payload: {
    occurredAt: "2026-08-11T16:00:00.000Z",
    timezone: "America/Los_Angeles",
    workLocation: "office",
    data: {
      eventType: "shift_started",
    },
  },
} as const;

const makeRetryableError = () =>
  Object.assign(new Error("Retry later"), {
    status: 503,
    code: "upstream_error",
    retryAfterSeconds: 15,
  });

describe("payroll outbox", () => {
  it("persists a validated event for the scoped user before any network attempt", async () => {
    const store = createInMemoryPayrollOutboxStore();

    await enqueuePayrollOutboxEvent({
      store,
      action: "record_time_event",
      idempotencyKey: "time-key-1",
      ...baseEvent,
    });

    await expect(
      listPayrollOutboxEvents(store, {
        organizationId: "org-1",
        userId: "user-1",
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        idempotencyKey: "time-key-1",
        organizationId: "org-1",
        userId: "user-1",
        occurredAt: "2026-08-11T16:00:00.000Z",
        state: "pending",
      }),
    ]);
  });

  it("replays queued events in enqueue order with the original key and occurredAt", async () => {
    const store = createInMemoryPayrollOutboxStore();
    const sendOrder: Array<{ key: string; occurredAt: string }> = [];

    await enqueuePayrollOutboxEvent({
      store,
      action: "record_time_event",
      idempotencyKey: "time-key-1",
      ...baseEvent,
    });
    await enqueuePayrollOutboxEvent({
      store,
      action: "record_session_attendance",
      idempotencyKey: "attendance-key-1",
      organizationId: "org-1",
      userId: "user-1",
      localDate: "2026-08-11",
      occurredAt: "2026-08-11T16:05:00.000Z",
      payload: {
        occurredAt: "2026-08-11T16:05:00.000Z",
        timezone: "America/Los_Angeles",
        workLocation: "client_site",
        data: {
          eventType: "session_started",
          sessionId: "11111111-1111-1111-1111-111111111111",
        },
      },
    });

    await drainPayrollOutbox({
      store,
      organizationId: "org-1",
      userId: "user-1",
      recordTimeEvent: vi.fn(async (event) => {
        sendOrder.push({ key: event.idempotencyKey, occurredAt: event.event.occurredAt });
        return { idempotencyKey: event.idempotencyKey };
      }),
      recordSessionAttendance: vi.fn(async (event) => {
        sendOrder.push({ key: event.idempotencyKey, occurredAt: event.event.occurredAt });
        return { idempotencyKey: event.idempotencyKey };
      }),
    });

    expect(sendOrder).toEqual([
      { key: "time-key-1", occurredAt: "2026-08-11T16:00:00.000Z" },
      { key: "attendance-key-1", occurredAt: "2026-08-11T16:05:00.000Z" },
    ]);
    await expect(listPayrollOutboxEvents(store, { organizationId: "org-1", userId: "user-1" })).resolves.toEqual([]);
  });

  it("does not dequeue an event until the transport confirms the identical key", async () => {
    const store = createInMemoryPayrollOutboxStore();

    await enqueuePayrollOutboxEvent({
      store,
      action: "record_time_event",
      idempotencyKey: "time-key-2",
      ...baseEvent,
    });

    await drainPayrollOutbox({
      store,
      organizationId: "org-1",
      userId: "user-1",
      recordTimeEvent: vi.fn(async () => ({ idempotencyKey: "different-key" })),
      recordSessionAttendance: vi.fn(),
    });

    await expect(
      listPayrollOutboxEvents(store, { organizationId: "org-1", userId: "user-1" }),
    ).resolves.toEqual([
      expect.objectContaining({
        idempotencyKey: "time-key-2",
        state: "pending",
      }),
    ]);
  });

  it("returns retryable failures to pending and stops replay without losing order", async () => {
    const store = createInMemoryPayrollOutboxStore();
    const attendanceTransport = vi.fn();

    await enqueuePayrollOutboxEvent({
      store,
      action: "record_time_event",
      idempotencyKey: "time-key-retry",
      ...baseEvent,
    });
    await enqueuePayrollOutboxEvent({
      store,
      action: "record_session_attendance",
      idempotencyKey: "attendance-key-after-retry",
      organizationId: "org-1",
      userId: "user-1",
      localDate: "2026-08-11",
      occurredAt: "2026-08-11T16:05:00.000Z",
      payload: {
        occurredAt: "2026-08-11T16:05:00.000Z",
        timezone: "America/Los_Angeles",
        workLocation: "client_site",
        data: {
          eventType: "session_started",
          sessionId: "11111111-1111-1111-1111-111111111111",
        },
      },
    });

    await drainPayrollOutbox({
      store,
      organizationId: "org-1",
      userId: "user-1",
      recordTimeEvent: vi.fn(async () => {
        throw makeRetryableError();
      }),
      recordSessionAttendance: attendanceTransport,
    });

    expect(attendanceTransport).not.toHaveBeenCalled();
    await expect(
      listPayrollOutboxEvents(store, { organizationId: "org-1", userId: "user-1" }),
    ).resolves.toEqual([
      expect.objectContaining({
        idempotencyKey: "time-key-retry",
        state: "pending",
      }),
      expect.objectContaining({
        idempotencyKey: "attendance-key-after-retry",
        state: "pending",
      }),
    ]);
  });

  it("marks state conflicts as needs_attention and stops the drain", async () => {
    const store = createInMemoryPayrollOutboxStore();
    const attendanceTransport = vi.fn();

    await enqueuePayrollOutboxEvent({
      store,
      action: "record_time_event",
      idempotencyKey: "time-key-conflict",
      ...baseEvent,
    });
    await enqueuePayrollOutboxEvent({
      store,
      action: "record_session_attendance",
      idempotencyKey: "attendance-key-after-conflict",
      organizationId: "org-1",
      userId: "user-1",
      localDate: "2026-08-11",
      occurredAt: "2026-08-11T16:05:00.000Z",
      payload: {
        occurredAt: "2026-08-11T16:05:00.000Z",
        timezone: "America/Los_Angeles",
        workLocation: "client_site",
        data: {
          eventType: "session_started",
          sessionId: "11111111-1111-1111-1111-111111111111",
        },
      },
    });

    await drainPayrollOutbox({
      store,
      organizationId: "org-1",
      userId: "user-1",
      recordTimeEvent: vi.fn(async () => {
        throw Object.assign(new Error("Payroll state conflict."), {
          status: 409,
          code: "state_conflict",
        });
      }),
      recordSessionAttendance: attendanceTransport,
    });

    expect(attendanceTransport).not.toHaveBeenCalled();
    await expect(
      listPayrollOutboxEvents(store, { organizationId: "org-1", userId: "user-1" }),
    ).resolves.toEqual([
      expect.objectContaining({
        idempotencyKey: "time-key-conflict",
        state: "needs_attention",
        safeCode: "state_conflict",
      }),
      expect.objectContaining({
        idempotencyKey: "attendance-key-after-conflict",
        state: "pending",
      }),
    ]);
  });

  it("resets stale replaying rows to pending on recovery and isolates scope by org and user", async () => {
    const store = createInMemoryPayrollOutboxStore([
      {
        idempotencyKey: "replaying-key",
        action: "record_time_event",
        organizationId: "org-1",
        userId: "user-1",
        localDate: "2026-08-11",
        occurredAt: "2026-08-11T16:00:00.000Z",
        payload: { ...baseEvent.payload },
        enqueueSequence: 1,
        enqueuedAt: "2026-08-11T16:00:01.000Z",
        state: "replaying",
        safeCode: null,
      } satisfies PendingPayrollEvent,
      {
        idempotencyKey: "other-scope-key",
        action: "record_time_event",
        organizationId: "org-2",
        userId: "user-2",
        localDate: "2026-08-11",
        occurredAt: "2026-08-11T16:10:00.000Z",
        payload: { ...baseEvent.payload },
        enqueueSequence: 2,
        enqueuedAt: "2026-08-11T16:10:01.000Z",
        state: "pending",
        safeCode: null,
      } satisfies PendingPayrollEvent,
    ]);

    await recoverPayrollOutbox(store, {
      organizationId: "org-1",
      userId: "user-1",
    });

    await expect(
      listPayrollOutboxEvents(store, { organizationId: "org-1", userId: "user-1" }),
    ).resolves.toEqual([
      expect.objectContaining({
        idempotencyKey: "replaying-key",
        state: "pending",
      }),
    ]);
    await expect(
      listPayrollOutboxEvents(store, { organizationId: "org-2", userId: "user-2" }),
    ).resolves.toEqual([
      expect.objectContaining({
        idempotencyKey: "other-scope-key",
        state: "pending",
      }),
    ]);
  });

  it("never forwards local organization or user scope as outbound payload authority", async () => {
    const store = createInMemoryPayrollOutboxStore();
    const sentPayloads: unknown[] = [];

    await enqueuePayrollOutboxEvent({
      store,
      action: "record_time_event",
      idempotencyKey: "time-key-3",
      ...baseEvent,
    });

    await drainPayrollOutbox({
      store,
      organizationId: "org-1",
      userId: "user-1",
      recordTimeEvent: vi.fn(async (event) => {
        sentPayloads.push(event.event);
        return { idempotencyKey: event.idempotencyKey };
      }),
      recordSessionAttendance: vi.fn(),
    });

    expect(sentPayloads).toEqual([
      {
        occurredAt: "2026-08-11T16:00:00.000Z",
        timezone: "America/Los_Angeles",
        workLocation: "office",
        data: {
          eventType: "shift_started",
        },
      },
    ]);
  });
});
