import { z } from "zod";
import {
  corsHeadersForRequest,
  errorResponse,
  fetchAuthenticatedUserId,
  fetchJson,
  getAccessToken,
  getSupabaseConfig,
  isDisallowedOriginRequest,
  jsonForRequest,
  resolveOrgAndRole,
} from "./shared";

export const startSessionSchema = z.object({
  session_id: z.string().uuid(),
  program_id: z.string().uuid(),
  goal_id: z.string().uuid(),
  goal_ids: z.array(z.string().uuid()).optional(),
  started_at: z.string().optional(),
});

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
    jsonForRequest(request, body, status, { ...traceHeaders, ...extra });

  if (isDisallowedOriginRequest(request)) {
    return errorResponse(request, "forbidden", "Origin not allowed", {
      status: 403,
      headers: traceHeaders,
    });
  }

  if (request.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: { ...corsHeadersForRequest(request), ...traceHeaders } });
  }

  if (request.method !== "POST") {
    return errorResponse(request, "validation_error", "Method not allowed", { status: 405 });
  }

  const accessToken = getAccessToken(request);
  if (!accessToken) {
    return errorResponse(request, "unauthorized", "Missing authorization token", {
      headers: { "WWW-Authenticate": "Bearer", ...traceHeaders },
    });
  }

  const { organizationId, isTherapist, isAdmin, isSuperAdmin } = await resolveOrgAndRole(accessToken);
  if (!organizationId || (!isTherapist && !isAdmin && !isSuperAdmin)) {
    return errorResponse(request, "forbidden", "Forbidden", { headers: traceHeaders });
  }

  const currentUserId = await fetchAuthenticatedUserId(accessToken);
  if (!currentUserId) {
    return errorResponse(request, "forbidden", "Forbidden", { headers: traceHeaders });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return errorResponse(request, "validation_error", "Invalid JSON body", { headers: traceHeaders });
  }

  const parsed = startSessionSchema.safeParse(payload);
  if (!parsed.success) {
    return errorResponse(request, "validation_error", "Invalid request body", { headers: traceHeaders });
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
    return errorResponse(request, "not_found", "Session not found", { headers: traceHeaders });
  }

  const sessionRow = sessionResult.data[0];
  if (isTherapist && sessionRow.therapist_id !== currentUserId) {
    return errorResponse(request, "forbidden", "Forbidden", { headers: traceHeaders });
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
    return errorResponse(request, "upstream_error", "Failed to start session", {
      status: rpcResult.status || 500,
      headers: traceHeaders,
    });
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
    const resolvedStatus = statusMap[errorCode] ?? 409;
    return errorResponse(
      request,
      resolvedStatus === 404 ? "not_found" : resolvedStatus === 400 ? "validation_error" : "conflict",
      rpcResult.data.error_message ?? "Failed to start session",
      {
        status: resolvedStatus,
        headers: traceHeaders,
        extra: { rpcCode: errorCode },
      },
    );
  }

  if (!rpcResult.data.session) {
    return errorResponse(request, "internal_error", "Session start response missing session payload", {
      headers: traceHeaders,
    });
  }

  return respond(rpcResult.data.session);
}
