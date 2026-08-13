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
  "self_approval",
  "review_queue",
  "review_details",
  "submit",
  "manager_approve",
  "return",
  "lock",
  "reopen",
  "resolve_blocker",
]);

const snapshotHashSchema = z.string().regex(/^[0-9a-f]{64}$/);
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
    action: z.literal("self_approval"),
    selectedLocalDate: z.string().date(),
  }).strict(),
  z.object({
    action: z.literal("review_queue"),
    selectedLocalDate: z.string().date(),
  }).strict(),
  z.object({
    action: z.literal("review_details"),
    snapshotId: z.string().uuid(),
    snapshotHash: snapshotHashSchema,
  }).strict(),
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
const payrollReviewStateSchema = z.enum([
  "ok",
  "feature_disabled",
  "unsupported_policy",
  "unsupported_jurisdiction",
  "missing_prerequisite",
]);
const payrollReviewCapabilitiesSchema = z.object({
  canReviewAssigned: z.boolean(),
  canApproveAssigned: z.boolean(),
  canViewCompensation: z.boolean(),
  hasOrgPayrollAccess: z.boolean(),
}).strict();
const payrollSelfApprovalOkResponseSchema = z.object({
  state: z.literal("ok"),
  selectedLocalDate: z.string().date(),
  approval: z.object({
    currentState: z.string().min(1),
    submittedAt: z.string().min(1).nullable(),
    returnedComment: z.string().nullable(),
    unresolvedBlockerCount: z.number().int(),
    snapshot: z.object({
      id: z.string().uuid().nullable(),
      hash: snapshotHashSchema.nullable(),
      isCurrent: z.boolean(),
    }).strict(),
    actions: z.object({
      canSubmit: z.boolean(),
    }).strict(),
    compensation: z.object({
      grossEarningsCents: z.number().int(),
    }).strict().optional(),
    history: z.array(z.object({
      action: z.string().min(1),
      occurredAt: z.string().min(1),
      comment: z.string().nullable(),
      reason: z.string().nullable(),
      snapshotId: z.string().uuid(),
      snapshotHash: snapshotHashSchema,
    }).strict()),
  }).strict(),
}).strict();
const payrollSelfApprovalResponseSchema = z.discriminatedUnion("state", [
  payrollSelfApprovalOkResponseSchema,
  z.object({ state: z.literal("feature_disabled") }).strict(),
  z.object({ state: z.literal("unsupported_policy") }).strict(),
  z.object({ state: z.literal("unsupported_jurisdiction") }).strict(),
  z.object({ state: z.literal("missing_prerequisite") }).strict(),
  z.object({ state: z.literal("no_employment_profile") }).strict(),
]);
const payrollReviewQueueItemSchema = z.object({
  employeeLabel: z.string().min(1),
  employmentProfileId: z.string().uuid(),
  payPeriodId: z.string().uuid(),
  periodStart: z.string().date(),
  periodEnd: z.string().date(),
  state: z.string().min(1),
  blockerCount: z.number().int(),
  submittedAt: z.string().min(1).nullable(),
  snapshot: z.object({
    id: z.string().uuid().nullable(),
    hash: snapshotHashSchema.nullable(),
  }).strict(),
  classifiedSeconds: z.object({
    regular: z.number().int(),
    overtime: z.number().int(),
    doubleTime: z.number().int(),
  }).strict(),
  compensation: z.object({
    grossEarningsCents: z.number().int(),
  }).strict().optional(),
}).strict();
const payrollReviewQueueResponseSchema = z.union([
  z.object({
    state: z.literal("ok"),
    selectedLocalDate: z.string().date(),
    capabilities: payrollReviewCapabilitiesSchema,
    queue: z.array(payrollReviewQueueItemSchema),
  }).strict(),
  z.object({
    state: payrollReviewStateSchema.exclude(["ok"]),
    selectedLocalDate: z.string().date(),
    capabilities: payrollReviewCapabilitiesSchema,
    queue: z.array(payrollReviewQueueItemSchema),
  }).strict(),
]);
const payrollReviewDetailsResponseSchema = z.object({
  state: z.literal("ok"),
  snapshotId: z.string().uuid(),
  snapshotHash: snapshotHashSchema,
  periodStart: z.string().date(),
  periodEnd: z.string().date(),
  punches: z.array(z.object({
    id: z.string().uuid(),
    eventType: z.string().min(1),
    occurredAt: z.string().min(1),
    timezone: z.string().min(1),
    workLocation: z.string().nullable(),
    workCategory: z.string().nullable(),
    createdAt: z.string().min(1),
  }).strict()),
  classifiedSeconds: z.object({
    regular: z.number().int(),
    overtime: z.number().int(),
    doubleTime: z.number().int(),
  }).strict(),
  approvalHistory: z.array(z.object({
    action: z.string().min(1),
    occurredAt: z.string().min(1),
    comment: z.string().nullable(),
    reason: z.string().nullable(),
    snapshotId: z.string().uuid(),
    snapshotHash: snapshotHashSchema,
  }).strict()),
  blockers: z.array(z.object({
    blockerType: blockerTypeSchema,
    blockerId: z.string().uuid(),
    state: z.string().min(1),
    createdAt: z.string().min(1),
  }).strict()),
  unresolvedBlockerCount: z.number().int(),
  compensation: z.object({
    grossEarningsCents: z.number().int(),
  }).strict().optional(),
}).strict();
const payrollApprovalErrorSchema = z.object({
  success: z.literal(false),
  error: z.string().min(1),
  requestId: z.string().min(1),
  code: z.enum(["feature_disabled", "conflict", "state_conflict", "validation_error", "forbidden", "unauthorized", "upstream_error", "rate_limited", "invalid_response"]),
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
type PayrollApprovalErrorCode = z.infer<typeof payrollApprovalErrorSchema.shape.code>;

const PAYROLL_ERROR_CLASSIFICATIONS = {
  method_deny: {
    category: "validation",
    severity: "low",
    retryable: false,
    httpStatus: 405,
  },
  invalid_response: {
    category: "upstream",
    severity: "high",
    retryable: false,
    httpStatus: 502,
  },
  state_conflict: {
    category: "request",
    severity: "medium",
    retryable: false,
    httpStatus: 409,
  },
} as const;

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

const payrollErrorResponse = (
  request: Request,
  status: number,
  payload: {
    code: PayrollApprovalErrorCode;
    message: string;
    classification: {
      category: string;
      severity: "low" | "medium" | "high" | "critical";
      retryable: boolean;
      httpStatus: number;
    };
    idempotencyKey?: string;
    state?: string;
  },
  traceHeaders: Record<string, string>,
  extraHeaders: Record<string, string> = {},
) =>
  jsonForRequest(request, {
    success: false,
    error: payload.message,
    requestId: request.headers.get("x-request-id")?.trim() || crypto.randomUUID(),
    code: payload.code,
    message: payload.message,
    classification: payload.classification,
    ...(payload.idempotencyKey ? { idempotencyKey: payload.idempotencyKey } : {}),
    ...(payload.state ? { state: payload.state } : {}),
  }, status, {
    ...traceHeaders,
    ...extraHeaders,
  });

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

  if (
    parsed.action === "self_approval"
    || parsed.action === "review_queue"
    || parsed.action === "review_details"
  ) {
    return { idempotencyKey: "" };
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
  action: PayrollApprovalAction["action"],
  payload: unknown,
  requestedKey: string,
): PayrollApprovalTransition
  | PayrollBlockerResolution
  | z.infer<typeof payrollSelfApprovalResponseSchema>
  | z.infer<typeof payrollReviewQueueResponseSchema>
  | z.infer<typeof payrollReviewDetailsResponseSchema>
  | Response => {
  const schema =
    action === "self_approval"
      ? payrollSelfApprovalResponseSchema
      : action === "review_queue"
      ? payrollReviewQueueResponseSchema
      : action === "review_details"
      ? payrollReviewDetailsResponseSchema
      : payrollApprovalResponseSchema;
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    return payrollErrorResponse(request, 502, {
      code: "invalid_response",
      message: "Invalid payroll approval response.",
      classification: PAYROLL_ERROR_CLASSIFICATIONS.invalid_response,
    }, traceHeaders);
  }
  if (action === "self_approval" || action === "review_queue" || action === "review_details") {
    return parsed.data;
  }
  if (parsed.data.idempotencyKey !== requestedKey) {
    return payrollErrorResponse(request, 502, {
      code: "invalid_response",
      message: "Invalid payroll approval response.",
      classification: PAYROLL_ERROR_CLASSIFICATIONS.invalid_response,
    }, traceHeaders);
  }
  return parsed.data;
};

type PayrollApprovalTransition = z.infer<typeof payrollApprovalTransitionResponseSchema>;
type PayrollBlockerResolution = z.infer<typeof payrollBlockerResolutionResponseSchema>;

const mapActionToRpc = (parsed: PayrollApprovalAction, idempotencyKey: string) => {
  if (parsed.action === "self_approval") {
    return {
      functionName: "get_payroll_self_approval",
      args: {
        selected_local_date: parsed.selectedLocalDate,
      },
    };
  }

  if (parsed.action === "review_queue") {
    return {
      functionName: "get_payroll_review_queue",
      args: {
        selected_local_date: parsed.selectedLocalDate,
      },
    };
  }

  if (parsed.action === "review_details") {
    return {
      functionName: "get_payroll_review_details",
      args: {
        snapshot_id: parsed.snapshotId,
        snapshot_hash: parsed.snapshotHash,
      },
    };
  }

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
  if (message.includes("IDEMPOTENCY_CONFLICT") || code === "23505" || (result.status === 409 && code !== "23514")) {
    return errorResponse(request, "conflict", "Idempotency conflict.", {
      status: 409,
      headers,
      extra,
    });
  }
  if (code === "23514") {
    return payrollErrorResponse(request, 409, {
      code: "state_conflict",
      message: "Payroll state conflict.",
      classification: PAYROLL_ERROR_CLASSIFICATIONS.state_conflict,
      idempotencyKey,
    }, traceHeaders, {
      "Idempotency-Key": idempotencyKey,
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

const invalidForwardedEdgeResponse = (
  request: Request,
  traceHeaders: Record<string, string>,
) =>
  errorResponse(request, "upstream_error", "Invalid payroll approval response.", {
    status: 502,
    headers: traceHeaders,
    extra: {
      code: "invalid_response",
      classification: PAYROLL_ERROR_CLASSIFICATIONS.invalid_response,
    },
  });

const validateForwardedErrorIdempotency = (
  request: Request,
  traceHeaders: Record<string, string>,
  payload: z.infer<typeof payrollApprovalErrorSchema>,
  forwardedHeaders: Headers,
) => {
  const requestIdempotencyKey = request.headers.get("Idempotency-Key")?.trim() ?? "";
  const headerIdempotencyKey = forwardedHeaders.get("Idempotency-Key")?.trim() ?? "";
  const bodyIdempotencyKey = payload.idempotencyKey?.trim() ?? "";
  const expectedKey = requestIdempotencyKey;

  if (bodyIdempotencyKey || headerIdempotencyKey || expectedKey) {
    if (!bodyIdempotencyKey || !headerIdempotencyKey) {
      return invalidForwardedEdgeResponse(request, traceHeaders);
    }
    if (bodyIdempotencyKey !== headerIdempotencyKey) {
      return invalidForwardedEdgeResponse(request, traceHeaders);
    }
    if (expectedKey && headerIdempotencyKey !== expectedKey) {
      return invalidForwardedEdgeResponse(request, traceHeaders);
    }
  }

  return {
    idempotencyKey: headerIdempotencyKey || bodyIdempotencyKey || null,
  };
};

const buildForwardedEdgeResponse = (
  request: Request,
  traceHeaders: Record<string, string>,
  status: number,
  payload: z.infer<typeof payrollApprovalErrorSchema>,
  forwardedHeaders: Headers,
) => {
  const validatedIdempotency = validateForwardedErrorIdempotency(request, traceHeaders, payload, forwardedHeaders);
  if (validatedIdempotency instanceof Response) {
    return validatedIdempotency;
  }

  const responseHeaders = new Headers({
    ...corsHeadersForRequest(request),
    ...traceHeaders,
    "Content-Type": "application/json",
  });
  if (validatedIdempotency.idempotencyKey) {
    responseHeaders.set("Idempotency-Key", validatedIdempotency.idempotencyKey);
  }
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
    return payrollErrorResponse(request, 405, {
      code: "validation_error",
      message: "Method not allowed",
      classification: PAYROLL_ERROR_CLASSIFICATIONS.method_deny,
    }, traceHeaders);
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
        parsed.data.action,
        responsePayload,
        validated.idempotencyKey,
      );
      if (successPayload instanceof Response) {
        return successPayload;
      }
      if (
        parsed.data.action === "self_approval"
        || parsed.data.action === "review_queue"
        || parsed.data.action === "review_details"
      ) {
        return jsonForRequest(
          request,
          successPayload as Record<string, unknown>,
          200,
          { ...traceHeaders, ...forwardedTraceHeaders },
        );
      }
      return buildSuccessResponse(
        request,
        { ...traceHeaders, ...forwardedTraceHeaders },
        successPayload as PayrollApprovalTransition | PayrollBlockerResolution,
        (successPayload as PayrollApprovalTransition | PayrollBlockerResolution).idempotencyKey,
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
    parsed.data.action,
    result.data,
    validated.idempotencyKey,
  );
  if (validatedResponse instanceof Response) {
    return validatedResponse;
  }

  if (
    parsed.data.action === "self_approval"
    || parsed.data.action === "review_queue"
    || parsed.data.action === "review_details"
  ) {
    return jsonForRequest(request, validatedResponse as Record<string, unknown>, 200, traceHeaders);
  }

  return buildSuccessResponse(request, traceHeaders, validatedResponse, validatedResponse.idempotencyKey);
}
