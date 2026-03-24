import { describe, expect, it, vi } from "vitest";
import {
  applyPendingScheduleDetail,
  consumePendingScheduleFromStorage,
  createOpenScheduleModalHandler,
  type PendingScheduleTransitionRecorder,
} from "../Schedule";
import type { PendingScheduleDetail } from "../schedule-utils";

type LedgerRow = {
  seq: number;
  kind: "decision" | "ref-checkpoint" | "setter" | "storage";
  name: string;
  payload: unknown;
};

const createLedger = () => {
  const rows: LedgerRow[] = [];
  let seq = 0;
  const record: PendingScheduleTransitionRecorder = (row) => {
    seq += 1;
    rows.push({
      seq,
      ...row,
    });
  };

  return { rows, record };
};

const createSetterSpies = () => {
  return {
    setPendingAgentIdempotencyKey: vi.fn(),
    setPendingAgentOperationId: vi.fn(),
    setPendingTraceRequestId: vi.fn(),
    setPendingTraceCorrelationId: vi.fn(),
    setSelectedDate: vi.fn(),
    setSelectedTimeSlot: vi.fn(),
    setSelectedSession: vi.fn(),
    setRetryHint: vi.fn(),
    setIsModalOpen: vi.fn(),
  };
};

const collectSetterNames = (rows: LedgerRow[]) =>
  rows
    .filter((row) => row.kind === "setter")
    .map((row) => row.name);

