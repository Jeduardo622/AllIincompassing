import { callApi } from "../../../lib/api";
import { parseJsonResponse } from "../../../lib/sdk/contracts";
import { toNormalizedApiError } from "../../../lib/sdk/errors";
import {
  sessionsStartSuccessPayloadSchema,
  sessionsStartRequestSchema,
} from "../../../lib/contracts/scheduling";

export type StartSessionRequest = {
  sessionId: string;
  programId: string;
  goalId: string;
  goalIds?: string[];
  startedAt?: string;
};

export async function startSessionFromModal(request: StartSessionRequest): Promise<void> {
  const parsedRequest = sessionsStartRequestSchema.safeParse({
    session_id: request.sessionId,
    program_id: request.programId,
    goal_id: request.goalId,
    goal_ids: request.goalIds ?? [],
    started_at: request.startedAt,
  });
  if (!parsedRequest.success) {
    throw new Error("Invalid session start request");
  }

  const response = await callApi("/api/sessions-start", {
    method: "POST",
    body: JSON.stringify(parsedRequest.data),
  });

  const responseForParsing = response.clone();
  const parsedResponse = await parseJsonResponse(responseForParsing, sessionsStartSuccessPayloadSchema);
  if (!response.ok || !parsedResponse) {
    let fallbackPayload: Record<string, unknown> | null = null;
    try {
      fallbackPayload = await response.json() as Record<string, unknown>;
    } catch {
      fallbackPayload = null;
    }
    throw toNormalizedApiError(
      fallbackPayload,
      response.status,
      "Failed to start session",
    );
  }
}

