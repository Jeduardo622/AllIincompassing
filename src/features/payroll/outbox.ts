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
  remove(storageKey: string): Promise<void>;
  markFailed(storageKey: string, safeCode: string): Promise<void>;
}

export type PendingPayrollEvent = {
  storageKey: string;
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
const PAYROLL_OUTBOX_DB_VERSION = 2;

const operationChains = new Map<string, Promise<void>>();

const createStorageKey = (scope: ScopedOutbox, idempotencyKey: string): string =>
  JSON.stringify([scope.organizationId, scope.userId, idempotencyKey]);

const normalizeStoredEvent = (event: PendingPayrollEvent): PendingPayrollEvent => ({
  ...event,
  storageKey: event.storageKey || createStorageKey(event, event.idempotencyKey),
});

const runScopedOperation = <T>(
  scope: ScopedOutbox,
  operation: () => Promise<T>,
): Promise<T> => {
  const scopeKey = JSON.stringify([scope.organizationId, scope.userId]);
  const previous = operationChains.get(scopeKey) ?? Promise.resolve();
  const current = previous.then(operation, operation);
  const tail = current.then(
    () => undefined,
    () => undefined,
  );
  operationChains.set(scopeKey, tail);
  void tail.then(() => {
    if (operationChains.get(scopeKey) === tail) {
      operationChains.delete(scopeKey);
    }
  });
  return current;
};

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
  const entries = new Map(
    initialEvents.map((event) => {
      const normalized = normalizeStoredEvent(event);
      return [normalized.storageKey, normalized];
    }),
  );

  return {
    async put(event) {
      entries.set(event.storageKey, { ...event });
    },
    async list() {
      return sortOutboxEvents(Array.from(entries.values()).map((event) => ({ ...event })));
    },
    async remove(storageKey) {
      entries.delete(storageKey);
    },
    async markFailed(storageKey, safeCode) {
      const existing = entries.get(storageKey);
      if (!existing) {
        return;
      }
      entries.set(storageKey, {
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
        database.createObjectStore(PAYROLL_OUTBOX_STORE_NAME, { keyPath: "storageKey" });
        return;
      }

      const transaction = request.transaction;
      if (!transaction) {
        throw new Error("Payroll outbox upgrade transaction is unavailable.");
      }
      const existingStore = transaction.objectStore(PAYROLL_OUTBOX_STORE_NAME);
      if (existingStore.keyPath === "storageKey") {
        return;
      }

      const readRequest = existingStore.getAll();
      readRequest.onerror = () => transaction.abort();
      readRequest.onsuccess = () => {
        const existingEvents = (readRequest.result ?? []) as PendingPayrollEvent[];
        database.deleteObjectStore(PAYROLL_OUTBOX_STORE_NAME);
        const migratedStore = database.createObjectStore(PAYROLL_OUTBOX_STORE_NAME, {
          keyPath: "storageKey",
        });
        for (const event of existingEvents) {
          migratedStore.put(normalizeStoredEvent(event));
        }
      };
    };
    request.onsuccess = () => resolve(request.result);
  });
};

const runIndexedDbRequest = async <T>(
  mode: IDBTransactionMode,
  executor: (
    store: IDBObjectStore,
    setResult: (value: T) => void,
    setRequestError: (reason: unknown) => void,
  ) => void,
): Promise<T> => {
  const database = await openIndexedDb();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(PAYROLL_OUTBOX_STORE_NAME, mode);
    const store = transaction.objectStore(PAYROLL_OUTBOX_STORE_NAME);
    let result: T;
    let hasResult = false;
    let requestError: unknown;
    let settled = false;

    const closeDatabase = () => {
      database.close();
    };
    const rejectTransaction = (fallback: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      closeDatabase();
      reject(transaction.error ?? requestError ?? fallback);
    };

    transaction.oncomplete = () => {
      if (settled) {
        return;
      }
      settled = true;
      closeDatabase();
      if (!hasResult) {
        reject(requestError ?? new Error("Payroll outbox IndexedDB request did not complete."));
        return;
      }
      resolve(result);
    };
    transaction.onerror = () => {
      rejectTransaction(new Error("Payroll outbox IndexedDB transaction failed."));
    };
    transaction.onabort = () => {
      rejectTransaction(new Error("Payroll outbox IndexedDB transaction aborted."));
    };

    try {
      executor(
        store,
        (value) => {
          result = value;
          hasResult = true;
        },
        (reason) => {
          requestError = reason;
        },
      );
    } catch (error) {
      requestError = error;
      try {
        transaction.abort();
      } catch {
        rejectTransaction(new Error("Payroll outbox IndexedDB transaction failed."));
      }
    }
  });
};

