import { z } from "zod";
import { CORS_HEADERS, fetchJson, getAccessToken, getSupabaseConfig, json, resolveOrgAndRole } from "./shared";

const startSessionSchema = z.object({
  session_id: z.string().uuid(),
  program_id: z.string().uuid(),
  goal_id: z.string().uuid(),
  goal_ids: z.array(z.string().uuid()).optional(),
  started_at: z.string().optional(),
});

function decodeJwtSubject(accessToken: string): string | null {
  const [, payload] = accessToken.split(".");
  if (!payload) {
    return null;
  }

  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const parsed = JSON.parse(atob(padded)) as { sub?: unknown };
    return typeof parsed.sub === "string" && parsed.sub.length > 0 ? parsed.sub : null;
  } catch {
    return null;
  }
}

export async function sessionsStartHandler(request: Request): Promise<Response> {
  const traceHeaders: Record<string, string> = {};
  const requestId = request.headers.get("x-request-id")?.trim();
  const correlationId = request.headers.get("x-correlation-id")?.trim();
  const agentOperationId = request.headers.get("x-agent-operation-id")?.trim();
  if (requestId) {
    traceHeaders["x-request-id"] = requestId;
  }
  if (correlationId) {
    traceHeaders["x-correlation-id"] = correlationId;
  }
  if (agentOperationId) {
    traceHeaders["x-agent-operation-id"] = agentOperationId;
  }
  const respond = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
    json(body, status, { ...traceHeaders, ...extra });

  if (request.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: { ...CORS_HEADERS, ...traceHeaders } });
  }

  if (request.method !== "POST") {
    return respond({ error: "Method not allowed" }, 405);
  }

  const accessToken = getAccessToken(request);
  if (!accessToken) {
    return respond({ error: "Missing authorization token" }, 401, { "WWW-Authenticate": "Bearer" });
  }

  const { organizationId, isTherapist, isAdmin, isSuperAdmin } = await resolveOrgAndRole(accessToken);
  if (!organizationId || (!isTherapist && !isAdmin && !isSuperAdmin)) {
    return respond({ error: "Forbidden" }, 403);
  }

  const currentUserId = decodeJwtSubject(accessToken);
  if (!currentUserId) {
    return respond({ error: "Forbidden" }, 403);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return respond({ error: "Invalid JSON body" }, 400);
  }

  const parsed = startSessionSchema.safeParse(payload);
  if (!parsed.success) {
    return respond({ error: "Invalid request body" }, 400);
  }

  const { session_id, program_id, goal_id, goal_ids, started_at } = parsed.data;
  const normalizedGoalIds = Array.isArray(goal_ids) ? goal_ids : [];
  const mergedGoalIds = Array.from(new Set([goal_id, ...normalizedGoalIds]));

  const { supabaseUrl, anonKey } = getSupabaseConfig();
  const headers = {
    "Content-Type": "application/json",
    apikey: anonKey,
    Authorization: `Bearer ${accessToken}`,
  };

  const sessionUrl = `${supabaseUrl}/rest/v1/sessions?select=id,client_id,organization_id,program_id,goal_id,therapist_id,status,started_at&organization_id=eq.${organizationId}&id=eq.${session_id}`;
  const sessionResult = await fetchJson<Array<{
    id: string;
    client_id: string;
    organization_id: string;
    therapist_id: string;
    status: string;
    started_at: string | null;
  }>>(sessionUrl, {
    method: "GET",
    headers,
  });
  if (!sessionResult.ok || !sessionResult.data || sessionResult.data.length === 0) {
    return respond({ error: "Session not found" }, 404);
  }

  const sessionRow = sessionResult.data[0];
  if (isTherapist && sessionRow.therapist_id !== currentUserId) {
    return respond({ error: "Forbidden" }, 403);
  }

  const rpcUrl = `${supabaseUrl}/rest/v1/rpc/start_session_with_goals`;
  const rpcResult = await fetchJson<{
    success?: boolean;
    error_code?: string;
    error_message?: string;
    session?: { id: string; started_at: string };
  }>(rpcUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      p_session_id: session_id,
      p_program_id: program_id,
      p_goal_id: goal_id,
      p_goal_ids: mergedGoalIds,
      p_started_at: started_at ?? null,
      p_actor_id: currentUserId,
    }),
  });

  if (!rpcResult.ok || !rpcResult.data) {
    return respond({ error: "Failed to start session" }, rpcResult.status || 500);
  }

  if (!rpcResult.data.success) {
    const statusMap: Record<string, number> = {
      MISSING_FIELDS: 400,
      SESSION_NOT_FOUND: 404,
      ALREADY_STARTED: 409,
      INVALID_STATUS: 409,
      GOAL_NOT_FOUND: 404,
      INVALID_GOALS: 400,
    };
    const errorCode = rpcResult.data.error_code ?? "FAILED";
    return respond(
      { error: rpcResult.data.error_message ?? "Failed to start session", code: errorCode },
      statusMap[errorCode] ?? 409,
    );
  }

  if (!rpcResult.data.session) {
    return respond({ error: "Session start response missing session payload" }, 500);
  }

  return respond(rpcResult.data.session);
}
