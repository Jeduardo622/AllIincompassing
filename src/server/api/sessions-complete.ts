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
import { resolveSessionCloseRequiredGoalIds } from "../../lib/sessionCloseRequiredGoals";

const completeSessionSchema = z.object({
  session_id: z.string().uuid(),
  outcome: z.enum(["completed", "no-show"]),
  notes: z.string().nullable().optional(),
});

type CompleteSessionPayload = z.infer<typeof completeSessionSchema>;

const COMPLETABLE_STATUSES = new Set(["scheduled", "in_progress"]);
const TERMINAL_STATUSES = new Set(["completed", "cancelled", "no-show"]);

type RuntimeMetricLabels = Record<string, string | number | boolean | null | undefined>;

type RuntimeTraceMeta = {
  requestId: string | null;
  correlationId: string | null;
  agentOperationId: string | null;
};

const sanitizeMetricLabels = (labels: RuntimeMetricLabels): RuntimeMetricLabels =>
  Object.entries(labels).reduce<RuntimeMetricLabels>((acc, [key, value]) => {
    if (value !== undefined && value !== null) {
      acc[key] = value;
    }
    return acc;
  }, {});

const incrementRuntimeMetric = (name: string, labels: RuntimeMetricLabels = {}): void => {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: "metric",
    metric: name,
    count: 1,
    ...sanitizeMetricLabels(labels),
  }));
};

const traceMetaFromHeaders = (traceHeaders: Record<string, string>): RuntimeTraceMeta => ({
  requestId: traceHeaders["x-request-id"] ?? null,
  correlationId: traceHeaders["x-correlation-id"] ?? null,
  agentOperationId: traceHeaders["x-agent-operation-id"] ?? null,
});

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
}): Promise<{ userId: string | null; unauthorized: boolean; upstreamError: boolean }> => {
  const userResult = await fetchJson<{ id?: unknown }>(`${supabaseUrl}/auth/v1/user`, {
    method: "GET",
    headers: buildRuntimeHeaders(accessToken, supabaseAnonKey),
  });
  if (!userResult.ok || !userResult.data) {
    return {
      userId: null,
      unauthorized: userResult.status === 401 || userResult.status === 403,
      upstreamError: userResult.status >= 500 || userResult.status === 0,
    };
  }
  return {
    userId: typeof userResult.data.id === "string" && userResult.data.id.length > 0 ? userResult.data.id : null,
    unauthorized: false,
    upstreamError: false,
  };
};

const checkNotesCoverage = async ({
  sessionId,
  organizationId,
  supabaseUrl,
  headers,
  primaryGoalId,
}: {
  sessionId: string;
  organizationId: string;
  supabaseUrl: string;
  headers: Record<string, string>;
  primaryGoalId?: string | null;
}): Promise<{ ok: true } | { ok: false } | { upstreamError: true; message: string }> => {
  const sessionGoalsResult = await fetchJson<Array<{ goal_id: string }>>(
    `${supabaseUrl}/rest/v1/session_goals?select=goal_id&organization_id=eq.${encodeURIComponent(organizationId)}&session_id=eq.${encodeURIComponent(sessionId)}`,
    { method: "GET", headers },
  );
  if (!sessionGoalsResult.ok || !sessionGoalsResult.data) {
    return { upstreamError: true, message: "Failed to load session goals for notes check" };
  }
  const requiredGoalIds = resolveSessionCloseRequiredGoalIds({
    sessionGoalIds: sessionGoalsResult.data.map((row) => row.goal_id),
    primaryGoalId,
  });
  if (requiredGoalIds.length === 0) {
    return { ok: true };
  }
  const notesRowsResult = await fetchJson<Array<{ goal_notes: Record<string, unknown> | null }>>(
    `${supabaseUrl}/rest/v1/client_session_notes?select=goal_notes&organization_id=eq.${encodeURIComponent(organizationId)}&session_id=eq.${encodeURIComponent(sessionId)}`,
    { method: "GET", headers },
  );
  if (!notesRowsResult.ok || !notesRowsResult.data) {
    return { upstreamError: true, message: "Failed to load session notes for notes check" };
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

const recordRuntimeSessionAuditEvent = async ({
  sessionId,
  eventType,
  actorId,
  payload,
  supabaseUrl,
  headers,
}: {
  sessionId: string;
  eventType: string;
  actorId: string;
  payload: Record<string, unknown>;
  supabaseUrl: string;
  headers: Record<string, string>;
}): Promise<void> => {
  try {
    const result = await fetchJson(`${supabaseUrl}/rest/v1/rpc/record_session_audit`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        p_session_id: sessionId,
        p_event_type: eventType,
        p_actor_id: actorId,
        p_event_payload: payload,
      }),
    });

    if (!result.ok) {
      incrementRuntimeMetric("session_audit_failure_total", {
        eventType,
        required: false,
        failureType: "rpc_error",
      });
      console.warn(JSON.stringify({
        level: "warn",
        message: "audit.event.persist_failed",
        eventType,
        sessionId,
      }));
    }
  } catch (error) {
    incrementRuntimeMetric("session_audit_failure_total", {
      eventType,
      required: false,
      failureType: "exception",
    });
    console.error(JSON.stringify({
      level: "error",
      message: "audit.event.exception",
      eventType,
      sessionId,
      error: error instanceof Error ? error.message : "unknown",
    }));
  }
};

