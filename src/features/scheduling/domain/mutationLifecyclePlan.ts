type ScheduleMutationLifecycleInvalidateKey = "sessions" | "sessions-batch";

type ScheduleMutationLifecycleSuccessEvent =
  | { kind: "create-success" }
  | { kind: "update-success" };

type ScheduleMutationLifecycleErrorEvent = {
  kind: "mutation-error";
  status: number | undefined;
  retryHint: string | null;
};

type ScheduleMutationLifecycleEvent =
  | ScheduleMutationLifecycleSuccessEvent
  | ScheduleMutationLifecycleErrorEvent;

export type ScheduleMutationLifecycleSuccessPlan = {
  phase: "success";
  invalidateQueryKeys: ScheduleMutationLifecycleInvalidateKey[];
  resetBranch: { kind: "create-success" } | { kind: "update-success" };
};

export type ScheduleMutationLifecycleErrorPlan = {
  phase: "error";
  errorKind: "conflict" | "non-conflict";
  resetBranch: {
    kind: "mutation-error";
    retryHint: string | null;
    source: "409" | "non409";
  };
};

export type ScheduleMutationLifecyclePlan =
  | ScheduleMutationLifecycleSuccessPlan
  | ScheduleMutationLifecycleErrorPlan;

export function planScheduleMutationLifecycle(
  event: ScheduleMutationLifecycleSuccessEvent,
): ScheduleMutationLifecycleSuccessPlan;
export function planScheduleMutationLifecycle(
  event: ScheduleMutationLifecycleErrorEvent,
): ScheduleMutationLifecycleErrorPlan;

export function planScheduleMutationLifecycle(
  event: ScheduleMutationLifecycleEvent,
): ScheduleMutationLifecyclePlan {
  switch (event.kind) {
    case "create-success": {
      return {
        phase: "success",
        invalidateQueryKeys: ["sessions", "sessions-batch"],
        resetBranch: { kind: "create-success" },
      };
    }
    case "update-success": {
      return {
        phase: "success",
        invalidateQueryKeys: ["sessions", "sessions-batch"],
        resetBranch: { kind: "update-success" },
      };
    }
    case "mutation-error": {
      if (event.status === 409) {
        return {
          phase: "error",
          errorKind: "conflict",
          resetBranch: {
            kind: "mutation-error",
            retryHint: event.retryHint,
            source: "409",
          },
        };
      }
      return {
        phase: "error",
        errorKind: "non-conflict",
        resetBranch: {
          kind: "mutation-error",
          retryHint: null,
          source: "non409",
        },
      };
    }
    default: {
      const _exhaustiveCheck: never = event;
      return _exhaustiveCheck;
    }
  }
}
