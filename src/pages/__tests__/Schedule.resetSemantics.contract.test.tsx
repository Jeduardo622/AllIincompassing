import { describe, expect, it, vi } from "vitest";
import {
  applyScheduleResetBranch,
  type ScheduleResetBranch,
  type ScheduleResetBranchRecord,
} from "../../features/scheduling/domain/scheduleResetBranch";

type SetterName =
  | "setIsModalOpen"
  | "setSelectedSession"
  | "setSelectedTimeSlot"
  | "setRetryHint"
  | "setPendingAgentIdempotencyKey"
  | "setPendingAgentOperationId"
  | "setPendingTraceRequestId"
  | "setPendingTraceCorrelationId";

type LedgerRow = {
  seq: number;
  branchKind: ScheduleResetBranch["kind"];
  name: SetterName;
  payload: unknown;
};

const createSetterSpies = () => ({
  setIsModalOpen: vi.fn(),
  setSelectedSession: vi.fn(),
  setSelectedTimeSlot: vi.fn(),
  setRetryHint: vi.fn(),
  setPendingAgentIdempotencyKey: vi.fn(),
  setPendingAgentOperationId: vi.fn(),
  setPendingTraceRequestId: vi.fn(),
  setPendingTraceCorrelationId: vi.fn(),
});

const createLedger = () => {
  const rows: LedgerRow[] = [];
  let seq = 0;
  const record: ScheduleResetBranchRecord = (row) => {
    seq += 1;
    rows.push({
      seq,
      ...row,
    });
  };

  return { rows, record };
};

const runBranch = (branch: ScheduleResetBranch) => {
  const setters = createSetterSpies();
  const { rows, record } = createLedger();
  applyScheduleResetBranch(branch, setters, record);
  return { setters, rows };
};

const toNames = (rows: LedgerRow[]) => rows.map((row) => row.name);

const touchedNames = (rows: LedgerRow[]) => new Set(toNames(rows));

