import { z } from "zod";
import {
  consumeRateLimit,
  corsHeadersForRequest,
  errorResponse,
  fetchAuthenticatedUserIdWithStatus,
  fetchJson,
  getAccessToken,
  getSupabaseConfig,
  isDisallowedOriginRequest,
  jsonForRequest,
  resolveOrgAndRoleWithStatus,
  resolveUserRoleWithStatus,
} from "./shared";
import { getApiAuthorityMode, proxyToEdgeAuthority } from "./edgeAuthority";

const PRESERVED_EDGE_HEADERS = new Set([
  "content-type",
  "idempotency-key",
  "idempotent-replay",
  "retry-after",
]);
const FORBIDDEN_AUTHORITY_KEYS = new Set([
  "organization_id",
  "organizationId",
  "user_id",
  "userId",
  "actor_id",
  "actorId",
  "actor_user_id",
  "actorUserId",
  "employment_profile_id",
  "employmentProfileId",
  "pay_period_id",
  "payPeriodId",
  "policy_version_id",
  "policyVersionId",
]);

const payrollTimesheetActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("get_period"), selectedLocalDate: z.string().date() }).strict(),
  z.object({ action: z.literal("derive_snapshot"), selectedLocalDate: z.string().date() }).strict(),
]);
const PAYROLL_ALLOWED_ROLES = new Set(["bt", "therapist", "midtier", "admin_schedule", "admin", "bcba", "super_admin"]);

type PayrollTimesheetAction = z.infer<typeof payrollTimesheetActionSchema>;

const containsForbiddenAuthority = (value: unknown): boolean => {
  if (!value || typeof value !== "object") {
    return false;
  }
  if (Array.isArray(value)) {
    return value.some((entry) => containsForbiddenAuthority(entry));
  }
  return Object.entries(value as Record<string, unknown>).some(([key, nestedValue]) =>
    FORBIDDEN_AUTHORITY_KEYS.has(key) || containsForbiddenAuthority(nestedValue)
  );
};

const parseFailure = async (response: Response, fallbackMessage: string) => {
  let payload: Record<string, unknown> | null = null;
  try {
    payload = await response.json() as Record<string, unknown>;
  } catch {
    payload = null;
  }
  return payload ?? { error: fallbackMessage };
};

const buildLegacyHeaders = (accessToken: string, anonKey: string): Record<string, string> => ({
  "Content-Type": "application/json",
  apikey: anonKey,
  Authorization: `Bearer ${accessToken}`,
});

const mapActionToRpc = (parsed: PayrollTimesheetAction, idempotencyKey: string | null) => {
  switch (parsed.action) {
    case "get_period":
      return {
        functionName: "get_payroll_timesheet_period",
        args: { selected_local_date: parsed.selectedLocalDate },
      };
    case "derive_snapshot":
      return {
        functionName: "derive_timesheet_snapshot",
        args: { selected_local_date: parsed.selectedLocalDate, p_idempotency_key: idempotencyKey },
      };
  }
};

