import { buildSchedulingConflictHint } from "../../../lib/conflictPolicy";
import { toError } from "../../../lib/logger/normalizeError";
import {
  planScheduleMutationLifecycle,
  type ScheduleMutationLifecycleErrorPlan,
} from "./mutationLifecyclePlan";

const DEFAULT_ERROR_MESSAGE = "Schedule mutation failed";
const DEFAULT_CONFLICT_HINT =
  "The selected time slot was just booked. Refresh the schedule or choose a different time.";

type AdaptScheduleMutationErrorResult = {
  normalized: Error;
  lifecyclePlan: ScheduleMutationLifecycleErrorPlan;
  userMessage: string | Error;
  conflictLogMetadata: { hint: string | null; error: string } | null;
};

export const adaptScheduleMutationError = (
  error: unknown,
): AdaptScheduleMutationErrorResult => {
  const normalized = toError(error, DEFAULT_ERROR_MESSAGE);
  const status =
    typeof (error as { status?: number } | null | undefined)?.status === "number"
      ? (error as { status?: number }).status
      : undefined;

  const conflictHint =
    status === 409 ? buildSchedulingConflictHint(error, DEFAULT_CONFLICT_HINT) : null;

  const lifecyclePlan = planScheduleMutationLifecycle({
    kind: "mutation-error",
    status,
    retryHint: conflictHint,
  });

  if (lifecyclePlan.errorKind === "conflict") {
    return {
      normalized,
      lifecyclePlan,
      userMessage: `${normalized.message}. ${lifecyclePlan.resetBranch.retryHint}`,
      conflictLogMetadata: {
        hint: lifecyclePlan.resetBranch.retryHint,
        error: normalized.message,
      },
    };
  }

  return {
    normalized,
    lifecyclePlan,
    userMessage: normalized,
    conflictLogMetadata: null,
  };
};