const createRuntimeSupervisionSessionNoteRequest = async ({
  sessionId,
  organizationId,
  supabaseUrl,
  headers,
}: {
  sessionId: string;
  organizationId: string;
  supabaseUrl: string;
  headers: Record<string, string>;
}): Promise<void> => {
  try {
    const result = await fetchJson(`${supabaseUrl}/rest/v1/rpc/create_supervision_session_note_request_for_completed_session`, {
      method: "POST",
      headers,
      body: JSON.stringify({ p_session_id: sessionId }),
    });

    if (!result.ok) {
      incrementRuntimeMetric("supervision_note_request_failure_total", {
        function: "sessions-complete",
        orgId: organizationId,
        surface: "runtime-rest",
        reason: "rpc_error",
      });
      console.warn(JSON.stringify({
        level: "warn",
        message: "supervision-note.request.persist_failed",
        sessionId,
      }));
      return;
    }

    if (result.data !== null) {
      incrementRuntimeMetric("supervision_note_request_created_total", {
        function: "sessions-complete",
        orgId: organizationId,
        surface: "runtime-rest",
      });
    }
  } catch (error) {
    incrementRuntimeMetric("supervision_note_request_failure_total", {
      function: "sessions-complete",
      orgId: organizationId,
      surface: "runtime-rest",
      reason: "exception",
    });
    console.warn(JSON.stringify({
      level: "warn",
      message: "supervision-note.request.exception",
      sessionId,
      error: error instanceof Error ? error.message : "unknown",
    }));
  }
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
    incrementRuntimeMetric("tenant_denial_total", {
      function: "sessions-complete",
      orgId: roleResolution.organizationId ?? undefined,
      reason: roleResolution.organizationId ? "role-denied" : "missing-org",
    });
    return errorResponse(request, "forbidden", "Forbidden", { headers: traceHeaders });
  }

  const currentUserResult = await resolveRuntimeAuthenticatedUserWithStatus({ accessToken, supabaseUrl, supabaseAnonKey });
  if (currentUserResult.upstreamError) {
    return errorResponse(request, "upstream_error", "Unable to validate authenticated user", {
      status: 502,
      headers: traceHeaders,
    });
  }
  if (currentUserResult.unauthorized) {
    return errorResponse(request, "unauthorized", "Unauthorized", {
      status: 401,
      headers: { ...traceHeaders, "WWW-Authenticate": "Bearer" },
    });
  }
  if (!currentUserResult.userId) {
    return errorResponse(request, "unauthorized", "Unauthorized", {
      status: 401,
      headers: { ...traceHeaders, "WWW-Authenticate": "Bearer" },
    });
  }

  const organizationId = roleResolution.organizationId;
  const currentUserId = currentUserResult.userId;
  const headers = buildRuntimeHeaders(accessToken, supabaseAnonKey);
  const sessionResult = await fetchJson<Array<{
    id: string;
    status: string;
    therapist_id: string | null;
    goal_id: string | null;
    start_time: string;
    end_time: string;
  }>>(
    `${supabaseUrl}/rest/v1/sessions?select=id,status,therapist_id,goal_id,start_time,end_time&organization_id=eq.${encodeURIComponent(organizationId)}&id=eq.${encodeURIComponent(payload.session_id)}`,
    { method: "GET", headers },
  );
  incrementRuntimeMetric("org_scoped_query_total", {
    function: "sessions-complete",
    orgId: organizationId,
    operation: "fetch-session",
  });
  if (!sessionResult.ok || !sessionResult.data) {
    return errorResponse(request, "upstream_error", "Failed to load session", {
      status: 502,
      headers: traceHeaders,
    });
  }
  if (sessionResult.data.length === 0) {
    incrementRuntimeMetric("tenant_denial_total", {
      function: "sessions-complete",
      orgId: organizationId,
      reason: "session-not-found",
    });
    return errorResponse(request, "not_found", "Session not found", {
      headers: traceHeaders,
      extra: { code: "SESSION_NOT_FOUND" },
    });
  }
  const session = sessionResult.data[0];
  if (roleResolution.isTherapist && session.therapist_id !== currentUserId) {
    incrementRuntimeMetric("tenant_denial_total", {
      function: "sessions-complete",
      orgId: organizationId,
      reason: "therapist-mismatch",
    });
    return errorResponse(request, "forbidden", "Forbidden", {
      headers: traceHeaders,
      extra: { code: "FORBIDDEN" },
    });
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
      primaryGoalId: session.goal_id,
    });
    if ("upstreamError" in notesCoverage) {
      return errorResponse(request, "upstream_error", notesCoverage.message, {
        status: 502,
        headers: traceHeaders,
      });
    }
    if (!notesCoverage.ok) {
      incrementRuntimeMetric("session_notes_required_rejection_total", {
        function: "sessions-complete",
        orgId: organizationId,
      });
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
  if (!updateResult.ok || !updateResult.data) {
    return errorResponse(request, "conflict", "Session could not be completed", {
      status: 409,
      headers: traceHeaders,
      extra: { code: "UPDATE_FAILED" },
    });
  }
  if (updateResult.data.length === 0) {
    incrementRuntimeMetric("session_complete_concurrent_total", {
      function: "sessions-complete",
      orgId: organizationId,
    });
    return errorResponse(request, "conflict", "Session was modified concurrently. Refresh and try again.", {
      status: 409,
      headers: traceHeaders,
      extra: { code: "CONCURRENT_MODIFICATION" },
    });
  }

  const traceMeta = traceMetaFromHeaders(traceHeaders);
  const eventType = payload.outcome === "completed" ? "session_completed" : "session_no_show";
  await recordRuntimeSessionAuditEvent({
    sessionId: payload.session_id,
    eventType,
    actorId: currentUserId,
    supabaseUrl,
    headers,
    payload: {
      outcome: payload.outcome,
      startTime: session.start_time,
      endTime: session.end_time,
      notes: payload.notes ?? null,
      agentOperationId: traceMeta.agentOperationId,
      trace: traceMeta,
    },
  });

  if (payload.outcome === "completed") {
    await createRuntimeSupervisionSessionNoteRequest({
      sessionId: payload.session_id,
      organizationId,
      supabaseUrl,
      headers,
    });
  }

  incrementRuntimeMetric("session_complete_success_total", {
    function: "sessions-complete",
    orgId: organizationId,
    outcome: payload.outcome,
  });

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
    const idempotencyKeyHeader = request.headers.get("Idempotency-Key")?.trim();
    if (requestIdHeader) {
      forwardHeaders.set("x-request-id", requestIdHeader);
    }
    if (correlationIdHeader) {
      forwardHeaders.set("x-correlation-id", correlationIdHeader);
    }
    if (agentOperationIdHeader) {
      forwardHeaders.set("x-agent-operation-id", agentOperationIdHeader);
    }
    if (idempotencyKeyHeader) {
      forwardHeaders.set("Idempotency-Key", idempotencyKeyHeader);
    }
    let forwarded: Response;
    try {
      forwarded = await fetch(functionUrl, {
        method: "POST",
        headers: forwardHeaders,
        body: JSON.stringify(parsed.data),
      });
    } catch {
      return completeSessionViaRuntimeRest({
        request,
        payload: parsed.data,
        accessToken,
        traceHeaders,
      });
    }
    const bodyText = await forwarded.text();
    const responseHeaders = new Headers({
      ...corsHeadersForRequest(request),
      ...traceHeaders,
      "Content-Type": forwarded.headers.get("Content-Type") ?? "application/json",
    });
    forwarded.headers.forEach((value, key) => {
      const normalized = key.toLowerCase();
      if (
        normalized === "retry-after" ||
        normalized === "idempotency-key" ||
        normalized === "idempotent-replay" ||
        normalized === "www-authenticate"
      ) {
        responseHeaders.set(key, value);
      }
    });
    if (!responseHeaders.has("Idempotency-Key") && idempotencyKeyHeader) {
      responseHeaders.set("Idempotency-Key", idempotencyKeyHeader);
    }

    return new Response(bodyText, {
      status: forwarded.status,
      headers: responseHeaders,
    });
  } catch {
    return errorResponse(request, "upstream_error", "Failed to complete session", {
      status: 502,
      headers: traceHeaders,
    });
  }
}

export const __TESTING__ = {
  completeSessionViaRuntimeRest,
};
