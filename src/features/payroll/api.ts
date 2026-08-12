import { z } from "zod";
import { callApi } from "../../lib/api";
import { parseJsonResponse } from "../../lib/sdk/contracts";
import { toNormalizedApiError, type NormalizedApiError } from "../../lib/sdk/errors";

const PAYROLL_TIME_ENDPOINT = "/api/payroll-time-events";
const PAYROLL_TIMESHEET_ENDPOINT = "/api/payroll-timesheets";
const PAYROLL_APPROVALS_ENDPOINT = "/api/payroll-approvals";
const FORBIDDEN_AUTHORITY_KEYS = new Set([
  "organization_id",
  "organizationId",
  "user_id",
  "userId",
  "actor_id",
  "actorId",
  "actor_user_id",
  "actorUserId",
]);
const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);

const workLocationSchema = z.enum(["client_site", "office", "home", "community", "other"]);
const workCategorySchema = z.enum(["direct_service", "administration", "travel", "training"]);
const correctionReplacementPayloadSchema = z.record(z.string(), z.unknown());
const payrollDayStateSchema = z.enum([
  "ok",
  "feature_disabled",
  "unsupported_jurisdiction",
  "no_employment_profile",
]);
const payrollTimesheetStateSchema = z.enum([
  "ok",
  "blocked",
  "feature_disabled",
  "unsupported_jurisdiction",
  "unsupported_policy",
  "missing_prerequisite",
  "no_employment_profile",
]);
const payrollApprovalResponseActionSchema = z.enum([
  "submitted",
  "manager_approved",
  "returned",
  "locked",
  "reopened",
  "approval_invalidated",
]);
const payrollBlockerTypeSchema = z.enum([
  "time_correction_request",
  "session_attendance_correction_request",
  "timekeeping_exception",
]);
const payrollBlockerResolutionSchema = z.enum(["resolved", "reopened"]);
const payrollReviewStateSchema = z.enum([
  "ok",
  "feature_disabled",
  "unsupported_policy",
  "unsupported_jurisdiction",
  "missing_prerequisite",
]);

const timeEventPayloadSchema = z.object({
  occurredAt: z.string().min(1),
  timezone: z.string().min(1),
  workLocation: workLocationSchema,
  data: z.object({
    eventType: z.enum([
      "shift_started",
      "shift_ended",
      "meal_started",
      "meal_ended",
      "work_category_changed",
    ]),
    workCategory: workCategorySchema.optional(),
    note: z.string().optional(),
  }).passthrough(),
}).passthrough();

const sessionAttendancePayloadSchema = z.object({
  occurredAt: z.string().min(1),
  data: z.object({
    eventType: z.enum(["session_started", "session_ended"]),
    sessionId: z.string().uuid(),
    note: z.string().optional(),
  }).strict(),
}).strict();

const timeCorrectionPayloadSchema = z.object({
  data: z.object({
    originalEventId: z.string().uuid(),
    reasonCode: z.string().min(1),
    replacementPayload: z.record(z.string(), z.unknown()).optional(),
  }).passthrough(),
}).passthrough();

const attendanceCorrectionPayloadSchema = z.object({
  data: z.object({
    sessionAttendanceEventId: z.string().uuid(),
    reasonCode: z.string().min(1),
    replacementPayload: z.record(z.string(), z.unknown()).optional(),
  }).passthrough(),
}).passthrough();

const payrollSessionContextFeatureDisabledSchema = z.object({
  state: z.literal("feature_disabled"),
  sessionId: z.string().uuid(),
  organizationId: z.string().uuid(),
}).strict();

const payrollSessionContextOkSchema = z.object({
  state: z.literal("ok"),
  sessionId: z.string().uuid(),
  organizationId: z.string().uuid(),
  employmentProfileId: z.string().uuid(),
  employmentTimezone: z.string().min(1),
  actorIsAssignedEmployee: z.boolean(),
  canClockSelf: z.boolean(),
  canonicalWorkLocation: workLocationSchema,
  activeShiftEventId: z.string().uuid().nullable(),
}).strict();

export const payrollSessionContextResponseSchema = z.discriminatedUnion("state", [
  payrollSessionContextFeatureDisabledSchema,
  payrollSessionContextOkSchema,
]);

const payrollBootstrapSchema = z.object({
  organizationId: z.string().min(1),
  employmentProfileId: z.string().min(1).nullable(),
  localDate: z.string().date(),
  employmentTimezone: z.string().min(1).nullable(),
  workdayStartsAt: z.string().min(1).nullable(),
  capabilities: z.object({
    canViewSelf: z.boolean(),
    canClockSelf: z.boolean(),
    canRequestCorrectionSelf: z.boolean(),
  }),
});

