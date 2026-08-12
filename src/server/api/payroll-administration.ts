import { z } from "zod";
import {
  consumeRateLimit,
  corsHeadersForRequest,
  errorResponse,
  fetchJson,
  getAccessToken,
  getSupabaseConfig,
  isDisallowedOriginRequest,
  jsonForRequest,
  resolveOrgAndRoleWithStatus,
} from "./shared";
import { getApiAuthorityMode, proxyToEdgeAuthority } from "./edgeAuthority";

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
] as const);
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
  z.object({
    action: z.literal("create_org_settings"),
    organizationSettingsId: z.string().uuid(),
    replayed: z.boolean(),
  }).strict(),
  z.object({
    action: z.literal("supersede_org_settings"),
    organizationSettingsId: z.string().uuid(),
    replayed: z.boolean(),
  }).strict(),
  z.object({
    action: z.literal("create_employment"),
    employmentProfileId: z.string().uuid(),
    replayed: z.boolean(),
  }).strict(),
  z.object({
    action: z.literal("deactivate_employment"),
    employmentProfileId: z.string().uuid(),
    replayed: z.boolean(),
  }).strict(),
  z.object({
    action: z.literal("add_rate_version"),
    rateVersionId: z.string().uuid(),
    replayed: z.boolean(),
  }).strict(),
  z.object({
    action: z.literal("create_manager_assignment"),
    managerAssignmentId: z.string().uuid(),
    replayed: z.boolean(),
  }).strict(),
  z.object({
    action: z.literal("deactivate_manager_assignment"),
    managerAssignmentId: z.string().uuid(),
    replayed: z.boolean(),
  }).strict(),
  z.object({
    action: z.literal("grant_capability"),
    capabilityGrantId: z.string().uuid(),
    replayed: z.boolean(),
  }).strict(),
  z.object({
    action: z.literal("revoke_capability"),
    capabilityGrantId: z.string().uuid(),
    replayed: z.boolean(),
  }).strict(),
  z.object({
    action: z.literal("create_pay_group"),
    payGroupId: z.string().uuid(),
    replayed: z.boolean(),
  }).strict(),
  z.object({
    action: z.literal("deactivate_pay_group"),
    payGroupId: z.string().uuid(),
    replayed: z.boolean(),
  }).strict(),
  z.object({
    action: z.literal("create_pay_group_assignment"),
    payGroupAssignmentId: z.string().uuid(),
    replayed: z.boolean(),
  }).strict(),
  z.object({
    action: z.literal("deactivate_pay_group_assignment"),
    payGroupAssignmentId: z.string().uuid(),
    replayed: z.boolean(),
  }).strict(),
  z.object({
    action: z.literal("set_generation_version"),
    generationVersionId: z.string().uuid(),
    payGroupId: z.string().uuid(),
    replayed: z.boolean(),
  }).strict(),
  z.object({
    action: z.literal("generate_periods"),
    payGroupId: z.string().uuid(),
    generatedCount: z.number().int(),
    replayed: z.boolean(),
  }).strict(),
]);

const publicMutationResponseSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create_org_settings"),
    organizationSettingsId: z.string().uuid(),
    replayed: z.boolean(),
    idempotencyKey: idempotencyKeySchema,
  }).strict(),
  z.object({
    action: z.literal("supersede_org_settings"),
    organizationSettingsId: z.string().uuid(),
    replayed: z.boolean(),
    idempotencyKey: idempotencyKeySchema,
  }).strict(),
  z.object({
    action: z.literal("create_employment"),
    employmentProfileId: z.string().uuid(),
    replayed: z.boolean(),
    idempotencyKey: idempotencyKeySchema,
  }).strict(),
  z.object({
    action: z.literal("deactivate_employment"),
    employmentProfileId: z.string().uuid(),
    replayed: z.boolean(),
    idempotencyKey: idempotencyKeySchema,
  }).strict(),
  z.object({
    action: z.literal("add_rate_version"),
    rateVersionId: z.string().uuid(),
    replayed: z.boolean(),
    idempotencyKey: idempotencyKeySchema,
  }).strict(),
  z.object({
    action: z.literal("create_manager_assignment"),
    managerAssignmentId: z.string().uuid(),
    replayed: z.boolean(),
    idempotencyKey: idempotencyKeySchema,
  }).strict(),
  z.object({
    action: z.literal("deactivate_manager_assignment"),
    managerAssignmentId: z.string().uuid(),
    replayed: z.boolean(),
    idempotencyKey: idempotencyKeySchema,
  }).strict(),
  z.object({
    action: z.literal("grant_capability"),
    capabilityGrantId: z.string().uuid(),
    replayed: z.boolean(),
    idempotencyKey: idempotencyKeySchema,
  }).strict(),
  z.object({
    action: z.literal("revoke_capability"),
    capabilityGrantId: z.string().uuid(),
    replayed: z.boolean(),
    idempotencyKey: idempotencyKeySchema,
  }).strict(),
  z.object({
    action: z.literal("create_pay_group"),
    payGroupId: z.string().uuid(),
    replayed: z.boolean(),
    idempotencyKey: idempotencyKeySchema,
  }).strict(),
  z.object({
    action: z.literal("deactivate_pay_group"),
    payGroupId: z.string().uuid(),
    replayed: z.boolean(),
    idempotencyKey: idempotencyKeySchema,
  }).strict(),
  z.object({
    action: z.literal("create_pay_group_assignment"),
    payGroupAssignmentId: z.string().uuid(),
    replayed: z.boolean(),
    idempotencyKey: idempotencyKeySchema,
  }).strict(),
  z.object({
    action: z.literal("deactivate_pay_group_assignment"),
    payGroupAssignmentId: z.string().uuid(),
    replayed: z.boolean(),
    idempotencyKey: idempotencyKeySchema,
  }).strict(),
  z.object({
    action: z.literal("set_generation_version"),
    generationVersionId: z.string().uuid(),
    payGroupId: z.string().uuid(),
    replayed: z.boolean(),
    idempotencyKey: idempotencyKeySchema,
  }).strict(),
  z.object({
    action: z.literal("generate_periods"),
    payGroupId: z.string().uuid(),
    generatedCount: z.number().int(),
    replayed: z.boolean(),
    idempotencyKey: idempotencyKeySchema,
  }).strict(),
]);

const payrollAdministrationErrorSchema = z.object({
  success: z.literal(false).optional(),
  error: z.string().min(1).optional(),
  requestId: z.string().min(1),
  code: z.enum([
    "conflict",
    "state_conflict",
    "validation_error",
    "unauthorized",
    "forbidden",
    "not_found",
    "internal_error",
    "upstream_error",
    "rate_limited",
    "invalid_response",
  ]),
  message: z.string().min(1),
  classification: z.object({
    category: z.string().min(1),
    severity: z.enum(["low", "medium", "high", "critical"]),
    retryable: z.boolean(),
    httpStatus: z.number().int(),
  }).strict(),
  idempotencyKey: idempotencyKeySchema.optional(),
}).strict();

type PayrollAdministrationAction = z.infer<typeof payrollAdministrationActionSchema>;
type PayrollAdministrationErrorCode = z.infer<typeof payrollAdministrationErrorSchema.shape.code>;
type InternalMutationResponse = z.infer<typeof internalMutationResponseSchema>;
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
    code: PayrollAdministrationErrorCode;
    message: string;
    classification: {
      category: string;
      severity: "low" | "medium" | "high" | "critical";
      retryable: boolean;
      httpStatus: number;
    };
    idempotencyKey?: string;
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

const validateReadInvariants = (
  request: Request,
  traceHeaders: Record<string, string>,
  payload: z.infer<typeof readResponseSchema>,
) => {
  if (payload.capabilities.canManagePolicyMutations !== false) {
    return payrollErrorResponse(request, 502, {
      code: "invalid_response",
      message: "Invalid payroll administration response.",
      classification: PAYROLL_ERROR_CLASSIFICATIONS.invalid_response,
    }, traceHeaders);
  }
  if (payload.policies.some((policy) => policy.mutationsReadOnlyInV1 !== true)) {
    return payrollErrorResponse(request, 502, {
      code: "invalid_response",
      message: "Invalid payroll administration response.",
      classification: PAYROLL_ERROR_CLASSIFICATIONS.invalid_response,
    }, traceHeaders);
  }

  const compensationPaths = collectCompensationPaths(payload);
  const allowedCompensationPaths = new Set(
    payload.employments.flatMap((employment, index) =>
      employment.compensation === undefined ? [] : [`$.employments[${index}].compensation`, `$.employments[${index}].compensation.hourlyRateCents`]
    ),
  );

  if (!payload.capabilities.canViewCompensation) {
    if (compensationPaths.length > 0) {
      return payrollErrorResponse(request, 502, {
        code: "invalid_response",
        message: "Invalid payroll administration response.",
        classification: PAYROLL_ERROR_CLASSIFICATIONS.invalid_response,
      }, traceHeaders);
    }
    return payload;
  }

  if (compensationPaths.some((path) => !allowedCompensationPaths.has(path))) {
    return payrollErrorResponse(request, 502, {
      code: "invalid_response",
      message: "Invalid payroll administration response.",
      classification: PAYROLL_ERROR_CLASSIFICATIONS.invalid_response,
    }, traceHeaders);
  }

  return payload;
};

