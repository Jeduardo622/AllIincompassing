import "../bootstrapSupabase";
import {
  consumeRateLimit,
  corsHeadersForRequest,
  errorResponse,
  fetchJson,
  getSupabaseConfig,
  getAccessToken,
  isDisallowedOriginRequest,
  jsonForRequest,
  resolveOrgAndRoleWithStatus,
} from "./shared";
import {
  type WeekForwardApiResponse,
  type WeekForwardRequestBody,
  weekForwardRequestBodySchema,
} from "../types";

const JSON_CONTENT_TYPE_HEADER: Record<string, string> = {
  "Content-Type": "application/json",
};

type SourceSessionRow = {
  id: string;
  organization_id: string;
  therapist_id: string;
  client_id: string;
  start_time: string;
  end_time: string;
  status: string;
};

const toInFilter = (ids: string[]) => ids.map((id) => `"${id}"`).join(",");

const isIsoWithinRange = (iso: string, startIso: string, endIso: string): boolean => {
  const value = Date.parse(iso);
  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  return Number.isFinite(value) && Number.isFinite(start) && Number.isFinite(end) && value >= start && value <= end;
};

export async function sessionsWeekForwardHandler(request: Request): Promise<Response> {
  if (isDisallowedOriginRequest(request)) {
    return errorResponse(request, "forbidden", "Origin not allowed", { status: 403 });
  }

  if (request.method === "OPTIONS") {
    return new Response("ok", {
      status: 200,
      headers: { ...JSON_CONTENT_TYPE_HEADER, ...corsHeadersForRequest(request) },
    });
  }

  if (request.method !== "POST") {
    return errorResponse(request, "validation_error", "Method not allowed", { status: 405 });
  }

  const rateLimit = await consumeRateLimit(request, {
    keyPrefix: "api:sessions-week-forward",
    maxRequests: 10,
    windowMs: 60_000,
  });
  if (rateLimit.limited) {
    return errorResponse(request, "rate_limited", "Too many week-forward scheduling requests", {
      headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
    });
  }

  const accessToken = getAccessToken(request);
  if (!accessToken) {
    return errorResponse(request, "unauthorized", "Missing authorization token", {
      headers: { "WWW-Authenticate": "Bearer" },
    });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return errorResponse(request, "validation_error", "Invalid JSON body");
  }

  const parseResult = weekForwardRequestBodySchema.safeParse(rawBody);
  if (!parseResult.success) {
    return errorResponse(request, "validation_error", "Invalid request body", {
      extra: { code: "invalid_request" },
    });
  }

  const body: WeekForwardRequestBody = parseResult.data;
  const roleResolution = await resolveOrgAndRoleWithStatus(accessToken);
  if (roleResolution.upstreamError) {
    return errorResponse(request, "upstream_error", "Unable to validate organization access", { status: 502 });
  }
  if (!roleResolution.organizationId) {
    return errorResponse(request, "forbidden", "Organization context required", { status: 403 });
  }
  if (!roleResolution.isAdmin && !roleResolution.isSuperAdmin) {
    return errorResponse(request, "forbidden", "Forbidden", { status: 403 });
  }

  const { supabaseUrl, anonKey } = getSupabaseConfig();
  const headers = {
    ...JSON_CONTENT_TYPE_HEADER,
    apikey: anonKey,
    Authorization: `Bearer ${accessToken}`,
  };

  const encodedOrgId = encodeURIComponent(roleResolution.organizationId);
  const encodedIdFilter = encodeURIComponent(`(${toInFilter(body.sourceSessionIds)})`);
  const sourceSessionsUrl = `${supabaseUrl}/rest/v1/sessions?select=id,organization_id,therapist_id,client_id,start_time,end_time,status&organization_id=eq.${encodedOrgId}&id=in.${encodedIdFilter}&order=start_time.asc`;
  const sourceSessionsResult = await fetchJson<SourceSessionRow[]>(sourceSessionsUrl, {
    method: "GET",
    headers,
  });

  if (!sourceSessionsResult.ok || !Array.isArray(sourceSessionsResult.data)) {
    return errorResponse(request, "upstream_error", "Unable to load source sessions", { status: 502 });
  }

  const sourceSessions = sourceSessionsResult.data;
  if (sourceSessions.length !== body.sourceSessionIds.length) {
    return errorResponse(request, "forbidden", "One or more source sessions are not accessible in the active organization", {
      status: 403,
      extra: { code: "SOURCE_SCOPE_MISMATCH" },
    });
  }

  const outOfWeekSource = sourceSessions.find(
    (session) => !isIsoWithinRange(session.start_time, body.displayedWeekStart, body.displayedWeekEnd),
  );
  if (outOfWeekSource) {
    return errorResponse(request, "validation_error", "One or more source sessions fall outside the displayed week", {
      status: 400,
      extra: { code: "SOURCE_WEEK_MISMATCH" },
    });
  }

  const invalidStatusSource = sourceSessions.find((session) => session.status !== "scheduled");
  if (invalidStatusSource) {
    return errorResponse(request, "validation_error", "All visible source sessions must be scheduled before applying this week forward", {
      status: 400,
      extra: { code: "SOURCE_STATUS_INVALID" },
    });
  }

  const rpcUrl = `${supabaseUrl}/rest/v1/rpc/apply_schedule_week_forward`;
  const rpcResult = await fetchJson<{
    success?: boolean;
    error_code?: string;
    error_message?: string;
    source_session_count?: number;
    generated_session_count?: number;
    generated_week_count?: number;
    end_date?: string;
    conflicts?: unknown[];
    created_sessions?: unknown[];
  }>(rpcUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      p_source_session_ids: body.sourceSessionIds,
      p_displayed_week_start: body.displayedWeekStart,
      p_displayed_week_end: body.displayedWeekEnd,
      p_end_date: body.endDate,
      p_time_zone: body.timeZone,
      p_dry_run: body.dryRun,
    }),
  });

  if (!rpcResult.ok || !rpcResult.data) {
    return errorResponse(request, "upstream_error", "Week-forward scheduling authority failed", { status: 502 });
  }

  const rpcData = rpcResult.data;
  if (rpcData.success !== true) {
    const status =
      rpcData.error_code === "THERAPIST_CONFLICT" || rpcData.error_code === "CLIENT_CONFLICT"
        ? 409
        : rpcData.error_code === "FORBIDDEN"
          ? 403
          : 400;
    return errorResponse(
      request,
      status === 409 ? "conflict" : status === 403 ? "forbidden" : "validation_error",
      rpcData.error_message ?? "Unable to apply week-forward scheduling",
      {
        status,
        extra: {
          code: rpcData.error_code ?? "WEEK_FORWARD_FAILED",
          data: {
            sourceSessionCount: rpcData.source_session_count ?? 0,
            generatedSessionCount: rpcData.generated_session_count ?? 0,
            generatedWeekCount: rpcData.generated_week_count ?? 0,
            endDate: rpcData.end_date ?? body.endDate,
            conflicts: Array.isArray(rpcData.conflicts) ? rpcData.conflicts : [],
          },
        },
      },
    );
  }

  const responsePayload: WeekForwardApiResponse = {
    success: true,
    data: {
      sourceSessionCount: rpcData.source_session_count ?? 0,
      generatedSessionCount: rpcData.generated_session_count ?? 0,
      generatedWeekCount: rpcData.generated_week_count ?? 0,
      endDate: rpcData.end_date ?? body.endDate,
      conflicts: Array.isArray(rpcData.conflicts) ? (rpcData.conflicts as never[]) : [],
      ...(body.dryRun ? {} : { createdSessions: Array.isArray(rpcData.created_sessions) ? (rpcData.created_sessions as never[]) : [] }),
    },
  };

  return jsonForRequest(request, responsePayload, 200);
}
