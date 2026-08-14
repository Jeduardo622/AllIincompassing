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
  "policy_version_id",
  "policyVersionId",
]);

const periodActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("get_period"),
    selectedLocalDate: z.string().date(),
  }).strict(),
  z.object({
    action: z.literal("derive_snapshot"),
    selectedLocalDate: z.string().date(),
  }).strict(),
]);

type PayrollTimesheetAction = z.infer<typeof periodActionSchema>;
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

const jsonResponse = (req: Request, status: number, body: Record<string, unknown>, extra: HeadersInit = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: buildCorsHeaders(req, extra),
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

const validateAuthorityAndIdempotency = (
  req: Request,
  parsed: PayrollTimesheetAction,
): { idempotencyKey: string | null } | Response => {
  if (containsForbiddenAuthority(parsed)) {
    return jsonResponse(req, 400, { error: "Authority fields are not allowed in payroll requests." });
  }

  if (parsed.action === "get_period") {
    return { idempotencyKey: null };
  }

  const headerKey = req.headers.get("Idempotency-Key")?.trim() ?? "";
  if (!headerKey) {
    return jsonResponse(req, 400, { error: "Idempotency-Key is required for payroll mutations." });
  }

  return { idempotencyKey: headerKey };
};

const mapRpcResult = (parsed: PayrollTimesheetAction, idempotencyKey: string | null) => {
  switch (parsed.action) {
    case "get_period":
      return {
        functionName: "get_payroll_timesheet_period",
        args: { selected_local_date: parsed.selectedLocalDate },
      };
    case "derive_snapshot":
      return {
        functionName: "derive_timesheet_snapshot",
        args: {
          selected_local_date: parsed.selectedLocalDate,
          p_idempotency_key: idempotencyKey,
        },
      };
  }
};

const mapRpcError = (req: Request, error: { code?: string; message?: string } | null, idempotencyKey: string | null): Response => {
  const extraHeaders: Record<string, string> = {};
  const extraBody: Record<string, unknown> = {};
  if (idempotencyKey) {
    extraHeaders["Idempotency-Key"] = idempotencyKey;
    extraBody.idempotencyKey = idempotencyKey;
  }

  if (error?.code === "23505") {
    return jsonResponse(req, 409, { code: "conflict", error: "Idempotency conflict.", ...extraBody }, extraHeaders);
  }
  if (error?.code === "42501") {
    return jsonResponse(req, 403, { code: "forbidden", error: "Forbidden", ...extraBody }, extraHeaders);
  }
  if (error?.code === "23514") {
    return jsonResponse(req, 409, { code: "state_conflict", error: "Payroll state conflict.", ...extraBody }, extraHeaders);
  }
  if (error?.code === "22023") {
    return jsonResponse(req, 400, { code: "validation_error", error: "Invalid payroll request.", ...extraBody }, extraHeaders);
  }

  return jsonResponse(req, 502, { code: "upstream_error", error: "Payroll transport failed.", ...extraBody }, extraHeaders);
};

export async function handlePayrollTimesheets({ req, userContext: _userContext, db }: HandlerParams): Promise<Response> {
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

  const parsedResult = periodActionSchema.safeParse(payload);
  if (!parsedResult.success) {
    return jsonResponse(req, 400, { error: "Unsupported action" });
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

  if (validated.idempotencyKey) {
    const replayed = typeof (data as { replayed?: unknown } | null)?.replayed === "boolean"
      ? Boolean((data as { replayed?: boolean }).replayed)
      : null;
    const headers: Record<string, string> = { "Idempotency-Key": validated.idempotencyKey };
    if (replayed !== null) {
      headers["Idempotent-Replay"] = replayed ? "true" : "false";
    }
    const body =
      data && typeof data === "object" && !Array.isArray(data)
        ? { ...(data as Record<string, unknown>), idempotencyKey: validated.idempotencyKey }
        : { data, idempotencyKey: validated.idempotencyKey };
    return jsonResponse(req, 200, body, headers);
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
          handlePayrollTimesheets({
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
