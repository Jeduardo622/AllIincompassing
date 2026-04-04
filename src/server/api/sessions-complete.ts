import { z } from "zod";
import {
  consumeRateLimit,
  corsHeadersForRequest,
  errorResponse,
  fetchJson,
  getAccessToken,
  isDisallowedOriginRequest,
  jsonForRequest,
} from "./shared";
import { getRuntimeSupabaseConfig } from "../runtimeConfig";

const completeSessionSchema = z.object({
  session_id: z.string().uuid(),
  outcome: z.enum(["completed", "no-show"]),
  notes: z.string().nullable().optional(),
});

type CompleteSessionPayload = z.infer<typeof completeSessionSchema>;

const COMPLETABLE_STATUSES = new Set(["scheduled", "in_progress"]);
const TERMINAL_STATUSES = new Set(["completed", "cancelled", "no-show"]);

const buildRuntimeHeaders = (accessToken: string, supabaseAnonKey: string): Record<string, string> => ({
  "Content-Type": "application/json",
  apikey: supabaseAnonKey,
  Authorization: `Bearer ${accessToken}`,
});

const resolveRuntimeOrgAndRoleWithStatus = async ({
  accessToken,
  supabaseUrl,
  supabaseAnonKey,
}: {
  accessToken: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
}): Promise<{
  organizationId: string | null;
  isTherapist: boolean;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  upstreamError: boolean;
}> => {
  const headers = buildRuntimeHeaders(accessToken, supabaseAnonKey);
  const superAdminResult = await fetchJson<boolean>(`${supabaseUrl}/rest/v1/rpc/current_user_is_super_admin`, {
    method: "POST",
    headers,
    body: "{}",
  });
  const isSuperAdmin = superAdminResult.ok && superAdminResult.data === true;
  const superAdminUpstreamError = !superAdminResult.ok && superAdminResult.status >= 500;

  const orgResult = await fetchJson<string>(`${supabaseUrl}/rest/v1/rpc/current_user_organization_id`, {
    method: "POST",
    headers,
    body: "{}",
  });
  const organizationId =
    orgResult.ok && typeof orgResult.data === "string" && orgResult.data.length > 0
      ? orgResult.data
      : null;
  const orgUpstreamError = !orgResult.ok && orgResult.status >= 500;
  if (!organizationId) {
    return {
      organizationId: null,
      isTherapist: false,
      isAdmin: false,
      isSuperAdmin,
      upstreamError: superAdminUpstreamError || orgUpstreamError,
    };
  }

  const therapistResult = await fetchJson<boolean>(`${supabaseUrl}/rest/v1/rpc/user_has_role_for_org`, {
    method: "POST",
    headers,
    body: JSON.stringify({ role_name: "therapist", target_organization_id: organizationId }),
  });
  const adminResult = await fetchJson<boolean>(`${supabaseUrl}/rest/v1/rpc/user_has_role_for_org`, {
    method: "POST",
    headers,
    body: JSON.stringify({ role_name: "admin", target_organization_id: organizationId }),
  });
  const orgSuperAdminResult = await fetchJson<boolean>(`${supabaseUrl}/rest/v1/rpc/user_has_role_for_org`, {
    method: "POST",
    headers,
    body: JSON.stringify({ role_name: "super_admin", target_organization_id: organizationId }),
  });
  const hasOrgSuperAdminRole = orgSuperAdminResult.ok && orgSuperAdminResult.data === true;
  return {
    organizationId,
    isTherapist: therapistResult.ok && therapistResult.data === true,
    isAdmin: adminResult.ok && adminResult.data === true,
    isSuperAdmin: isSuperAdmin || hasOrgSuperAdminRole,
    upstreamError:
      superAdminUpstreamError ||
      orgUpstreamError ||
      (!therapistResult.ok && therapistResult.status >= 500) ||
      (!adminResult.ok && adminResult.status >= 500) ||
      (!orgSuperAdminResult.ok && orgSuperAdminResult.status >= 500),
  };
};

const resolveRuntimeAuthenticatedUserWithStatus = async ({
  accessToken,
  supabaseUrl,
  supabaseAnonKey,
}: {
  accessToken: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
}): Promise<{ userId: string | null; upstreamError: boolean }> => {
  const userResult = await fetchJson<{ id?: unknown }>(`${supabaseUrl}/auth/v1/user`, {
    method: "GET",
    headers: buildRuntimeHeaders(accessToken, supabaseAnonKey),
  });
  if (!userResult.ok || !userResult.data) {
    return { userId: null, upstreamError: userResult.status >= 500 || userResult.status === 0 };
  }
  return {
    userId: typeof userResult.data.id === "string" && userResult.data.id.length > 0 ? userResult.data.id : null,
    upstreamError: false,
  };
};

