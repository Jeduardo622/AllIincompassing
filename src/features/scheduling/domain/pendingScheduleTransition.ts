import { format, parseISO } from "date-fns";
import { buildPendingScheduleDetailKey } from "./pendingSchedule";

type PendingScheduleTransitionDetail = {
  start_time?: string;
  idempotency_key?: string;
  agent_operation_id?: string;
  trace_request_id?: string;
  trace_correlation_id?: string;
} | null;

type PendingScheduleTransitionPrefill = {
  date: Date;
  time: string;
} | null;

type PendingScheduleTransitionBase = {
  detailKey: string | null;
};

export type PendingScheduleTransition =
  | (PendingScheduleTransitionBase & {
      decision: "noop";
      reason: "null-detail" | "duplicate-detail";
      pendingAgentIdempotencyKey: null;
      pendingAgentOperationId: null;
      pendingTraceRequestId: null;
      pendingTraceCorrelationId: null;
      prefill: null;
    })
  | (PendingScheduleTransitionBase & {
      decision: "apply";
      reason: "apply";
      pendingAgentIdempotencyKey: string | null;
      pendingAgentOperationId: string | null;
      pendingTraceRequestId: string | null;
      pendingTraceCorrelationId: string | null;
      prefill: PendingScheduleTransitionPrefill;
    });

export const planPendingScheduleTransition = (
  detail: PendingScheduleTransitionDetail,
  lastDetailKey: string | null,
): PendingScheduleTransition => {
  if (!detail) {
    return {
      decision: "noop",
      reason: "null-detail",
      detailKey: null,
      pendingAgentIdempotencyKey: null,
      pendingAgentOperationId: null,
      pendingTraceRequestId: null,
      pendingTraceCorrelationId: null,
      prefill: null,
    };
  }

  const detailKey = buildPendingScheduleDetailKey(detail);
  if (lastDetailKey === detailKey) {
    return {
      decision: "noop",
      reason: "duplicate-detail",
      detailKey,
      pendingAgentIdempotencyKey: null,
      pendingAgentOperationId: null,
      pendingTraceRequestId: null,
      pendingTraceCorrelationId: null,
      prefill: null,
    };
  }

  let prefill: PendingScheduleTransitionPrefill = null;
  if (detail.start_time) {
    const date = parseISO(detail.start_time);
    if (!Number.isNaN(date.getTime())) {
      prefill = { date, time: format(date, "HH:mm") };
    }
  }

  return {
    decision: "apply",
    reason: "apply",
    detailKey,
    pendingAgentIdempotencyKey: detail.idempotency_key ?? null,
    pendingAgentOperationId: detail.agent_operation_id ?? null,
    pendingTraceRequestId: detail.trace_request_id ?? null,
    pendingTraceCorrelationId: detail.trace_correlation_id ?? null,
    prefill,
  };
};
