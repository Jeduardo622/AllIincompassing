import { fromZonedTime as zonedTimeToUtc } from "date-fns-tz";
import { logger } from "../lib/logger/logger";
import { toError } from "../lib/logger/normalizeError";
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

  if (exceptionIsoValues.length > 0) {
    recurrence.exceptions = exceptionIsoValues;
  }

  return recurrence;
}
