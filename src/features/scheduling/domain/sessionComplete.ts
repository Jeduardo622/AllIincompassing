import { callEdgeFunctionHttp } from "../../../lib/api";
import { toNormalizedApiError } from "../../../lib/sdk/errors";

export type CompleteSessionRequest = {
  sessionId: string;
  outcome: "completed" | "no-show";
  notes?: string | null;
};

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
