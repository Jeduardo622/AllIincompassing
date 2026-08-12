// deno-lint-ignore-file no-import-prefix
import { z } from "npm:zod";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.50.0";
import { corsHeadersForRequest, resolveAllowedOriginForRequest } from "../_shared/cors.ts";

type Role = "bt" | "therapist" | "midtier" | "admin_schedule" | "admin" | "bcba" | "super_admin";
type UserContext = {
  user: { id: string; email: string | null };
  profile: { id: string; email: string | null; role: Role; is_active: boolean };
};

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

type HandlerParams = {
  req: Request;
  userContext: UserContext;
  db: SupabaseClient;
};

type InitializedDependencies = {
  protectedHandler: (req: Request) => Promise<Response>;
};

let initializedDependenciesPromise: Promise<InitializedDependencies> | null = null;

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

const normalizeErrorMessage = (message: string): string => message.trim().replace(/\s+/g, " ");

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

const validateAuthorityAndIdempotency = (
  req: Request,
  parsed: PayrollAction,
): { idempotencyKey: string | null } | Response => {
  if (containsForbiddenAuthority(parsed)) {
    return jsonResponse(req, 400, { error: "Authority fields are not allowed in payroll requests." });
  }

  if (parsed.action === "get_day") {
    return { idempotencyKey: null };
  }
  if (parsed.action === "get_session_context") {
    return { idempotencyKey: null };
  }

  const headerKey = req.headers.get("Idempotency-Key")?.trim() ?? "";
  if (!headerKey) {
    return jsonResponse(req, 400, { error: "Idempotency-Key is required for payroll mutations." });
  }

  const nestedKey = getNestedIdempotencyKey(
    parsed.action === "record_time_event" || parsed.action === "record_session_attendance"
      ? parsed.event
      : parsed.correction,
  );
  if (nestedKey && nestedKey !== headerKey) {
    return jsonResponse(req, 400, { error: "Nested idempotencyKey must match the Idempotency-Key header." });
  }

  return { idempotencyKey: headerKey };
};

const mapRpcResult = (parsed: PayrollAction, idempotencyKey: string | null) => {
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

const mapRpcError = (req: Request, error: { code?: string; message?: string } | null, idempotencyKey: string | null): Response => {
  const code = typeof error?.code === "string" ? error.code : "";
  const message = normalizeErrorMessage(typeof error?.message === "string" ? error.message : "Payroll transport failed");
  const extraHeaders: Record<string, string> = {};
  const extraBody: Record<string, unknown> = {};

  if (idempotencyKey) {
    extraHeaders["Idempotency-Key"] = idempotencyKey;
    extraBody.idempotencyKey = idempotencyKey;
  }

  if (message.includes("IDEMPOTENCY_CONFLICT") || code === "23505") {
    return jsonResponse(req, 409, {
      code: "conflict",
      error: "Idempotency conflict.",
      ...extraBody,
    }, extraHeaders);
  }

  if (code === "42501") {
    return jsonResponse(req, 403, {
      code: "forbidden",
      error: "Forbidden",
      ...extraBody,
    }, extraHeaders);
  }

  if (code === "23514") {
    return jsonResponse(req, 409, {
      code: "state_conflict",
      error: "Payroll state conflict.",
      ...extraBody,
    }, extraHeaders);
  }

  if (code === "22023") {
    return jsonResponse(req, 400, {
      code: "validation_error",
      error: "Invalid payroll request.",
      ...extraBody,
    }, extraHeaders);
  }

  if (code === "55P03") {
    extraHeaders["Retry-After"] = "1";
    return jsonResponse(req, 409, {
      code: "conflict",
      error: "Payroll state is temporarily locked.",
      ...extraBody,
    }, extraHeaders);
  }

  return jsonResponse(req, 502, {
    code: "upstream_error",
    error: "Payroll transport failed.",
    ...extraBody,
  }, extraHeaders);
};

const buildMutationHeaders = (req: Request, idempotencyKey: string, replayed: boolean | null) => {
  const headers: Record<string, string> = { "Idempotency-Key": idempotencyKey };
  if (replayed !== null) {
    headers["Idempotent-Replay"] = replayed ? "true" : "false";
  }
  return buildCorsHeaders(req, { ...traceHeadersForRequest(req), ...headers });
};

export async function handlePayrollTimeEvents({ req, userContext: _userContext, db }: HandlerParams): Promise<Response> {
  const requestedOrigin = req.headers.get("origin");
  if (requestedOrigin && !resolveAllowedOriginForRequest(req)) {
    return jsonResponse(req, 403, { error: "Origin not allowed" });
  }

  if (req.method !== "POST") {
    return jsonResponse(req, 405, { error: "Method not allowed" });
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse(req, 400, { error: "Invalid JSON body" });
  }

  if (containsForbiddenAuthority(payload)) {
    return jsonResponse(req, 400, { error: "Authority fields are not allowed in payroll requests." });
  }

  const parsedResult = payrollActionSchema.safeParse(payload);
  if (!parsedResult.success) {
    const actionValue =
      payload && typeof payload === "object" && !Array.isArray(payload)
        ? (payload as Record<string, unknown>).action
        : undefined;
    return jsonResponse(
      req,
      400,
      { error: typeof actionValue === "string" && SUPPORTED_ACTIONS.has(actionValue) ? "Invalid payroll request body" : "Unsupported action" },
    );
  }

  const validated = validateAuthorityAndIdempotency(req, parsedResult.data);
  if (validated instanceof Response) {
    return validated;
  }

  const rpc = mapRpcResult(parsedResult.data, validated.idempotencyKey);
  const { data, error } = await db.rpc(rpc.functionName, rpc.args as never);

  if (error) {
    return mapRpcError(req, error as { code?: string; message?: string }, validated.idempotencyKey);
  }

  if (parsedResult.data.action === "get_session_context") {
    const parsedContext = sessionPayrollContextResponseSchema.safeParse(data);
    if (!parsedContext.success) {
      return jsonResponse(req, 502, {
        code: "invalid_response",
        error: "Invalid payroll session context response.",
      });
    }
    return jsonResponse(req, 200, parsedContext.data);
  }

  if (validated.idempotencyKey) {
    const replayed = typeof (data as { replayed?: unknown } | null)?.replayed === "boolean"
      ? Boolean((data as { replayed?: boolean }).replayed)
      : null;
    const body =
      data && typeof data === "object" && !Array.isArray(data)
        ? { ...(data as Record<string, unknown>), idempotencyKey: validated.idempotencyKey }
        : { data, idempotencyKey: validated.idempotencyKey };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: buildMutationHeaders(req, validated.idempotencyKey, replayed),
    });
  }

  return jsonResponse(
    req,
    200,
    data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : { data },
  );
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
          handlePayrollTimeEvents({
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
    return jsonResponse(req, 403, { error: "Origin not allowed" });
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
