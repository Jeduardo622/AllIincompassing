import { describe, expect, it } from "vitest";
import type { Session } from "../../../../types";
import { decideScheduleSubmitBranch } from "../submitBranchDecision";

const selectedSession = (id: string): Session =>
  ({
    id,
    status: "scheduled",
  }) as Session;

describe("submitBranchDecision", () => {
  it("chooses edit-cancel first when editing and status is cancelled", () => {
    const decision = decideScheduleSubmitBranch({
      selectedSession: selectedSession("session-1"),
      data: {
        status: "cancelled",
        notes: "User requested cancellation",
      },
    });

    expect(decision).toEqual({
      kind: "edit-cancel",
      selectedSessionId: "session-1",
      cancellationReason: "User requested cancellation",
    });
  });

  it("returns undefined cancellation reason when cancelled notes are blank", () => {
    const decision = decideScheduleSubmitBranch({
      selectedSession: selectedSession("session-2"),
      data: {
        status: "cancelled",
        notes: "   ",
      },
    });

    expect(decision).toEqual({
      kind: "edit-cancel",
      selectedSessionId: "session-2",
      cancellationReason: undefined,
    });
  });

  it("returns undefined cancellation reason when cancelled notes are omitted", () => {
    const decision = decideScheduleSubmitBranch({
      selectedSession: selectedSession("session-2b"),
      data: {
        status: "cancelled",
      },
    });

    expect(decision).toEqual({
      kind: "edit-cancel",
      selectedSessionId: "session-2b",
      cancellationReason: undefined,
    });
  });

  it("returns undefined cancellation reason when cancelled notes are empty", () => {
    const decision = decideScheduleSubmitBranch({
      selectedSession: selectedSession("session-2c"),
      data: {
        status: "cancelled",
        notes: "",
      },
    });

    expect(decision).toEqual({
      kind: "edit-cancel",
      selectedSessionId: "session-2c",
      cancellationReason: undefined,
    });
  });

  it("chooses edit-update when editing and not cancelling", () => {
    const decision = decideScheduleSubmitBranch({
      selectedSession: selectedSession("session-3"),
      data: {
        status: "scheduled",
      },
    });

    expect(decision).toEqual({
      kind: "edit-update",
    });
  });

  it("chooses create when not editing", () => {
    const decision = decideScheduleSubmitBranch({
      selectedSession: undefined,
      data: {
        status: "cancelled",
      },
    });

    expect(decision).toEqual({
      kind: "create",
    });
  });
});