const employeeTimeEventSchema = z.object({
  id: z.string().min(1),
  employmentProfileId: z.string().min(1),
  eventType: z.enum([
    "shift_started",
    "shift_ended",
    "meal_started",
    "meal_ended",
    "work_category_changed",
  ]),
  eventAt: z.string().min(1),
  sourceTimezone: z.string().min(1),
  workLocation: workLocationSchema.nullable(),
  workCategory: workCategorySchema.nullable(),
  metadata: z.unknown(),
  createdAt: z.string().min(1),
});

const sessionAttendanceEventSchema = z.object({
  id: z.string().min(1),
  employmentProfileId: z.string().min(1),
  sessionId: z.string().uuid(),
  employeeTimeEventId: z.string().uuid().nullable(),
  eventType: z.enum(["session_started", "session_ended"]),
  eventAt: z.string().min(1),
  sourceTimezone: z.string().min(1),
  workLocation: workLocationSchema.nullable(),
  metadata: z.unknown(),
  createdAt: z.string().min(1),
});

const timeCorrectionRequestSchema = z.object({
  id: z.string().min(1),
  employmentProfileId: z.string().min(1),
  originalEventId: z.string().uuid(),
  reasonCode: z.string().min(1),
  replacementPayload: correctionReplacementPayloadSchema.nullable(),
  createdAt: z.string().min(1),
});

const sessionAttendanceCorrectionRequestSchema = z.object({
  id: z.string().min(1),
  employmentProfileId: z.string().min(1),
  sessionAttendanceEventId: z.string().uuid(),
  reasonCode: z.string().min(1),
  replacementPayload: correctionReplacementPayloadSchema.nullable(),
  createdAt: z.string().min(1),
});

const timekeepingExceptionSchema = z.object({
  id: z.string().min(1),
  employmentProfileId: z.string().min(1),
  exceptionCode: z.string().min(1),
  sourceSessionAttendanceEventId: z.string().uuid().nullable(),
  details: z.unknown(),
  createdAt: z.string().min(1),
});

const payrollDayResponseSchema = z.object({
  state: payrollDayStateSchema,
  bootstrap: payrollBootstrapSchema.optional(),
  day: z.object({
    employeeTimeEvents: z.array(employeeTimeEventSchema).optional(),
    sessionAttendanceEvents: z.array(sessionAttendanceEventSchema).optional(),
    timeCorrectionRequests: z.array(timeCorrectionRequestSchema).optional(),
    sessionAttendanceCorrectionRequests: z.array(sessionAttendanceCorrectionRequestSchema).optional(),
    exceptions: z.array(timekeepingExceptionSchema).optional(),
  }).optional(),
  totals: z.object({
    label: z.string().min(1),
  }).passthrough().optional(),
}).passthrough();

