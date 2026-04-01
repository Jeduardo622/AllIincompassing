import { callEdgeFunctionHttp } from "../../../lib/api";
import { toNormalizedApiError } from "../../../lib/sdk/errors";
import { supabase } from "../../../lib/supabase";

export type CompleteSessionRequest = {
  sessionId: string;
  outcome: "completed" | "no-show";
  notes?: string | null;
};

type InProgressSessionCloseReadinessInput = {
  sessionId: string;
  organizationId: string | null;
};

export type InProgressSessionCloseReadiness = {
  ready: boolean;
  requiredGoalIds: string[];
  missingGoalIds: string[];
};

export const IN_PROGRESS_CLOSE_NOT_READY_MESSAGE =
  "You must complete the linked session documentation with per-goal notes before closing this in-progress session. Add per-goal notes in a client session note linked by session_id. Notes entered in this Schedule modal and overall narrative text do not satisfy this requirement.";

export async function checkInProgressSessionCloseReadiness(
  input: InProgressSessionCloseReadinessInput,
): Promise<InProgressSessionCloseReadiness> {
  if (!input.organizationId) {
    return { ready: false, requiredGoalIds: [], missingGoalIds: [] };
  }

  const { data: sessionGoals, error: sessionGoalsError } = await supabase
    .from("session_goals")
    .select("goal_id")
    .eq("session_id", input.sessionId)
    .eq("organization_id", input.organizationId);

  if (sessionGoalsError) {
    throw sessionGoalsError;
  }

  const requiredGoalIds = Array.from(
    new Set(
      (sessionGoals ?? [])
        .map((row) => row.goal_id)
        .filter((goalId): goalId is string => typeof goalId === "string" && goalId.length > 0),
    ),
  );

  if (requiredGoalIds.length === 0) {
    return { ready: true, requiredGoalIds: [], missingGoalIds: [] };
  }

  const { data: noteRows, error: noteRowsError } = await supabase
    .from("client_session_notes")
    .select("goal_notes")
    .eq("session_id", input.sessionId)
    .eq("organization_id", input.organizationId);

  if (noteRowsError) {
    throw noteRowsError;
  }

  const coveredGoalIds = new Set<string>();
  for (const row of noteRows ?? []) {
    const goalNotes = row.goal_notes as Record<string, unknown> | null;
    if (!goalNotes || typeof goalNotes !== "object") {
      continue;
    }
    for (const [goalId, noteText] of Object.entries(goalNotes)) {
      if (typeof noteText === "string" && noteText.trim().length > 0) {
        coveredGoalIds.add(goalId);
      }
    }
  }

  const missingGoalIds = requiredGoalIds.filter((goalId) => !coveredGoalIds.has(goalId));

  return {
    ready: missingGoalIds.length === 0,
    requiredGoalIds,
    missingGoalIds,
  };
}

export async function completeSessionFromModal(
  request: CompleteSessionRequest,
): Promise<void> {
  const response = await callEdgeFunctionHttp("sessions-complete", {
    method: "POST",
    body: JSON.stringify({
      session_id: request.sessionId,
      outcome: request.outcome,
      notes: request.notes ?? null,
    }),
  });

  if (!response.ok) {
    let payload: Record<string, unknown> | null = null;
    try {
      payload = (await response.json()) as Record<string, unknown>;
    } catch {
      payload = null;
    }
    throw toNormalizedApiError(
      payload,
      response.status,
      "Failed to complete session",
    );
  }
}
