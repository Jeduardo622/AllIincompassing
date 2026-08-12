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
} from "./shared";
import { getApiAuthorityMode, proxyToEdgeAuthority } from "./edgeAuthority";

const TRACE_HEADER_NAMES = [
  "x-request-id",
  "x-correlation-id",
  "x-agent-operation-id",
] as const;
const PRESERVED_EDGE_HEADERS = new Set([
  "content-type",
  "idempotency-key",
  "idempotent-replay",
  "retry-after",
  "www-authenticate",
  "x-request-id",
  "x-correlation-id",
  "x-agent-operation-id",
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
  "employment_timezone",
  "employmentTimezone",
  "canonical_work_location",
  "canonicalWorkLocation",
  "active_shift_event_id",
  "activeShiftEventId",
  "actor_is_assigned_employee",
  "actorIsAssignedEmployee",
  "can_clock_self",
  "canClockSelf",
]);
const SUPPORTED_ACTIONS = new Set([
  "get_day",
  "get_session_context",
  "record_time_event",
  "record_session_attendance",
  "request_correction",
  "request_session_attendance_correction",
]);

const workLocationSchema = z.enum(["client_site", "office", "home", "community", "other"]);
const workCategorySchema = z.enum(["direct_service", "administration", "travel", "training"]);

const eventEnvelopeBaseSchema = z.object({
  occurredAt: z.string().min(1),
  timezone: z.string().min(1),
  workLocation: workLocationSchema,
});

const timeEventSchema = eventEnvelopeBaseSchema.extend({
  data: z.object({
    eventType: z.enum(["shift_started", "shift_ended", "meal_started", "meal_ended", "work_category_changed"]),
    workCategory: workCategorySchema.optional(),
    idempotencyKey: z.string().min(1).optional(),
    note: z.string().optional(),
  }).passthrough(),
}).passthrough();

const sessionAttendanceSchema = eventEnvelopeBaseSchema.extend({
  data: z.object({
    eventType: z.enum(["session_started", "session_ended"]),
    sessionId: z.string().uuid(),
    employeeTimeEventId: z.string().uuid().nullable().optional(),
    idempotencyKey: z.string().min(1).optional(),
    note: z.string().optional(),
  }).passthrough(),
}).passthrough();

const correctionSchema = z.object({
  data: z.object({
    originalEventId: z.string().uuid(),
    reasonCode: z.string().min(1),
    replacementPayload: z.record(z.string(), z.unknown()).optional(),
    idempotencyKey: z.string().min(1).optional(),
  }).passthrough(),
}).passthrough();

const attendanceCorrectionSchema = z.object({
  data: z.object({
    sessionAttendanceEventId: z.string().uuid(),
    reasonCode: z.string().min(1),
    replacementPayload: z.record(z.string(), z.unknown()).optional(),
    idempotencyKey: z.string().min(1).optional(),
  }).passthrough(),
}).passthrough();

const sessionPayrollContextResponseSchema = z.object({
  sessionId: z.string().uuid(),
  organizationId: z.string().uuid(),
  employmentProfileId: z.string().uuid(),
  employmentTimezone: z.string().min(1),
  actorIsAssignedEmployee: z.boolean(),
  canClockSelf: z.boolean(),
  canonicalWorkLocation: workLocationSchema,
  activeShiftEventId: z.string().uuid().nullable(),
}).strict();

const payrollActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("get_day"), localDate: z.string().date() }),
  z.object({ action: z.literal("get_session_context"), sessionId: z.string().uuid() }).strict(),
  z.object({ action: z.literal("record_time_event"), event: timeEventSchema }),
  z.object({ action: z.literal("record_session_attendance"), event: sessionAttendanceSchema }),
  z.object({ action: z.literal("request_correction"), correction: correctionSchema }),
  z.object({ action: z.literal("request_session_attendance_correction"), correction: attendanceCorrectionSchema }),
]);

type PayrollAction = z.infer<typeof payrollActionSchema>;