const mutationSuccessSchema = z.object({
  idempotencyKey: z.string().min(1),
}).passthrough();
const payrollSnapshotHashSchema = z.string().regex(/^[0-9a-f]{64}$/);
const payrollApprovalTransitionSchema = z.object({
  transitionId: z.string().uuid(),
  snapshotId: z.string().uuid(),
  snapshotHash: payrollSnapshotHashSchema,
  canonicalSnapshotHash: payrollSnapshotHashSchema,
  action: payrollApprovalResponseActionSchema,
  previousTransitionId: z.string().uuid().nullable(),
  replayed: z.boolean(),
  occurredAt: z.string().min(1),
  idempotencyKey: z.string().min(1),
}).strict();
const payrollBlockerResolutionResponseSchema = z.object({
  resolutionId: z.string().uuid(),
  blockerType: payrollBlockerTypeSchema,
  blockerId: z.string().uuid(),
  payPeriodId: z.string().uuid(),
  action: payrollBlockerResolutionSchema,
  previousResolutionId: z.string().uuid().nullable(),
  replayed: z.boolean(),
  occurredAt: z.string().min(1),
  idempotencyKey: z.string().min(1),
}).strict();
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
    hash: payrollSnapshotHashSchema.nullable(),
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
const payrollReviewQueueResponseSchema = z.object({
  state: payrollReviewStateSchema,
  selectedLocalDate: z.string().date(),
  capabilities: payrollReviewCapabilitiesSchema,
  queue: z.array(payrollReviewQueueItemSchema),
}).strict().superRefine((value, ctx) => {
  if (!value.capabilities.canViewCompensation) {
    value.queue.forEach((item, index) => {
      if (item.compensation) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Compensation requires payroll.view_compensation.",
          path: ["queue", index, "compensation"],
        });
      }
    });
  }
});
const payrollReviewDetailsResponseSchema = z.object({
  state: z.literal("ok"),
  snapshotId: z.string().uuid(),
  snapshotHash: payrollSnapshotHashSchema,
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
    snapshotHash: payrollSnapshotHashSchema,
  }).strict()),
  blockers: z.array(z.object({
    blockerType: payrollBlockerTypeSchema,
    blockerId: z.string().uuid(),
    state: z.string().min(1),
    createdAt: z.string().min(1),
  }).strict()),
  unresolvedBlockerCount: z.number().int(),
  compensation: z.object({
    grossEarningsCents: z.number().int(),
  }).strict().optional(),
}).strict();
const payrollTimesheetSnapshotSchema = z.object({
  id: z.string().uuid().optional(),
  snapshotId: z.string().uuid().optional(),
  sourceHash: z.string().min(1).optional(),
  lockable: z.boolean().optional(),
  totals: z.object({
    regularSeconds: z.number().int(),
    overtimeSeconds: z.number().int(),
    doubleTimeSeconds: z.number().int(),
    mealPremiumCents: z.number().int(),
    grossEarningsCents: z.number().int(),
  }).optional(),
  createdAt: z.string().min(1).optional(),
}).passthrough();
const payrollTimesheetTotalsSchema = z.object({
  regularSeconds: z.number().int(),
  overtimeSeconds: z.number().int(),
  doubleTimeSeconds: z.number().int(),
  mealPremiumCents: z.number().int(),
  grossEarningsCents: z.number().int(),
});
const payrollTimesheetReviewExceptionSchema = z.object({
  id: z.string().min(1).optional(),
  code: z.string().min(1).optional(),
  exceptionCode: z.string().min(1).optional(),
  blocking: z.boolean().optional(),
  details: z.unknown().optional(),
  createdAt: z.string().min(1).optional(),
}).passthrough();
const payrollTimesheetPeriodSchema = z.object({
  selectedLocalDate: z.string().date().optional(),
  periodStart: z.string().date().optional(),
  periodEnd: z.string().date().optional(),
  timezone: z.string().min(1).optional(),
  workdayStartsAt: z.string().min(1).optional(),
  workweekStartsOn: z.number().int().optional(),
  policyVersionId: z.string().uuid().nullable().optional(),
  payPeriodId: z.string().uuid().nullable().optional(),
  events: z.array(z.object({
    id: z.string().min(1),
    source: z.string().min(1),
    eventType: z.string().min(1),
    occurredAt: z.string().min(1),
    createdAt: z.string().min(1),
    timezone: z.string().min(1),
    workLocation: workLocationSchema.nullable(),
    workCategory: workCategorySchema.nullable(),
    sessionId: z.string().uuid().nullable().optional(),
    employeeTimeEventId: z.string().uuid().nullable().optional(),
    details: z.unknown().optional(),
  })).optional(),
  rateVersions: z.array(z.object({
    id: z.string().uuid(),
    effectiveFrom: z.string().min(1),
    effectiveThrough: z.string().nullable(),
  })).optional(),
  timeCorrectionRequests: z.array(timeCorrectionRequestSchema).optional(),
  sessionAttendanceCorrectionRequests: z.array(sessionAttendanceCorrectionRequestSchema).optional(),
  exceptions: z.array(payrollTimesheetReviewExceptionSchema).optional(),
});
const payrollTimesheetPeriodResponseSchema = z.object({
  state: payrollTimesheetStateSchema,
  period: payrollTimesheetPeriodSchema,
  totals: payrollTimesheetTotalsSchema.optional(),
  exceptions: z.array(payrollTimesheetReviewExceptionSchema).optional(),
  sourceHash: z.string().min(1).nullable().optional(),
  snapshot: payrollTimesheetSnapshotSchema.nullable().optional(),
}).passthrough();
const payrollTimesheetDeriveSuccessSchema = z.object({
  state: z.literal("ok"),
  idempotencyKey: z.string().min(1),
  snapshotId: z.string().uuid(),
  sourceHash: z.string().min(1),
  replayed: z.boolean(),
  lockable: z.boolean().optional(),
  period: payrollTimesheetPeriodSchema.optional(),
  totals: payrollTimesheetTotalsSchema.optional(),
  exceptions: z.array(payrollTimesheetReviewExceptionSchema).optional(),
}).passthrough();
const payrollTimesheetDeriveBlockedSchema = z.object({
  state: z.literal("blocked"),
  idempotencyKey: z.string().min(1),
  snapshotId: z.null(),
  sourceHash: z.string().min(1).nullable(),
  replayed: z.boolean().optional(),
  lockable: z.literal(false),
  period: payrollTimesheetPeriodSchema,
  totals: payrollTimesheetTotalsSchema,
  exceptions: z.array(payrollTimesheetReviewExceptionSchema),
}).passthrough();
const payrollTimesheetDeriveLegacySuccessSchema = z.union([
  z.object({
    idempotencyKey: z.string().min(1),
    snapshotId: z.string().uuid(),
    sourceHash: z.string().min(1),
    replayed: z.boolean(),
  }).passthrough(),
  z.object({
    idempotencyKey: z.string().min(1),
    snapshot_id: z.string().uuid(),
    source_hash: z.string().min(1),
    replayed: z.boolean(),
  }).passthrough(),
]);
const payrollTimesheetDeriveResponseSchema = z.union([
  payrollTimesheetDeriveSuccessSchema,
  payrollTimesheetDeriveBlockedSchema,
]);

