// deno-lint-ignore-file no-import-prefix
import { z } from "npm:zod";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.50.0";
import type { Role, UserContext } from "../_shared/auth-middleware.ts";
import { corsHeadersForRequest, resolveAllowedOriginForRequest } from "../_shared/cors.ts";

type ProtectedRouteFactory = (
  handler: (req: Request, userContext: UserContext) => Promise<Response>,
  options: { requireAuth?: boolean; allowedRoles?: Role[] },
) => (req: Request) => Promise<Response>;

const PAYROLL_EXPORT_ALLOWED_ROLES = [
  "admin",
  "super_admin",
] as Role[];
const PAYROLL_EXPORT_METHODS = "GET, POST, OPTIONS";
const TRACE_HEADER_NAMES = [
  "x-request-id",
  "x-correlation-id",
  "x-agent-operation-id",
] as const;
const FORBIDDEN_AUTHORITY_KEYS = new Set<string>([
  "organization_id",
  "organizationid",
  "org_id",
  "orgid",
  "org",
  "tenant_id",
  "tenantid",
  "tenant",
  "actor_id",
  "actorid",
  "actor",
  "actor_user_id",
  "actoruserid",
  "caller_id",
  "callerid",
  "caller",
  "user_id",
  "userid",
  "employee_id",
  "employeeid",
  "employee",
  "employment_profile_id",
  "employmentprofileid",
]);
const ADAPTER_VERSION = "provider-neutral-v1" as const;
const IDEMPOTENCY_KEY_REGEX = /^[\x21-\x7E]{1,200}$/;
const SAFE_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const createPayrollExportRequestSchema = z.object({
  payPeriodId: z.string().uuid(),
  idempotencyKey: z.string().regex(IDEMPOTENCY_KEY_REGEX),
  adapterVersion: z.literal(ADAPTER_VERSION).optional(),
}).strict();

const createPayrollExportResponseSchema = z.object({
  runId: z.string().uuid(),
  payPeriodId: z.string().uuid(),
  adapterVersion: z.literal(ADAPTER_VERSION),
  replayed: z.boolean(),
  createdAt: z.string().min(1),
  exportedAt: z.string().min(1),
  reconciliationStatus: z.literal("reconciled"),
  checksumSha256: z.string().regex(/^[0-9a-f]{64}$/),
  rowCount: z.number().int().nonnegative(),
  totalRegularSeconds: z.number().int().nonnegative(),
  totalOvertimeSeconds: z.number().int().nonnegative(),
  totalDoubleTimeSeconds: z.number().int().nonnegative(),
  totalMealPremiumCents: z.number().int().nonnegative(),
  totalGrossEarningsCents: z.number().int().nonnegative(),
  sourceSnapshotCount: z.number().int().nonnegative(),
  adjustsRunId: z.string().uuid().nullable(),
}).strict();

const getPayrollExportResponseSchema = z.object({
  runId: z.string().uuid(),
  payPeriodId: z.string().uuid(),
  adapterVersion: z.literal(ADAPTER_VERSION),
  periodStart: z.string().regex(SAFE_DATE_REGEX),
  periodEnd: z.string().regex(SAFE_DATE_REGEX),
  csv: z.string().min(1),
}).strict();

