import { z } from "zod";
import { callApi } from "../../lib/api";
import { parseJsonResponse } from "../../lib/sdk/contracts";
import { toNormalizedApiError, type NormalizedApiError } from "../../lib/sdk/errors";

const PAYROLL_TIME_ENDPOINT = "/api/payroll-time-events";
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
const payrollDayStateSchema = z.enum([
  "ok",
  "feature_disabled",
  "unsupported_jurisdiction",
  "no_employment_profile",
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
  timezone: z.string().min(1),
  workLocation: workLocationSchema,
  data: z.object({
    eventType: z.enum(["session_started", "session_ended"]),
    sessionId: z.string().uuid(),
    employeeTimeEventId: z.string().uuid().nullable().optional(),
    note: z.string().optional(),
  }).passthrough(),
}).passthrough();

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

const payrollBootstrapSchema = z.object({
  organizationId: z.string().min(1),
  employmentProfileId: z.string().min(1).nullable(),
  localDate: z.string().date(),
  employmentTimezone: z.string().min(1),
  workdayStartsAt: z.string().min(1),
  capabilities: z.object({
    canViewSelf: z.boolean(),
    canClockSelf: z.boolean(),
    canRequestCorrectionSelf: z.boolean(),
  }),
});

const payrollDayResponseSchema = z.object({
  state: payrollDayStateSchema,
  bootstrap: payrollBootstrapSchema.optional(),
  day: z.object({
    employeeTimeEvents: z.unknown().optional(),
    sessionAttendanceEvents: z.unknown().optional(),
    timeCorrectionRequests: z.unknown().optional(),
    sessionAttendanceCorrectionRequests: z.unknown().optional(),
    exceptions: z.unknown().optional(),
  }).optional(),
  totals: z.object({
    label: z.string().min(1),
  }).passthrough().optional(),
}).passthrough();

const mutationSuccessSchema = z.object({
  idempotencyKey: z.string().min(1),
}).passthrough();

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
export type PayrollDayResponse = {
  state: PayrollDayState;
  bootstrap?: z.infer<typeof payrollBootstrapSchema>;
  day: {
    employeeTimeEvents: unknown[];
    sessionAttendanceEvents: unknown[];
    timeCorrectionRequests: unknown[];
    sessionAttendanceCorrectionRequests: unknown[];
    exceptions: unknown[];
  };
  totals?: {
    label: string;
  };
};

type ScopedMutationInput<T> = PayrollScope & {
  idempotencyKey: string;
} & T;

const asSafeArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

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
      employeeTimeEvents: asSafeArray(parsed.day?.employeeTimeEvents),
      sessionAttendanceEvents: asSafeArray(parsed.day?.sessionAttendanceEvents),
      timeCorrectionRequests: asSafeArray(parsed.day?.timeCorrectionRequests),
      sessionAttendanceCorrectionRequests: asSafeArray(parsed.day?.sessionAttendanceCorrectionRequests),
      exceptions: asSafeArray(parsed.day?.exceptions),
    },
    ...(parsed.totals?.label ? { totals: { label: parsed.totals.label } } : {}),
  };
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

export const isRetryablePayrollTransportError = (error: unknown): boolean => {
  const status = typeof (error as { status?: unknown })?.status === "number"
    ? (error as { status: number }).status
    : null;
  return status !== null && RETRYABLE_STATUSES.has(status);
};
