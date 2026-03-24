export type ScheduleResetBranch =
  | { kind: "submit-cancel" }
  | { kind: "create-success" }
  | { kind: "update-success" }
  | { kind: "close-modal" }
  | { kind: "mutation-error"; retryHint: string | null; source: "409" | "non409" };

export type ScheduleResetBranchSetters<SessionLike = unknown> = {
  setIsModalOpen: (value: boolean) => void;
  setSelectedSession: (value: SessionLike | undefined) => void;
  setSelectedTimeSlot: (value: { date: Date; time: string } | undefined) => void;
  setRetryHint: (value: string | null) => void;
  setPendingAgentIdempotencyKey: (value: string | null) => void;
  setPendingAgentOperationId: (value: string | null) => void;
  setPendingTraceRequestId: (value: string | null) => void;
  setPendingTraceCorrelationId: (value: string | null) => void;
};

export type ScheduleResetBranchRecord = (row: {
  branchKind: ScheduleResetBranch["kind"];
  name:
    | "setIsModalOpen"
    | "setSelectedSession"
    | "setSelectedTimeSlot"
    | "setRetryHint"
    | "setPendingAgentIdempotencyKey"
    | "setPendingAgentOperationId"
    | "setPendingTraceRequestId"
    | "setPendingTraceCorrelationId";
  payload: unknown;
}) => void;

export const applyScheduleResetBranch = <SessionLike>(
  branch: ScheduleResetBranch,
  setters: ScheduleResetBranchSetters<SessionLike>,
  record?: ScheduleResetBranchRecord,
) => {
  switch (branch.kind) {
    case "submit-cancel": {
      setters.setIsModalOpen(false);
      record?.({
        branchKind: branch.kind,
        name: "setIsModalOpen",
        payload: false,
      });
      setters.setSelectedSession(undefined);
      record?.({
        branchKind: branch.kind,
        name: "setSelectedSession",
        payload: undefined,
      });
      return;
    }

    case "create-success": {
      setters.setIsModalOpen(false);
      record?.({
        branchKind: branch.kind,
        name: "setIsModalOpen",
        payload: false,
      });
      setters.setSelectedSession(undefined);
      record?.({
        branchKind: branch.kind,
        name: "setSelectedSession",
        payload: undefined,
      });
      setters.setSelectedTimeSlot(undefined);
      record?.({
        branchKind: branch.kind,
        name: "setSelectedTimeSlot",
        payload: undefined,
      });
      setters.setRetryHint(null);
      record?.({
        branchKind: branch.kind,
        name: "setRetryHint",
        payload: null,
      });
      setters.setPendingAgentIdempotencyKey(null);
      record?.({
        branchKind: branch.kind,
        name: "setPendingAgentIdempotencyKey",
        payload: null,
      });
      setters.setPendingAgentOperationId(null);
      record?.({
        branchKind: branch.kind,
        name: "setPendingAgentOperationId",
        payload: null,
      });
      setters.setPendingTraceRequestId(null);
      record?.({
        branchKind: branch.kind,
        name: "setPendingTraceRequestId",
        payload: null,
      });
      setters.setPendingTraceCorrelationId(null);
      record?.({
        branchKind: branch.kind,
        name: "setPendingTraceCorrelationId",
        payload: null,
      });
      return;
    }

    case "update-success": {
      setters.setIsModalOpen(false);
      record?.({
        branchKind: branch.kind,
        name: "setIsModalOpen",
        payload: false,
      });
      setters.setSelectedSession(undefined);
      record?.({
        branchKind: branch.kind,
        name: "setSelectedSession",
        payload: undefined,
      });
      setters.setRetryHint(null);
      record?.({
        branchKind: branch.kind,
        name: "setRetryHint",
        payload: null,
      });
      return;
    }

    case "close-modal": {
      setters.setIsModalOpen(false);
      record?.({
        branchKind: branch.kind,
        name: "setIsModalOpen",
        payload: false,
      });
      setters.setRetryHint(null);
      record?.({
        branchKind: branch.kind,
        name: "setRetryHint",
        payload: null,
      });
      return;
    }

    case "mutation-error": {
      setters.setRetryHint(branch.retryHint);
      record?.({
        branchKind: branch.kind,
        name: "setRetryHint",
        payload: branch.retryHint,
      });
      return;
    }

    default: {
      const _exhaustiveCheck: never = branch;
      return _exhaustiveCheck;
    }
  }
};
