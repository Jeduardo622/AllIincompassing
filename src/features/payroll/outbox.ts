import {
  isRetryablePayrollTransportError,
  type PayrollScope,
  type PayrollSessionAttendancePayload,
  type PayrollTimeEventPayload,
  type PayrollMutationSuccess,
  validatePayrollSessionAttendancePayload,
  validatePayrollTimeEventPayload,
} from "./api";

export interface PayrollOutboxStore {
  put(event: PendingPayrollEvent): Promise<void>;
  list(): Promise<PendingPayrollEvent[]>;
  remove(idempotencyKey: string): Promise<void>;
  markFailed(idempotencyKey: string, safeCode: string): Promise<void>;
}

export type PendingPayrollEvent = {
  organizationId: string;
  userId: string;
  localDate: string;
  idempotencyKey: string;
  action: "record_time_event" | "record_session_attendance";
  occurredAt: string;
  payload: Record<string, unknown>;
  enqueueSequence: number;
  enqueuedAt: string;
  state: "pending" | "replaying" | "needs_attention";
  safeCode: string | null;
};

type ScopedOutbox = Pick<PayrollScope, "organizationId" | "userId">;
type EnqueuePayrollOutboxEventInput = PayrollScope & {
  action: PendingPayrollEvent["action"];
  idempotencyKey: string;
  occurredAt: string;
  payload: Record<string, unknown>;
  store: PayrollOutboxStore;
};
type DrainPayrollOutboxInput = ScopedOutbox & {
  store: PayrollOutboxStore;
  recordTimeEvent: (input: PayrollScope & { idempotencyKey: string; event: PayrollTimeEventPayload }) => Promise<PayrollMutationSuccess>;
  recordSessionAttendance: (input: PayrollScope & { idempotencyKey: string; event: PayrollSessionAttendancePayload }) => Promise<PayrollMutationSuccess>;
};

const PAYROLL_OUTBOX_DB_NAME = "allincompassing-payroll-time-outbox";
const PAYROLL_OUTBOX_STORE_NAME = "payroll-time-events";
const PAYROLL_OUTBOX_DB_VERSION = 1;

const isMatchingScope = (event: PendingPayrollEvent, scope: ScopedOutbox): boolean =>
  event.organizationId === scope.organizationId && event.userId === scope.userId;

const sortOutboxEvents = (events: PendingPayrollEvent[]): PendingPayrollEvent[] =>
  [...events].sort((left, right) =>
    left.enqueueSequence - right.enqueueSequence ||
    left.enqueuedAt.localeCompare(right.enqueuedAt) ||
    left.idempotencyKey.localeCompare(right.idempotencyKey)
  );

const assertNonEmptyKey = (idempotencyKey: string): string => {
  const trimmed = idempotencyKey.trim();
  if (!trimmed) {
    throw new Error("A non-empty payroll idempotency key is required.");
  }
  return trimmed;
};

const validateOutboxPayload = (
  action: PendingPayrollEvent["action"],
  payload: Record<string, unknown>,
): Record<string, unknown> => {
  if (action === "record_time_event") {
    return validatePayrollTimeEventPayload(payload as PayrollTimeEventPayload) as Record<string, unknown>;
  }
  return validatePayrollSessionAttendancePayload(payload as PayrollSessionAttendancePayload) as Record<string, unknown>;
};

const withPendingState = (event: PendingPayrollEvent): PendingPayrollEvent => ({
  ...event,
  state: "pending",
  safeCode: null,
});

export const createInMemoryPayrollOutboxStore = (
  initialEvents: PendingPayrollEvent[] = [],
): PayrollOutboxStore => {
  const entries = new Map(initialEvents.map((event) => [event.idempotencyKey, event]));

  return {
    async put(event) {
      entries.set(event.idempotencyKey, { ...event });
    },
    async list() {
      return sortOutboxEvents(Array.from(entries.values()).map((event) => ({ ...event })));
    },
    async remove(idempotencyKey) {
      entries.delete(idempotencyKey);
    },
    async markFailed(idempotencyKey, safeCode) {
      const existing = entries.get(idempotencyKey);
      if (!existing) {
        return;
      }
      entries.set(idempotencyKey, {
        ...existing,
        state: "needs_attention",
        safeCode,
      });
    },
  };
};

const openIndexedDb = async (): Promise<IDBDatabase> => {
  if (typeof indexedDB === "undefined") {
    throw new Error("IndexedDB is not available in this environment.");
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(PAYROLL_OUTBOX_DB_NAME, PAYROLL_OUTBOX_DB_VERSION);
    request.onerror = () => reject(request.error ?? new Error("Failed to open payroll outbox database."));
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(PAYROLL_OUTBOX_STORE_NAME)) {
        database.createObjectStore(PAYROLL_OUTBOX_STORE_NAME, { keyPath: "idempotencyKey" });
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
};

const runIndexedDbRequest = async <T>(
  mode: IDBTransactionMode,
  executor: (store: IDBObjectStore, resolve: (value: T) => void, reject: (reason?: unknown) => void) => void,
): Promise<T> => {
  const database = await openIndexedDb();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(PAYROLL_OUTBOX_STORE_NAME, mode);
    const store = transaction.objectStore(PAYROLL_OUTBOX_STORE_NAME);
    transaction.onerror = () => reject(transaction.error ?? new Error("Payroll outbox IndexedDB transaction failed."));
    transaction.oncomplete = () => database.close();
    executor(store, resolve, reject);
  });
};

