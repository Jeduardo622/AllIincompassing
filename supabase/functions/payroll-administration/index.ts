// deno-lint-ignore-file no-import-prefix
import { z } from "npm:zod";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.50.0";
import type { Role, UserContext } from "../_shared/auth-middleware.ts";
import { corsHeadersForRequest, resolveAllowedOriginForRequest } from "../_shared/cors.ts";

type ProtectedRouteFactory = (
  handler: (req: Request, userContext: UserContext) => Promise<Response>,
  options: { requireAuth?: boolean; allowedRoles?: Role[] },
) => (req: Request) => Promise<Response>;

const PAYROLL_ALLOWED_ROLES = ["admin", "super_admin"] as Role[];
const PAYROLL_METHODS = "POST, OPTIONS";
const TRACE_HEADER_NAMES = [
  "x-request-id",
  "x-correlation-id",
  "x-agent-operation-id",
] as const;
const FORBIDDEN_AUTHORITY_KEYS = new Set([
  "organization_id",
  "organizationid",
  "org_id",
  "orgid",
  "org",
  "actor_user_id",
  "actoruserid",
  "actor_id",
  "actorid",
  "actor",
  "caller_user_id",
  "calleruserid",
  "caller_id",
  "callerid",
  "caller",
  "actor_role",
  "actorrole",
  "caller_role",
  "callerrole",
  "employment_authority_id",
  "employmentauthorityid",
  "employment_profile_authority_id",
  "employmentprofileauthorityid",
]);
const PAYROLL_CAPABILITIES = [
  "time.clock_self",
  "time.view_self",
  "time.request_correction_self",
  "time.review_assigned",
  "time.approve_assigned",
  "session_attendance.record_assigned",
  "payroll.configure_employment",
  "payroll.resolve_exceptions",
  "payroll.lock_period",
  "payroll.reopen_period",
  "payroll.export_period",
  "payroll.view_compensation",
] as const;
const PAYROLL_CADENCE = ["weekly", "biweekly", "monthly"] as const;
const PAYROLL_GENERATION_CADENCE = ["weekly", "biweekly"] as const;
const EXTERNAL_IDENTIFIER_REGEX = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/;
const IDEMPOTENCY_KEY_REGEX = /^[\x21-\x7E]{1,200}$/;
const TIME_REGEX = /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;
const TIMESTAMP_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

const externalIdentifierSchema = z.string().regex(EXTERNAL_IDENTIFIER_REGEX);
const payGroupNameSchema = z.string().refine(
  (value) =>
    value.trim() === value
    && value.length >= 1
    && value.length <= 100
    && /^[\x20-\x7E]+$/.test(value)
    && !Array.from(value).some((char) => {
      const code = char.charCodeAt(0);
      return code < 32 || code === 127;
    }),
  "Invalid pay group name",
);
const idempotencyKeySchema = z.string().regex(IDEMPOTENCY_KEY_REGEX);
const timestampSchema = z.string().regex(TIMESTAMP_REGEX);
const cadenceSchema = z.enum(PAYROLL_CADENCE);
const generationCadenceSchema = z.enum(PAYROLL_GENERATION_CADENCE);
const capabilitySchema = z.enum(PAYROLL_CAPABILITIES);

const payrollAdministrationActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("get_administration"),
    selectedLocalDate: z.string().date(),
  }).strict(),
  z.object({
    action: z.literal("create_org_settings"),
    effectiveFrom: z.string().date(),
    effectiveThrough: z.string().date().nullable().optional(),
    externalPayrollOrganizationId: externalIdentifierSchema,
    timezone: z.string().min(1),
    workdayStartsAt: z.string().regex(TIME_REGEX).optional(),
    workweekStartsOn: z.number().int().min(0).max(6).optional(),
  }).strict(),
  z.object({
    action: z.literal("supersede_org_settings"),
    effectiveFrom: z.string().date(),
    effectiveThrough: z.string().date().nullable().optional(),
    externalPayrollOrganizationId: externalIdentifierSchema,
    timezone: z.string().min(1),
    workdayStartsAt: z.string().regex(TIME_REGEX).optional(),
    workweekStartsOn: z.number().int().min(0).max(6).optional(),
  }).strict(),
  z.object({
    action: z.literal("create_employment"),
    userId: z.string().uuid(),
    employeeNumber: externalIdentifierSchema,
    payrollEmployeeId: externalIdentifierSchema,
    classification: z.string().min(1).optional(),
    homeJurisdiction: z.string().min(1).optional(),
    timezone: z.string().min(1),
    activeFrom: z.string().date(),
    activeThrough: z.string().date().nullable().optional(),
    therapistId: z.string().uuid().nullable().optional(),
  }).strict(),
  z.object({
    action: z.literal("deactivate_employment"),
    employmentProfileId: z.string().uuid(),
    effectiveThrough: z.string().date(),
  }).strict(),
  z.object({
    action: z.literal("add_rate_version"),
    employmentProfileId: z.string().uuid(),
    hourlyRateCents: z.number().int(),
    effectiveFrom: timestampSchema,
    effectiveThrough: timestampSchema.nullable().optional(),
  }).strict(),
  z.object({
    action: z.literal("create_manager_assignment"),
    employmentProfileId: z.string().uuid(),
    managerUserId: z.string().uuid(),
    effectiveFrom: timestampSchema,
    effectiveThrough: timestampSchema.nullable().optional(),
  }).strict(),
  z.object({
    action: z.literal("deactivate_manager_assignment"),
    managerAssignmentId: z.string().uuid(),
    effectiveThrough: timestampSchema,
  }).strict(),
  z.object({
    action: z.literal("grant_capability"),
    userId: z.string().uuid(),
    capability: capabilitySchema,
    effectiveFrom: timestampSchema,
    effectiveThrough: timestampSchema.nullable().optional(),
  }).strict(),
  z.object({
    action: z.literal("revoke_capability"),
    userId: z.string().uuid(),
    capability: capabilitySchema,
    effectiveThrough: timestampSchema,
  }).strict(),
  z.object({
    action: z.literal("create_pay_group"),
    name: payGroupNameSchema,
    cadence: cadenceSchema,
    timezone: z.string().min(1),
    effectiveFrom: z.string().date().optional(),
    effectiveThrough: z.string().date().nullable().optional(),
  }).strict(),
  z.object({
    action: z.literal("deactivate_pay_group"),
    payGroupId: z.string().uuid(),
    effectiveThrough: z.string().date(),
  }).strict(),
  z.object({
    action: z.literal("create_pay_group_assignment"),
    employmentProfileId: z.string().uuid(),
    payGroupId: z.string().uuid(),
    effectiveFrom: z.string().date(),
    effectiveThrough: z.string().date().nullable().optional(),
  }).strict(),
  z.object({
    action: z.literal("deactivate_pay_group_assignment"),
    payGroupAssignmentId: z.string().uuid(),
    effectiveThrough: z.string().date(),
  }).strict(),
  z.object({
    action: z.literal("set_generation_version"),
    payGroupId: z.string().uuid(),
    cadence: generationCadenceSchema,
    effectiveFrom: z.string().date(),
    effectiveThrough: z.string().date().nullable().optional(),
    startsOn: z.string().date(),
    timezone: z.string().min(1),
  }).strict(),
  z.object({
    action: z.literal("generate_periods"),
    payGroupId: z.string().uuid(),
    from: z.string().date(),
    to: z.string().date(),
  }).strict(),
]);

