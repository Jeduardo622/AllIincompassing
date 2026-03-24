import { describe, expect, it } from "vitest";
import { buildPendingScheduleDetailKey } from "../pendingSchedule";

describe("pendingSchedule", () => {
  it("serializes expected fields in stable order", () => {
    const key = buildPendingScheduleDetailKey({
      start_time: "2026-03-24T12:30:00.000Z",
      idempotency_key: "idempotency-1",
      agent_operation_id: "agent-op-1",
      trace_request_id: "trace-req-1",
      trace_correlation_id: "trace-corr-1",
    });

    expect(key).toBe(
      JSON.stringify({
        start_time: "2026-03-24T12:30:00.000Z",
        idempotency_key: "idempotency-1",
        agent_operation_id: "agent-op-1",
        trace_request_id: "trace-req-1",
        trace_correlation_id: "trace-corr-1",
      }),
    );
  });

  it("normalizes missing fields to null", () => {
    const key = buildPendingScheduleDetailKey({});

    expect(key).toBe(
      JSON.stringify({
        start_time: null,
        idempotency_key: null,
        agent_operation_id: null,
        trace_request_id: null,
        trace_correlation_id: null,
      }),
    );
  });
});
