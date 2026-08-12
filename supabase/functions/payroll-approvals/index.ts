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
  idempotencyKey: z.string().min(1).optional(),
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
  idempotencyKey: z.string().min(1).optional(),
}).strict();

const payrollApprovalResponseSchema = z.union([
  payrollApprovalTransitionResponseSchema,
  payrollBlockerResolutionResponseSchema,
]);

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
    return jsonResponse(req, 400, { error: "Authority fields are not allowed in payroll requests." });
  }

  const idempotencyKey = req.headers.get("Idempotency-Key")?.trim() ?? "";
  if (!idempotencyKey) {
    return jsonResponse(req, 400, { error: "Idempotency-Key is required for payroll mutations." });
  }

  return { idempotencyKey };
};

const validateApprovalResponse = (req: Request, data: unknown): PayrollApprovalResponse | Response => {
  const parsed = payrollApprovalResponseSchema.safeParse(data);
  if (!parsed.success) {
    return jsonResponse(req, 502, {
      code: "invalid_response",
      error: "Invalid payroll approval response.",
    });
  }
  return parsed.data;
};

const mapActionToRpc = (parsed: PayrollApprovalAction, idempotencyKey: string) => {
  if (parsed.action === "resolve_blocker") {
    return {
      functionName: "resolve_payroll_blocker",
      args: {
        p_payload: {
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
  jsonResponse(req, 403, {
    code: "feature_disabled",
    error: "Payroll approval workflow is unavailable.",
    message: "Payroll approval workflow is unavailable.",
    state: "feature_disabled",
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
    return jsonResponse(req, 409, { code: "conflict", error: "Idempotency conflict.", idempotencyKey }, extraHeaders);
  }
  if (code === "42501") {
    return jsonResponse(req, 403, { code: "forbidden", error: "Forbidden", idempotencyKey }, extraHeaders);
  }
  if (code === "23514") {
    return jsonResponse(req, 409, { code: "state_conflict", error: "Payroll state conflict.", idempotencyKey }, extraHeaders);
  }
  if (code === "22023") {
    return jsonResponse(req, 400, { code: "validation_error", error: "Invalid payroll approval request.", idempotencyKey }, extraHeaders);
  }
  if (code === "55P03") {
    return jsonResponse(req, 409, { code: "conflict", error: "Payroll state is temporarily locked.", idempotencyKey }, {
      ...extraHeaders,
      "Retry-After": "1",
    });
  }

  return jsonResponse(req, 502, { code: "upstream_error", error: "Payroll transport failed.", idempotencyKey }, extraHeaders);
};

export async function handlePayrollApprovals({ req, userContext: _userContext, db }: HandlerParams): Promise<Response> {
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

  const parsed = payrollApprovalActionSchema.safeParse(payload);
  if (!parsed.success) {
    const actionValue =
      payload && typeof payload === "object" && !Array.isArray(payload)
        ? (payload as Record<string, unknown>).action
        : undefined;
    return jsonResponse(
      req,
      400,
      { error: typeof actionValue === "string" && SUPPORTED_ACTIONS.has(actionValue) ? "Invalid payroll approval request body" : "Unsupported action" },
    );
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

  const validatedResponse = validateApprovalResponse(req, data);
  if (validatedResponse instanceof Response) {
    return validatedResponse;
  }

  const replayed = validatedResponse.replayed ? "true" : "false";
  return jsonResponse(req, 200, {
    ...validatedResponse,
    idempotencyKey: validated.idempotencyKey,
  }, {
    "Idempotency-Key": validated.idempotencyKey,
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
