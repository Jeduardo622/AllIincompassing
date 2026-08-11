import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createInMemoryPayrollOutboxStore,
  createIndexedDbPayrollOutboxStore,
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
});