export type PayrollScope = {
  organizationId: string;
  userId: string;
  localDate: string;
};

export type PayrollTimeEventPayload = z.infer<typeof timeEventPayloadSchema>;
export type PayrollSessionAttendancePayload = z.infer<typeof sessionAttendancePayloadSchema>;
export type PayrollTimeCorrectionPayload = z.infer<typeof timeCorrectionPayloadSchema>;
export type PayrollSessionAttendanceCorrectionPayload = z.infer<typeof attendanceCorrectionPayloadSchema>;
export type PayrollDayState = z.infer<typeof payrollDayStateSchema>;
export type PayrollMutationSuccess = z.infer<typeof mutationSuccessSchema> & Record<string, unknown>;
export type PayrollBootstrap = z.infer<typeof payrollBootstrapSchema>;
export type PayrollEmployeeTimeEvent = z.infer<typeof employeeTimeEventSchema>;
export type PayrollSessionAttendanceEvent = z.infer<typeof sessionAttendanceEventSchema>;
export type PayrollTimeCorrectionRequest = z.infer<typeof timeCorrectionRequestSchema>;
export type PayrollSessionAttendanceCorrectionRequest = z.infer<typeof sessionAttendanceCorrectionRequestSchema>;
export type PayrollTimekeepingException = z.infer<typeof timekeepingExceptionSchema>;
export type PayrollSessionContext = z.infer<typeof payrollSessionContextOkSchema>;
export type PayrollSessionContextResponse = z.infer<typeof payrollSessionContextResponseSchema>;
export type PayrollTimesheetState = z.infer<typeof payrollTimesheetStateSchema>;
export type PayrollTimesheetSnapshot = z.infer<typeof payrollTimesheetSnapshotSchema>;
export type PayrollTimesheetPeriodResponse = z.infer<typeof payrollTimesheetPeriodResponseSchema>;
export type PayrollTimesheetDeriveResponse =
  | z.infer<typeof payrollTimesheetDeriveSuccessSchema>
  | z.infer<typeof payrollTimesheetDeriveBlockedSchema>;
export type PayrollApprovalTransition = z.infer<typeof payrollApprovalTransitionSchema>;
export type PayrollBlockerResolutionResponse = z.infer<typeof payrollBlockerResolutionResponseSchema>;
export type PayrollReviewQueueResponse = z.infer<typeof payrollReviewQueueResponseSchema>;
export type PayrollReviewDetailsResponse = z.infer<typeof payrollReviewDetailsResponseSchema>;
export type PayrollDayResponse = {
  state: PayrollDayState;
  bootstrap?: PayrollBootstrap;
  day: {
    employeeTimeEvents: PayrollEmployeeTimeEvent[];
    sessionAttendanceEvents: PayrollSessionAttendanceEvent[];
    timeCorrectionRequests: PayrollTimeCorrectionRequest[];
    sessionAttendanceCorrectionRequests: PayrollSessionAttendanceCorrectionRequest[];
    exceptions: PayrollTimekeepingException[];
  };
  totals?: {
    label: string;
  };
};

type ScopedMutationInput<T> = PayrollScope & {
  idempotencyKey: string;
} & T;

type PayrollApprovalScopeInput = PayrollScope & {
  idempotencyKey: string;
  snapshotId: string;
  snapshotHash: string;
};

const containsForbiddenAuthority = (value: unknown): boolean => {
  if (!value || typeof value !== "object") {
    return false;
  }
  if (Array.isArray(value)) {
    return value.some((entry) => containsForbiddenAuthority(entry));
  }
  return Object.entries(value as Record<string, unknown>).some(([key, nested]) =>
    FORBIDDEN_AUTHORITY_KEYS.has(key) || containsForbiddenAuthority(nested)
  );
};

const withRetryAfterHeader = (
  error: NormalizedApiError,
  response: Response,
): NormalizedApiError => {
  if (typeof error.retryAfterSeconds === "number" || typeof error.retryAfter === "string") {
    return error;
  }
  const retryAfterHeader = response.headers.get("Retry-After")?.trim() ?? "";
  if (!retryAfterHeader) {
    return error;
  }
  const retryAfterSeconds = Number(retryAfterHeader);
  if (Number.isFinite(retryAfterSeconds)) {
    error.retryAfterSeconds = retryAfterSeconds;
  }
  return error;
};

