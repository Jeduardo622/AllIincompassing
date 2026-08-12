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

const TRACE_HEADER_NAMES = [
  "x-request-id",
  "x-correlation-id",
  "x-agent-operation-id",
] as const;
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
]);
const PAYROLL_ALLOWED_ROLES = new Set(["bt", "therapist", "midtier", "admin_schedule", "admin", "bcba", "super_admin"]);
const SUPPORTED_ACTIONS = new Set([
  "submit",
  "manager_approve",
  "return",
  "lock",
  "reopen",
  "resolve_blocker",
]);

const snapshotHashSchema = z.string().min(1);
const transitionActionResultSchema = z.enum([
  "submitted",
  "manager_approved",
  "returned",
  "locked",
  "reopened",
  "approval_invalidated",
]);
const blockerTypeSchema = z.enum([
  "time_correction_request",
  "session_attendance_correction_request",
  "timekeeping_exception",
]);
const blockerResolutionSchema = z.enum(["resolved", "reopened"]);

const payrollApprovalActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("submit"),
    snapshotId: z.string().uuid(),
    snapshotHash: snapshotHashSchema,
    attestation: z.literal(true),
  }).strict(),
  z.object({
    action: z.literal("manager_approve"),
    snapshotId: z.string().uuid(),
    snapshotHash: snapshotHashSchema,
    comment: z.string().min(1).optional(),
  }).strict(),
  z.object({
    action: z.literal("return"),
    snapshotId: z.string().uuid(),
    snapshotHash: snapshotHashSchema,
    comment: z.string().min(1),
  }).strict(),
  z.object({
    action: z.literal("lock"),
    snapshotId: z.string().uuid(),
    snapshotHash: snapshotHashSchema,
  }).strict(),
  z.object({
    action: z.literal("reopen"),
    snapshotId: z.string().uuid(),
    snapshotHash: snapshotHashSchema,
    reason: z.string().min(1),
  }).strict(),
  z.object({
    action: z.literal("resolve_blocker"),
    snapshotId: z.string().uuid(),
    snapshotHash: snapshotHashSchema,
    blockerType: blockerTypeSchema,
    blockerId: z.string().uuid(),
    resolution: blockerResolutionSchema,
    reason: z.string().min(1),
  }).strict(),
]);

const payrollApprovalTransitionResponseSchema = z.object({
  transitionId: z.string().uuid(),
  snapshotId: z.string().uuid(),
  snapshotHash: snapshotHashSchema,
  canonicalSnapshotHash: snapshotHashSchema,
  action: transitionActionResultSchema,
  previousTransitionId: z.string().uuid().nullable(),
  replayed: z.boolean(),
  occurredAt: z.string().min(1),
  idempotencyKey: z.string().min(1),
}).strict();

const payrollBlockerResolutionResponseSchema = z.object({
  resolutionId: z.string().uuid(),
  blockerType: blockerTypeSchema,
  blockerId: z.string().uuid(),
  payPeriodId: z.string().uuid(),
  action: blockerResolutionSchema,
  previousResolutionId: z.string().uuid().nullable(),
  replayed: z.boolean(),
  occurredAt: z.string().min(1),
  idempotencyKey: z.string().min(1),
}).strict();

const payrollApprovalResponseSchema = z.union([
  payrollApprovalTransitionResponseSchema,
  payrollBlockerResolutionResponseSchema,
]);
const payrollApprovalErrorSchema = z.object({
  success: z.literal(false),
  error: z.string().min(1),
  requestId: z.string().min(1),
  code: z.enum(["feature_disabled", "conflict", "validation_error", "forbidden", "upstream_error", "rate_limited"]),
  message: z.string().min(1),
  classification: z.object({
    category: z.string().min(1),
    severity: z.enum(["low", "medium", "high", "critical"]),
    retryable: z.boolean(),
    httpStatus: z.number().int(),
  }).strict(),
  idempotencyKey: z.string().min(1).optional(),
  state: z.string().min(1).optional(),
}).strict();

type PayrollApprovalAction = z.infer<typeof payrollApprovalActionSchema>;

const traceHeadersForRequest = (request: Request): Record<string, string> =>
  TRACE_HEADER_NAMES.reduce<Record<string, string>>((acc, headerName) => {
    const value = request.headers.get(headerName)?.trim();
    if (value) {
      acc[headerName] = value;
    }
    return acc;
  }, {});

const traceHeadersFromHeaders = (headers: Headers): Record<string, string> =>
  TRACE_HEADER_NAMES.reduce<Record<string, string>>((acc, headerName) => {
    const value = headers.get(headerName)?.trim();
    if (value) {
      acc[headerName] = value;
    }
    return acc;
  }, {});

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