const validateIdempotency = (
  request: Request,
  parsed: PayrollAdministrationAction,
  traceHeaders: Record<string, string>,
): { idempotencyKey: string } | Response => {
  if (containsForbiddenAuthority(parsed)) {
    return errorResponse(request, "validation_error", "Authority fields are not allowed in payroll requests.", {
      headers: traceHeaders,
    });
  }

  if (parsed.action === "get_administration") {
    return { idempotencyKey: "" };
  }

  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() ?? "";
  if (!idempotencyKey) {
    return errorResponse(request, "validation_error", "Idempotency-Key is required for payroll mutations.", {
      headers: traceHeaders,
    });
  }
  if (!idempotencyKeySchema.safeParse(idempotencyKey).success) {
    return errorResponse(request, "validation_error", "Invalid Idempotency-Key.", {
      headers: traceHeaders,
    });
  }

  return { idempotencyKey };
};

const validateReadResponse = (
  request: Request,
  traceHeaders: Record<string, string>,
  payload: unknown,
) => {
  const parsed = readResponseSchema.safeParse(payload);
  if (!parsed.success) {
    return payrollErrorResponse(request, 502, {
      code: "invalid_response",
      message: "Invalid payroll administration response.",
      classification: PAYROLL_ERROR_CLASSIFICATIONS.invalid_response,
    }, traceHeaders);
  }
  return validateReadInvariants(request, traceHeaders, parsed.data);
};

const validateInternalMutationResponse = (
  request: Request,
  traceHeaders: Record<string, string>,
  payload: unknown,
) => {
  const parsed = internalMutationResponseSchema.safeParse(payload);
  if (!parsed.success) {
    return payrollErrorResponse(request, 502, {
      code: "invalid_response",
      message: "Invalid payroll administration response.",
      classification: PAYROLL_ERROR_CLASSIFICATIONS.invalid_response,
    }, traceHeaders);
  }
  return parsed.data;
};

const validatePublicMutationResponse = (
  request: Request,
  traceHeaders: Record<string, string>,
  payload: unknown,
  requestedKey: string,
) => {
  const parsed = publicMutationResponseSchema.safeParse(payload);
  if (!parsed.success || parsed.data.idempotencyKey !== requestedKey) {
    return payrollErrorResponse(request, 502, {
      code: "invalid_response",
      message: "Invalid payroll administration response.",
      classification: PAYROLL_ERROR_CLASSIFICATIONS.invalid_response,
    }, traceHeaders);
  }
  return parsed.data;
};

const buildLegacyHeaders = (accessToken: string, anonKey: string): Record<string, string> => ({
  "Content-Type": "application/json",
  apikey: anonKey,
  Authorization: `Bearer ${accessToken}`,
});

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

