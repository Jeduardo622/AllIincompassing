import { callEdge } from "./supabase";

export interface CancelSessionsPayload {
  sessionIds?: string[];
  date?: string;
  therapistId?: string;
  reason?: string | null;
  idempotencyKey?: string;
  agentOperationId?: string;
}

export interface CancelSessionsResult {
  cancelledCount: number;
  alreadyCancelledCount: number;
  totalCount: number;
  cancelledSessionIds: string[];
  alreadyCancelledSessionIds: string[];
  idempotencyKey: string;
}

function createIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (typeof item === "string") return item;
      if (typeof item === "number" || typeof item === "bigint") return String(item);
      return "";
    })
    .filter((item): item is string => item.length > 0);
}

export async function cancelSessions(payload: CancelSessionsPayload): Promise<CancelSessionsResult> {
  if ((!payload.sessionIds || payload.sessionIds.length === 0) && !payload.date) {
    throw new Error("Must provide a session id list or date to cancel sessions");
  }

  const idempotencyKey = (payload.idempotencyKey ?? createIdempotencyKey()).trim();
  const headers = new Headers({ "Content-Type": "application/json" });
  if (idempotencyKey.length > 0) {
    headers.set("Idempotency-Key", idempotencyKey);
  }

  const body: Record<string, unknown> = {};
  if (payload.sessionIds && payload.sessionIds.length > 0) {
    body.session_ids = payload.sessionIds;
  }
  if (payload.date) {
    body.date = payload.date;
  }
  if (payload.therapistId) {
    body.therapist_id = payload.therapistId;
  }
  if (payload.reason !== undefined) {
    body.reason = payload.reason;
  }
  if (payload.agentOperationId) {
    body.agent_operation_id = payload.agentOperationId;
  }

  const response = await callEdge("sessions-cancel", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  let responseBody: Record<string, unknown> | null = null;
  try {
    responseBody = (await response.json()) as Record<string, unknown>;
  } catch (error) {
    console.error("Failed to parse sessions-cancel response", error);
  }

  if (!responseBody || responseBody.success !== true || !response.ok) {
    const errorMessage = typeof responseBody?.error === "string"
      ? responseBody.error
      : "Failed to cancel sessions";
    throw new Error(errorMessage);
  }

  const data = (responseBody.data ?? {}) as Record<string, unknown>;

  const cancelledCount = typeof data.cancelledCount === "number"
    ? data.cancelledCount
    : Number(data.cancelled_count ?? 0);
  const alreadyCancelledCount = typeof data.alreadyCancelledCount === "number"
    ? data.alreadyCancelledCount
    : Number(data.already_cancelled_count ?? 0);
  const totalCount = typeof data.totalCount === "number"
    ? data.totalCount
    : Number(data.total_count ?? cancelledCount + alreadyCancelledCount);

  const cancelledSessionIds = normalizeStringArray(
    data.cancelledSessionIds ?? data.cancelled_session_ids,
  );
  const alreadyCancelledSessionIds = normalizeStringArray(
    data.alreadyCancelledSessionIds ?? data.already_cancelled_session_ids,
  );

  const usedKey = response.headers.get("Idempotency-Key")?.trim() || idempotencyKey;

  return {
    cancelledCount: Number.isNaN(cancelledCount) ? 0 : cancelledCount,
    alreadyCancelledCount: Number.isNaN(alreadyCancelledCount) ? 0 : alreadyCancelledCount,
    totalCount: Number.isNaN(totalCount) ? cancelledCount + alreadyCancelledCount : totalCount,
    cancelledSessionIds,
    alreadyCancelledSessionIds,
    idempotencyKey: usedKey,
  };
}
