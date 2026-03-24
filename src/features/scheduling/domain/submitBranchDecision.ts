import type { Session } from "../../../types";

export type SubmitBranchDecision =
  | {
      kind: "edit-cancel";
      selectedSessionId: string;
      cancellationReason: string | undefined;
    }
  | {
      kind: "edit-update";
    }
  | {
      kind: "create";
    };

type DecideSubmitBranchInput = {
  selectedSession: Session | undefined;
  data: Partial<Session>;
};

export const decideScheduleSubmitBranch = ({
  selectedSession,
  data,
}: DecideSubmitBranchInput): SubmitBranchDecision => {
  if (selectedSession) {
    if (data.status === "cancelled") {
      return {
        kind: "edit-cancel",
        selectedSessionId: selectedSession.id,
        cancellationReason:
          typeof data.notes === "string" && data.notes.trim().length > 0
            ? data.notes
            : undefined,
      };
    }

    return { kind: "edit-update" };
  }

  return { kind: "create" };
};