const readResponseSchema = z.object({
  state: z.literal("ok"),
  selectedLocalDate: z.string().date(),
  capabilities: z.object({
    canConfigureEmployment: z.boolean(),
    canResolveExceptions: z.boolean(),
    canLockPeriod: z.boolean(),
    canReopenPeriod: z.boolean(),
    canGeneratePeriods: z.boolean(),
    canViewCompensation: z.boolean(),
    canManagePolicyMutations: z.literal(false),
  }).strict(),
  orgSettings: z.array(z.object({
    id: z.string().uuid(),
    externalPayrollOrganizationId: externalIdentifierSchema,
    timezone: z.string().min(1),
    workdayStartsAt: z.string().regex(TIME_REGEX),
    workweekStartsOn: z.number().int(),
    effectiveFrom: z.string().date(),
    effectiveThrough: z.string().date().nullable(),
  }).strict()),
  policies: z.array(z.object({
    id: z.string().uuid(),
    jurisdiction: z.string().min(1),
    policyName: z.string().min(1),
    activationStatus: z.string().min(1),
    supportsMonthlyNonexempt: z.boolean(),
    effectiveFrom: z.string().date(),
    effectiveThrough: z.string().date().nullable(),
    mutationsReadOnlyInV1: z.literal(true),
  }).strict()),
  employments: z.array(z.object({
    id: z.string().uuid(),
    userId: z.string().uuid(),
    employeeNumber: externalIdentifierSchema,
    payrollEmployeeId: externalIdentifierSchema,
    classification: z.string().min(1),
    homeJurisdiction: z.string().min(1),
    timezone: z.string().min(1),
    activeFrom: z.string().date(),
    activeThrough: z.string().date().nullable(),
    compensation: z.object({
      hourlyRateCents: z.number().int(),
      effectiveFrom: timestampSchema,
      effectiveThrough: timestampSchema.nullable(),
    }).strict().nullable().optional(),
  }).strict()),
  payGroups: z.array(z.object({
    id: z.string().uuid(),
    name: payGroupNameSchema,
    cadence: cadenceSchema,
    timezone: z.string().min(1),
    effectiveFrom: z.string().date(),
    effectiveThrough: z.string().date().nullable(),
  }).strict()),
  generationVersions: z.array(z.object({
    id: z.string().uuid(),
    payGroupId: z.string().uuid(),
    cadence: cadenceSchema,
    startsOn: z.string().date(),
    timezone: z.string().min(1),
    effectiveFrom: z.string().date(),
    effectiveThrough: z.string().date().nullable(),
  }).strict()),
  payPeriods: z.array(z.object({
    id: z.string().uuid(),
    payGroupId: z.string().uuid(),
    startsOn: z.string().date(),
    endsOn: z.string().date(),
    lockedAt: timestampSchema.nullable(),
    exportedAt: timestampSchema.nullable(),
  }).strict()),
  bounds: z.object({
    orgSettings: z.number().int(),
    policies: z.number().int(),
    employments: z.number().int(),
    payGroups: z.number().int(),
    generationVersions: z.number().int(),
    payPeriods: z.number().int(),
  }).strict(),
}).strict();

const internalMutationResponseSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create_org_settings"), organizationSettingsId: z.string().uuid(), replayed: z.boolean() }).strict(),
  z.object({ action: z.literal("supersede_org_settings"), organizationSettingsId: z.string().uuid(), replayed: z.boolean() }).strict(),
  z.object({ action: z.literal("create_employment"), employmentProfileId: z.string().uuid(), replayed: z.boolean() }).strict(),
  z.object({ action: z.literal("deactivate_employment"), employmentProfileId: z.string().uuid(), replayed: z.boolean() }).strict(),
  z.object({ action: z.literal("add_rate_version"), rateVersionId: z.string().uuid(), replayed: z.boolean() }).strict(),
  z.object({ action: z.literal("create_manager_assignment"), managerAssignmentId: z.string().uuid(), replayed: z.boolean() }).strict(),
  z.object({ action: z.literal("deactivate_manager_assignment"), managerAssignmentId: z.string().uuid(), replayed: z.boolean() }).strict(),
  z.object({ action: z.literal("grant_capability"), capabilityGrantId: z.string().uuid(), replayed: z.boolean() }).strict(),
  z.object({ action: z.literal("revoke_capability"), capabilityGrantId: z.string().uuid(), replayed: z.boolean() }).strict(),
  z.object({ action: z.literal("create_pay_group"), payGroupId: z.string().uuid(), replayed: z.boolean() }).strict(),
  z.object({ action: z.literal("deactivate_pay_group"), payGroupId: z.string().uuid(), replayed: z.boolean() }).strict(),
  z.object({ action: z.literal("create_pay_group_assignment"), payGroupAssignmentId: z.string().uuid(), replayed: z.boolean() }).strict(),
  z.object({ action: z.literal("deactivate_pay_group_assignment"), payGroupAssignmentId: z.string().uuid(), replayed: z.boolean() }).strict(),
  z.object({ action: z.literal("set_generation_version"), generationVersionId: z.string().uuid(), payGroupId: z.string().uuid(), replayed: z.boolean() }).strict(),
  z.object({ action: z.literal("generate_periods"), payGroupId: z.string().uuid(), generatedCount: z.number().int(), replayed: z.boolean() }).strict(),
]);