const traceHeadersForRequest = (request: Request): Record<string, string> =>
  TRACE_HEADER_NAMES.reduce<Record<string, string>>((acc, headerName) => {
    const value = request.headers.get(headerName)?.trim();
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

const getNestedIdempotencyKey = (value: unknown): string | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const nested = record.data;
  if (!nested || typeof nested !== "object" || Array.isArray(nested)) {
    return null;
  }
  const candidate = (nested as Record<string, unknown>).idempotencyKey;
  return typeof candidate === "string" && candidate.trim().length > 0 ? candidate.trim() : null;
};

const normalizeSafeMessage = (value: unknown): string => {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().replace(/\s+/g, " ");
};

const validateAuthorityAndIdempotency = (
  request: Request,
  parsed: PayrollAction,
  traceHeaders: Record<string, string>,
): { idempotencyKey: string | null } | Response => {
  if (containsForbiddenAuthority(parsed)) {
    return errorResponse(request, "validation_error", "Authority fields are not allowed in payroll requests.", {
      headers: traceHeaders,
    });
  }

  if (parsed.action === "get_day") {
    return { idempotencyKey: null };
  }
  if (parsed.action === "get_session_context") {
    return { idempotencyKey: null };
  }

  const headerKey = request.headers.get("Idempotency-Key")?.trim() ?? "";
  if (!headerKey) {
    return errorResponse(request, "validation_error", "Idempotency-Key is required for payroll mutations.", {
      headers: traceHeaders,
    });
  }

  const nestedKey = getNestedIdempotencyKey(
    parsed.action === "record_time_event" || parsed.action === "record_session_attendance"
      ? parsed.event
      : parsed.correction,
  );
  if (nestedKey && nestedKey !== headerKey) {
    return errorResponse(request, "validation_error", "Nested idempotencyKey must match the Idempotency-Key header.", {
      headers: traceHeaders,
    });
  }

  return { idempotencyKey: headerKey };
};

const mapActionToRpc = (parsed: PayrollAction, idempotencyKey: string | null) => {
  switch (parsed.action) {
    case "get_day":
      return {
        functionName: "get_payroll_day",
        args: { local_date: parsed.localDate },
      };
    case "get_session_context":
      return {
        functionName: "get_session_payroll_context",
        args: { session_id: parsed.sessionId },
      };
    case "record_time_event":
      return {
        functionName: "record_employee_time_event",
        args: { event_payload: parsed.event, idempotency_key: idempotencyKey },
      };
    case "record_session_attendance":
      return {
        functionName: "record_session_attendance_event",
        args: { event_payload: parsed.event, idempotency_key: idempotencyKey },
      };
    case "request_correction":
      return {
        functionName: "request_time_correction",
        args: { correction_payload: parsed.correction, idempotency_key: idempotencyKey },
      };
    case "request_session_attendance_correction":
      return {
        functionName: "request_session_attendance_correction",
        args: { correction_payload: parsed.correction, idempotency_key: idempotencyKey },
      };
  }
};

const buildRpcUrl = (supabaseUrl: string, functionName: string): string =>
  functionName === "get_payroll_day"
    ? `${supabaseUrl}/rest/v1/rpc/${functionName}`
    : `${supabaseUrl}/rest/v1/rpc/${functionName}`;

const buildLegacyHeaders = (accessToken: string, anonKey: string): Record<string, string> => ({
  "Content-Type": "application/json",
  apikey: anonKey,
  Authorization: `Bearer ${accessToken}`,
});

const buildSuccessResponse = (
  request: Request,
  traceHeaders: Record<string, string>,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
) => jsonForRequest(request, body, 200, { ...traceHeaders, ...headers });

const buildStateConflictResponse = (
  request: Request,
  traceHeaders: Record<string, string>,
  idempotencyKey: string | null,
) => {
  const headers: Record<string, string> = { ...traceHeaders };
  const body: Record<string, unknown> = {
    success: false,
    error: "Payroll state conflict.",
    requestId: request.headers.get("x-request-id")?.trim() || crypto.randomUUID(),
    code: "state_conflict",
    message: "Payroll state conflict.",
    classification: {
      category: "request",
      severity: "medium",
      retryable: false,
      httpStatus: 409,
    },
  };

  if (idempotencyKey) {
    headers["Idempotency-Key"] = idempotencyKey;
    body.idempotencyKey = idempotencyKey;
  }

  return jsonForRequest(request, body, 409, headers);
};

const mapLegacyError = (
  request: Request,
  traceHeaders: Record<string, string>,
  result: { status: number; ok: boolean; data: unknown | null },
  idempotencyKey: string | null,
): Response => {
  const message = normalizeSafeMessage((result.data as { message?: unknown; error?: unknown } | null)?.message) ||
    normalizeSafeMessage((result.data as { error?: unknown } | null)?.error);
  const headers: Record<string, string> = {};
  const extra: Record<string, unknown> = {};
  if (idempotencyKey) {
    headers["Idempotency-Key"] = idempotencyKey;
    extra.idempotencyKey = idempotencyKey;
  }

  if (normalizeSafeMessage((result.data as { code?: unknown } | null)?.code) === "23514") {
    return buildStateConflictResponse(request, traceHeaders, idempotencyKey);
  }

  if (message.includes("IDEMPOTENCY_CONFLICT") || result.status === 409 || normalizeSafeMessage((result.data as { code?: unknown } | null)?.code).includes("23505")) {
    return errorResponse(request, "conflict", "Idempotency conflict.", {
      status: 409,
      headers: { ...traceHeaders, ...headers },
      extra,
    });
  }

  if (result.status === 401) {
    return errorResponse(request, "unauthorized", "Unauthorized", {
      status: 401,
      headers: { ...traceHeaders, ...headers, "WWW-Authenticate": "Bearer" },
      extra,
    });
  }

  if (result.status === 403) {
    return errorResponse(request, "forbidden", "Forbidden", {
      status: 403,
      headers: { ...traceHeaders, ...headers },
      extra,
    });
  }

  if (result.status === 400 || result.status === 422) {
    return errorResponse(request, "validation_error", "Invalid payroll request.", {
      status: 400,
      headers: { ...traceHeaders, ...headers },
      extra,
    });
  }

  if (result.status === 404) {
    return errorResponse(request, "not_found", "Not found", {
      status: 404,
      headers: { ...traceHeaders, ...headers },
      extra,
    });
  }

  return errorResponse(request, "upstream_error", "Payroll transport failed.", {
    status: result.status >= 400 ? result.status : 502,
    headers: { ...traceHeaders, ...headers },
    extra,
  });
};

export async function payrollTimeEventsHandler(request: Request): Promise<Response> {
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

  try {
    const accessToken = getAccessToken(request);
    if (!accessToken) {
      return errorResponse(request, "unauthorized", "Missing authorization token", {
        headers: { ...traceHeaders, "WWW-Authenticate": "Bearer" },
      });
    }

    const rateLimit = await consumeRateLimit(request, {
      keyPrefix: "api:payroll-time-events",
      maxRequests: 60,
      windowMs: 60_000,
    });
    if (rateLimit.limited) {
      return errorResponse(request, "rate_limited", "Too many payroll transport requests", {
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

    let payload: unknown;
    let payloadParsed = false;
    try {
      payload = await request.clone().json();
      payloadParsed = true;
    } catch {
      // Preserve edge ownership of malformed JSON while keeping the original request body unread.
    }

    if (payloadParsed && containsForbiddenAuthority(payload)) {
      return errorResponse(request, "validation_error", "Authority fields are not allowed in payroll requests.", {
        headers: traceHeaders,
      });
    }

    if (getApiAuthorityMode() === "edge") {
      const forwarded = await proxyToEdgeAuthority(request, {
        functionName: "payroll-time-events",
        accessToken,
        method: "POST",
      });
      const text = await forwarded.text();
      const responseHeaders = new Headers({
        ...corsHeadersForRequest(request),
        ...traceHeaders,
        "Content-Type": forwarded.headers.get("Content-Type") ?? "application/json",
      });
      forwarded.headers.forEach((value, key) => {
        if (PRESERVED_EDGE_HEADERS.has(key.toLowerCase())) {
          responseHeaders.set(key, value);
        }
      });
      return new Response(text, {
        status: forwarded.status,
        headers: responseHeaders,
      });
    }

    if (!payloadParsed) {
      try {
        payload = await request.json();
      } catch {
        return errorResponse(request, "validation_error", "Invalid JSON body", { headers: traceHeaders });
      }
    }

    const parsed = payrollActionSchema.safeParse(payload);
    if (!parsed.success) {
      const actionValue =
        payload && typeof payload === "object" && !Array.isArray(payload)
          ? (payload as Record<string, unknown>).action
          : undefined;
      return errorResponse(
        request,
        "validation_error",
        typeof actionValue === "string" && SUPPORTED_ACTIONS.has(actionValue) ? "Invalid payroll request body" : "Unsupported action",
        { headers: traceHeaders },
      );
    }

    const validated = validateAuthorityAndIdempotency(request, parsed.data, traceHeaders);
    if (validated instanceof Response) {
      return validated;
    }

    const { supabaseUrl, anonKey } = getSupabaseConfig();
    const rpc = mapActionToRpc(parsed.data, validated.idempotencyKey);
    const result = await fetchJson<Record<string, unknown>>(buildRpcUrl(supabaseUrl, rpc.functionName), {
      method: "POST",
      headers: buildLegacyHeaders(accessToken, anonKey),
      body: JSON.stringify(rpc.args),
    });

    if (!result.ok || !result.data) {
      return mapLegacyError(request, traceHeaders, result, validated.idempotencyKey);
    }

    if (parsed.data.action === "get_session_context") {
      const parsedContext = sessionPayrollContextResponseSchema.safeParse(result.data);
      if (!parsedContext.success) {
        return errorResponse(request, "invalid_response", "Invalid payroll session context response.", {
          status: 502,
          headers: traceHeaders,
        });
      }
      return buildSuccessResponse(request, traceHeaders, parsedContext.data);
    }

    if (validated.idempotencyKey) {
      const replayed = typeof result.data.replayed === "boolean" ? result.data.replayed : null;
      const headers: Record<string, string> = {
        "Idempotency-Key": validated.idempotencyKey,
      };
      if (replayed !== null) {
        headers["Idempotent-Replay"] = replayed ? "true" : "false";
      }
      return buildSuccessResponse(request, traceHeaders, {
        ...result.data,
        idempotencyKey: validated.idempotencyKey,
      }, headers);
    }

    return buildSuccessResponse(request, traceHeaders, result.data);
  } catch {
    return errorResponse(request, "upstream_error", "Payroll transport failed.", {
      status: 502,
      headers: traceHeaders,
    });
  }
}