const protectedErrorResponseSchema = z.object({
  success: z.literal(false),
  requestId: z.string().min(1),
  code: z.string().min(1),
  error: z.string().min(1),
  message: z.string().min(1),
  classification: z.object({
    category: z.string().min(1),
    severity: z.enum(["low", "medium", "high", "critical"]),
    retryable: z.boolean(),
    httpStatus: z.number().int(),
  }).strict(),
  idempotencyKey: z.string().regex(IDEMPOTENCY_KEY_REGEX).optional(),
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
    "Access-Control-Allow-Methods": PAYROLL_EXPORT_METHODS,
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
    headers: buildCorsHeaders(req, {
      ...traceHeadersForRequest(req),
      "Content-Type": "application/json",
      ...extra,
    }),
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

const buildDownloadFilename = (payload: z.infer<typeof getPayrollExportResponseSchema>) =>
  `payroll-export-${payload.adapterVersion}-${payload.periodStart}-to-${payload.periodEnd}-${payload.runId}.csv`;

const csvResponse = (req: Request, payload: z.infer<typeof getPayrollExportResponseSchema>) =>
  new Response(payload.csv, {
    status: 200,
    headers: buildCorsHeaders(req, {
      "Content-Type": "text/csv; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": `attachment; filename="${buildDownloadFilename(payload)}"`,
    }),
  });

const mapRpcError = (req: Request, error: { code?: string; message?: string } | null, idempotencyKey: string): Response => {
  const code = typeof error?.code === "string" ? error.code.trim() : "";
  const message = typeof error?.message === "string" ? error.message.trim() : "";
  const headers: Record<string, string> = idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {};

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
    }, headers);
  }
  if (code === "23514") {
    return jsonErrorResponse(req, 409, {
      code: "state_conflict",
      error: "Payroll export state conflict.",
      message: "Payroll export state conflict.",
      classification: PAYROLL_ERROR_CLASSIFICATIONS.state_conflict,
      ...(idempotencyKey ? { idempotencyKey } : {}),
    }, headers);
  }
  if (code === "22023") {
    return jsonErrorResponse(req, 400, {
      code: "validation_error",
      error: "Invalid payroll export request.",
      message: "Invalid payroll export request.",
      classification: {
        category: "validation",
        severity: "low",
        retryable: false,
        httpStatus: 400,
      },
      ...(idempotencyKey ? { idempotencyKey } : {}),
    }, headers);
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
    }, headers);
  }

  return jsonErrorResponse(req, 502, {
    code: "upstream_error",
    error: "Payroll export transport failed.",
    message: "Payroll export transport failed.",
    classification: {
      category: "upstream",
      severity: "high",
      retryable: true,
      httpStatus: 502,
    },
    ...(idempotencyKey ? { idempotencyKey } : {}),
  }, headers);
};

const parseCreatePayload = async (req: Request) => {
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
      error: "Authority fields are not allowed in payroll export requests.",
      message: "Authority fields are not allowed in payroll export requests.",
      classification: {
        category: "validation",
        severity: "low",
        retryable: false,
        httpStatus: 400,
      },
    });
  }

  const parsed = createPayrollExportRequestSchema.safeParse(payload);
  if (!parsed.success) {
    return protectedErrorResponse(req, 400, {
      success: false,
      requestId: req.headers.get("x-request-id")?.trim() || crypto.randomUUID(),
      code: "validation_error",
      error: "Invalid payroll export request body",
      message: "Invalid payroll export request body",
      classification: {
        category: "validation",
        severity: "low",
        retryable: false,
        httpStatus: 400,
      },
    });
  }

  return {
    payPeriodId: parsed.data.payPeriodId,
    idempotencyKey: parsed.data.idempotencyKey,
    adapterVersion: parsed.data.adapterVersion ?? ADAPTER_VERSION,
  };
};

const parseRunIdQuery = (req: Request) => {
  const url = new URL(req.url);
  const keys = [...new Set(Array.from(url.searchParams.keys()))];
  if (keys.length !== 1 || keys[0] !== "runId" || url.searchParams.getAll("runId").length !== 1) {
    return protectedErrorResponse(req, 400, {
      success: false,
      requestId: req.headers.get("x-request-id")?.trim() || crypto.randomUUID(),
      code: "validation_error",
      error: "Invalid payroll export query.",
      message: "Invalid payroll export query.",
      classification: {
        category: "validation",
        severity: "low",
        retryable: false,
        httpStatus: 400,
      },
    });
  }

  const parsed = z.object({ runId: z.string().uuid() }).strict().safeParse({
    runId: url.searchParams.get("runId") ?? "",
  });
  if (!parsed.success) {
    return protectedErrorResponse(req, 400, {
      success: false,
      requestId: req.headers.get("x-request-id")?.trim() || crypto.randomUUID(),
      code: "validation_error",
      error: "Invalid payroll export query.",
      message: "Invalid payroll export query.",
      classification: {
        category: "validation",
        severity: "low",
        retryable: false,
        httpStatus: 400,
      },
    });
  }

  return parsed.data.runId;
};

