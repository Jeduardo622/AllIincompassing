import { planPendingScheduleTransition } from "./pendingScheduleTransition";

export type PendingScheduleTransitionLedgerRow = {
  seq: number;
  kind: "decision" | "ref-checkpoint" | "setter" | "storage";
  name: string;
  payload: unknown;
};

export type PendingScheduleTransitionRecorder = (
  row: Omit<PendingScheduleTransitionLedgerRow, "seq">,
) => void;

export type PendingScheduleApplyDetail = {
  start_time?: string;
  idempotency_key?: string;
  agent_operation_id?: string;
  trace_request_id?: string;
  trace_correlation_id?: string;
} | null;

export type PendingScheduleTransitionSetters<SessionLike = unknown> = {
  setPendingAgentIdempotencyKey: (value: string | null) => void;
  setPendingAgentOperationId: (value: string | null) => void;
  setPendingTraceRequestId: (value: string | null) => void;
  setPendingTraceCorrelationId: (value: string | null) => void;
  setSelectedDate: (value: Date) => void;
  setSelectedTimeSlot: (value: { date: Date; time: string }) => void;
  setSelectedSession: (value: SessionLike | undefined) => void;
  setRetryHint: (value: string | null) => void;
  setIsModalOpen: (value: boolean) => void;
};

export const applyPendingScheduleDetail = <SessionLike = unknown>({
  detail,
  lastDetailKeyRef,
  setters,
  record,
}: {
  detail: PendingScheduleApplyDetail;
  lastDetailKeyRef: { current: string | null };
  setters: PendingScheduleTransitionSetters<SessionLike>;
  record?: PendingScheduleTransitionRecorder;
}) => {
  record?.({
    kind: "ref-checkpoint",
    name: "before",
    payload: lastDetailKeyRef.current,
  });

  const transition = planPendingScheduleTransition(detail, lastDetailKeyRef.current);
  record?.({
    kind: "decision",
    name: transition.decision,
    payload: {
      reason: transition.reason,
      detailKey: transition.detailKey,
    },
  });
  if (transition.decision === "noop") {
    record?.({
      kind: "ref-checkpoint",
      name: "after",
      payload: lastDetailKeyRef.current,
    });
    return transition;
  }

  lastDetailKeyRef.current = transition.detailKey;
  record?.({
    kind: "ref-checkpoint",
    name: "after",
    payload: lastDetailKeyRef.current,
  });

  setters.setPendingAgentIdempotencyKey(transition.pendingAgentIdempotencyKey);
  record?.({
    kind: "setter",
    name: "setPendingAgentIdempotencyKey",
    payload: transition.pendingAgentIdempotencyKey,
  });

  setters.setPendingAgentOperationId(transition.pendingAgentOperationId);
  record?.({
    kind: "setter",
    name: "setPendingAgentOperationId",
    payload: transition.pendingAgentOperationId,
  });

  setters.setPendingTraceRequestId(transition.pendingTraceRequestId);
  record?.({
    kind: "setter",
    name: "setPendingTraceRequestId",
    payload: transition.pendingTraceRequestId,
  });

  setters.setPendingTraceCorrelationId(transition.pendingTraceCorrelationId);
  record?.({
    kind: "setter",
    name: "setPendingTraceCorrelationId",
    payload: transition.pendingTraceCorrelationId,
  });

  if (transition.prefill) {
    setters.setSelectedDate(transition.prefill.date);
    record?.({
      kind: "setter",
      name: "setSelectedDate",
      payload: transition.prefill.date,
    });

    setters.setSelectedTimeSlot({
      date: transition.prefill.date,
      time: transition.prefill.time,
    });
    record?.({
      kind: "setter",
      name: "setSelectedTimeSlot",
      payload: {
        date: transition.prefill.date,
        time: transition.prefill.time,
      },
    });
  }

  setters.setSelectedSession(undefined);
  record?.({
    kind: "setter",
    name: "setSelectedSession",
    payload: undefined,
  });

  setters.setRetryHint(null);
  record?.({
    kind: "setter",
    name: "setRetryHint",
    payload: null,
  });

  setters.setIsModalOpen(true);
  record?.({
    kind: "setter",
    name: "setIsModalOpen",
    payload: true,
  });

  return transition;
};
