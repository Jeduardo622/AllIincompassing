import type { Session } from "../../../types";

export type SubmitBranchDecision =
  | {
      kind: "edit-cancel";
      selectedSessionId: string;
      cancellationReason: string | undefined;
    }
  | {
      kind: "edit-complete";
      selectedSessionId: string;
      notes: string | undefined;
    }
  | {
      kind: "edit-no-show";
      selectedSessionId: string;
      notes: string | undefined;
    }
  | {
      kind: "edit-update";
    }
  | {
      kind: "create";
    }
  | {
      kind: "create-blocked";
      blockedStatus: string;
    };

// Statuses that are not valid for new session creation.
// in_progress, completed, and no-show all represent lifecycle states that
// can only be reached from an existing scheduled session.
const CREATE_BLOCKED_STATUSES = new Set<string>(["in_progress", "completed", "no-show"]);

type DecideSubmitBranchInput = {
  selectedSession: Session | undefined;
  data: Partial<Session>;
};

const extractNotes = (data: Partial<Session>): string | undefined =>
  typeof data.notes === "string" && data.notes.trim().length > 0
    ? data.notes.trim()
    : undefined;

export const decideScheduleSubmitBranch = ({
  selectedSession,
  data,
}: DecideSubmitBranchInput): SubmitBranchDecision => {
  if (selectedSession) {
    if (data.status === "cancelled") {
      return {
        kind: "edit-cancel",
        selectedSessionId: selectedSession.id,
        cancellationReason: extractNotes(data),
      };
    }

    if (data.status === "completed") {
      return {
        kind: "edit-complete",
        selectedSessionId: selectedSession.id,
        notes: extractNotes(data),
      };
    }

    if (data.status === "no-show") {
      return {
        kind: "edit-no-show",
        selectedSessionId: selectedSession.id,
        notes: extractNotes(data),
      };
    }

    return { kind: "edit-update" };
  }

  if (data.status && CREATE_BLOCKED_STATUSES.has(data.status)) {
    return { kind: "create-blocked", blockedStatus: data.status };
  }

  return { kind: "create" };
};