export const createIndexedDbPayrollOutboxStore = (): PayrollOutboxStore => ({
  async put(event) {
    await runIndexedDbRequest<void>("readwrite", (store, resolve, reject) => {
      const request = store.put(event);
      request.onerror = () => reject(request.error ?? new Error("Failed to persist payroll outbox event."));
      request.onsuccess = () => resolve();
    });
  },
  async list() {
    return runIndexedDbRequest<PendingPayrollEvent[]>("readonly", (store, resolve, reject) => {
      const request = store.getAll();
      request.onerror = () => reject(request.error ?? new Error("Failed to read payroll outbox events."));
      request.onsuccess = () => {
        resolve(sortOutboxEvents((request.result ?? []) as PendingPayrollEvent[]));
      };
    });
  },
  async remove(idempotencyKey) {
    await runIndexedDbRequest<void>("readwrite", (store, resolve, reject) => {
      const request = store.delete(idempotencyKey);
      request.onerror = () => reject(request.error ?? new Error("Failed to remove payroll outbox event."));
      request.onsuccess = () => resolve();
    });
  },
  async markFailed(idempotencyKey, safeCode) {
    const events = await this.list();
    const existing = events.find((event) => event.idempotencyKey === idempotencyKey);
    if (!existing) {
      return;
    }
    await this.put({
      ...existing,
      state: "needs_attention",
      safeCode,
    });
  },
});

export async function listPayrollOutboxEvents(
  store: PayrollOutboxStore,
  scope: ScopedOutbox,
): Promise<PendingPayrollEvent[]> {
  const events = await store.list();
  return sortOutboxEvents(events.filter((event) => isMatchingScope(event, scope)));
}

export async function recoverPayrollOutbox(
  store: PayrollOutboxStore,
  scope: ScopedOutbox,
): Promise<void> {
  const events = await listPayrollOutboxEvents(store, scope);
  for (const event of events) {
    if (event.state === "replaying") {
      await store.put(withPendingState(event));
    }
  }
}

export async function enqueuePayrollOutboxEvent(
  input: EnqueuePayrollOutboxEventInput,
): Promise<PendingPayrollEvent> {
  const idempotencyKey = assertNonEmptyKey(input.idempotencyKey);
  const payload = validateOutboxPayload(input.action, input.payload);
  const existingEvents = await input.store.list();
  const enqueueSequence = existingEvents.reduce(
    (maxSequence, event) => Math.max(maxSequence, event.enqueueSequence),
    0,
  ) + 1;
  const pendingEvent: PendingPayrollEvent = {
    organizationId: input.organizationId,
    userId: input.userId,
    localDate: input.localDate,
    idempotencyKey,
    action: input.action,
    occurredAt: input.occurredAt,
    payload,
    enqueueSequence,
    enqueuedAt: new Date().toISOString(),
    state: "pending",
    safeCode: null,
  };
  await input.store.put(pendingEvent);
  return pendingEvent;
}

export async function drainPayrollOutbox(
  input: DrainPayrollOutboxInput,
): Promise<{ confirmedKeys: string[] }> {
  const confirmedKeys: string[] = [];
  const events = await listPayrollOutboxEvents(input.store, input);

  for (const event of events) {
    if (event.state === "needs_attention") {
      break;
    }

    await input.store.put({
      ...event,
      state: "replaying",
      safeCode: null,
    });

    try {
      const result = event.action === "record_time_event"
        ? await input.recordTimeEvent({
          organizationId: event.organizationId,
          userId: event.userId,
          localDate: event.localDate,
          idempotencyKey: event.idempotencyKey,
          event: event.payload as PayrollTimeEventPayload,
        })
        : await input.recordSessionAttendance({
          organizationId: event.organizationId,
          userId: event.userId,
          localDate: event.localDate,
          idempotencyKey: event.idempotencyKey,
          event: event.payload as PayrollSessionAttendancePayload,
        });

      if (result.idempotencyKey !== event.idempotencyKey) {
        await input.store.put(withPendingState(event));
        break;
      }

      await input.store.remove(event.idempotencyKey);
      confirmedKeys.push(event.idempotencyKey);
    } catch (error) {
      if ((error as { code?: unknown })?.code === "state_conflict") {
        await input.store.markFailed(event.idempotencyKey, "state_conflict");
        break;
      }

      await input.store.put(withPendingState(event));
      if (isRetryablePayrollTransportError(error)) {
        break;
      }
      break;
    }
  }

  return { confirmedKeys };
}