describe("Schedule reset semantics contract", () => {
  it("A3: submit-cancel resets only modal + selectedSession in exact order", () => {
    const { setters, rows } = runBranch({ kind: "submit-cancel" });

    expect(toNames(rows)).toEqual(["setIsModalOpen", "setSelectedSession"]);
    expect(setters.setIsModalOpen).toHaveBeenCalledWith(false);
    expect(setters.setSelectedSession).toHaveBeenCalledWith(undefined);
    expect(setters.setSelectedTimeSlot).not.toHaveBeenCalled();
    expect(setters.setRetryHint).not.toHaveBeenCalled();
    expect(setters.setPendingAgentIdempotencyKey).not.toHaveBeenCalled();
    expect(setters.setPendingAgentOperationId).not.toHaveBeenCalled();
    expect(setters.setPendingTraceRequestId).not.toHaveBeenCalled();
    expect(setters.setPendingTraceCorrelationId).not.toHaveBeenCalled();
  });

  it("A1/A2/A7: create-success resets exact eight-set sequence", () => {
    const { setters, rows } = runBranch({ kind: "create-success" });

    expect(toNames(rows)).toEqual([
      "setIsModalOpen",
      "setSelectedSession",
      "setSelectedTimeSlot",
      "setRetryHint",
      "setPendingAgentIdempotencyKey",
      "setPendingAgentOperationId",
      "setPendingTraceRequestId",
      "setPendingTraceCorrelationId",
    ]);
    expect(setters.setIsModalOpen).toHaveBeenCalledWith(false);
    expect(setters.setSelectedSession).toHaveBeenCalledWith(undefined);
    expect(setters.setSelectedTimeSlot).toHaveBeenCalledWith(undefined);
    expect(setters.setRetryHint).toHaveBeenCalledWith(null);
    expect(setters.setPendingAgentIdempotencyKey).toHaveBeenCalledWith(null);
    expect(setters.setPendingAgentOperationId).toHaveBeenCalledWith(null);
    expect(setters.setPendingTraceRequestId).toHaveBeenCalledWith(null);
    expect(setters.setPendingTraceCorrelationId).toHaveBeenCalledWith(null);
  });

  it("A4: update-success resets only modal + selectedSession + retry in exact order", () => {
    const { setters, rows } = runBranch({ kind: "update-success" });

    expect(toNames(rows)).toEqual([
      "setIsModalOpen",
      "setSelectedSession",
      "setRetryHint",
    ]);
    expect(setters.setIsModalOpen).toHaveBeenCalledWith(false);
    expect(setters.setSelectedSession).toHaveBeenCalledWith(undefined);
    expect(setters.setRetryHint).toHaveBeenCalledWith(null);
    expect(setters.setSelectedTimeSlot).not.toHaveBeenCalled();
    expect(setters.setPendingAgentIdempotencyKey).not.toHaveBeenCalled();
    expect(setters.setPendingAgentOperationId).not.toHaveBeenCalled();
    expect(setters.setPendingTraceRequestId).not.toHaveBeenCalled();
    expect(setters.setPendingTraceCorrelationId).not.toHaveBeenCalled();
  });

  it("A5: close-modal resets only modal + retry in exact order", () => {
    const { setters, rows } = runBranch({ kind: "close-modal" });

    expect(toNames(rows)).toEqual(["setIsModalOpen", "setRetryHint"]);
    expect(setters.setIsModalOpen).toHaveBeenCalledWith(false);
    expect(setters.setRetryHint).toHaveBeenCalledWith(null);
    expect(setters.setSelectedSession).not.toHaveBeenCalled();
    expect(setters.setSelectedTimeSlot).not.toHaveBeenCalled();
    expect(setters.setPendingAgentIdempotencyKey).not.toHaveBeenCalled();
    expect(setters.setPendingAgentOperationId).not.toHaveBeenCalled();
    expect(setters.setPendingTraceRequestId).not.toHaveBeenCalled();
    expect(setters.setPendingTraceCorrelationId).not.toHaveBeenCalled();
  });

  it("A6: mutation-error touches only retryHint for 409 and non409", () => {
    const conflict = runBranch({
      kind: "mutation-error",
      retryHint: "conflict-hint",
      source: "409",
    });
    const other = runBranch({
      kind: "mutation-error",
      retryHint: null,
      source: "non409",
    });

    expect(toNames(conflict.rows)).toEqual(["setRetryHint"]);
    expect(toNames(other.rows)).toEqual(["setRetryHint"]);
    expect(conflict.setters.setRetryHint).toHaveBeenCalledWith("conflict-hint");
    expect(other.setters.setRetryHint).toHaveBeenCalledWith(null);

    for (const setters of [conflict.setters, other.setters]) {
      expect(setters.setIsModalOpen).not.toHaveBeenCalled();
      expect(setters.setSelectedSession).not.toHaveBeenCalled();
      expect(setters.setSelectedTimeSlot).not.toHaveBeenCalled();
      expect(setters.setPendingAgentIdempotencyKey).not.toHaveBeenCalled();
      expect(setters.setPendingAgentOperationId).not.toHaveBeenCalled();
      expect(setters.setPendingTraceRequestId).not.toHaveBeenCalled();
      expect(setters.setPendingTraceCorrelationId).not.toHaveBeenCalled();
    }
  });

  it("A8: branch reset sets remain intentionally distinct", () => {
    const branches: ScheduleResetBranch[] = [
      { kind: "submit-cancel" },
      { kind: "create-success" },
      { kind: "update-success" },
      { kind: "close-modal" },
      { kind: "mutation-error", retryHint: "conflict-hint", source: "409" },
    ];

    const signatures = branches.map((branch) => {
      const { rows } = runBranch(branch);
      return JSON.stringify(Array.from(touchedNames(rows)).sort());
    });

    expect(new Set(signatures).size).toBe(signatures.length);
  });
});