type PayrollAdministrationAction = z.infer<typeof payrollAdministrationActionSchema>;
type InternalMutationResponse = z.infer<typeof internalMutationResponseSchema>;
type HandlerParams = {
  req: Request;
  userContext: UserContext;
  db: SupabaseClient;
  rateLimitDependencies?: EdgeRateLimitDependencies;
};

type EdgeRateLimitDependencies = {
  getEnv: (name: string) => string | undefined;
  fetch: typeof fetch;
};

type EdgeRateLimitDecision =
  | { outcome: "allowed" }
  | { outcome: "denied"; retryAfterSeconds: number }
  | { outcome: "unavailable" };

type InitializedDependencies = {
  protectedHandler: (req: Request) => Promise<Response>;
};

let initializedDependenciesPromise: Promise<InitializedDependencies> | null = null;

const defaultRateLimitDependencies: EdgeRateLimitDependencies = {
  getEnv: (name) => Deno.env.get(name),
  fetch,
};

export const consumePayrollAdministrationRateLimit = async (
  actorId: string,
  dependencies: EdgeRateLimitDependencies = defaultRateLimitDependencies,
): Promise<EdgeRateLimitDecision> => {
  const rawBaseUrl = dependencies.getEnv("UPSTASH_REDIS_REST_URL")?.trim();
  const token = dependencies.getEnv("UPSTASH_REDIS_REST_TOKEN")?.trim();
  if (!rawBaseUrl || !token) {
    return { outcome: "unavailable" };
  }

  let pipelineUrl: string;
  try {
    const baseUrl = new URL(rawBaseUrl);
    if (baseUrl.protocol !== "https:") {
      return { outcome: "unavailable" };
    }
    pipelineUrl = `${baseUrl.toString().replace(/\/+$/, "")}/pipeline`;
  } catch {
    return { outcome: "unavailable" };
  }

  const key = `payroll-administration:${actorId}`;
  const pipelineBody = [
    ["INCR", key],
    ["EXPIRE", key, 60, "NX"],
    ["TTL", key],
  ];

  try {
    const response = await dependencies.fetch(pipelineUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(pipelineBody),
    });
    if (!response.ok) {
      return { outcome: "unavailable" };
    }

    const payload = await response.json() as Array<{ result?: unknown; error?: unknown }>;
    if (!Array.isArray(payload) || payload.length !== 3 || payload.some((entry) => !entry || entry.error !== undefined)) {
      return { outcome: "unavailable" };
    }
    const count = Number(payload[0]?.result);
    const expiryApplied = Number(payload[1]?.result);
    const rawTtl = payload[2]?.result;
    if (
      !Number.isInteger(count) || count < 1
      || !Number.isInteger(expiryApplied) || (expiryApplied !== 0 && expiryApplied !== 1)
      || typeof rawTtl !== "number" || !Number.isFinite(rawTtl) || !Number.isInteger(rawTtl) || rawTtl < 0
    ) {
      return { outcome: "unavailable" };
    }

    return count > 60
      ? { outcome: "denied", retryAfterSeconds: Math.max(1, rawTtl) }
      : { outcome: "allowed" };
  } catch {
    return { outcome: "unavailable" };
  }
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