describe("Schedule openFromPendingSchedule transition mechanics", () => {
  it("null detail is noop with zero setter rows", () => {
    const setters = createSetterSpies();
    const { rows, record } = createLedger();
    const lastDetailKeyRef = { current: null as string | null };

    const transition = applyPendingScheduleDetail({
      detail: null,
      lastDetailKeyRef,
      setters,
      record,
    });

    expect(transition.decision).toBe("noop");
    expect(transition.reason).toBe("null-detail");
    expect(lastDetailKeyRef.current).toBeNull();
    expect(rows.filter((row) => row.kind === "setter")).toHaveLength(0);
    expect(rows.map((row) => `${row.kind}:${row.name}`)).toEqual([
      "ref-checkpoint:before",
      "decision:noop",
      "ref-checkpoint:after",
    ]);
  });

  it("duplicate detail is noop on second invocation", () => {
    const detail: PendingScheduleDetail = {
      start_time: "2025-03-18T10:00:00Z",
      idempotency_key: "idem-1",
      agent_operation_id: "op-1",
      trace_request_id: "req-1",
      trace_correlation_id: "corr-1",
    };

    const setters = createSetterSpies();
    const firstLedger = createLedger();
    const secondLedger = createLedger();
    const lastDetailKeyRef = { current: null as string | null };

    const first = applyPendingScheduleDetail({
      detail,
      lastDetailKeyRef,
      setters,
      record: firstLedger.record,
    });
    const firstKey = lastDetailKeyRef.current;

    const second = applyPendingScheduleDetail({
      detail,
      lastDetailKeyRef,
      setters,
      record: secondLedger.record,
    });

    expect(first.decision).toBe("apply");
    expect(firstKey).toBe(first.detailKey);
    expect(second.decision).toBe("noop");
    expect(second.reason).toBe("duplicate-detail");
    expect(secondLedger.rows.filter((row) => row.kind === "setter")).toHaveLength(0);
    expect(lastDetailKeyRef.current).toBe(firstKey);
  });

  it("invalid start_time applies without date/time prefill setters", () => {
    const detail: PendingScheduleDetail = {
      start_time: "not-a-date",
      idempotency_key: "idem-2",
      agent_operation_id: "op-2",
      trace_request_id: "req-2",
      trace_correlation_id: "corr-2",
    };

    const setters = createSetterSpies();
    const { rows, record } = createLedger();
    const lastDetailKeyRef = { current: null as string | null };

    const transition = applyPendingScheduleDetail({
      detail,
      lastDetailKeyRef,
      setters,
      record,
    });

    expect(transition.decision).toBe("apply");

    const setterNames = collectSetterNames(rows);
    expect(setterNames).toEqual([
      "setPendingAgentIdempotencyKey",
      "setPendingAgentOperationId",
      "setPendingTraceRequestId",
      "setPendingTraceCorrelationId",
      "setSelectedSession",
      "setRetryHint",
      "setIsModalOpen",
    ]);
    expect(setterNames).not.toContain("setSelectedDate");
    expect(setterNames).not.toContain("setSelectedTimeSlot");

    const refAfter = rows.find((row) => row.kind === "ref-checkpoint" && row.name === "after");
    const firstSetter = rows.find((row) => row.kind === "setter");
    expect(refAfter).toBeDefined();
    expect(firstSetter).toBeDefined();
    expect((refAfter?.seq ?? 0) < (firstSetter?.seq ?? 0)).toBe(true);
  });

  it("valid start_time applies with date/time prefill and strict setter order", () => {
    const detail: PendingScheduleDetail = {
      start_time: "2025-03-18T10:00:00Z",
      idempotency_key: "idem-3",
      agent_operation_id: "op-3",
      trace_request_id: "req-3",
      trace_correlation_id: "corr-3",
    };

    const setters = createSetterSpies();
    const { rows, record } = createLedger();
    const lastDetailKeyRef = { current: null as string | null };

    const transition = applyPendingScheduleDetail({
      detail,
      lastDetailKeyRef,
      setters,
      record,
    });

    expect(transition.decision).toBe("apply");
    expect(collectSetterNames(rows)).toEqual([
      "setPendingAgentIdempotencyKey",
      "setPendingAgentOperationId",
      "setPendingTraceRequestId",
      "setPendingTraceCorrelationId",
      "setSelectedDate",
      "setSelectedTimeSlot",
      "setSelectedSession",
      "setRetryHint",
      "setIsModalOpen",
    ]);
  });

  it("consume path removes storage on parse failure and forwards null detail", () => {
    const storage = {
      getItem: vi.fn().mockReturnValue("{invalid-json"),
      removeItem: vi.fn(),
    };
    const openFromPendingSchedule = vi.fn();
    const { rows, record } = createLedger();

    consumePendingScheduleFromStorage({
      storage,
      openFromPendingSchedule,
      record,
    });

    expect(rows.map((row) => `${row.kind}:${row.name}`)).toEqual([
      "storage:getItem",
      "storage:removeItem",
    ]);
    expect(openFromPendingSchedule).toHaveBeenCalledWith(null);
  });

  it("consume path noops when pendingSchedule is missing", () => {
    const storage = {
      getItem: vi.fn().mockReturnValue(null),
      removeItem: vi.fn(),
    };
    const openFromPendingSchedule = vi.fn();
    const { rows, record } = createLedger();

    consumePendingScheduleFromStorage({
      storage,
      openFromPendingSchedule,
      record,
    });

    expect(rows.map((row) => `${row.kind}:${row.name}`)).toEqual([
      "storage:getItem",
    ]);
    expect(storage.removeItem).not.toHaveBeenCalled();
    expect(openFromPendingSchedule).not.toHaveBeenCalled();
  });

  it("consume path removes storage on parse success and forwards normalized detail", () => {
    const storage = {
      getItem: vi
        .fn()
        .mockReturnValue(
          JSON.stringify({ idempotency_key: "idem-4", start_time: "2025-03-18T10:00:00Z" }),
        ),
      removeItem: vi.fn(),
    };
    const openFromPendingSchedule = vi.fn();
    const { rows, record } = createLedger();

    consumePendingScheduleFromStorage({
      storage,
      openFromPendingSchedule,
      record,
    });

    expect(rows.map((row) => `${row.kind}:${row.name}`)).toEqual([
      "storage:getItem",
      "storage:removeItem",
    ]);
    expect(openFromPendingSchedule).toHaveBeenCalledWith({
      idempotency_key: "idem-4",
      start_time: "2025-03-18T10:00:00Z",
      agent_operation_id: undefined,
      trace_request_id: undefined,
      trace_correlation_id: undefined,
    });
  });

  it("listener handler normalizes detail before forwarding", () => {
    const openFromPendingSchedule = vi.fn();
    const handler = createOpenScheduleModalHandler(openFromPendingSchedule);

    handler(new CustomEvent("openScheduleModal", { detail: { start_time: 123 } }));
    expect(openFromPendingSchedule).toHaveBeenCalledWith(null);
  });
});