const normalizeSafeMessage = (value: unknown): string => {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().replace(/\s+/g, " ");
};

const buildLegacyHeaders = (accessToken: string, anonKey: string): Record<string, string> => ({
  "Content-Type": "application/json",
  apikey: anonKey,
  Authorization: `Bearer ${accessToken}`,
});

const validateIdempotency = (
  request: Request,
  parsed: PayrollApprovalAction,
  traceHeaders: Record<string, string>,
): { idempotencyKey: string } | Response => {
  if (containsForbiddenAuthority(parsed)) {
    return errorResponse(request, "validation_error", "Authority fields are not allowed in payroll requests.", {
      headers: traceHeaders,
    });
  }

  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() ?? "";
  if (!idempotencyKey) {
    return errorResponse(request, "validation_error", "Idempotency-Key is required for payroll mutations.", {
      headers: traceHeaders,
    });
  }

  return { idempotencyKey };
};

const validateApprovalResponse = (
  request: Request,
  traceHeaders: Record<string, string>,
  payload: unknown,
  requestedKey: string,
): PayrollApprovalTransition | PayrollBlockerResolution | Response => {
  const parsed = payrollApprovalResponseSchema.safeParse(payload);
  if (!parsed.success) {
    return errorResponse(request, "upstream_error", "Invalid payroll approval response.", {
      status: 502,
      headers: traceHeaders,
      extra: { code: "invalid_response" },
    });
  }
  if (parsed.data.idempotencyKey !== requestedKey) {
    return errorResponse(request, "upstream_error", "Invalid payroll approval response.", {
      status: 502,
      headers: traceHeaders,
      extra: { code: "invalid_response" },
    });
  }
  return parsed.data;
};

type PayrollApprovalTransition = z.infer<typeof payrollApprovalTransitionResponseSchema>;
type PayrollBlockerResolution = z.infer<typeof payrollBlockerResolutionResponseSchema>;

const mapActionToRpc = (parsed: PayrollApprovalAction, idempotencyKey: string) => {
  if (parsed.action === "resolve_blocker") {
    return {
      functionName: "resolve_payroll_blocker",
      args: {
        p_payload: {
          snapshotId: parsed.snapshotId,
          snapshotHash: parsed.snapshotHash,
          blockerType: parsed.blockerType,
          blockerId: parsed.blockerId,
          action: parsed.resolution,
          reason: parsed.reason,
        },
        p_idempotency_key: idempotencyKey,
      },
    };
  }

  return {
    functionName: "transition_timesheet_approval",
    args: {
      p_payload: {
        action: parsed.action,
        snapshotId: parsed.snapshotId,
        snapshotHash: parsed.snapshotHash,
        ...(parsed.action === "submit" ? { attestation: true } : {}),
        ...(parsed.action === "manager_approve" && parsed.comment ? { comment: parsed.comment } : {}),
        ...(parsed.action === "return" ? { comment: parsed.comment } : {}),
        ...(parsed.action === "reopen" ? { reason: parsed.reason } : {}),
      },
      p_idempotency_key: idempotencyKey,
    },
  };
};

const featureDisabledResponse = (
  request: Request,
  traceHeaders: Record<string, string>,
  idempotencyKey: string,
) =>
  jsonForRequest(request, {
    success: false,
    error: "Payroll approval workflow is unavailable.",
    requestId: request.headers.get("x-request-id")?.trim() || crypto.randomUUID(),
    code: "feature_disabled",
    message: "Payroll approval workflow is unavailable.",
    state: "feature_disabled",
    classification: {
      category: "feature",
      severity: "medium",
      retryable: false,
      httpStatus: 403,
    },
    idempotencyKey,
  }, 403, {
    ...traceHeaders,
    "Idempotency-Key": idempotencyKey,
  });