const buildAuthorityError = (): never => {
  throw new Error("Authority fields are not allowed in payroll requests.");
};

const assertNoAuthorityFields = (value: unknown): void => {
  if (containsForbiddenAuthority(value)) {
    buildAuthorityError();
  }
};

const assertNonEmptyIdempotencyKey = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("A non-empty payroll idempotency key is required.");
  }
  return trimmed;
};

const buildMutationMismatchError = (
  requestedKey: string,
  headerKey: string,
  bodyKey: string,
): never => {
  throw toNormalizedApiError(
    {
      code: "idempotency_mismatch",
      error: `Payroll confirmation key mismatch for ${requestedKey}.`,
      data: {
        requestedKey,
        responseHeaderKey: headerKey || null,
        responseBodyKey: bodyKey || null,
      },
    },
    502,
    "Payroll confirmation key mismatch.",
  );
};

const parseFailure = async (
  response: Response,
  fallbackMessage: string,
): Promise<NormalizedApiError> => {
  let payload: Record<string, unknown> | null = null;
  try {
    payload = await response.json() as Record<string, unknown>;
  } catch {
    payload = null;
  }
  const error = toNormalizedApiError(payload, response.status, fallbackMessage);
  if (payload && typeof payload.state === "string") {
    (error as NormalizedApiError & { state?: string }).state = payload.state;
  }
  if (payload && typeof payload.idempotencyKey === "string" && !error.data) {
    error.data = { idempotencyKey: payload.idempotencyKey };
  }
  return withRetryAfterHeader(error, response);
};

const confirmExactIdempotencyKey = async (
  response: Response,
  requestedKey: string,
): Promise<PayrollMutationSuccess> => {
  const parsed = await parseJsonResponse(response.clone(), mutationSuccessSchema);
  if (!response.ok || !parsed) {
    throw await parseFailure(response, "Payroll request failed.");
  }

  const headerKey = response.headers.get("Idempotency-Key")?.trim() ?? "";
  const bodyKey = parsed.idempotencyKey.trim();
  if (headerKey !== requestedKey || bodyKey !== requestedKey) {
    buildMutationMismatchError(requestedKey, headerKey, bodyKey);
  }

  return parsed;
};

const postPayrollAction = async (
  body: Record<string, unknown>,
  idempotencyKey?: string,
): Promise<Response> => {
  const headers = new Headers({
    "Content-Type": "application/json",
  });
  if (idempotencyKey) {
    headers.set("Idempotency-Key", idempotencyKey);
  }
  return callApi(PAYROLL_TIME_ENDPOINT, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
};

const postPayrollApprovalAction = async (
  body: Record<string, unknown>,
  idempotencyKey: string,
): Promise<Response> =>
  callApi(PAYROLL_APPROVALS_ENDPOINT, {
    method: "POST",
    headers: new Headers({
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    }),
    body: JSON.stringify(body),
  });

export const validatePayrollTimeEventPayload = (
  payload: PayrollTimeEventPayload,
): PayrollTimeEventPayload => {
  assertNoAuthorityFields(payload);
  return timeEventPayloadSchema.parse(payload);
};

export const validatePayrollSessionAttendancePayload = (
  payload: PayrollSessionAttendancePayload,
): PayrollSessionAttendancePayload => {
  assertNoAuthorityFields(payload);
  return sessionAttendancePayloadSchema.parse(payload);
};

export const buildPayrollSessionAttendancePayload = (input: {
  occurredAt: string;
  eventType: "session_started" | "session_ended";
  sessionId: string;
}): PayrollSessionAttendancePayload => validatePayrollSessionAttendancePayload({
  occurredAt: input.occurredAt,
  data: {
    eventType: input.eventType,
    sessionId: input.sessionId,
  },
});

export async function fetchPayrollDay(scope: PayrollScope): Promise<PayrollDayResponse> {
  const response = await postPayrollAction({
    action: "get_day",
    localDate: z.string().date().parse(scope.localDate),
  });

  if (!response.ok) {
    throw await parseFailure(response, "Failed to fetch payroll day.");
  }

  const parsed = await parseJsonResponse(response.clone(), payrollDayResponseSchema);
  if (!parsed) {
    throw toNormalizedApiError(
      {
        code: "invalid_response",
        error: "Invalid payroll day response.",
      },
      502,
      "Invalid payroll day response.",
    );
  }

  return {
    state: parsed.state,
    ...(parsed.bootstrap ? { bootstrap: parsed.bootstrap } : {}),
    day: {
      employeeTimeEvents: parsed.day?.employeeTimeEvents ?? [],
      sessionAttendanceEvents: parsed.day?.sessionAttendanceEvents ?? [],
      timeCorrectionRequests: parsed.day?.timeCorrectionRequests ?? [],
      sessionAttendanceCorrectionRequests: parsed.day?.sessionAttendanceCorrectionRequests ?? [],
      exceptions: parsed.day?.exceptions ?? [],
    },
    ...(parsed.totals?.label ? { totals: { label: parsed.totals.label } } : {}),
  };
}

export async function fetchPayrollTimesheetPeriod(scope: PayrollScope): Promise<PayrollTimesheetPeriodResponse> {
  const response = await callApi(PAYROLL_TIMESHEET_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action: "get_period",
      selectedLocalDate: z.string().date().parse(scope.localDate),
    }),
  });

  if (!response.ok) {
    throw await parseFailure(response, "Failed to fetch payroll timesheet period.");
  }

  const parsed = await parseJsonResponse(response.clone(), payrollTimesheetPeriodResponseSchema);
  if (!parsed) {
    throw toNormalizedApiError(
      {
        code: "invalid_response",
        error: "Invalid payroll timesheet period response.",
      },
      502,
      "Invalid payroll timesheet period response.",
    );
  }

  return parsed;
}