const checkNotesCoverage = async ({
  sessionId,
  organizationId,
  supabaseUrl,
  headers,
}: {
  sessionId: string;
  organizationId: string;
  supabaseUrl: string;
  headers: Record<string, string>;
}): Promise<{ ok: true } | { ok: false }> => {
  const sessionGoalsResult = await fetchJson<Array<{ goal_id: string }>>(
    `${supabaseUrl}/rest/v1/session_goals?select=goal_id&organization_id=eq.${encodeURIComponent(organizationId)}&session_id=eq.${encodeURIComponent(sessionId)}`,
    { method: "GET", headers },
  );
  if (!sessionGoalsResult.ok || !sessionGoalsResult.data || sessionGoalsResult.data.length === 0) {
    return { ok: true };
  }

  const requiredGoalIds = sessionGoalsResult.data
    .map((row) => row.goal_id)
    .filter((goalId): goalId is string => typeof goalId === "string" && goalId.length > 0);
  const notesRowsResult = await fetchJson<Array<{ goal_notes: Record<string, unknown> | null }>>(
    `${supabaseUrl}/rest/v1/client_session_notes?select=goal_notes&organization_id=eq.${encodeURIComponent(organizationId)}&session_id=eq.${encodeURIComponent(sessionId)}`,
    { method: "GET", headers },
  );
  if (!notesRowsResult.ok || !notesRowsResult.data) {
    return { ok: false };
  }
  const coveredGoalIds = new Set<string>();
  for (const row of notesRowsResult.data) {
    const goalNotes = row.goal_notes;
    if (!goalNotes || typeof goalNotes !== "object") {
      continue;
    }
    for (const [goalId, noteText] of Object.entries(goalNotes)) {
      if (typeof noteText === "string" && noteText.trim().length > 0) {
        coveredGoalIds.add(goalId);
      }
    }
  }

  return requiredGoalIds.every((goalId) => coveredGoalIds.has(goalId))
    ? { ok: true }
    : { ok: false };
};

const completeSessionViaRuntimeRest = async ({
  request,
  payload,
  accessToken,
  traceHeaders,
}: {
  request: Request;
  payload: CompleteSessionPayload;
  accessToken: string;
  traceHeaders: Record<string, string>;
}): Promise<Response> => {
  const { supabaseUrl, supabaseAnonKey } = getRuntimeSupabaseConfig();
  const roleResolution = await resolveRuntimeOrgAndRoleWithStatus({ accessToken, supabaseUrl, supabaseAnonKey });
  if (roleResolution.upstreamError) {
    return errorResponse(request, "upstream_error", "Unable to validate organization access", {
      status: 502,
      headers: traceHeaders,
    });
  }
  if (!roleResolution.organizationId || (!roleResolution.isTherapist && !roleResolution.isAdmin && !roleResolution.isSuperAdmin)) {
    return errorResponse(request, "forbidden", "Forbidden", { headers: traceHeaders });
  }

  const currentUserResult = await resolveRuntimeAuthenticatedUserWithStatus({ accessToken, supabaseUrl, supabaseAnonKey });
  if (currentUserResult.upstreamError) {
    return errorResponse(request, "upstream_error", "Unable to validate authenticated user", {
      status: 502,
      headers: traceHeaders,
    });
  }
  if (!currentUserResult.userId) {
    return errorResponse(request, "forbidden", "Forbidden", { headers: traceHeaders });
  }

  const organizationId = roleResolution.organizationId;
  const currentUserId = currentUserResult.userId;
  const headers = buildRuntimeHeaders(accessToken, supabaseAnonKey);
  const sessionResult = await fetchJson<Array<{ id: string; status: string; therapist_id: string | null }>>(
    `${supabaseUrl}/rest/v1/sessions?select=id,status,therapist_id&organization_id=eq.${encodeURIComponent(organizationId)}&id=eq.${encodeURIComponent(payload.session_id)}`,
    { method: "GET", headers },
  );
  if (!sessionResult.ok || !sessionResult.data || sessionResult.data.length === 0) {
    return errorResponse(request, "not_found", "Session not found", { headers: traceHeaders });
  }
  const session = sessionResult.data[0];
  if (roleResolution.isTherapist && session.therapist_id !== currentUserId) {
    return errorResponse(request, "forbidden", "Forbidden", { headers: traceHeaders });
  }
  if (TERMINAL_STATUSES.has(session.status)) {
    return errorResponse(request, "conflict", `Session is already in a terminal state: ${session.status}`, {
      status: 409,
      headers: traceHeaders,
      extra: { code: "ALREADY_TERMINAL" },
    });
  }
  if (!COMPLETABLE_STATUSES.has(session.status)) {
    return errorResponse(request, "conflict", `Session status '${session.status}' cannot be transitioned to ${payload.outcome}`, {
      status: 409,
      headers: traceHeaders,
      extra: { code: "INVALID_STATUS" },
    });
  }

  if (session.status === "in_progress") {
    const notesCoverage = await checkNotesCoverage({
      sessionId: payload.session_id,
      organizationId,
      supabaseUrl,
      headers,
    });
    if (!notesCoverage.ok) {
      return errorResponse(
        request,
        "conflict",
        "Session notes with goal progress are required before closing this session.",
        {
          status: 409,
          headers: traceHeaders,
          extra: { code: "SESSION_NOTES_REQUIRED" },
        },
      );
    }
  }

  const updates: Record<string, unknown> = {
    status: payload.outcome,
    updated_by: currentUserId,
  };
  if (payload.notes && payload.notes.trim().length > 0) {
    updates.notes = payload.notes.trim();
  }
  const updateResult = await fetchJson<Array<{ id: string; status: string; updated_at: string }>>(
    `${supabaseUrl}/rest/v1/sessions?id=eq.${encodeURIComponent(payload.session_id)}&organization_id=eq.${encodeURIComponent(organizationId)}&status=in.(scheduled,in_progress)&select=id,status,updated_at`,
    {
      method: "PATCH",
      headers: {
        ...headers,
        Prefer: "return=representation",
      },
      body: JSON.stringify(updates),
    },
  );
  if (!updateResult.ok || !updateResult.data || updateResult.data.length === 0) {
    return errorResponse(request, "conflict", "Session could not be completed", {
      status: 409,
      headers: traceHeaders,
      extra: { code: "UPDATE_FAILED" },
    });
  }

  return jsonForRequest(
    request,
    { success: true, data: { session: updateResult.data[0], outcome: payload.outcome } },
    200,
    traceHeaders,
  );
};