const mapLegacyError = (
  request: Request,
  traceHeaders: Record<string, string>,
  result: { status: number; ok: boolean; data: unknown | null },
  idempotencyKey: string,
): Response => {
  const message = normalizeSafeMessage((result.data as { message?: unknown; error?: unknown } | null)?.message) ||
    normalizeSafeMessage((result.data as { error?: unknown } | null)?.error);
  const code = normalizeSafeMessage((result.data as { code?: unknown } | null)?.code);
  const headers: Record<string, string> = { ...traceHeaders, "Idempotency-Key": idempotencyKey };
  const extra = { idempotencyKey };

  if (message.includes("feature_disabled")) {
    return featureDisabledResponse(request, traceHeaders, idempotencyKey);
  }
  if (message.includes("IDEMPOTENCY_CONFLICT") || code === "23505" || result.status === 409) {
    return errorResponse(request, "conflict", "Idempotency conflict.", {
      status: 409,
      headers,
      extra,
    });
  }
  if (code === "23514") {
    return errorResponse(request, "conflict", "Payroll state conflict.", {
      status: 409,
      headers,
      extra: { ...extra, code: "state_conflict" },
    });
  }
  if (code === "22023") {
    return errorResponse(request, "validation_error", "Invalid payroll approval request.", {
      status: 400,
      headers,
      extra,
    });
  }
  if (code === "42501" || result.status === 403) {
    return errorResponse(request, "forbidden", "Forbidden", {
      status: 403,
      headers,
      extra,
    });
  }
  if (code === "55P03") {
    return errorResponse(request, "conflict", "Payroll state is temporarily locked.", {
      status: 409,
      headers: { ...headers, "Retry-After": "1" },
      extra,
    });
  }

  return errorResponse(request, "upstream_error", "Payroll transport failed.", {
    status: result.status >= 400 ? result.status : 502,
    headers,
    extra,
  });
};

const mapForwardedEdgeError = (
  request: Request,
  traceHeaders: Record<string, string>,
  status: number,
  idempotencyKey: string,
  forwardedHeaders: Headers,
) => {
  const headers: Record<string, string> = { ...traceHeaders, "Idempotency-Key": idempotencyKey };
  const retryAfter = forwardedHeaders.get("Retry-After")?.trim();
  if (status === 400) {
    return errorResponse(request, "validation_error", "Invalid payroll approval request.", {
      status,
      headers,
      extra: { idempotencyKey },
    });
  }
  if (status === 403) {
    return errorResponse(request, "forbidden", "Forbidden", {
      status,
      headers,
      extra: { idempotencyKey },
    });
  }
  if (status === 409) {
    return errorResponse(request, "conflict", "Idempotency conflict.", {
      status,
      headers,
      extra: { idempotencyKey },
    });
  }
  if (status === 429) {
    return errorResponse(request, "rate_limited", "Too many payroll approval requests", {
      status,
      headers: retryAfter ? { ...headers, "Retry-After": retryAfter } : headers,
      extra: { idempotencyKey },
    });
  }
  return errorResponse(request, "upstream_error", "Payroll transport failed.", {
    status: status >= 400 ? status : 502,
    headers: retryAfter ? { ...headers, "Retry-After": retryAfter } : headers,
    extra: { idempotencyKey },
  });
};

const buildForwardedEdgeResponse = (
  request: Request,
  traceHeaders: Record<string, string>,
  status: number,
  payload: unknown,
  forwardedHeaders: Headers,
) => {
  const responseHeaders = new Headers({
    ...corsHeadersForRequest(request),
    ...traceHeaders,
    "Content-Type": "application/json",
  });
  if (forwardedHeaders.get("Retry-After")) {
    responseHeaders.set("Retry-After", forwardedHeaders.get("Retry-After") as string);
  }
  if (forwardedHeaders.get("WWW-Authenticate")) {
    responseHeaders.set("WWW-Authenticate", forwardedHeaders.get("WWW-Authenticate") as string);
  }
  return new Response(JSON.stringify(payload), {
    status,
    headers: responseHeaders,
  });
};

const buildSuccessResponse = (
  request: Request,
  traceHeaders: Record<string, string>,
  body: PayrollApprovalTransition | PayrollBlockerResolution,
  idempotencyKey: string,
) => {
  const replayed = body.replayed ? "true" : "false";
  return jsonForRequest(request, {
    ...body,
    idempotencyKey,
  }, 200, {
    ...traceHeaders,
    "Idempotency-Key": idempotencyKey,
    "Idempotent-Replay": replayed,
  });
};