const containsForbiddenAuthority = (value: unknown): boolean => {
  if (!value || typeof value !== "object") {
    return false;
  }
  if (Array.isArray(value)) {
    return value.some((entry) => containsForbiddenAuthority(entry));
  }
  return Object.entries(value as Record<string, unknown>).some(([key, nestedValue]) =>
    FORBIDDEN_AUTHORITY_KEYS.has(key.toLowerCase()) || containsForbiddenAuthority(nestedValue)
  );
};

const collectCompensationPaths = (value: unknown, path = "$"): string[] => {
  if (!value || typeof value !== "object") {
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => collectCompensationPaths(entry, `${path}[${index}]`));
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([key, nestedValue]) => {
    const nextPath = `${path}.${key}`;
    if (key === "compensation") {
      return [nextPath, ...collectCompensationPaths(nestedValue, nextPath)];
    }
    if (key === "hourlyRateCents") {
      return [nextPath];
    }
    return collectCompensationPaths(nestedValue, nextPath);
  });
};

const invalidResponse = (req: Request) =>
  jsonErrorResponse(req, 502, {
    code: "invalid_response",
    error: "Invalid payroll administration response.",
    message: "Invalid payroll administration response.",
    classification: {
      category: "upstream",
      severity: "high",
      retryable: false,
      httpStatus: 502,
    },
  });

const validateReadInvariants = (req: Request, payload: z.infer<typeof readResponseSchema>) => {
  if (payload.capabilities.canManagePolicyMutations !== false) {
    return invalidResponse(req);
  }
  if (payload.policies.some((policy) => policy.mutationsReadOnlyInV1 !== true)) {
    return invalidResponse(req);
  }
  const compensationPaths = collectCompensationPaths(payload);
  const allowedCompensationPaths = new Set(
    payload.employments.flatMap((employment, index) =>
      employment.compensation === undefined ? [] : [`$.employments[${index}].compensation`, `$.employments[${index}].compensation.hourlyRateCents`]
    ),
  );
  if (!payload.capabilities.canViewCompensation && compensationPaths.length > 0) {
    return invalidResponse(req);
  }
  if (payload.capabilities.canViewCompensation && compensationPaths.some((path) => !allowedCompensationPaths.has(path))) {
    return invalidResponse(req);
  }
  return payload;
};

