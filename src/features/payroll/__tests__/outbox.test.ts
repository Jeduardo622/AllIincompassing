import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearRetainedPayrollOutboxEvent,
  createInMemoryPayrollOutboxStore,
  createIndexedDbPayrollOutboxStore,
  drainPayrollOutbox,
  enqueuePayrollOutboxEvent,
  listPayrollOutboxEvents,
  reconfirmRetainedPayrollOutboxEvent,
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

const baseAttendanceEvent = {
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
} as const;

const makeRetryableError = () =>
  Object.assign(new Error("Retry later"), {
    status: 503,
    code: "upstream_error",
    retryAfterSeconds: 15,
  });

const createDeferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

describe("payroll outbox", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

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
      ...baseAttendanceEvent,
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
      ...baseAttendanceEvent,
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
      ...baseAttendanceEvent,
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
        storageKey: '["org-1","user-1","replaying-key"]',
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
        storageKey: '["org-2","user-2","other-scope-key"]',
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

  it("isolates identical idempotency keys across organization and user scopes", async () => {
    const store = createInMemoryPayrollOutboxStore();

    await enqueuePayrollOutboxEvent({
      store,
      action: "record_time_event",
      idempotencyKey: "shared-key",
      ...baseEvent,
    });
    await enqueuePayrollOutboxEvent({
      store,
      action: "record_time_event",
      idempotencyKey: "shared-key",
      ...baseEvent,
      organizationId: "org-2",
      userId: "user-2",
    });

    const sentKeys: string[] = [];
    await drainPayrollOutbox({
      store,
      organizationId: "org-1",
      userId: "user-1",
      recordTimeEvent: vi.fn(async (event) => {
        sentKeys.push(event.idempotencyKey);
        return { idempotencyKey: event.idempotencyKey };
      }),
      recordSessionAttendance: vi.fn(),
    });

    expect(sentKeys).toEqual(["shared-key"]);
    await expect(
      listPayrollOutboxEvents(store, { organizationId: "org-1", userId: "user-1" }),
    ).resolves.toEqual([]);
    await expect(
      listPayrollOutboxEvents(store, { organizationId: "org-2", userId: "user-2" }),
    ).resolves.toEqual([
      expect.objectContaining({
        idempotencyKey: "shared-key",
        organizationId: "org-2",
        userId: "user-2",
      }),
    ]);
  });

  it("rejects native persistence when request success is followed by transaction abort", async () => {
    const putRequest: Partial<IDBRequest> = {};
    const transaction: Partial<IDBTransaction> = {
      error: null,
      objectStore: vi.fn(() => ({
        put: vi.fn(() => putRequest),
      }) as unknown as IDBObjectStore),
    };
    const database: Partial<IDBDatabase> = {
      close: vi.fn(),
      transaction: vi.fn(() => transaction as IDBTransaction),
    };
    const openRequest: Partial<IDBOpenDBRequest> = {
      result: database as IDBDatabase,
    };
    vi.stubGlobal("indexedDB", {
      open: vi.fn(() => openRequest),
    });

    const store = createIndexedDbPayrollOutboxStore();
    const persistence = store.put({
      storageKey: '["org-1","user-1","abort-key"]',
      idempotencyKey: "abort-key",
      action: "record_time_event",
      ...baseEvent,
      enqueueSequence: 1,
      enqueuedAt: "2026-08-11T16:00:01.000Z",
      state: "pending",
      safeCode: null,
    });

    openRequest.onsuccess?.(new Event("success"));
    for (let attempt = 0; attempt < 5 && !putRequest.onsuccess; attempt += 1) {
      await Promise.resolve();
    }
    expect(putRequest.onsuccess).toBeTypeOf("function");
    putRequest.onsuccess?.(new Event("success"));

    let settled = false;
    void persistence.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await Promise.resolve();
    expect(settled).toBe(false);

    Object.defineProperty(transaction, "error", {
      value: new DOMException("Commit aborted", "AbortError"),
    });
    transaction.onabort?.(new Event("abort"));

    await expect(persistence).rejects.toThrow("Commit aborted");
  });

  it("serializes concurrent enqueue and drain calls in persisted enqueue order", async () => {
    const innerStore = createInMemoryPayrollOutboxStore();
    const firstPutStarted = createDeferred();
    const releaseFirstPut = createDeferred();
    let putCount = 0;
    const store = {
      ...innerStore,
      async put(event: PendingPayrollEvent) {
        putCount += 1;
        if (putCount === 1) {
          firstPutStarted.resolve();
          await releaseFirstPut.promise;
        }
        await innerStore.put(event);
      },
    };
    const sendOrder: string[] = [];

    const firstEnqueue = enqueuePayrollOutboxEvent({
      store,
      action: "record_time_event",
      idempotencyKey: "concurrent-key-1",
      ...baseEvent,
    });
    await firstPutStarted.promise;
    const secondEnqueue = enqueuePayrollOutboxEvent({
      store,
      action: "record_time_event",
      idempotencyKey: "concurrent-key-2",
      ...baseEvent,
      occurredAt: "2026-08-11T16:01:00.000Z",
      payload: {
        ...baseEvent.payload,
        occurredAt: "2026-08-11T16:01:00.000Z",
      },
    });
    const drain = drainPayrollOutbox({
      store,
      organizationId: "org-1",
      userId: "user-1",
      recordTimeEvent: vi.fn(async (event) => {
        sendOrder.push(event.idempotencyKey);
        return { idempotencyKey: event.idempotencyKey };
      }),
      recordSessionAttendance: vi.fn(),
    });

    releaseFirstPut.resolve();
    const [first, second] = await Promise.all([firstEnqueue, secondEnqueue]);
    await drain;

    expect([first.enqueueSequence, second.enqueueSequence]).toEqual([1, 2]);
    expect(sendOrder).toEqual(["concurrent-key-1", "concurrent-key-2"]);
  });

  it("serializes overlapping drains so a queued event is sent only once", async () => {
    const store = createInMemoryPayrollOutboxStore();
    const transportStarted = createDeferred();
    const releaseTransport = createDeferred();
    const transport = vi.fn(async (event) => {
      transportStarted.resolve();
      await releaseTransport.promise;
      return { idempotencyKey: event.idempotencyKey };
    });

    await enqueuePayrollOutboxEvent({
      store,
      action: "record_time_event",
      idempotencyKey: "single-send-key",
      ...baseEvent,
    });

    const firstDrain = drainPayrollOutbox({
      store,
      organizationId: "org-1",
      userId: "user-1",
      recordTimeEvent: transport,
      recordSessionAttendance: vi.fn(),
    });
    await transportStarted.promise;
    const secondDrain = drainPayrollOutbox({
      store,
      organizationId: "org-1",
      userId: "user-1",
      recordTimeEvent: transport,
      recordSessionAttendance: vi.fn(),
    });

    await Promise.resolve();
    expect(transport).toHaveBeenCalledTimes(1);
    releaseTransport.resolve();
    await Promise.all([firstDrain, secondDrain]);

    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("continues the per-scope operation chain after a rejected enqueue", async () => {
    const innerStore = createInMemoryPayrollOutboxStore();
    let failNextList = true;
    const store = {
      ...innerStore,
      async list() {
        if (failNextList) {
          failNextList = false;
          throw new Error("transient local read failure");
        }
        return innerStore.list();
      },
    };

    const failedEnqueue = enqueuePayrollOutboxEvent({
      store,
      action: "record_time_event",
      idempotencyKey: "failed-local-key",
      ...baseEvent,
    });
    const nextEnqueue = enqueuePayrollOutboxEvent({
      store,
      action: "record_time_event",
      idempotencyKey: "recovered-local-key",
      ...baseEvent,
    });

    await expect(failedEnqueue).rejects.toThrow("transient local read failure");
    await expect(nextEnqueue).resolves.toEqual(
      expect.objectContaining({ idempotencyKey: "recovered-local-key", enqueueSequence: 1 }),
    );
  });

  it("retains confirmed clinical attendance rows instead of deleting them during drain", async () => {
    const store = createInMemoryPayrollOutboxStore();

    await enqueuePayrollOutboxEvent({
      store,
      action: "record_session_attendance",
      idempotencyKey: "attendance-retained-key",
      retainForClinical: true,
      ...baseAttendanceEvent,
    });

    await expect(
      drainPayrollOutbox({
        store,
        organizationId: "org-1",
        userId: "user-1",
        recordTimeEvent: vi.fn(),
        recordSessionAttendance: vi.fn(async (event) => ({ idempotencyKey: event.idempotencyKey })),
      }),
    ).resolves.toEqual({ confirmedKeys: ["attendance-retained-key"] });

    await expect(
      listPayrollOutboxEvents(store, { organizationId: "org-1", userId: "user-1" }),
    ).resolves.toEqual([
      expect.objectContaining({
        idempotencyKey: "attendance-retained-key",
        occurredAt: "2026-08-11T16:05:00.000Z",
        state: "confirmed_pending_clinical",
        retainForClinical: true,
      }),
    ]);
  });

  it("persists and replays only canonical audit fields for retained attendance", async () => {
    const store = createInMemoryPayrollOutboxStore();
    const canonicalPayload = {
      occurredAt: "2026-08-11T16:05:00.000Z",
      timezone: "America/Los_Angeles",
      workLocation: "client_site",
      data: {
        eventType: "session_started",
        sessionId: "11111111-1111-1111-1111-111111111111",
        employeeTimeEventId: "22222222-2222-2222-2222-222222222222",
      },
    };

    await enqueuePayrollOutboxEvent({
      store,
      action: "record_session_attendance",
      idempotencyKey: "canonical-retained-key",
      retainForClinical: true,
      ...baseAttendanceEvent,
      payload: {
        ...canonicalPayload,
        note: "top-level clinical note",
        unbounded: { nested: { value: "drop-me" } },
        data: {
          ...canonicalPayload.data,
          note: "nested clinical note",
          nestedExtra: { value: "drop-me-too" },
        },
      },
    });

    await expect(
      listPayrollOutboxEvents(store, { organizationId: "org-1", userId: "user-1" }),
    ).resolves.toEqual([
      expect.objectContaining({
        idempotencyKey: "canonical-retained-key",
        occurredAt: "2026-08-11T16:05:00.000Z",
        payload: canonicalPayload,
      }),
    ]);

    await drainPayrollOutbox({
      store,
      organizationId: "org-1",
      userId: "user-1",
      recordTimeEvent: vi.fn(),
      recordSessionAttendance: vi.fn(async (event) => ({ idempotencyKey: event.idempotencyKey })),
    });
    const replayedPayloads: unknown[] = [];
    await reconfirmRetainedPayrollOutboxEvent({
      store,
      organizationId: "org-1",
      userId: "user-1",
      idempotencyKey: "canonical-retained-key",
      recordSessionAttendance: vi.fn(async (event) => {
        replayedPayloads.push(event.event);
        return { idempotencyKey: event.idempotencyKey };
      }),
    });

    expect(replayedPayloads).toEqual([canonicalPayload]);
  });

  it("skips retained confirmed attendance rows during later drain and recovery while preserving their original data", async () => {
    const store = createInMemoryPayrollOutboxStore([
      {
        storageKey: '["org-1","user-1","retained-key"]',
        idempotencyKey: "retained-key",
        action: "record_session_attendance",
        organizationId: "org-1",
        userId: "user-1",
        localDate: "2026-08-11",
        occurredAt: "2026-08-11T16:05:00.000Z",
        payload: { ...baseAttendanceEvent.payload },
        enqueueSequence: 1,
        enqueuedAt: "2026-08-11T16:05:01.000Z",
        state: "confirmed_pending_clinical",
        safeCode: null,
        retainForClinical: true,
      } satisfies PendingPayrollEvent,
    ]);

    const attendanceTransport = vi.fn();
    await recoverPayrollOutbox(store, {
      organizationId: "org-1",
      userId: "user-1",
    });
    await expect(
      drainPayrollOutbox({
        store,
        organizationId: "org-1",
        userId: "user-1",
        recordTimeEvent: vi.fn(),
        recordSessionAttendance: attendanceTransport,
      }),
    ).resolves.toEqual({ confirmedKeys: [] });

    expect(attendanceTransport).not.toHaveBeenCalled();
    await expect(
      listPayrollOutboxEvents(store, { organizationId: "org-1", userId: "user-1" }),
    ).resolves.toEqual([
      expect.objectContaining({
        idempotencyKey: "retained-key",
        occurredAt: "2026-08-11T16:05:00.000Z",
        state: "confirmed_pending_clinical",
      }),
    ]);
  });

  it("reconfirms exactly one retained attendance row with the same key and preserves retention on retryable failure", async () => {
    const store = createInMemoryPayrollOutboxStore([
      {
        storageKey: '["org-1","user-1","retained-key"]',
        idempotencyKey: "retained-key",
        action: "record_session_attendance",
        organizationId: "org-1",
        userId: "user-1",
        localDate: "2026-08-11",
        occurredAt: "2026-08-11T16:05:00.000Z",
        payload: { ...baseAttendanceEvent.payload },
        enqueueSequence: 1,
        enqueuedAt: "2026-08-11T16:05:01.000Z",
        state: "confirmed_pending_clinical",
        safeCode: null,
        retainForClinical: true,
      } satisfies PendingPayrollEvent,
    ]);

    const replayedKeys: Array<{ key: string; occurredAt: string }> = [];
    await expect(
      reconfirmRetainedPayrollOutboxEvent({
        store,
        organizationId: "org-1",
        userId: "user-1",
        idempotencyKey: "retained-key",
        recordSessionAttendance: vi.fn(async (event) => {
          replayedKeys.push({ key: event.idempotencyKey, occurredAt: event.event.occurredAt });
          return { idempotencyKey: event.idempotencyKey };
        }),
      }),
    ).resolves.toEqual({ idempotencyKey: "retained-key" });

    expect(replayedKeys).toEqual([
      { key: "retained-key", occurredAt: "2026-08-11T16:05:00.000Z" },
    ]);
    await expect(
      listPayrollOutboxEvents(store, { organizationId: "org-1", userId: "user-1" }),
    ).resolves.toEqual([
      expect.objectContaining({
        idempotencyKey: "retained-key",
        state: "confirmed_pending_clinical",
      }),
    ]);

    await expect(
      reconfirmRetainedPayrollOutboxEvent({
        store,
        organizationId: "org-1",
        userId: "user-1",
        idempotencyKey: "retained-key",
        recordSessionAttendance: vi.fn(async () => {
          throw makeRetryableError();
        }),
      }),
    ).rejects.toMatchObject({ code: "upstream_error", status: 503 });

    await expect(
      listPayrollOutboxEvents(store, { organizationId: "org-1", userId: "user-1" }),
    ).resolves.toEqual([
      expect.objectContaining({
        idempotencyKey: "retained-key",
        state: "confirmed_pending_clinical",
        safeCode: null,
      }),
    ]);
  });

  it("marks only the scoped retained row needs_attention when reconfirm returns a mismatched key", async () => {
    const retainedEvent = {
      storageKey: '["org-1","user-1","retained-key"]',
      idempotencyKey: "retained-key",
      action: "record_session_attendance",
      organizationId: "org-1",
      userId: "user-1",
      localDate: "2026-08-11",
      occurredAt: "2026-08-11T16:05:00.000Z",
      payload: { ...baseAttendanceEvent.payload },
      enqueueSequence: 1,
      enqueuedAt: "2026-08-11T16:05:01.000Z",
      state: "confirmed_pending_clinical",
      safeCode: null,
      retainForClinical: true,
    } satisfies PendingPayrollEvent;
    const otherScopeEvent = {
      ...retainedEvent,
      storageKey: '["org-2","user-2","retained-key"]',
      organizationId: "org-2",
      userId: "user-2",
      enqueueSequence: 2,
    } satisfies PendingPayrollEvent;
    const store = createInMemoryPayrollOutboxStore([retainedEvent, otherScopeEvent]);

    await expect(
      reconfirmRetainedPayrollOutboxEvent({
        store,
        organizationId: "org-1",
        userId: "user-1",
        idempotencyKey: "retained-key",
        recordSessionAttendance: vi.fn(async () => ({ idempotencyKey: "different-key" })),
      }),
    ).rejects.toMatchObject({ code: "idempotency_mismatch" });

    await expect(store.list()).resolves.toEqual([
      expect.objectContaining({
        storageKey: '["org-1","user-1","retained-key"]',
        state: "needs_attention",
        safeCode: "idempotency_mismatch",
      }),
      expect.objectContaining({
        storageKey: '["org-2","user-2","retained-key"]',
        state: "confirmed_pending_clinical",
        safeCode: null,
      }),
    ]);
  });

  it("marks the scoped retained row needs_attention when reconfirm throws idempotency_mismatch", async () => {
    const retainedEvent = {
      storageKey: '["org-1","user-1","retained-key"]',
      idempotencyKey: "retained-key",
      action: "record_session_attendance",
      organizationId: "org-1",
      userId: "user-1",
      localDate: "2026-08-11",
      occurredAt: "2026-08-11T16:05:00.000Z",
      payload: { ...baseAttendanceEvent.payload },
      enqueueSequence: 1,
      enqueuedAt: "2026-08-11T16:05:01.000Z",
      state: "confirmed_pending_clinical",
      safeCode: null,
      retainForClinical: true,
    } satisfies PendingPayrollEvent;
    const store = createInMemoryPayrollOutboxStore([retainedEvent]);
    const mismatch = Object.assign(new Error("Upstream key mismatch"), {
      code: "idempotency_mismatch",
      status: 409,
    });

    await expect(
      reconfirmRetainedPayrollOutboxEvent({
        store,
        organizationId: "org-1",
        userId: "user-1",
        idempotencyKey: "retained-key",
        recordSessionAttendance: vi.fn(async () => {
          throw mismatch;
        }),
      }),
    ).rejects.toBe(mismatch);

    await expect(store.list()).resolves.toEqual([
      expect.objectContaining({
        storageKey: '["org-1","user-1","retained-key"]',
        state: "needs_attention",
        safeCode: "idempotency_mismatch",
      }),
    ]);
  });

  it("marks retained reconfirm state_conflict needs_attention and preserves retryable retention", async () => {
    const retainedEvent = {
      storageKey: '["org-1","user-1","retained-key"]',
      idempotencyKey: "retained-key",
      action: "record_session_attendance",
      organizationId: "org-1",
      userId: "user-1",
      localDate: "2026-08-11",
      occurredAt: "2026-08-11T16:05:00.000Z",
      payload: { ...baseAttendanceEvent.payload },
      enqueueSequence: 1,
      enqueuedAt: "2026-08-11T16:05:01.000Z",
      state: "confirmed_pending_clinical",
      safeCode: null,
      retainForClinical: true,
    } satisfies PendingPayrollEvent;
    const conflictStore = createInMemoryPayrollOutboxStore([retainedEvent]);
    const conflict = Object.assign(new Error("Attendance state conflict"), {
      code: "state_conflict",
      status: 409,
    });

    await expect(
      reconfirmRetainedPayrollOutboxEvent({
        store: conflictStore,
        organizationId: "org-1",
        userId: "user-1",
        idempotencyKey: "retained-key",
        recordSessionAttendance: vi.fn(async () => {
          throw conflict;
        }),
      }),
    ).rejects.toBe(conflict);
    await expect(conflictStore.list()).resolves.toEqual([
      expect.objectContaining({ state: "needs_attention", safeCode: "state_conflict" }),
    ]);

    const retryStore = createInMemoryPayrollOutboxStore([retainedEvent]);
    await expect(
      reconfirmRetainedPayrollOutboxEvent({
        store: retryStore,
        organizationId: "org-1",
        userId: "user-1",
        idempotencyKey: "retained-key",
        recordSessionAttendance: vi.fn(async () => {
          throw makeRetryableError();
        }),
      }),
    ).rejects.toMatchObject({ code: "upstream_error", status: 503 });
    await expect(retryStore.list()).resolves.toEqual([
      expect.objectContaining({ state: "confirmed_pending_clinical", safeCode: null }),
    ]);
  });

  it("rejects retained replay on wrong scope, wrong state, and needs_attention", async () => {
    const retainedEvent = {
      storageKey: '["org-1","user-1","retained-key"]',
      idempotencyKey: "retained-key",
      action: "record_session_attendance",
      organizationId: "org-1",
      userId: "user-1",
      localDate: "2026-08-11",
      occurredAt: "2026-08-11T16:05:00.000Z",
      payload: { ...baseAttendanceEvent.payload },
      enqueueSequence: 1,
      enqueuedAt: "2026-08-11T16:05:01.000Z",
      state: "confirmed_pending_clinical",
      safeCode: null,
      retainForClinical: true,
    } satisfies PendingPayrollEvent;

    await expect(
      reconfirmRetainedPayrollOutboxEvent({
        store: createInMemoryPayrollOutboxStore([retainedEvent]),
        organizationId: "org-2",
        userId: "user-1",
        idempotencyKey: "retained-key",
        recordSessionAttendance: vi.fn(),
      }),
    ).rejects.toThrow("No retained payroll outbox event exists");

    await expect(
      reconfirmRetainedPayrollOutboxEvent({
        store: createInMemoryPayrollOutboxStore([
          {
            ...retainedEvent,
            state: "pending",
          },
        ]),
        organizationId: "org-1",
        userId: "user-1",
        idempotencyKey: "retained-key",
        recordSessionAttendance: vi.fn(),
      }),
    ).rejects.toThrow("Retained payroll outbox event is not ready");

    await expect(
      reconfirmRetainedPayrollOutboxEvent({
        store: createInMemoryPayrollOutboxStore([
          {
            ...retainedEvent,
            safeCode: "state_conflict",
            state: "needs_attention",
          },
        ]),
        organizationId: "org-1",
        userId: "user-1",
        idempotencyKey: "retained-key",
        recordSessionAttendance: vi.fn(),
      }),
    ).rejects.toThrow("Retained payroll outbox event requires attention");
  });

  it("clears exactly one retained row only after a matching compatible success key", async () => {
    const retainedEvent = {
      storageKey: '["org-1","user-1","retained-key"]',
      idempotencyKey: "retained-key",
      action: "record_session_attendance",
      organizationId: "org-1",
      userId: "user-1",
      localDate: "2026-08-11",
      occurredAt: "2026-08-11T16:05:00.000Z",
      payload: { ...baseAttendanceEvent.payload },
      enqueueSequence: 1,
      enqueuedAt: "2026-08-11T16:05:01.000Z",
      state: "confirmed_pending_clinical",
      safeCode: null,
      retainForClinical: true,
    } satisfies PendingPayrollEvent;

    const store = createInMemoryPayrollOutboxStore([retainedEvent]);
    await clearRetainedPayrollOutboxEvent({
      store,
      organizationId: "org-1",
      userId: "user-1",
      idempotencyKey: "retained-key",
      confirmedServerIdempotencyKey: "retained-key",
    });

    await expect(
      listPayrollOutboxEvents(store, { organizationId: "org-1", userId: "user-1" }),
    ).resolves.toEqual([]);
  });

  it("rejects retained clear for wrong state, wrong action, and mismatched success key", async () => {
    const retainedEvent = {
      storageKey: '["org-1","user-1","retained-key"]',
      idempotencyKey: "retained-key",
      action: "record_session_attendance",
      organizationId: "org-1",
      userId: "user-1",
      localDate: "2026-08-11",
      occurredAt: "2026-08-11T16:05:00.000Z",
      payload: { ...baseAttendanceEvent.payload },
      enqueueSequence: 1,
      enqueuedAt: "2026-08-11T16:05:01.000Z",
      state: "confirmed_pending_clinical",
      safeCode: null,
      retainForClinical: true,
    } satisfies PendingPayrollEvent;

    await expect(
      clearRetainedPayrollOutboxEvent({
        store: createInMemoryPayrollOutboxStore([retainedEvent]),
        organizationId: "org-1",
        userId: "user-1",
        idempotencyKey: "retained-key",
        confirmedServerIdempotencyKey: "different-key",
      }),
    ).rejects.toThrow("Clinical success key does not match");

    await expect(
      clearRetainedPayrollOutboxEvent({
        store: createInMemoryPayrollOutboxStore([
          {
            ...retainedEvent,
            state: "pending",
          },
        ]),
        organizationId: "org-1",
        userId: "user-1",
        idempotencyKey: "retained-key",
        confirmedServerIdempotencyKey: "retained-key",
      }),
    ).rejects.toThrow("Retained payroll outbox event is not ready");

    await expect(
      clearRetainedPayrollOutboxEvent({
        store: createInMemoryPayrollOutboxStore([
          {
            ...retainedEvent,
            action: "record_time_event",
            payload: { ...baseEvent.payload },
          },
        ]),
        organizationId: "org-1",
        userId: "user-1",
        idempotencyKey: "retained-key",
        confirmedServerIdempotencyKey: "retained-key",
      }),
    ).rejects.toThrow("Retained payroll outbox event has an incompatible action");
  });

  it("independently reconfirms and clears retained rows sharing a key across scopes", async () => {
    const retainedEvent = {
      storageKey: '["org-1","user-1","retained-key"]',
      idempotencyKey: "retained-key",
      action: "record_session_attendance",
      organizationId: "org-1",
      userId: "user-1",
      localDate: "2026-08-11",
      occurredAt: "2026-08-11T16:05:00.000Z",
      payload: { ...baseAttendanceEvent.payload },
      enqueueSequence: 1,
      enqueuedAt: "2026-08-11T16:05:01.000Z",
      state: "confirmed_pending_clinical",
      safeCode: null,
      retainForClinical: true,
    } satisfies PendingPayrollEvent;
    const store = createInMemoryPayrollOutboxStore([
      retainedEvent,
      {
        ...retainedEvent,
        storageKey: '["org-2","user-2","retained-key"]',
        organizationId: "org-2",
        userId: "user-2",
        enqueueSequence: 2,
      },
    ]);
    const replayedScopes: string[] = [];
    const recordSessionAttendance = vi.fn(async (event) => {
      replayedScopes.push(`${event.organizationId}/${event.userId}`);
      return { idempotencyKey: event.idempotencyKey };
    });

    await reconfirmRetainedPayrollOutboxEvent({
      store,
      organizationId: "org-1",
      userId: "user-1",
      idempotencyKey: "retained-key",
      recordSessionAttendance,
    });
    await expect(
      listPayrollOutboxEvents(store, { organizationId: "org-2", userId: "user-2" }),
    ).resolves.toEqual([
      expect.objectContaining({ state: "confirmed_pending_clinical", safeCode: null }),
    ]);

    await reconfirmRetainedPayrollOutboxEvent({
      store,
      organizationId: "org-2",
      userId: "user-2",
      idempotencyKey: "retained-key",
      recordSessionAttendance,
    });
    expect(replayedScopes).toEqual(["org-1/user-1", "org-2/user-2"]);

    await clearRetainedPayrollOutboxEvent({
      store,
      organizationId: "org-1",
      userId: "user-1",
      idempotencyKey: "retained-key",
      confirmedServerIdempotencyKey: "retained-key",
    });
    await expect(
      listPayrollOutboxEvents(store, { organizationId: "org-1", userId: "user-1" }),
    ).resolves.toEqual([]);
    await expect(
      listPayrollOutboxEvents(store, { organizationId: "org-2", userId: "user-2" }),
    ).resolves.toHaveLength(1);

    await clearRetainedPayrollOutboxEvent({
      store,
      organizationId: "org-2",
      userId: "user-2",
      idempotencyKey: "retained-key",
      confirmedServerIdempotencyKey: "retained-key",
    });
    await expect(store.list()).resolves.toEqual([]);
  });

  it("serializes overlapping retained replay and clear operations without poisoning the scope chain", async () => {
    const store = createInMemoryPayrollOutboxStore([
      {
        storageKey: '["org-1","user-1","retained-key"]',
        idempotencyKey: "retained-key",
        action: "record_session_attendance",
        organizationId: "org-1",
        userId: "user-1",
        localDate: "2026-08-11",
        occurredAt: "2026-08-11T16:05:00.000Z",
        payload: { ...baseAttendanceEvent.payload },
        enqueueSequence: 1,
        enqueuedAt: "2026-08-11T16:05:01.000Z",
        state: "confirmed_pending_clinical",
        safeCode: null,
        retainForClinical: true,
      } satisfies PendingPayrollEvent,
    ]);
    const transportStarted = createDeferred();
    const releaseTransport = createDeferred();

    const replay = reconfirmRetainedPayrollOutboxEvent({
      store,
      organizationId: "org-1",
      userId: "user-1",
      idempotencyKey: "retained-key",
      recordSessionAttendance: vi.fn(async (event) => {
        transportStarted.resolve();
        await releaseTransport.promise;
        return { idempotencyKey: event.idempotencyKey };
      }),
    });
    await transportStarted.promise;

    const clear = clearRetainedPayrollOutboxEvent({
      store,
      organizationId: "org-1",
      userId: "user-1",
      idempotencyKey: "retained-key",
      confirmedServerIdempotencyKey: "retained-key",
    });

    await expect(
      listPayrollOutboxEvents(store, { organizationId: "org-1", userId: "user-1" }),
    ).resolves.toEqual([
      expect.objectContaining({
        idempotencyKey: "retained-key",
      }),
    ]);

    releaseTransport.resolve();
    await replay;
    await clear;

    await expect(
      listPayrollOutboxEvents(store, { organizationId: "org-1", userId: "user-1" }),
    ).resolves.toEqual([]);
  });
});