export async function payrollApprovalsHandler(request: Request): Promise<Response> {
  const traceHeaders = traceHeadersForRequest(request);

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

  const accessToken = getAccessToken(request);
  if (!accessToken) {
    return errorResponse(request, "unauthorized", "Missing authorization token", {
      headers: { ...traceHeaders, "WWW-Authenticate": "Bearer" },
    });
  }

  const rateLimit = await consumeRateLimit(request, {
    keyPrefix: "api:payroll-approvals",
    maxRequests: 60,
    windowMs: 60_000,
  });
  if (rateLimit.limited) {
    return errorResponse(request, "rate_limited", "Too many payroll approval requests", {
      headers: { ...traceHeaders, "Retry-After": String(rateLimit.retryAfterSeconds) },
    });
  }

  const { organizationId, upstreamError: roleUpstreamError } = await resolveOrgAndRoleWithStatus(accessToken);
  if (roleUpstreamError) {
    return errorResponse(request, "upstream_error", "Unable to validate organization access", {
      status: 502,
      headers: traceHeaders,
    });
  }
  if (!organizationId) {
    return errorResponse(request, "forbidden", "Forbidden", { headers: traceHeaders });
  }

  const { userId, upstreamError: userUpstreamError } = await fetchAuthenticatedUserIdWithStatus(accessToken);
  if (userUpstreamError) {
    return errorResponse(request, "upstream_error", "Unable to validate authenticated user", {
      status: 502,
      headers: traceHeaders,
    });
  }
  if (!userId) {
    return errorResponse(request, "forbidden", "Forbidden", { headers: traceHeaders });
  }

  const { role, upstreamError: userRoleUpstreamError } = await resolveUserRoleWithStatus(accessToken, userId);
  if (userRoleUpstreamError) {
    return errorResponse(request, "upstream_error", "Unable to validate payroll role", {
      status: 502,
      headers: traceHeaders,
    });
  }
  if (!role || !PAYROLL_ALLOWED_ROLES.has(role)) {
    return errorResponse(request, "forbidden", "Forbidden", { headers: traceHeaders });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return errorResponse(request, "validation_error", "Invalid JSON body", { headers: traceHeaders });
  }

  if (containsForbiddenAuthority(payload)) {
    return errorResponse(request, "validation_error", "Authority fields are not allowed in payroll requests.", {
      headers: traceHeaders,
    });
  }

  const parsed = payrollApprovalActionSchema.safeParse(payload);
  if (!parsed.success) {
    const actionValue =
      payload && typeof payload === "object" && !Array.isArray(payload)
        ? (payload as Record<string, unknown>).action
        : undefined;
    return errorResponse(
      request,
      "validation_error",
      typeof actionValue === "string" && SUPPORTED_ACTIONS.has(actionValue)
        ? "Invalid payroll approval request body"
        : "Unsupported action",
      { headers: traceHeaders },
    );
  }

  const validated = validateIdempotency(request, parsed.data, traceHeaders);
  if (validated instanceof Response) {
    return validated;
  }

  if (getApiAuthorityMode() === "edge") {
    const forwarded = await proxyToEdgeAuthority(request, {
      functionName: "payroll-approvals",
      accessToken,
      method: "POST",
    });
    const forwardedTraceHeaders = traceHeadersFromHeaders(forwarded.headers);
    const text = await forwarded.text();
    let responsePayload: unknown = null;
    try {
      responsePayload = text ? JSON.parse(text) : null;
    } catch {
      responsePayload = null;
    }

    if (forwarded.ok) {
      const successPayload = validateApprovalResponse(
        request,
        traceHeaders,
        responsePayload,
        validated.idempotencyKey,
      );
      if (successPayload instanceof Response) {
        return successPayload;
      }
      return buildSuccessResponse(
        request,
        { ...traceHeaders, ...forwardedTraceHeaders },
        successPayload,
        successPayload.idempotencyKey,
      );
    }

    const parsedError = payrollApprovalErrorSchema.safeParse(responsePayload);
    if (parsedError.success) {
      return buildForwardedEdgeResponse(
        request,
        { ...traceHeaders, ...forwardedTraceHeaders },
        forwarded.status,
        parsedError.data,
        forwarded.headers,
      );
    }

    return mapForwardedEdgeError(
      request,
      traceHeaders,
      forwarded.status,
      validated.idempotencyKey,
      forwarded.headers,
    );
  }

  const { supabaseUrl, anonKey } = getSupabaseConfig();
  const rpc = mapActionToRpc(parsed.data, validated.idempotencyKey);
  const result = await fetchJson<Record<string, unknown>>(`${supabaseUrl}/rest/v1/rpc/${rpc.functionName}`, {
    method: "POST",
    headers: buildLegacyHeaders(accessToken, anonKey),
    body: JSON.stringify(rpc.args),
  });

  if (!result.ok || !result.data) {
    return mapLegacyError(request, traceHeaders, result, validated.idempotencyKey);
  }

  const validatedResponse = validateApprovalResponse(
    request,
    traceHeaders,
    result.data,
    validated.idempotencyKey,
  );
  if (validatedResponse instanceof Response) {
    return validatedResponse;
  }

  return buildSuccessResponse(request, traceHeaders, validatedResponse, validatedResponse.idempotencyKey);
}