const validateIdempotency = (req: Request, parsed: PayrollAdministrationAction): { idempotencyKey: string } | Response => {
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
  if (parsed.action === "get_administration") {
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
  if (!idempotencyKeySchema.safeParse(idempotencyKey).success) {
    return jsonErrorResponse(req, 400, {
      code: "validation_error",
      error: "Invalid Idempotency-Key.",
      message: "Invalid Idempotency-Key.",
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

const validateReadResponse = (req: Request, data: unknown) => {
  const parsed = readResponseSchema.safeParse(data);
  if (!parsed.success) {
    return invalidResponse(req);
  }
  return validateReadInvariants(req, parsed.data);
};

const validateInternalMutationResponse = (req: Request, data: unknown): InternalMutationResponse | Response => {
  const parsed = internalMutationResponseSchema.safeParse(data);
  if (!parsed.success) {
    return invalidResponse(req);
  }
  return parsed.data;
};

const mapActionToRpc = (parsed: PayrollAdministrationAction, idempotencyKey: string) => {
  if (parsed.action === "get_administration") {
    return {
      functionName: "get_payroll_administration",
      args: {
        selected_local_date: parsed.selectedLocalDate,
      },
    };
  }
  return {
    functionName: "execute_payroll_administration",
    args: {
      p_payload: parsed,
      p_idempotency_key: idempotencyKey,
    },
  };
};

const normalizeSafeMessage = (value: unknown): string => {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().replace(/\s+/g, " ");
};

const mapRpcError = (req: Request, error: { code?: string; message?: string } | null, idempotencyKey: string): Response => {
  const code = normalizeSafeMessage(error?.code);
  const message = normalizeSafeMessage(error?.message);
  const extraHeaders: Record<string, string> = idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {};
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
      ...(idempotencyKey ? { idempotencyKey } : {}),
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
      ...(idempotencyKey ? { idempotencyKey } : {}),
    }, extraHeaders);
  }
  if (code === "23514") {
    return jsonErrorResponse(req, 409, {
      code: "state_conflict",
      error: "Payroll state conflict.",
      message: "Payroll state conflict.",
      classification: {
        category: "request",
        severity: "medium",
        retryable: false,
        httpStatus: 409,
      },
      ...(idempotencyKey ? { idempotencyKey } : {}),
    }, extraHeaders);
  }
  if (code === "22023") {
    return jsonErrorResponse(req, 400, {
      code: "validation_error",
      error: "Invalid payroll administration request.",
      message: "Invalid payroll administration request.",
      classification: {
        category: "validation",
        severity: "low",
        retryable: false,
        httpStatus: 400,
      },
      ...(idempotencyKey ? { idempotencyKey } : {}),
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
      ...(idempotencyKey ? { idempotencyKey } : {}),
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
    ...(idempotencyKey ? { idempotencyKey } : {}),
  }, extraHeaders);
};

export async function handlePayrollAdministration({
  req,
  userContext,
  db,
  rateLimitDependencies = defaultRateLimitDependencies,
}: HandlerParams): Promise<Response> {
  const requestedOrigin = req.headers.get("origin");
  if (requestedOrigin && !resolveAllowedOriginForRequest(req)) {
    return jsonErrorResponse(req, 403, {
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
    return jsonErrorResponse(req, 405, {
      code: "validation_error",
      error: "Method not allowed",
      message: "Method not allowed",
      classification: {
        category: "validation",
        severity: "low",
        retryable: false,
        httpStatus: 405,
      },
    });
  }

  const limit = await consumePayrollAdministrationRateLimit(userContext.user.id, rateLimitDependencies);
  if (limit.outcome === "unavailable") {
    return jsonErrorResponse(req, 503, {
      code: "upstream_error",
      error: "Payroll administration rate limiter unavailable.",
      message: "Payroll administration rate limiter unavailable.",
      classification: {
        category: "upstream",
        severity: "high",
        retryable: true,
        httpStatus: 503,
      },
    });
  }
  if (limit.outcome === "denied") {
    return jsonErrorResponse(req, 429, {
      code: "rate_limited",
      error: "Too many payroll administration requests",
      message: "Too many payroll administration requests",
      classification: {
        category: "rate_limit",
        severity: "high",
        retryable: true,
        httpStatus: 429,
      },
    }, {
      "Retry-After": String(limit.retryAfterSeconds),
    });
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return jsonErrorResponse(req, 400, {
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

  const parsed = payrollAdministrationActionSchema.safeParse(payload);
  if (!parsed.success) {
    const actionValue =
      payload && typeof payload === "object" && !Array.isArray(payload)
        ? (payload as Record<string, unknown>).action
        : undefined;
    const message = typeof actionValue === "string" ? "Invalid payroll administration request body" : "Unsupported action";
    return jsonErrorResponse(req, 400, {
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

  if (parsed.data.action === "get_administration") {
    const validatedResponse = validateReadResponse(req, data);
    if (validatedResponse instanceof Response) {
      return validatedResponse;
    }
    return jsonResponse(req, 200, validatedResponse);
  }

  const validatedResponse = validateInternalMutationResponse(req, data);
  if (validatedResponse instanceof Response) {
    return validatedResponse;
  }

  return jsonResponse(req, 200, {
    ...validatedResponse,
    idempotencyKey: validated.idempotencyKey,
  }, {
    "Idempotency-Key": validated.idempotencyKey,
    "Idempotent-Replay": validatedResponse.replayed ? "true" : "false",
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
          handlePayrollAdministration({
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
    return jsonErrorResponse(req, 403, {
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