const mapLegacyError = (
  request: Request,
  traceHeaders: Record<string, string>,
  result: { status: number; ok: boolean; data: unknown | null },
  idempotencyKey: string,
): Response => {
  const message = normalizeSafeMessage((result.data as { message?: unknown; error?: unknown } | null)?.message) ||
    normalizeSafeMessage((result.data as { error?: unknown } | null)?.error);
  const code = normalizeSafeMessage((result.data as { code?: unknown } | null)?.code);
  const headers: Record<string, string> = idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {};

  if (message.includes("IDEMPOTENCY_CONFLICT") || code === "23505" || (result.status === 409 && code !== "23514" && code !== "55P03")) {
    return errorResponse(request, "conflict", "Idempotency conflict.", {
      status: 409,
      headers: { ...traceHeaders, ...headers },
      extra: idempotencyKey ? { idempotencyKey } : {},
    });
  }
  if (code === "23514") {
    return payrollErrorResponse(request, 409, {
      code: "state_conflict",
      message: "Payroll state conflict.",
      classification: PAYROLL_ERROR_CLASSIFICATIONS.state_conflict,
      idempotencyKey,
    }, traceHeaders, headers);
  }
  if (code === "22023") {
    return errorResponse(request, "validation_error", "Invalid payroll administration request.", {
      status: 400,
      headers: { ...traceHeaders, ...headers },
      extra: idempotencyKey ? { idempotencyKey } : {},
    });
  }
  if (code === "42501" || result.status === 403) {
    return errorResponse(request, "forbidden", "Forbidden", {
      status: 403,
      headers: { ...traceHeaders, ...headers },
      extra: idempotencyKey ? { idempotencyKey } : {},
    });
  }
  if (code === "55P03") {
    return errorResponse(request, "conflict", "Payroll state is temporarily locked.", {
      status: 409,
      headers: { ...traceHeaders, ...headers, "Retry-After": "1" },
      extra: idempotencyKey ? { idempotencyKey } : {},
    });
  }

  return errorResponse(request, "upstream_error", "Payroll transport failed.", {
    status: result.status >= 400 ? result.status : 502,
    headers: { ...traceHeaders, ...headers },
    extra: idempotencyKey ? { idempotencyKey } : {},
  });
};

const mapForwardedEdgeError = (
  request: Request,
  traceHeaders: Record<string, string>,
  status: number,
  idempotencyKey: string,
  forwardedHeaders: Headers,
) => {
  const headers: Record<string, string> = idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {};
  const retryAfter = forwardedHeaders.get("Retry-After")?.trim();
  if (status === 400) {
    return errorResponse(request, "validation_error", "Invalid payroll administration request.", {
      status,
      headers: { ...traceHeaders, ...headers },
      extra: idempotencyKey ? { idempotencyKey } : {},
    });
  }
  if (status === 403) {
    return errorResponse(request, "forbidden", "Forbidden", {
      status,
      headers: { ...traceHeaders, ...headers },
      extra: idempotencyKey ? { idempotencyKey } : {},
    });
  }
  if (status === 409) {
    return errorResponse(request, "conflict", "Idempotency conflict.", {
      status,
      headers: { ...traceHeaders, ...headers },
      extra: idempotencyKey ? { idempotencyKey } : {},
    });
  }
  if (status === 429) {
    return errorResponse(request, "rate_limited", "Too many payroll administration requests", {
      status,
      headers: retryAfter ? { ...traceHeaders, ...headers, "Retry-After": retryAfter } : { ...traceHeaders, ...headers },
      extra: idempotencyKey ? { idempotencyKey } : {},
    });
  }

  return errorResponse(request, "upstream_error", "Payroll transport failed.", {
    status: status >= 400 ? status : 502,
    headers: retryAfter ? { ...traceHeaders, ...headers, "Retry-After": retryAfter } : { ...traceHeaders, ...headers },
    extra: idempotencyKey ? { idempotencyKey } : {},
  });
};

const buildForwardedEdgeResponse = (
  request: Request,
  traceHeaders: Record<string, string>,
  status: number,
  payload: z.infer<typeof payrollAdministrationErrorSchema>,
  forwardedHeaders: Headers,
) => {
  const requestKey = request.headers.get("Idempotency-Key")?.trim() ?? "";
  const headerKey = forwardedHeaders.get("Idempotency-Key")?.trim() ?? "";
  const bodyKey = payload.idempotencyKey?.trim() ?? "";
  const endpointOwnedEnvelope = payload.success === false || payload.error !== undefined || bodyKey.length > 0;
  if (endpointOwnedEnvelope && (requestKey || headerKey || bodyKey)) {
    if (!headerKey || !bodyKey || headerKey !== bodyKey || (requestKey && requestKey !== headerKey)) {
      return payrollErrorResponse(request, 502, {
        code: "invalid_response",
        message: "Invalid payroll administration response.",
        classification: PAYROLL_ERROR_CLASSIFICATIONS.invalid_response,
      }, traceHeaders);
    }
  }

  const responseHeaders = new Headers({
    ...corsHeadersForRequest(request),
    ...traceHeaders,
    "Content-Type": "application/json",
  });
  if (headerKey) {
    responseHeaders.set("Idempotency-Key", headerKey);
  }
  if (forwardedHeaders.get("Retry-After")) {
    responseHeaders.set("Retry-After", forwardedHeaders.get("Retry-After") as string);
  }
  if (forwardedHeaders.get("WWW-Authenticate")) {
    responseHeaders.set("WWW-Authenticate", forwardedHeaders.get("WWW-Authenticate") as string);
  }
  if (forwardedHeaders.get("Cache-Control")) {
    responseHeaders.set("Cache-Control", forwardedHeaders.get("Cache-Control") as string);
  }
  return new Response(JSON.stringify(payload), {
    status,
    headers: responseHeaders,
  });
};