export async function handlePayrollExport({ req, userContext, db }: HandlerParams): Promise<Response> {
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

  if (req.method !== "GET" && req.method !== "POST") {
    return protectedErrorResponse(req, 405, {
      success: false,
      requestId: req.headers.get("x-request-id")?.trim() || crypto.randomUUID(),
      code: "validation_error",
      error: "Method not allowed",
      message: "Method not allowed",
      classification: PAYROLL_ERROR_CLASSIFICATIONS.method_deny,
    });
  }

  const limit = consumeEdgeRateLimit(`payroll-export:${userContext.user.id}`, 60, 60_000);
  if (!limit.allowed) {
    return jsonErrorResponse(req, 429, {
      code: "rate_limited",
      error: "Too many payroll export requests",
      message: "Too many payroll export requests",
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

  if (req.method === "POST") {
    const parsed = await parseCreatePayload(req);
    if (parsed instanceof Response) {
      return parsed;
    }

    const { data, error } = await db.rpc("create_payroll_export", {
      payload: {
        payPeriodId: parsed.payPeriodId,
        adapterVersion: parsed.adapterVersion,
      },
      idempotency_key: parsed.idempotencyKey,
    } as never);
    if (error) {
      return mapRpcError(req, error as { code?: string; message?: string }, parsed.idempotencyKey);
    }

    const validated = createPayrollExportResponseSchema.safeParse(data);
    if (!validated.success) {
      return protectedErrorResponse(req, 502, {
        success: false,
        requestId: req.headers.get("x-request-id")?.trim() || crypto.randomUUID(),
        code: "invalid_response",
        error: "Invalid payroll export response.",
        message: "Invalid payroll export response.",
        classification: PAYROLL_ERROR_CLASSIFICATIONS.invalid_response,
      });
    }

    return jsonResponse(req, 200, {
      ...validated.data,
      idempotencyKey: parsed.idempotencyKey,
    }, {
      "Idempotency-Key": parsed.idempotencyKey,
      "Idempotent-Replay": validated.data.replayed ? "true" : "false",
    });
  }

  const runId = parseRunIdQuery(req);
  if (runId instanceof Response) {
    return runId;
  }

  const { data, error } = await db.rpc("get_payroll_export", {
    run_id: runId,
  } as never);
  if (error) {
    return mapRpcError(req, error as { code?: string; message?: string }, "");
  }

  const validated = getPayrollExportResponseSchema.safeParse(data);
  if (!validated.success) {
    return protectedErrorResponse(req, 502, {
      success: false,
      requestId: req.headers.get("x-request-id")?.trim() || crypto.randomUUID(),
      code: "invalid_response",
      error: "Invalid payroll export response.",
      message: "Invalid payroll export response.",
      classification: PAYROLL_ERROR_CLASSIFICATIONS.invalid_response,
    });
  }

  return csvResponse(req, validated.data);
}

export const applyPayrollExportCors = async (response: Response, origin: string | null = null): Promise<Response> => {
  const headers = new Headers(response.headers);
  const corsRequest = new Request("https://edge.internal.local", {
    headers: origin ? { origin } : {},
  });
  const corsHeaders = corsHeadersForRequest(corsRequest);
  Object.entries(corsHeaders).forEach(([key, value]) => headers.set(key, value));
  headers.set("Access-Control-Allow-Methods", PAYROLL_EXPORT_METHODS);

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
          handlePayrollExport({
            req,
            userContext,
            db: databaseModule.createRequestClient(req),
          }),
        {
          requireAuth: true,
          allowedRoles: PAYROLL_EXPORT_ALLOWED_ROLES,
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
      "Access-Control-Allow-Methods": PAYROLL_EXPORT_METHODS,
      "Access-Control-Allow-Headers": req.headers.get("Access-Control-Request-Headers") ?? "authorization,content-type",
    });
    return new Response(null, { status: 204, headers });
  }

  const { protectedHandler } = await initializeDependencies();
  const response = await protectedHandler(req);
  return applyPayrollExportCors(response, allowedOrigin);
}

export default handler;
