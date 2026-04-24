import { fromZonedTime as zonedTimeToUtc } from "date-fns-tz";
import { logger } from "../lib/logger/logger";
import { toError } from "../lib/logger/normalizeError";
import type { Session } from "../types";
import type { SessionRecurrence } from "../server/types";

export interface RecurrenceFormState {
  enabled: boolean;
  rule: string;
  count?: number;
  until?: string;
  exceptions: string[];
  timeZone: string;
}

export type PendingScheduleDetail = {
  start_time?: string;
  idempotency_key?: string;
  agent_operation_id?: string;
  trace_request_id?: string;
  trace_correlation_id?: string;
};

export const toPendingScheduleDetail = (value: unknown): PendingScheduleDetail | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const startTime = record.start_time;
  const idempotencyKey = record.idempotency_key;
  const agentOperationId = record.agent_operation_id;
  const traceRequestId = record.trace_request_id;
  const traceCorrelationId = record.trace_correlation_id;

  if (startTime !== undefined && typeof startTime !== "string") {
    return null;
  }
  if (idempotencyKey !== undefined && typeof idempotencyKey !== "string") {
    return null;
  }
  if (agentOperationId !== undefined && typeof agentOperationId !== "string") {
    return null;
  }
  if (traceRequestId !== undefined && typeof traceRequestId !== "string") {
    return null;
  }
  if (traceCorrelationId !== undefined && typeof traceCorrelationId !== "string") {
    return null;
  }

  return {
    start_time: typeof startTime === "string" ? startTime : undefined,
    idempotency_key: typeof idempotencyKey === "string" ? idempotencyKey : undefined,
    agent_operation_id: typeof agentOperationId === "string" ? agentOperationId : undefined,
    trace_request_id: typeof traceRequestId === "string" ? traceRequestId : undefined,
    trace_correlation_id: typeof traceCorrelationId === "string" ? traceCorrelationId : undefined,
  };
};

function toTimeZoneAwareIso(value: string | undefined, timeZone: string): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  try {
    if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(trimmed)) {
      const parsed = new Date(trimmed);
      return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
    }

    const utcValue = zonedTimeToUtc(trimmed, timeZone);
    return utcValue.toISOString();
  } catch (error) {
    logger.warn("Failed to normalize recurrence datetime", {
      metadata: {
        value,
        timeZone,
        failure: toError(error, "Recurrence normalization failed").message,
      },
    });
    return undefined;
  }
}

export function normalizeRecurrencePayload(
  state: RecurrenceFormState | undefined,
): SessionRecurrence | undefined {
  if (!state?.enabled) {
    return undefined;
  }

  const rule = state.rule.trim();
  if (rule.length === 0) {
    return undefined;
  }

  const recurrence: SessionRecurrence = {
    rule,
    timeZone: state.timeZone,
  };

  if (typeof state.count === "number" && Number.isFinite(state.count) && state.count > 0) {
    recurrence.count = Math.trunc(state.count);
  }

  const untilIso = toTimeZoneAwareIso(state.until, state.timeZone);
  if (untilIso) {
    recurrence.until = untilIso;
  }

  const exceptionIsoValues = state.exceptions
    .map((value) => toTimeZoneAwareIso(value, state.timeZone))
    .filter((value): value is string => typeof value === "string");

  const dedupedExceptionIsoValues = Array.from(new Set(exceptionIsoValues));

  if (dedupedExceptionIsoValues.length > 0) {
    recurrence.exceptions = dedupedExceptionIsoValues;
  }

  return recurrence;
}

export function createSessionSlotKey(dateKey: string, timeKey: string): string {
  return `${dateKey}|${timeKey}`;
}

function parseSessionStartTime(startTime: string): { dateKey: string; timeKey: string } | null {
  const hasZoneInfo = /[zZ]|[+-]\d{2}:?\d{2}$/.test(startTime);
  if (!hasZoneInfo) {
    const rawDate = startTime.length >= 10 ? startTime.slice(0, 10) : "";
    const rawTime = startTime.length >= 16 ? startTime.slice(11, 16) : "";

    if (rawDate.length === 10 && rawTime.length === 5) {
      return { dateKey: rawDate, timeKey: rawTime };
    }
  }

  const parsed = new Date(startTime);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  const hours = String(parsed.getHours()).padStart(2, "0");
  const minutes = String(parsed.getMinutes()).padStart(2, "0");

  return {
    dateKey: `${parsed.getFullYear()}-${month}-${day}`,
    timeKey: `${hours}:${minutes}`,
  };
}

export function buildSessionSlotIndex(sessions: Session[]): Map<string, Session[]> {
  const index = new Map<string, Session[]>();

  for (const session of sessions) {
    if (typeof session.start_time !== "string") {
      continue;
    }

    const start = parseSessionStartTime(session.start_time);
    if (!start) {
      continue;
    }

    const key = createSessionSlotKey(start.dateKey, start.timeKey);
    const existing = index.get(key);
    if (existing) {
      existing.push(session);
    } else {
      index.set(key, [session]);
    }
  }

  return index;
}

export function reconcileOptimisticSessionMoves(
  optimisticSessionMoves: Record<string, { start_time: string; end_time: string }>,
  persistedSessions: Session[],
): Record<string, { start_time: string; end_time: string }> {
  const matchesPersistedInstant = (candidate: string, persisted: string): boolean => {
    const candidateMs = new Date(candidate).getTime();
    const persistedMs = new Date(persisted).getTime();
    if (!Number.isNaN(candidateMs) && !Number.isNaN(persistedMs)) {
      return candidateMs === persistedMs;
    }
    return candidate === persisted;
  };

  let changed = false;
  const next = { ...optimisticSessionMoves };

  for (const [sessionId, optimisticMove] of Object.entries(optimisticSessionMoves)) {
    const persisted = persistedSessions.find((session) => session.id === sessionId);
    if (!persisted) {
      delete next[sessionId];
      changed = true;
      continue;
    }
    if (
      matchesPersistedInstant(optimisticMove.start_time, persisted.start_time) &&
      matchesPersistedInstant(optimisticMove.end_time, persisted.end_time)
    ) {
      delete next[sessionId];
      changed = true;
    }
  }

  return changed ? next : optimisticSessionMoves;
}

export async function mapWithConcurrency<T, R>(
  items: T[],
  worker: (item: T, index: number) => Promise<R>,
  concurrency: number,
): Promise<R[]> {
  const normalizedConcurrency = Math.max(1, Math.floor(concurrency));
  const results: R[] = new Array(items.length);
  let cursor = 0;

  const runWorker = async () => {
    while (cursor < items.length) {
      const currentIndex = cursor;
      cursor += 1;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  };

  const workers = Array.from({ length: Math.min(normalizedConcurrency, items.length) }, () => runWorker());
  await Promise.all(workers);
  return results;
}
