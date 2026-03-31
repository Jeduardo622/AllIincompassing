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

  it("chooses edit-update when editing an in_progress session (no dedicated terminal path exists yet)", () => {
    // in_progress → in_progress is a same-to-same transition allowed by enforce_session_status_transition.
    // The booking pipeline safely preserves the status without triggering a forbidden transition.
    const decision = decideScheduleSubmitBranch({
      selectedSession: selectedSession("session-4"),
      data: {
        status: "in_progress",
      },
    });

    expect(decision).toEqual({
      kind: "edit-update",
    });
  });

  it("chooses edit-complete when editing and status is completed", () => {
    const decision = decideScheduleSubmitBranch({
      selectedSession: selectedSession("session-5"),
      data: {
        status: "completed",
        notes: "Session went well",
      },
    });

    expect(decision).toEqual({
      kind: "edit-complete",
      selectedSessionId: "session-5",
      notes: "Session went well",
    });
  });

  it("returns undefined notes for edit-complete when notes are blank", () => {
    const decision = decideScheduleSubmitBranch({
      selectedSession: selectedSession("session-6"),
      data: {
        status: "completed",
        notes: "   ",
      },
    });

    expect(decision).toEqual({
      kind: "edit-complete",
      selectedSessionId: "session-6",
      notes: undefined,
    });
  });

  it("returns undefined notes for edit-complete when notes are omitted", () => {
    const decision = decideScheduleSubmitBranch({
      selectedSession: selectedSession("session-6b"),
      data: {
        status: "completed",
      },
    });

    expect(decision).toEqual({
      kind: "edit-complete",
      selectedSessionId: "session-6b",
      notes: undefined,
    });
  });

  it("chooses edit-no-show when editing and status is no-show", () => {
    const decision = decideScheduleSubmitBranch({
      selectedSession: selectedSession("session-7"),
      data: {
        status: "no-show",
        notes: "Client did not arrive",
      },
    });

    expect(decision).toEqual({
      kind: "edit-no-show",
      selectedSessionId: "session-7",
      notes: "Client did not arrive",
    });
  });

  it("returns undefined notes for edit-no-show when notes are blank", () => {
    const decision = decideScheduleSubmitBranch({
      selectedSession: selectedSession("session-8"),
      data: {
        status: "no-show",
        notes: "",
      },
    });

    expect(decision).toEqual({
      kind: "edit-no-show",
      selectedSessionId: "session-8",
      notes: undefined,
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

  it("blocks create when status is completed (create-blocked)", () => {
    const decision = decideScheduleSubmitBranch({
      selectedSession: undefined,
      data: {
        status: "completed",
      },
    });

    expect(decision).toEqual({
      kind: "create-blocked",
      blockedStatus: "completed",
    });
  });

  it("blocks create when status is no-show (create-blocked)", () => {
    const decision = decideScheduleSubmitBranch({
      selectedSession: undefined,
      data: {
        status: "no-show",
      },
    });

    expect(decision).toEqual({
      kind: "create-blocked",
      blockedStatus: "no-show",
    });
  });

  it("blocks create when status is in_progress (create-blocked)", () => {
    const decision = decideScheduleSubmitBranch({
      selectedSession: undefined,
      data: {
        status: "in_progress",
      },
    });

    expect(decision).toEqual({
      kind: "create-blocked",
      blockedStatus: "in_progress",
    });
  });

  it("still allows create when status is scheduled", () => {
    const decision = decideScheduleSubmitBranch({
      selectedSession: undefined,
      data: {
        status: "scheduled",
      },
    });

    expect(decision).toEqual({ kind: "create" });
  });

  it("still allows create when status is cancelled", () => {
    const decision = decideScheduleSubmitBranch({
      selectedSession: undefined,
      data: {
        status: "cancelled",
      },
    });

    expect(decision).toEqual({ kind: "create" });
  });

  it("edit-complete is unaffected (edit mode still routes correctly)", () => {
    const decision = decideScheduleSubmitBranch({
      selectedSession: selectedSession("session-edit"),
      data: { status: "completed", notes: "done" },
    });

    expect(decision).toEqual({
      kind: "edit-complete",
      selectedSessionId: "session-edit",
      notes: "done",
    });
  });

  it("edit-no-show is unaffected (edit mode still routes correctly)", () => {
    const decision = decideScheduleSubmitBranch({
      selectedSession: selectedSession("session-edit-2"),
      data: { status: "no-show" },
    });

    expect(decision).toEqual({
      kind: "edit-no-show",
      selectedSessionId: "session-edit-2",
      notes: undefined,
    });
  });
});
