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
const PAYROLL_EXPORT_METHODS = "GET, POST, OPTIONS";
const PAYROLL_EXPORT_ALLOWED_ROLES = ["admin", "super_admin"] as const;
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
const IDEMPOTENCY_KEY_REGEX = /^[\x21-\x7E]{1,200}$/;
const SAFE_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const ADAPTER_VERSION = "provider-neutral-v1" as const;

const idempotencyKeySchema = z.string().regex(IDEMPOTENCY_KEY_REGEX);
const adapterVersionSchema = z.literal(ADAPTER_VERSION);

const createPayrollExportRequestSchema = z.object({
  payPeriodId: z.string().uuid(),
  idempotencyKey: idempotencyKeySchema,
  adapterVersion: adapterVersionSchema.optional(),
}).strict();

const createPayrollExportResponseSchema = z.object({
  runId: z.string().uuid(),
  payPeriodId: z.string().uuid(),
  adapterVersion: adapterVersionSchema,
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
  adapterVersion: adapterVersionSchema,
  periodStart: z.string().regex(SAFE_DATE_REGEX),
  periodEnd: z.string().regex(SAFE_DATE_REGEX),
  csv: z.string().min(1),
}).strict();

const payrollExportErrorSchema = z.object({
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

type PayrollExportErrorCode = z.infer<typeof payrollExportErrorSchema.shape.code>;

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
    code: PayrollExportErrorCode;
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

const buildLegacyHeaders = (accessToken: string, anonKey: string): Record<string, string> => ({
  "Content-Type": "application/json",
  apikey: anonKey,
  Authorization: `Bearer ${accessToken}`,
});

const normalizeSafeMessage = (value: unknown): string => {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().replace(/\s+/g, " ");
};

const buildDownloadFilename = (payload: z.infer<typeof getPayrollExportResponseSchema>) =>
  `payroll-export-${payload.adapterVersion}-${payload.periodStart}-to-${payload.periodEnd}-${payload.runId}.csv`;

const buildCsvResponse = (
  request: Request,
  traceHeaders: Record<string, string>,
  payload: z.infer<typeof getPayrollExportResponseSchema>,
) =>
  new Response(payload.csv, {
    status: 200,
    headers: {
      ...corsHeadersForRequest(request),
      ...traceHeaders,
      "Content-Type": "text/csv; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": `attachment; filename="${buildDownloadFilename(payload)}"`,
    },
  });

const parseCreatePayload = (
  request: Request,
  traceHeaders: Record<string, string>,
  payload: unknown,
) => {
  if (containsForbiddenAuthority(payload)) {
    return errorResponse(request, "validation_error", "Authority fields are not allowed in payroll export requests.", {
      headers: traceHeaders,
    });
  }

  const parsed = createPayrollExportRequestSchema.safeParse(payload);
  if (!parsed.success) {
    return errorResponse(request, "validation_error", "Invalid payroll export request body", {
      headers: traceHeaders,
    });
  }

  return {
    payPeriodId: parsed.data.payPeriodId,
    idempotencyKey: parsed.data.idempotencyKey,
    adapterVersion: parsed.data.adapterVersion ?? ADAPTER_VERSION,
  };
};

const parseRunIdQuery = (
  request: Request,
  traceHeaders: Record<string, string>,
) => {
  const url = new URL(request.url);
  const keys = [...new Set(Array.from(url.searchParams.keys()))];
  if (keys.length !== 1 || keys[0] !== "runId" || url.searchParams.getAll("runId").length !== 1) {
    return errorResponse(request, "validation_error", "Invalid payroll export query.", {
      headers: traceHeaders,
    });
  }

  const queryObject = { runId: url.searchParams.get("runId") ?? "" };
  if (containsForbiddenAuthority(queryObject)) {
    return errorResponse(request, "validation_error", "Authority fields are not allowed in payroll export requests.", {
      headers: traceHeaders,
    });
  }

  const parsed = z.object({ runId: z.string().uuid() }).strict().safeParse(queryObject);
  if (!parsed.success) {
    return errorResponse(request, "validation_error", "Invalid payroll export query.", {
      headers: traceHeaders,
    });
  }

  return parsed.data.runId;
};

const validateCreateResponse = (
  request: Request,
  traceHeaders: Record<string, string>,
  payload: unknown,
  requestedKey: string,
) => {
  const parsed = createPayrollExportResponseSchema.safeParse(payload);
  if (!parsed.success) {
    return payrollErrorResponse(request, 502, {
      code: "invalid_response",
      message: "Invalid payroll export response.",
      classification: PAYROLL_ERROR_CLASSIFICATIONS.invalid_response,
    }, traceHeaders);
  }
  return {
    ...parsed.data,
    idempotencyKey: requestedKey,
  };
};

const validateDownloadResponse = (
  request: Request,
  traceHeaders: Record<string, string>,
  payload: unknown,
) => {
  const parsed = getPayrollExportResponseSchema.safeParse(payload);
  if (!parsed.success) {
    return payrollErrorResponse(request, 502, {
      code: "invalid_response",
      message: "Invalid payroll export response.",
      classification: PAYROLL_ERROR_CLASSIFICATIONS.invalid_response,
    }, traceHeaders);
  }
  return parsed.data;
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

  if (message.includes("IDEMPOTENCY_CONFLICT") || code === "23505") {
    return errorResponse(request, "conflict", "Idempotency conflict.", {
      status: 409,
      headers: { ...traceHeaders, ...headers },
      extra: idempotencyKey ? { idempotencyKey } : {},
    });
  }
  if (code === "23514") {
    return payrollErrorResponse(request, 409, {
      code: "state_conflict",
      message: "Payroll export state conflict.",
      classification: PAYROLL_ERROR_CLASSIFICATIONS.state_conflict,
      idempotencyKey,
    }, traceHeaders, headers);
  }
  if (code === "22023") {
    return errorResponse(request, "validation_error", "Invalid payroll export request.", {
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
    return errorResponse(request, "conflict", "Payroll export is temporarily locked.", {
      status: 409,
      headers: { ...traceHeaders, ...headers, "Retry-After": "1" },
      extra: idempotencyKey ? { idempotencyKey } : {},
    });
  }

  return errorResponse(request, "upstream_error", "Payroll export transport failed.", {
    status: result.status >= 400 ? result.status : 502,
    headers: { ...traceHeaders, ...headers },
    extra: idempotencyKey ? { idempotencyKey } : {},
  });
};

const buildForwardedEdgeResponse = (
  request: Request,
  traceHeaders: Record<string, string>,
  status: number,
  payload: z.infer<typeof payrollExportErrorSchema>,
  forwardedHeaders: Headers,
) => {
  const requestKey =
    request.method === "POST"
      ? createPayrollExportRequestSchema.safeParse((() => {
        try {
          return JSON.parse((request as Request & { __cachedBody?: string }).__cachedBody ?? "");
        } catch {
          return null;
        }
      })()).success
        ? createPayrollExportRequestSchema.parse(JSON.parse((request as Request & { __cachedBody?: string }).__cachedBody ?? "")).idempotencyKey
        : ""
      : "";
  const headerKey = forwardedHeaders.get("Idempotency-Key")?.trim() ?? "";
  const bodyKey = payload.idempotencyKey?.trim() ?? "";

  if (request.method === "POST" && (requestKey || headerKey || bodyKey)) {
    if (!headerKey || !bodyKey || headerKey !== bodyKey || requestKey !== headerKey) {
      return payrollErrorResponse(request, 502, {
        code: "invalid_response",
        message: "Invalid payroll export response.",
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

  return new Response(JSON.stringify(payload), {
    status,
    headers: responseHeaders,
  });
};

const withCachedBody = async (request: Request): Promise<Request & { __cachedBody?: string }> => {
  if (request.method !== "POST") {
    return request as Request & { __cachedBody?: string };
  }
  const cachedBody = await request.text();
  const cloned = new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body: cachedBody,
  }) as Request & { __cachedBody?: string };
  cloned.__cachedBody = cachedBody;
  return cloned;
};

export async function payrollExportHandler(originalRequest: Request): Promise<Response> {
  const request = await withCachedBody(originalRequest);
  const traceHeaders = traceHeadersForRequest(request);

  if (isDisallowedOriginRequest(request)) {
    return errorResponse(request, "forbidden", "Origin not allowed", {
      status: 403,
      headers: traceHeaders,
    });
  }

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        ...corsHeadersForRequest(request),
        ...traceHeaders,
        "Access-Control-Allow-Methods": PAYROLL_EXPORT_METHODS,
        "Access-Control-Allow-Headers": request.headers.get("Access-Control-Request-Headers") ?? "authorization,content-type",
      },
    });
  }

  if (request.method !== "GET" && request.method !== "POST") {
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
    keyPrefix: "api:payroll-export",
    maxRequests: 60,
    windowMs: 60_000,
  });
  if (rateLimit.limited) {
    return errorResponse(request, "rate_limited", "Too many payroll export requests", {
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
    return errorResponse(request, "forbidden", "Forbidden", {
      headers: traceHeaders,
    });
  }

  let createPayload:
    | { payPeriodId: string; idempotencyKey: string; adapterVersion: typeof ADAPTER_VERSION }
    | null = null;
  let runId: string | null = null;

  if (request.method === "POST") {
    let payload: unknown;
    try {
      payload = JSON.parse(request.__cachedBody ?? "");
    } catch {
      return errorResponse(request, "validation_error", "Invalid JSON body", {
        headers: traceHeaders,
      });
    }
    const parsed = parseCreatePayload(request, traceHeaders, payload);
    if (parsed instanceof Response) {
      return parsed;
    }
    createPayload = parsed;
  } else {
    const parsed = parseRunIdQuery(request, traceHeaders);
    if (parsed instanceof Response) {
      return parsed;
    }
    runId = parsed;
  }

  if (getApiAuthorityMode() === "edge") {
    const forwarded = await proxyToEdgeAuthority(request, {
      functionName: "payroll-export",
      accessToken,
      method: request.method,
      body: request.__cachedBody,
    });
    const forwardedTraceHeaders = traceHeadersFromHeaders(forwarded.headers);

    if (forwarded.ok && request.method === "GET") {
      return new Response(await forwarded.text(), {
        status: forwarded.status,
        headers: {
          ...corsHeadersForRequest(request),
          ...traceHeaders,
          ...forwardedTraceHeaders,
          "Content-Type": forwarded.headers.get("Content-Type") ?? "text/csv; charset=utf-8",
          "Cache-Control": forwarded.headers.get("Cache-Control") ?? "no-store",
          "X-Content-Type-Options": forwarded.headers.get("X-Content-Type-Options") ?? "nosniff",
          ...(forwarded.headers.get("Content-Disposition")
            ? { "Content-Disposition": forwarded.headers.get("Content-Disposition") as string }
            : {}),
        },
      });
    }

    const text = await forwarded.text();
    let responsePayload: unknown = null;
    try {
      responsePayload = text ? JSON.parse(text) : null;
    } catch {
      responsePayload = null;
    }

    if (forwarded.ok) {
      const successPayload = validateCreateResponse(
        request,
        traceHeaders,
        responsePayload,
        createPayload?.idempotencyKey ?? "",
      );
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

    const parsedError = payrollExportErrorSchema.safeParse(responsePayload);
    if (parsedError.success) {
      return buildForwardedEdgeResponse(
        request,
        { ...traceHeaders, ...forwardedTraceHeaders },
        forwarded.status,
        parsedError.data,
        forwarded.headers,
      );
    }

    return mapLegacyError(
      request,
      traceHeaders,
      { status: forwarded.status, ok: forwarded.ok, data: responsePayload },
      createPayload?.idempotencyKey ?? "",
    );
  }

  const { supabaseUrl, anonKey } = getSupabaseConfig();
  const rpcName = request.method === "POST" ? "create_payroll_export" : "get_payroll_export";
  const rpcArgs = request.method === "POST"
    ? {
      payload: {
        payPeriodId: createPayload!.payPeriodId,
        adapterVersion: createPayload!.adapterVersion,
      },
      idempotency_key: createPayload!.idempotencyKey,
    }
    : {
      run_id: runId!,
    };

  const result = await fetchJson<Record<string, unknown>>(`${supabaseUrl}/rest/v1/rpc/${rpcName}`, {
    method: "POST",
    headers: buildLegacyHeaders(accessToken, anonKey),
    body: JSON.stringify(rpcArgs),
  });

  if (!result.ok || !result.data) {
    return mapLegacyError(request, traceHeaders, result, createPayload?.idempotencyKey ?? "");
  }

  if (request.method === "GET") {
    const validated = validateDownloadResponse(request, traceHeaders, result.data);
    if (validated instanceof Response) {
      return validated;
    }
    return buildCsvResponse(request, traceHeaders, validated);
  }

  const validated = validateCreateResponse(request, traceHeaders, result.data, createPayload!.idempotencyKey);
  if (validated instanceof Response) {
    return validated;
  }
  return jsonForRequest(request, validated, 200, {
    ...traceHeaders,
    "Idempotency-Key": validated.idempotencyKey,
    "Idempotent-Replay": validated.replayed ? "true" : "false",
  });
}

void PAYROLL_EXPORT_ALLOWED_ROLES;
