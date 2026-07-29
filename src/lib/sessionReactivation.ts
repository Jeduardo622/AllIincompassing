import { callEdge } from "./supabase";

export type ReactivateSessionResult =
  | {
    outcome: "reactivated" | "already_reactivated";
    sessionId: string;
    idempotencyKey: string;
  }
  | {
    outcome: "conflict";
    code: ReactivationConflictCode;
    message: string;
    idempotencyKey: string;
  };

type ReactivationConflictCode = "THERAPIST_CONFLICT" | "CLIENT_CONFLICT" | "HOLD_CONFLICT";

function createIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function reactivateSession(input: {
  sessionId: string;
  idempotencyKey?: string;
  startTime?: string;
  endTime?: string;
}): Promise<ReactivateSessionResult> {
  const hasStartTime = typeof input.startTime === "string" && input.startTime.length > 0;
  const hasEndTime = typeof input.endTime === "string" && input.endTime.length > 0;
  if (hasStartTime !== hasEndTime) {
    throw new Error("startTime and endTime must be provided together");
  }

  const idempotencyKey = (input.idempotencyKey ?? createIdempotencyKey()).trim();
  const headers = new Headers({ "Content-Type": "application/json" });
  if (idempotencyKey.length > 0) {
    headers.set("Idempotency-Key", idempotencyKey);
  }

  const body: Record<string, string> = { session_id: input.sessionId };
  if (hasStartTime && hasEndTime) {
    body.start_time = input.startTime!;
    body.end_time = input.endTime!;
  }

  const response = await callEdge("sessions-reactivate", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const responseBody = await response.json().catch(() => null) as Record<string, unknown> | null;
  const usedKey = response.headers.get("Idempotency-Key")?.trim() || idempotencyKey;

  if (response.ok && responseBody?.success === true) {
    const data = responseBody.data as Record<string, unknown> | undefined;
    const outcome = data?.outcome === "already_reactivated" ? "already_reactivated" : "reactivated";
    const sessionId = typeof data?.sessionId === "string" ? data.sessionId : input.sessionId;
    return {
      outcome,
      sessionId,
      idempotencyKey: usedKey,
    };
  }

  const code = typeof responseBody?.code === "string" ? responseBody.code : "";
  const message = typeof responseBody?.error === "string"
    ? responseBody.error
    : "Failed to reactivate appointment";

  if (code === "THERAPIST_CONFLICT" || code === "CLIENT_CONFLICT" || code === "HOLD_CONFLICT") {
    return {
      outcome: "conflict",
      code,
      message,
      idempotencyKey: usedKey,
    };
  }

  throw new Error(message);
}