export async function derivePayrollTimesheetSnapshot(scope: PayrollScope, input: {
  selectedLocalDate: string;
  idempotencyKey: string;
}): Promise<PayrollTimesheetDeriveResponse> {
  const idempotencyKey = assertNonEmptyIdempotencyKey(input.idempotencyKey);
  const response = await callApi(PAYROLL_TIMESHEET_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({
      action: "derive_snapshot",
      selectedLocalDate: z.string().date().parse(input.selectedLocalDate),
    }),
  });

  if (!response.ok) {
    throw await parseFailure(response, "Failed to derive payroll timesheet snapshot.");
  }

  const parsed = await parseJsonResponse(response.clone(), payrollTimesheetDeriveResponseSchema);
  const legacyParsed = !parsed
    ? await parseJsonResponse(response.clone(), payrollTimesheetDeriveLegacySuccessSchema)
    : null;
  if (!parsed && !legacyParsed) {
    throw toNormalizedApiError(
      {
        code: "invalid_response",
        error: "Invalid payroll timesheet derivation response.",
      },
      502,
      "Invalid payroll timesheet derivation response.",
    );
  }

  if (response.headers.get("Idempotency-Key")?.trim() !== idempotencyKey) {
    throw toNormalizedApiError(
      {
        code: "idempotency_mismatch",
        error: "Payroll confirmation key mismatch.",
      },
      502,
      "Payroll confirmation key mismatch.",
    );
  }

  if (parsed) {
    return parsed;
  }

  return {
    state: "ok",
    idempotencyKey: legacyParsed.idempotencyKey,
    snapshotId: "snapshotId" in legacyParsed ? legacyParsed.snapshotId : legacyParsed.snapshot_id,
    sourceHash: "sourceHash" in legacyParsed ? legacyParsed.sourceHash : legacyParsed.source_hash,
    replayed: legacyParsed.replayed,
  };
}

type FetchSessionPayrollContextOptions = {
  allowDisabled?: boolean;
};

export async function fetchSessionPayrollContext(
  sessionId: string,
  options: { allowDisabled: true },
): Promise<PayrollSessionContextResponse>;
export async function fetchSessionPayrollContext(
  sessionId: string,
  options?: FetchSessionPayrollContextOptions,
): Promise<PayrollSessionContext>;
export async function fetchSessionPayrollContext(
  sessionId: string,
  options?: FetchSessionPayrollContextOptions,
): Promise<PayrollSessionContextResponse> {
  const response = await postPayrollAction({
    action: "get_session_context",
    sessionId: z.string().uuid().parse(sessionId),
  });

  if (!response.ok) {
    throw await parseFailure(response, "Failed to fetch payroll session context.");
  }

  const parsed = await parseJsonResponse(response.clone(), payrollSessionContextResponseSchema);
  if (!parsed) {
    throw toNormalizedApiError(
      {
        code: "invalid_response",
        error: "Invalid payroll session context response.",
      },
      502,
      "Invalid payroll session context response.",
    );
  }

  if (parsed.state === "feature_disabled" && options?.allowDisabled !== true) {
    throw toNormalizedApiError(
      {
        code: "invalid_response",
        error: "Invalid payroll session context response.",
      },
      502,
      "Invalid payroll session context response.",
    );
  }

  return parsed;
}

