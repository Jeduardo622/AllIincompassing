// deno-lint-ignore-file no-import-prefix
import { z } from "npm:zod";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.50.0";
import type { Role, UserContext } from "../_shared/auth-middleware.ts";
import { corsHeadersForRequest, resolveAllowedOriginForRequest } from "../_shared/cors.ts";

type ProtectedRouteFactory = (
  handler: (req: Request, userContext: UserContext) => Promise<Response>,
  options: { requireAuth?: boolean; allowedRoles?: Role[] },
) => (req: Request) => Promise<Response>;

const PAYROLL_ALLOWED_ROLES = [
  "bt",
  "therapist",
  "midtier",
  "admin_schedule",
  "admin",
  "bcba",
  "super_admin",
] as Role[];
const PAYROLL_METHODS = "POST, OPTIONS";
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
const SUPPORTED_ACTIONS = new Set([
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
const protectedErrorClassificationSchema = z.object({
  category: z.string().min(1),
  severity: z.enum(["low", "medium", "high", "critical"]),
  retryable: z.boolean(),
  httpStatus: z.number().int(),
}).strict();

const payrollApprovalActionSchema = z.discriminatedUnion("action", [
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
    state: z.enum(["feature_disabled", "unsupported_policy", "unsupported_jurisdiction", "missing_prerequisite"]),
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
const protectedErrorResponseSchema = z.object({
  success: z.literal(false),
  requestId: z.string().min(1),
  code: z.string().min(1),
  error: z.string().min(1),
  message: z.string().min(1),
  classification: protectedErrorClassificationSchema,
  idempotencyKey: z.string().min(1).optional(),
  state: z.string().min(1).optional(),
}).strict();
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

type PayrollApprovalAction = z.infer<typeof payrollApprovalActionSchema>;
type PayrollApprovalResponse = z.infer<typeof payrollApprovalResponseSchema>;
type HandlerParams = {
  req: Request;
  userContext: UserContext;
  db: SupabaseClient;
};

type InitializedDependencies = {
  protectedHandler: (req: Request) => Promise<Response>;
};

let initializedDependenciesPromise: Promise<InitializedDependencies> | null = null;
const rateState = new Map<string, { count: number; resetAt: number }>();

const consumeEdgeRateLimit = (key: string, limit: number, windowMs: number): { allowed: boolean; retryAfter?: number } => {
  const now = Date.now();
  const existing = rateState.get(key);
  if (!existing || now > existing.resetAt) {
    rateState.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true };
  }
  if (existing.count < limit) {
    existing.count += 1;
    return { allowed: true };
  }
  return {
    allowed: false,
    retryAfter: Math.ceil((existing.resetAt - now) / 1000),
  };
};

const buildCorsHeaders = (req: Request, extra: HeadersInit = {}) => {
  const headers = new Headers({
    ...corsHeadersForRequest(req),
    "Access-Control-Allow-Methods": PAYROLL_METHODS,
    "Content-Type": "application/json",
  });
  new Headers(extra).forEach((value, key) => headers.set(key, value));
  return headers;
};

const traceHeadersForRequest = (req: Request): Record<string, string> =>
  TRACE_HEADER_NAMES.reduce<Record<string, string>>((acc, headerName) => {
    const value = req.headers.get(headerName)?.trim();
    if (value) {
      acc[headerName] = value;
    }
    return acc;
  }, {});

const jsonResponse = (req: Request, status: number, body: Record<string, unknown>, extra: HeadersInit = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: buildCorsHeaders(req, { ...traceHeadersForRequest(req), ...extra }),
  });

const jsonErrorResponse = (
  req: Request,
  status: number,
  body: Record<string, unknown>,
  extra: HeadersInit = {},
) => jsonResponse(req, status, {
  success: false,
  requestId: req.headers.get("x-request-id")?.trim() || crypto.randomUUID(),
  ...body,
}, extra);

const protectedErrorResponse = (
  req: Request,
  status: number,
  body: z.infer<typeof protectedErrorResponseSchema>,
  extra: HeadersInit = {},
) => jsonErrorResponse(req, status, protectedErrorResponseSchema.parse(body), extra);

const normalizeSafeMessage = (value: unknown): string => {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().replace(/\s+/g, " ");
};

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

const validateIdempotency = (req: Request, parsed: PayrollApprovalAction): { idempotencyKey: string } | Response => {
  if (containsForbiddenAuthority(parsed)) {
    return jsonErrorResponse(req, 400, {
      code: "validation_error",
      error: "Authority fields are not allowed in payroll requests.",
      message: "Authority fields are not allowed in payroll requests.",
      classification: {
        category: "validation",
        severity: "low",
        retryable: false,
        httpStatus: 400,
      },
    });
  }

  if (parsed.action === "review_queue" || parsed.action === "review_details") {
    return { idempotencyKey: "" };
  }

  const idempotencyKey = req.headers.get("Idempotency-Key")?.trim() ?? "";
  if (!idempotencyKey) {
    return jsonErrorResponse(req, 400, {
      code: "validation_error",
      error: "Idempotency-Key is required for payroll mutations.",
      message: "Idempotency-Key is required for payroll mutations.",
      classification: {
        category: "validation",
        severity: "low",
        retryable: false,
        httpStatus: 400,
      },
    });
  }

  return { idempotencyKey };
};

const validateApprovalResponse = (
  req: Request,
  data: unknown,
  action: PayrollApprovalAction["action"],
  requestedKey: string,
): PayrollApprovalResponse | Response => {
  const schema =
    action === "review_queue"
      ? payrollReviewQueueResponseSchema
      : action === "review_details"
      ? payrollReviewDetailsResponseSchema
      : payrollApprovalResponseSchema;
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    return protectedErrorResponse(req, 502, {
      success: false,
      requestId: req.headers.get("x-request-id")?.trim() || crypto.randomUUID(),
      code: "invalid_response",
      error: "Invalid payroll approval response.",
      message: "Invalid payroll approval response.",
      classification: PAYROLL_ERROR_CLASSIFICATIONS.invalid_response,
    });
  }
  if (action === "review_queue" || action === "review_details") {
    return parsed.data as PayrollApprovalResponse;
  }
  if ((parsed.data as PayrollApprovalResponse).idempotencyKey !== requestedKey) {
    return protectedErrorResponse(req, 502, {
      success: false,
      requestId: req.headers.get("x-request-id")?.trim() || crypto.randomUUID(),
      code: "invalid_response",
      error: "Invalid payroll approval response.",
      message: "Invalid payroll approval response.",
      classification: PAYROLL_ERROR_CLASSIFICATIONS.invalid_response,
    });
  }
  return parsed.data;
};

const mapActionToRpc = (parsed: PayrollApprovalAction, idempotencyKey: string) => {
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

const featureDisabledResponse = (req: Request, idempotencyKey: string) =>
  jsonErrorResponse(req, 403, {
    code: "feature_disabled",
    error: "Payroll approval workflow is unavailable.",
    message: "Payroll approval workflow is unavailable.",
    state: "feature_disabled",
    classification: {
      category: "feature",
      severity: "medium",
      retryable: false,
      httpStatus: 403,
    },
    idempotencyKey,
  }, {
    "Idempotency-Key": idempotencyKey,
  });

const mapRpcError = (req: Request, error: { code?: string; message?: string } | null, idempotencyKey: string): Response => {
  const code = normalizeSafeMessage(error?.code);
  const message = normalizeSafeMessage(error?.message);
  const extraHeaders: Record<string, string> = {
    "Idempotency-Key": idempotencyKey,
  };

  if (message.includes("feature_disabled")) {
    return featureDisabledResponse(req, idempotencyKey);
  }
  if (message.includes("IDEMPOTENCY_CONFLICT") || code === "23505") {
    return jsonErrorResponse(req, 409, {
      code: "conflict",
      error: "Idempotency conflict.",
      message: "Idempotency conflict.",
      classification: {
        category: "request",
        severity: "medium",
        retryable: false,
        httpStatus: 409,
      },
      idempotencyKey,
    }, extraHeaders);
  }
  if (code === "42501") {
    return jsonErrorResponse(req, 403, {
      code: "forbidden",
      error: "Forbidden",
      message: "Forbidden",
      classification: {
        category: "auth",
        severity: "medium",
        retryable: false,
        httpStatus: 403,
      },
      idempotencyKey,
    }, extraHeaders);
  }
  if (code === "23514") {
    return jsonErrorResponse(req, 409, {
      code: "state_conflict",
      error: "Payroll state conflict.",
      message: "Payroll state conflict.",
      classification: PAYROLL_ERROR_CLASSIFICATIONS.state_conflict,
      idempotencyKey,
    }, extraHeaders);
  }
  if (code === "22023") {
    return jsonErrorResponse(req, 400, {
      code: "validation_error",
      error: "Invalid payroll approval request.",
      message: "Invalid payroll approval request.",
      classification: {
        category: "validation",
        severity: "low",
        retryable: false,
        httpStatus: 400,
      },
      idempotencyKey,
    }, extraHeaders);
  }
  if (code === "55P03") {
    return jsonErrorResponse(req, 409, {
      code: "conflict",
      error: "Payroll state is temporarily locked.",
      message: "Payroll state is temporarily locked.",
      classification: {
        category: "request",
        severity: "medium",
        retryable: false,
        httpStatus: 409,
      },
      idempotencyKey,
    }, {
      ...extraHeaders,
      "Retry-After": "1",
    });
  }

  return jsonErrorResponse(req, 502, {
    code: "upstream_error",
    error: "Payroll transport failed.",
    message: "Payroll transport failed.",
    classification: {
      category: "upstream",
      severity: "high",
      retryable: true,
      httpStatus: 502,
    },
    idempotencyKey,
  }, extraHeaders);
};

export async function handlePayrollApprovals({ req, userContext, db }: HandlerParams): Promise<Response> {
  const requestedOrigin = req.headers.get("origin");
  if (requestedOrigin && !resolveAllowedOriginForRequest(req)) {
    return protectedErrorResponse(req, 403, {
      success: false,
      requestId: req.headers.get("x-request-id")?.trim() || crypto.randomUUID(),
      code: "forbidden",
      error: "Origin not allowed",
      message: "Origin not allowed",
      classification: {
        category: "auth",
        severity: "medium",
        retryable: false,
        httpStatus: 403,
      },
    });
  }

  if (req.method !== "POST") {
    return protectedErrorResponse(req, 405, {
      success: false,
      requestId: req.headers.get("x-request-id")?.trim() || crypto.randomUUID(),
      code: "validation_error",
      error: "Method not allowed",
      message: "Method not allowed",
      classification: PAYROLL_ERROR_CLASSIFICATIONS.method_deny,
    });
  }

  const limit = consumeEdgeRateLimit(`payroll-approvals:${userContext.user.id}`, 60, 60_000);
  if (!limit.allowed) {
    return jsonErrorResponse(req, 429, {
      code: "rate_limited",
      error: "Too many payroll approval requests",
      message: "Too many payroll approval requests",
      classification: {
        category: "rate_limit",
        severity: "high",
        retryable: true,
        httpStatus: 429,
      },
    }, {
      ...(typeof limit.retryAfter === "number" ? { "Retry-After": String(limit.retryAfter) } : {}),
    });
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return protectedErrorResponse(req, 400, {
      success: false,
      requestId: req.headers.get("x-request-id")?.trim() || crypto.randomUUID(),
      code: "validation_error",
      error: "Invalid JSON body",
      message: "Invalid JSON body",
      classification: {
        category: "validation",
        severity: "low",
        retryable: false,
        httpStatus: 400,
      },
    });
  }

  if (containsForbiddenAuthority(payload)) {
    return protectedErrorResponse(req, 400, {
      success: false,
      requestId: req.headers.get("x-request-id")?.trim() || crypto.randomUUID(),
      code: "validation_error",
      error: "Authority fields are not allowed in payroll requests.",
      message: "Authority fields are not allowed in payroll requests.",
      classification: {
        category: "validation",
        severity: "low",
        retryable: false,
        httpStatus: 400,
      },
    });
  }

  const parsed = payrollApprovalActionSchema.safeParse(payload);
  if (!parsed.success) {
    const actionValue =
      payload && typeof payload === "object" && !Array.isArray(payload)
        ? (payload as Record<string, unknown>).action
        : undefined;
    const message = typeof actionValue === "string" && SUPPORTED_ACTIONS.has(actionValue)
      ? "Invalid payroll approval request body"
      : "Unsupported action";
    return protectedErrorResponse(req, 400, {
      success: false,
      requestId: req.headers.get("x-request-id")?.trim() || crypto.randomUUID(),
      code: "validation_error",
      error: message,
      message,
      classification: {
        category: "validation",
        severity: "low",
        retryable: false,
        httpStatus: 400,
      },
    });
  }

  const validated = validateIdempotency(req, parsed.data);
  if (validated instanceof Response) {
    return validated;
  }

  const rpc = mapActionToRpc(parsed.data, validated.idempotencyKey);
  const { data, error } = await db.rpc(rpc.functionName, rpc.args as never);
  if (error) {
    return mapRpcError(req, error as { code?: string; message?: string }, validated.idempotencyKey);
  }

  const validatedResponse = validateApprovalResponse(req, data, parsed.data.action, validated.idempotencyKey);
  if (validatedResponse instanceof Response) {
    return validatedResponse;
  }

  if (parsed.data.action === "review_queue" || parsed.data.action === "review_details") {
    return jsonResponse(req, 200, validatedResponse as unknown as Record<string, unknown>);
  }

  const replayed = validatedResponse.replayed ? "true" : "false";
  return jsonResponse(req, 200, {
    ...validatedResponse,
  }, {
    "Idempotency-Key": validatedResponse.idempotencyKey,
    "Idempotent-Replay": replayed,
  });
}

export const applyPayrollCors = async (response: Response, origin: string | null = null): Promise<Response> => {
  const headers = new Headers(response.headers);
  const corsRequest = new Request("https://edge.internal.local", {
    headers: origin ? { origin } : {},
  });
  const corsHeaders = corsHeadersForRequest(corsRequest);
  Object.entries(corsHeaders).forEach(([key, value]) => headers.set(key, value));
  headers.set("Access-Control-Allow-Methods", PAYROLL_METHODS);

  if (response.status === 204 || response.body === null) {
    return new Response(null, { status: response.status, headers });
  }

  return new Response(await response.text(), { status: response.status, headers });
};

const initializeDependencies = (): Promise<InitializedDependencies> => {
  if (!initializedDependenciesPromise) {
    initializedDependenciesPromise = Promise.all([
      import("../_shared/auth-middleware.ts"),
      import("../_shared/database.ts"),
    ]).then(([authModule, databaseModule]) => {
      const protectedHandler = (authModule.createProtectedRoute as ProtectedRouteFactory)(
        async (req, userContext) =>
          handlePayrollApprovals({
            req,
            userContext,
            db: databaseModule.createRequestClient(req),
          }),
        {
          requireAuth: true,
          allowedRoles: PAYROLL_ALLOWED_ROLES,
        },
      );
      return { protectedHandler };
    });
  }

  return initializedDependenciesPromise;
};

export async function handler(req: Request): Promise<Response> {
  const requestedOrigin = req.headers.get("origin");
  const allowedOrigin = resolveAllowedOriginForRequest(req);

  if (requestedOrigin && !allowedOrigin) {
    return protectedErrorResponse(req, 403, {
      success: false,
      requestId: req.headers.get("x-request-id")?.trim() || crypto.randomUUID(),
      code: "forbidden",
      error: "Origin not allowed",
      message: "Origin not allowed",
      classification: {
        category: "auth",
        severity: "medium",
        retryable: false,
        httpStatus: 403,
      },
    });
  }

  if (req.method === "OPTIONS") {
    const headers = buildCorsHeaders(req, {
      "Access-Control-Allow-Methods": PAYROLL_METHODS,
      "Access-Control-Allow-Headers": req.headers.get("Access-Control-Request-Headers") ?? buildCorsHeaders(req).get("Access-Control-Allow-Headers") ?? "",
    });
    return new Response(null, { status: 204, headers });
  }

  const { protectedHandler } = await initializeDependencies();
  const response = await protectedHandler(req);
  return applyPayrollCors(response, allowedOrigin);
}

export default handler;