const buildMutationSuccessResponse = (
  request: Request,
  traceHeaders: Record<string, string>,
  body: InternalMutationResponse,
  idempotencyKey: string,
) =>
  jsonForRequest(request, {
    ...body,
    idempotencyKey,
  }, 200, {
    ...traceHeaders,
    "Idempotency-Key": idempotencyKey,
    "Idempotent-Replay": body.replayed ? "true" : "false",
  });

export async function payrollAdministrationHandler(request: Request): Promise<Response> {
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
      headers: {
        ...corsHeadersForRequest(request),
        ...traceHeaders,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
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
    keyPrefix: "api:payroll-administration",
    maxRequests: 60,
    windowMs: 60_000,
  });
  if (rateLimit.limited) {
    return errorResponse(request, "rate_limited", "Too many payroll administration requests", {
      headers: { ...traceHeaders, "Retry-After": String(rateLimit.retryAfterSeconds) },
    });
  }

  const {
    organizationId,
    isAdmin,
    isSuperAdmin,
    upstreamError: roleUpstreamError,
  } = await resolveOrgAndRoleWithStatus(accessToken);
  if (roleUpstreamError) {
    return errorResponse(request, "upstream_error", "Unable to validate organization access", {
      status: 502,
      headers: traceHeaders,
    });
  }
  if (!organizationId || (!isAdmin && !isSuperAdmin)) {
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

  const parsed = payrollAdministrationActionSchema.safeParse(payload);
  if (!parsed.success) {
    const actionValue =
      payload && typeof payload === "object" && !Array.isArray(payload)
        ? (payload as Record<string, unknown>).action
        : undefined;
    return errorResponse(
      request,
      "validation_error",
      typeof actionValue === "string" ? "Invalid payroll administration request body" : "Unsupported action",
      { headers: traceHeaders },
    );
  }

  const validated = validateIdempotency(request, parsed.data, traceHeaders);
  if (validated instanceof Response) {
    return validated;
  }

  if (getApiAuthorityMode() === "edge") {
    const forwarded = await proxyToEdgeAuthority(request, {
      functionName: "payroll-administration",
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
      if (parsed.data.action === "get_administration") {
        const successPayload = validateReadResponse(request, traceHeaders, responsePayload);
        if (successPayload instanceof Response) {
          return successPayload;
        }
        return jsonForRequest(request, successPayload, 200, { ...traceHeaders, ...forwardedTraceHeaders });
      }
      const successPayload = validatePublicMutationResponse(request, traceHeaders, responsePayload, validated.idempotencyKey);
      if (successPayload instanceof Response) {
        return successPayload;
      }
      return jsonForRequest(request, successPayload, 200, {
        ...traceHeaders,
        ...forwardedTraceHeaders,
        "Idempotency-Key": successPayload.idempotencyKey,
        "Idempotent-Replay": successPayload.replayed ? "true" : "false",
      });
    }

    const parsedError = payrollAdministrationErrorSchema.safeParse(responsePayload);
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

  if (parsed.data.action === "get_administration") {
    const validatedResponse = validateReadResponse(request, traceHeaders, result.data);
    if (validatedResponse instanceof Response) {
      return validatedResponse;
    }
    return jsonForRequest(request, validatedResponse, 200, traceHeaders);
  }

  const validatedResponse = validateInternalMutationResponse(request, traceHeaders, result.data);
  if (validatedResponse instanceof Response) {
    return validatedResponse;
  }

  return buildMutationSuccessResponse(request, traceHeaders, validatedResponse, validated.idempotencyKey);
}