export async function recordTimeEvent(
  input: ScopedMutationInput<{ event: PayrollTimeEventPayload }>,
): Promise<PayrollMutationSuccess> {
  const idempotencyKey = assertNonEmptyIdempotencyKey(input.idempotencyKey);
  const event = validatePayrollTimeEventPayload(input.event);
  const response = await postPayrollAction(
    {
      action: "record_time_event",
      event,
    },
    idempotencyKey,
  );
  return confirmExactIdempotencyKey(response, idempotencyKey);
}

export async function recordSessionAttendance(
  input: ScopedMutationInput<{ event: PayrollSessionAttendancePayload }>,
): Promise<PayrollMutationSuccess> {
  const idempotencyKey = assertNonEmptyIdempotencyKey(input.idempotencyKey);
  const event = validatePayrollSessionAttendancePayload(input.event);
  const response = await postPayrollAction(
    {
      action: "record_session_attendance",
      event,
    },
    idempotencyKey,
  );
  return confirmExactIdempotencyKey(response, idempotencyKey);
}

export async function requestTimeCorrection(
  input: ScopedMutationInput<{ correction: PayrollTimeCorrectionPayload }>,
): Promise<PayrollMutationSuccess> {
  const idempotencyKey = assertNonEmptyIdempotencyKey(input.idempotencyKey);
  assertNoAuthorityFields(input.correction);
  const correction = timeCorrectionPayloadSchema.parse(input.correction);
  const response = await postPayrollAction(
    {
      action: "request_correction",
      correction,
    },
    idempotencyKey,
  );
  return confirmExactIdempotencyKey(response, idempotencyKey);
}

export async function requestSessionAttendanceCorrection(
  input: ScopedMutationInput<{ correction: PayrollSessionAttendanceCorrectionPayload }>,
): Promise<PayrollMutationSuccess> {
  const idempotencyKey = assertNonEmptyIdempotencyKey(input.idempotencyKey);
  assertNoAuthorityFields(input.correction);
  const correction = attendanceCorrectionPayloadSchema.parse(input.correction);
  const response = await postPayrollAction(
    {
      action: "request_session_attendance_correction",
      correction,
    },
    idempotencyKey,
  );
  return confirmExactIdempotencyKey(response, idempotencyKey);
}

const validateSnapshotBinding = (input: { snapshotId: string; snapshotHash: string }) => ({
  snapshotId: z.string().uuid().parse(input.snapshotId),
  snapshotHash: payrollSnapshotHashSchema.parse(input.snapshotHash),
});

const confirmExactApprovalResponse = async <T extends { idempotencyKey: string }>(
  response: Response,
  requestedKey: string,
  schema: z.ZodSchema<T>,
): Promise<T> => {
  const parsed = await parseJsonResponse(response.clone(), schema);
  if (!response.ok) {
    throw await parseFailure(response, "Payroll approval request failed.");
  }
  if (!parsed) {
    throw toNormalizedApiError(
      {
        code: "invalid_response",
        error: "Invalid payroll approval response.",
      },
      502,
      "Invalid payroll approval response.",
    );
  }

  const headerKey = response.headers.get("Idempotency-Key")?.trim() ?? "";
  if (headerKey !== requestedKey || parsed.idempotencyKey !== requestedKey) {
    buildMutationMismatchError(requestedKey, headerKey, parsed.idempotencyKey);
  }

  return parsed;
};

const validatePayrollApprovalComment = (comment: string): string => z.string().min(1).parse(comment);
const validatePayrollApprovalReason = (reason: string): string => z.string().min(1).parse(reason);

export async function submitPayrollApproval(
  input: PayrollApprovalScopeInput & { attestation: true },
): Promise<PayrollApprovalTransition> {
  const idempotencyKey = assertNonEmptyIdempotencyKey(input.idempotencyKey);
  const snapshot = validateSnapshotBinding(input);
  const response = await postPayrollApprovalAction({
    action: "submit",
    ...snapshot,
    attestation: true,
  }, idempotencyKey);
  return confirmExactApprovalResponse(response, idempotencyKey, payrollApprovalTransitionSchema);
}

export async function approvePayrollTimesheet(
  input: PayrollApprovalScopeInput & { comment?: string; nested?: unknown },
): Promise<PayrollApprovalTransition> {
  assertNoAuthorityFields(input.nested);
  const idempotencyKey = assertNonEmptyIdempotencyKey(input.idempotencyKey);
  const snapshot = validateSnapshotBinding(input);
  const response = await postPayrollApprovalAction({
    action: "manager_approve",
    ...snapshot,
    ...(input.comment ? { comment: validatePayrollApprovalComment(input.comment) } : {}),
  }, idempotencyKey);
  return confirmExactApprovalResponse(response, idempotencyKey, payrollApprovalTransitionSchema);
}