export async function sessionsCompleteHandler(request: Request): Promise<Response> {
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

  if (isDisallowedOriginRequest(request)) {
    return errorResponse(request, "forbidden", "Origin not allowed", {
      status: 403,
      headers: traceHeaders,
    });
  }

  if (request.method === "OPTIONS") {
    return new Response("ok", {
      status: 200,
      headers: { ...corsHeadersForRequest(request), ...traceHeaders },
    });
  }

  if (request.method !== "POST") {
    return errorResponse(request, "validation_error", "Method not allowed", {
      status: 405,
      headers: traceHeaders,
    });
  }

  try {
    const accessToken = getAccessToken(request);
    if (!accessToken) {
      return errorResponse(request, "unauthorized", "Missing authorization token", {
        headers: { ...traceHeaders, "WWW-Authenticate": "Bearer" },
      });
    }

    const rateLimit = await consumeRateLimit(request, {
      keyPrefix: "api:sessions-complete",
      maxRequests: 60,
      windowMs: 60_000,
    });
    if (rateLimit.limited) {
      return errorResponse(request, "rate_limited", "Too many session completion requests", {
        headers: { ...traceHeaders, "Retry-After": String(rateLimit.retryAfterSeconds) },
      });
    }

    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return errorResponse(request, "validation_error", "Invalid JSON body", {
        headers: traceHeaders,
      });
    }

    const parsed = completeSessionSchema.safeParse(payload);
    if (!parsed.success) {
      return errorResponse(request, "validation_error", "Invalid request body", {
        headers: traceHeaders,
      });
    }

    const { supabaseUrl, supabaseAnonKey } = getRuntimeSupabaseConfig();
    const functionUrl = `${supabaseUrl}/functions/v1/sessions-complete`;
    const forwardHeaders = new Headers({
      "Content-Type": "application/json",
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${accessToken}`,
    });
    const requestIdHeader = request.headers.get("x-request-id");
    const correlationIdHeader = request.headers.get("x-correlation-id");
    const agentOperationIdHeader = request.headers.get("x-agent-operation-id");
    if (requestIdHeader) {
      forwardHeaders.set("x-request-id", requestIdHeader);
    }
    if (correlationIdHeader) {
      forwardHeaders.set("x-correlation-id", correlationIdHeader);
    }
    if (agentOperationIdHeader) {
      forwardHeaders.set("x-agent-operation-id", agentOperationIdHeader);
    }
    const forwarded = await fetch(functionUrl, {
      method: "POST",
      headers: forwardHeaders,
      body: JSON.stringify(parsed.data),
    });
    if (forwarded.status === 401) {
      return completeSessionViaRuntimeRest({
        request,
        payload: parsed.data,
        accessToken,
        traceHeaders,
      });
    }
    const bodyText = await forwarded.text();
    const retryAfter = forwarded.headers.get("Retry-After");

    return new Response(bodyText, {
      status: forwarded.status,
      headers: {
        ...corsHeadersForRequest(request),
        ...traceHeaders,
        "Content-Type": "application/json",
        ...(retryAfter ? { "Retry-After": retryAfter } : {}),
      },
    });
  } catch {
    return errorResponse(request, "upstream_error", "Failed to complete session", {
      status: 502,
      headers: traceHeaders,
    });
  }
}
