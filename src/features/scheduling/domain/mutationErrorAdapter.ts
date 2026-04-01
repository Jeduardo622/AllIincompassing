import { buildSchedulingConflictHint } from "../../../lib/conflictPolicy";
import { toError } from "../../../lib/logger/normalizeError";
import {
  planScheduleMutationLifecycle,
  type ScheduleMutationLifecycleErrorPlan,
} from "./mutationLifecyclePlan";

const DEFAULT_ERROR_MESSAGE = "Schedule mutation failed";
const DEFAULT_CONFLICT_HINT =
  "The selected time slot was just booked. Refresh the schedule or choose a different time.";

// Error codes that carry a self-contained, action-oriented backend message.
// For these codes the generic scheduling conflict hint is misleading and should
// be suppressed — the backend message alone is the best user-facing copy.
const SELF_DESCRIBING_409_CODES = new Set(["SESSION_NOTES_REQUIRED"]);

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
  const code =
    typeof (error as { code?: string } | null | undefined)?.code === "string"
      ? (error as { code?: string }).code
      : undefined;

  const conflictHint =
    status === 409 ? buildSchedulingConflictHint(error, DEFAULT_CONFLICT_HINT) : null;

  const lifecyclePlan = planScheduleMutationLifecycle({
    kind: "mutation-error",
    status,
    retryHint: conflictHint,
  });

  if (lifecyclePlan.errorKind === "conflict") {
    // Some 409 codes carry a complete, action-oriented backend message.
    // Appending the generic slot-booking hint would be misleading for those
    // errors, so the backend message is used as-is.
    const isSelfDescribing = typeof code === "string" && SELF_DESCRIBING_409_CODES.has(code);

    return {
      normalized,
      lifecyclePlan,
      userMessage: isSelfDescribing
        ? normalized.message
        : `${normalized.message}. ${lifecyclePlan.resetBranch.retryHint}`,
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
