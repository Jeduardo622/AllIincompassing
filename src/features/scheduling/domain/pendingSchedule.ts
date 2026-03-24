type PendingScheduleDetailKeySource = {
  start_time?: string;
  idempotency_key?: string;
  agent_operation_id?: string;
  trace_request_id?: string;
  trace_correlation_id?: string;
};

export const buildPendingScheduleDetailKey = (
  detail: PendingScheduleDetailKeySource,
): string => {
  return JSON.stringify({
    start_time: detail.start_time ?? null,
    idempotency_key: detail.idempotency_key ?? null,
    agent_operation_id: detail.agent_operation_id ?? null,
    trace_request_id: detail.trace_request_id ?? null,
    trace_correlation_id: detail.trace_correlation_id ?? null,
  });
};