export const createIndexedDbPayrollOutboxStore = (): PayrollOutboxStore => ({
  async put(event) {
    await runIndexedDbRequest<void>("readwrite", (store, setResult, setRequestError) => {
      const request = store.put(event);
      request.onerror = () => setRequestError(request.error ?? new Error("Failed to persist payroll outbox event."));
      request.onsuccess = () => setResult(undefined);
    });
  },
  async list() {
    return runIndexedDbRequest<PendingPayrollEvent[]>("readonly", (store, setResult, setRequestError) => {
      const request = store.getAll();
      request.onerror = () => setRequestError(request.error ?? new Error("Failed to read payroll outbox events."));
      request.onsuccess = () => {
        setResult(sortOutboxEvents(
          ((request.result ?? []) as PendingPayrollEvent[]).map(normalizeStoredEvent),
        ));
      };
    });
  },
  async remove(storageKey) {
    await runIndexedDbRequest<void>("readwrite", (store, setResult, setRequestError) => {
      const request = store.delete(storageKey);
      request.onerror = () => setRequestError(request.error ?? new Error("Failed to remove payroll outbox event."));
      request.onsuccess = () => setResult(undefined);
    });
  },
  async markFailed(storageKey, safeCode) {
    await runIndexedDbRequest<void>("readwrite", (store, setResult, setRequestError) => {
      const readRequest = store.get(storageKey);
      readRequest.onerror = () => setRequestError(
        readRequest.error ?? new Error("Failed to read payroll outbox event for failure state."),
      );
      readRequest.onsuccess = () => {
        const existing = readRequest.result as PendingPayrollEvent | undefined;
        if (!existing) {
          setResult(undefined);
          return;
        }
        const writeRequest = store.put({
          ...normalizeStoredEvent(existing),
          state: "needs_attention",
          safeCode,
        });
        writeRequest.onerror = () => setRequestError(
          writeRequest.error ?? new Error("Failed to persist payroll outbox failure state."),
        );
        writeRequest.onsuccess = () => setResult(undefined);
      };
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
  return runScopedOperation(scope, async () => {
    const events = await listPayrollOutboxEvents(store, scope);
    for (const event of events) {
      if (event.state === "replaying") {
        await store.put(withPendingState(event));
      }
    }
  });
}

export async function enqueuePayrollOutboxEvent(
  input: EnqueuePayrollOutboxEventInput,
): Promise<PendingPayrollEvent> {
  return runScopedOperation(input, async () => {
    const idempotencyKey = assertNonEmptyKey(input.idempotencyKey);
    const payload = validateOutboxPayload(input.action, input.payload);
    const existingEvents = await input.store.list();
    const enqueueSequence = existingEvents.reduce(
      (maxSequence, event) => Math.max(maxSequence, event.enqueueSequence),
      0,
    ) + 1;
    const pendingEvent: PendingPayrollEvent = {
      storageKey: createStorageKey(input, idempotencyKey),
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
  });
}

export async function drainPayrollOutbox(
  input: DrainPayrollOutboxInput,
): Promise<{ confirmedKeys: string[] }> {
  return runScopedOperation(input, async () => {
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

        await input.store.remove(event.storageKey);
        confirmedKeys.push(event.idempotencyKey);
      } catch (error) {
        if ((error as { code?: unknown })?.code === "state_conflict") {
          await input.store.markFailed(event.storageKey, "state_conflict");
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
  });
}