export async function payrollTimesheetsHandler(request: Request): Promise<Response> {
  if (isDisallowedOriginRequest(request)) {
    return errorResponse(request, "forbidden", "Origin not allowed", { status: 403 });
  }

  if (request.method === "OPTIONS") {
    return new Response("ok", {
      status: 200,
      headers: { ...corsHeadersForRequest(request) },
    });
  }

  if (request.method !== "POST") {
    return errorResponse(request, "validation_error", "Method not allowed", { status: 405 });
  }

  const accessToken = getAccessToken(request);
  if (!accessToken) {
    return errorResponse(request, "unauthorized", "Missing authorization token", {
      headers: { "WWW-Authenticate": "Bearer" },
    });
  }

  const rateLimit = await consumeRateLimit(request, {
    keyPrefix: "api:payroll-timesheets",
    maxRequests: 60,
    windowMs: 60_000,
  });
  if (rateLimit.limited) {
    return errorResponse(request, "rate_limited", "Too many payroll transport requests", {
      headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
    });
  }

  const { organizationId, upstreamError: roleUpstreamError } = await resolveOrgAndRoleWithStatus(accessToken);
  if (roleUpstreamError) {
    return errorResponse(request, "upstream_error", "Unable to validate organization access", { status: 502 });
  }
  if (!organizationId) {
    return errorResponse(request, "forbidden", "Forbidden");
  }

  const { userId, upstreamError: userUpstreamError } = await fetchAuthenticatedUserIdWithStatus(accessToken);
  if (userUpstreamError) {
    return errorResponse(request, "upstream_error", "Unable to validate authenticated user", { status: 502 });
  }
  if (!userId) {
    return errorResponse(request, "forbidden", "Forbidden");
  }

  const { role, upstreamError: userRoleUpstreamError } = await resolveUserRoleWithStatus(accessToken, userId);
  if (userRoleUpstreamError) {
    return errorResponse(request, "upstream_error", "Unable to validate payroll role", { status: 502 });
  }
  if (!role || !PAYROLL_ALLOWED_ROLES.has(role)) {
    return errorResponse(request, "forbidden", "Forbidden");
  }

  let payload: unknown;
  try {
    payload = await request.clone().json();
  } catch {
    return errorResponse(request, "validation_error", "Invalid JSON body", { status: 400 });
  }

  if (containsForbiddenAuthority(payload)) {
    return errorResponse(request, "validation_error", "Authority fields are not allowed in payroll requests.", { status: 400 });
  }

  const parsed = payrollTimesheetActionSchema.safeParse(payload);
  if (!parsed.success) {
    return errorResponse(request, "validation_error", "Unsupported action", { status: 400 });
  }

  const idempotencyKey = parsed.data.action === "derive_snapshot"
    ? request.headers.get("Idempotency-Key")?.trim() ?? ""
    : null;
  if (parsed.data.action === "derive_snapshot" && !idempotencyKey) {
    return errorResponse(request, "validation_error", "Idempotency-Key is required for payroll mutations.", { status: 400 });
  }

  if (getApiAuthorityMode() === "edge") {
    const forwarded = await proxyToEdgeAuthority(request, {
      functionName: "payroll-timesheets",
      accessToken,
      method: "POST",
    });
    const text = await forwarded.text();
    const responseHeaders = new Headers({
      ...corsHeadersForRequest(request),
      "Content-Type": forwarded.headers.get("Content-Type") ?? "application/json",
    });
    forwarded.headers.forEach((value, key) => {
      if (PRESERVED_EDGE_HEADERS.has(key.toLowerCase())) {
        responseHeaders.set(key, value);
      }
    });
    return new Response(text, { status: forwarded.status, headers: responseHeaders });
  }

  const { supabaseUrl, anonKey } = getSupabaseConfig();
  const rpc = mapActionToRpc(parsed.data, idempotencyKey);
  const result = await fetchJson<Record<string, unknown>>(`${supabaseUrl}/rest/v1/rpc/${rpc.functionName}`, {
    method: "POST",
    headers: buildLegacyHeaders(accessToken, anonKey),
    body: JSON.stringify(rpc.args),
  });

  if (!result.ok || !result.data) {
    const body: Record<string, unknown> = { error: "Payroll transport failed." };
    if (idempotencyKey) {
      body.idempotencyKey = idempotencyKey;
    }
    if ((result.data as { code?: string } | null)?.code === "23505") {
      return jsonForRequest(request, { ...body, code: "conflict", message: "Idempotency conflict." }, 409, {
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      });
    }
    if ((result.data as { code?: string } | null)?.code === "23514") {
      return jsonForRequest(request, { ...body, code: "state_conflict", message: "Payroll state conflict." }, 409, {
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      });
    }
    return jsonForRequest(request, { ...body, ...(await parseFailure(new Response(JSON.stringify(result.data ?? body)), "Payroll transport failed.")) }, result.status >= 400 ? result.status : 502, {
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    });
  }

  if (idempotencyKey) {
    return jsonForRequest(request, { ...result.data, idempotencyKey }, 200, {
      "Idempotency-Key": idempotencyKey,
      ...(typeof result.data.replayed === "boolean" ? { "Idempotent-Replay": result.data.replayed ? "true" : "false" } : {}),
    });
  }

  return jsonForRequest(request, result.data, 200);
}