export async function returnPayrollTimesheet(
  input: PayrollApprovalScopeInput & { comment: string },
): Promise<PayrollApprovalTransition> {
  const idempotencyKey = assertNonEmptyIdempotencyKey(input.idempotencyKey);
  const snapshot = validateSnapshotBinding(input);
  const response = await postPayrollApprovalAction({
    action: "return",
    ...snapshot,
    comment: validatePayrollApprovalComment(input.comment),
  }, idempotencyKey);
  return confirmExactApprovalResponse(response, idempotencyKey, payrollApprovalTransitionSchema);
}

export async function lockPayrollTimesheet(
  input: PayrollApprovalScopeInput,
): Promise<PayrollApprovalTransition> {
  const idempotencyKey = assertNonEmptyIdempotencyKey(input.idempotencyKey);
  const snapshot = validateSnapshotBinding(input);
  const response = await postPayrollApprovalAction({
    action: "lock",
    ...snapshot,
  }, idempotencyKey);
  return confirmExactApprovalResponse(response, idempotencyKey, payrollApprovalTransitionSchema);
}

export async function reopenPayrollTimesheet(
  input: PayrollApprovalScopeInput & { reason: string },
): Promise<PayrollApprovalTransition> {
  const idempotencyKey = assertNonEmptyIdempotencyKey(input.idempotencyKey);
  const snapshot = validateSnapshotBinding(input);
  const response = await postPayrollApprovalAction({
    action: "reopen",
    ...snapshot,
    reason: validatePayrollApprovalReason(input.reason),
  }, idempotencyKey);
  return confirmExactApprovalResponse(response, idempotencyKey, payrollApprovalTransitionSchema);
}

export async function resolvePayrollBlocker(
  input: PayrollApprovalScopeInput & {
    blockerType: z.infer<typeof payrollBlockerTypeSchema>;
    blockerId: string;
    resolution: z.infer<typeof payrollBlockerResolutionSchema>;
    reason: string;
  },
): Promise<PayrollBlockerResolutionResponse> {
  const idempotencyKey = assertNonEmptyIdempotencyKey(input.idempotencyKey);
  const snapshot = validateSnapshotBinding(input);
  const response = await postPayrollApprovalAction({
    action: "resolve_blocker",
    ...snapshot,
    blockerType: payrollBlockerTypeSchema.parse(input.blockerType),
    blockerId: z.string().uuid().parse(input.blockerId),
    resolution: payrollBlockerResolutionSchema.parse(input.resolution),
    reason: validatePayrollApprovalReason(input.reason),
  }, idempotencyKey);
  return confirmExactApprovalResponse(response, idempotencyKey, payrollBlockerResolutionResponseSchema);
}

export async function fetchPayrollReviewQueue(scope: PayrollScope): Promise<PayrollReviewQueueResponse> {
  const response = await callApi(PAYROLL_APPROVALS_ENDPOINT, {
    method: "POST",
    headers: new Headers({
      "Content-Type": "application/json",
    }),
    body: JSON.stringify({
      action: "review_queue",
      selectedLocalDate: z.string().date().parse(scope.localDate),
    }),
  });

  if (!response.ok) {
    throw await parseFailure(response, "Failed to fetch payroll review queue.");
  }

  const parsed = await parseJsonResponse(response.clone(), payrollReviewQueueResponseSchema);
  if (!parsed) {
    throw toNormalizedApiError(
      {
        code: "invalid_response",
        error: "Invalid payroll approval response.",
      },
      502,
      "Invalid payroll approval response.",
    );
  }

  return parsed;
}

export async function fetchPayrollReviewDetails(
  input: PayrollScope & { snapshotId: string; snapshotHash: string },
): Promise<PayrollReviewDetailsResponse> {
  const response = await callApi(PAYROLL_APPROVALS_ENDPOINT, {
    method: "POST",
    headers: new Headers({
      "Content-Type": "application/json",
    }),
    body: JSON.stringify({
      action: "review_details",
      ...validateSnapshotBinding(input),
    }),
  });

  if (!response.ok) {
    throw await parseFailure(response, "Failed to fetch payroll review details.");
  }

  const parsed = await parseJsonResponse(response.clone(), payrollReviewDetailsResponseSchema);
  if (!parsed) {
    throw toNormalizedApiError(
      {
        code: "invalid_response",
        error: "Invalid payroll approval response.",
      },
      502,
      "Invalid payroll approval response.",
    );
  }

  return parsed;
}

export const isRetryablePayrollTransportError = (error: unknown): boolean => {
  const status = typeof (error as { status?: unknown })?.status === "number"
    ? (error as { status: number }).status
    : null;
  return status !== null && RETRYABLE_STATUSES.has(status);
};
