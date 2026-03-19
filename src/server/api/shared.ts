import { getOptionalServerEnv, getRequiredServerEnv } from "../env";
import { corsHeadersForOrigin, getDefaultAllowedOrigin, resolveAllowedOriginValue } from "../corsPolicy";
import {
  consumeRateLimit as consumeRateLimitInternal,
  resetRateLimitsForTests as resetRateLimitsForTestsInternal,
} from "./rateLimiter";

const JSON_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
};

const baseCorsHeaders: Record<string, string> = {
  ...corsHeadersForOrigin(getDefaultAllowedOrigin()),
};

export const CORS_HEADERS: Record<string, string> = {
  ...baseCorsHeaders,
  "Access-Control-Allow-Origin": getDefaultAllowedOrigin(),
};

type FetchResult<T> = { status: number; ok: boolean; data: T | null };

type ApiErrorCode =
  | "validation_error"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "internal_error"
  | "upstream_error";

type ApiErrorClassification = {
  category: string;
  severity: "low" | "medium" | "high" | "critical";
  retryable: boolean;
  httpStatus: number;
};

const API_ERROR_TAXONOMY: Record<ApiErrorCode, ApiErrorClassification> = {
  validation_error: { category: "validation", severity: "low", retryable: false, httpStatus: 400 },
  unauthorized: { category: "auth", severity: "medium", retryable: false, httpStatus: 401 },
  forbidden: { category: "auth", severity: "medium", retryable: false, httpStatus: 403 },
  not_found: { category: "request", severity: "low", retryable: false, httpStatus: 404 },
  conflict: { category: "request", severity: "medium", retryable: false, httpStatus: 409 },
  rate_limited: { category: "rate_limit", severity: "high", retryable: true, httpStatus: 429 },
  internal_error: { category: "internal", severity: "critical", retryable: false, httpStatus: 500 },
  upstream_error: { category: "upstream", severity: "high", retryable: true, httpStatus: 502 },
};

type RateLimitOptions = {
  keyPrefix: string;
  maxRequests: number;
  windowMs: number;
};

type RateLimitResult =
  | { limited: false; retryAfterSeconds: null; mode: "memory" | "distributed" | "waf_only" }
  | { limited: true; retryAfterSeconds: number; mode: "memory" | "distributed" | "waf_only" };

export async function consumeRateLimit(request: Request, options: RateLimitOptions): Promise<RateLimitResult> {
  return consumeRateLimitInternal(request, options);
}

export function resetRateLimitsForTests(): void {
  resetRateLimitsForTestsInternal();
}

export function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...CORS_HEADERS, ...extra },
  });
}

export function resolveAllowedOrigin(request: Request): string | null {
  const origin = request.headers.get("origin");
  return resolveAllowedOriginValue(origin);
}

export function isDisallowedOriginRequest(request: Request): boolean {
  const origin = request.headers.get("origin");
  return Boolean(origin) && resolveAllowedOriginValue(origin) === null;
}

export function corsHeadersForRequest(request: Request): Record<string, string> {
  return corsHeadersForOrigin(request.headers.get("origin"));
}

export function jsonForRequest(
  request: Request,
  body: unknown,
  status = 200,
  extra: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...corsHeadersForRequest(request), ...extra },
  });
}

export function getRequestId(request: Request): string {
  return request.headers.get("x-request-id")?.trim() || crypto.randomUUID();
}

export function errorResponse(
  request: Request,
  code: ApiErrorCode,
  message: string,
  options: { status?: number; headers?: Record<string, string>; extra?: Record<string, unknown> } = {},
): Response {
  const classification = API_ERROR_TAXONOMY[code] ?? API_ERROR_TAXONOMY.internal_error;
  const status = options.status ?? classification.httpStatus;
  const body: Record<string, unknown> = {
    success: false,
    error: message,
    requestId: getRequestId(request),
    code,
    message,
    classification,
    ...(options.extra ?? {}),
  };
  return jsonForRequest(request, body, status, options.headers ?? {});
}

export function getAccessToken(request: Request): string | null {
  const authHeader = request.headers.get("Authorization");
  const accessToken = typeof authHeader === "string" ? authHeader.replace(/^Bearer\s+/i, "").trim() : "";
  return accessToken.length > 0 ? accessToken : null;
}

export function getAccessTokenSubject(accessToken: string): string | null {
  const token = accessToken.trim();
  if (!token) {
    return null;
  }

  const parts = token.split(".");
  if (parts.length < 2 || !parts[1]) {
    return null;
  }

  try {
    const normalized = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const payloadJson = Buffer.from(padded, "base64").toString("utf8");
    const payload = JSON.parse(payloadJson) as { sub?: unknown };
    return typeof payload.sub === "string" && payload.sub.length > 0 ? payload.sub : null;
  } catch {
    return null;
  }
}

export function getSupabaseConfig(): { supabaseUrl: string; anonKey: string } {
  const supabaseUrl =
    getOptionalServerEnv("SUPABASE_URL") ||
    getOptionalServerEnv("SUPABASE_DATABASE_URL") ||
    getRequiredServerEnv("VITE_SUPABASE_URL");

  const preferredPublishableKeys = [
    getOptionalServerEnv("SUPABASE_PUBLISHABLE_KEY"),
    getOptionalServerEnv("VITE_SUPABASE_PUBLISHABLE_KEY"),
    getOptionalServerEnv("SUPABASE_PUBLISHABLE_KEY_SUPABASE_ANON_KEY"),
    getOptionalServerEnv("VITE_SUPABASE_PUBLISHABLE_KEY_SUPABASE_ANON_KEY"),
  ];
  const generatedPublishable = Object.entries(process.env).find(([key, value]) =>
    key.includes("PUBLISHABLE") &&
    key.endsWith("_SUPABASE_ANON_KEY") &&
    typeof value === "string" &&
    value.trim().length > 0
  )?.[1];

  const anonKey = preferredPublishableKeys.find((value) => typeof value === "string" && value.trim().length > 0) ||
    generatedPublishable ||
    getOptionalServerEnv("SUPABASE_ANON_KEY") ||
    getRequiredServerEnv("VITE_SUPABASE_ANON_KEY");

  return { supabaseUrl: supabaseUrl.replace(/\/$/, ""), anonKey };
}

export async function fetchAuthenticatedUserId(accessToken: string): Promise<string | null> {
  const result = await fetchAuthenticatedUserIdWithStatus(accessToken);
  return result.userId;
}

export async function fetchAuthenticatedUserIdWithStatus(accessToken: string): Promise<{
  userId: string | null;
  upstreamError: boolean;
}> {
  const { supabaseUrl, anonKey } = getSupabaseConfig();
  const response = await fetchJson<{ id?: unknown }>(`${supabaseUrl}/auth/v1/user`, {
    method: "GET",
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok || !response.data) {
    return {
      userId: null,
      upstreamError: response.status >= 500 || response.status === 0,
    };
  }

  return {
    userId:
      typeof response.data.id === "string" && response.data.id.length > 0
        ? response.data.id
        : null,
    upstreamError: false,
  };
}

export async function fetchJson<T = unknown>(url: string, init: RequestInit): Promise<FetchResult<T>> {
  const response = await fetch(url, init);
  const status = response.status;
  const ok = response.ok;
  const text = await response.text();
  if (text.length === 0) {
    return { status, ok, data: null };
  }
  try {
    return { status, ok, data: JSON.parse(text) as T };
  } catch {
    return { status, ok, data: null };
  }
}

export async function resolveOrgAndRole(accessToken: string): Promise<{
  organizationId: string | null;
  isTherapist: boolean;
  isAdmin: boolean;
  isSuperAdmin: boolean;
}> {
  const result = await resolveOrgAndRoleWithStatus(accessToken);
  return {
    organizationId: result.organizationId,
    isTherapist: result.isTherapist,
    isAdmin: result.isAdmin,
    isSuperAdmin: result.isSuperAdmin,
  };
}

export async function resolveOrgAndRoleWithStatus(accessToken: string): Promise<{
  organizationId: string | null;
  isTherapist: boolean;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  upstreamError: boolean;
}> {
  const { supabaseUrl, anonKey } = getSupabaseConfig();
  const headers = {
    ...JSON_HEADERS,
    apikey: anonKey,
    Authorization: `Bearer ${accessToken}`,
  };

  const superAdminUrl = `${supabaseUrl}/rest/v1/rpc/current_user_is_super_admin`;
  const superAdminResult = await fetchJson<boolean>(superAdminUrl, {
    method: "POST",
    headers,
    body: "{}",
  });
  const isSuperAdmin = superAdminResult.ok && superAdminResult.data === true;
  const superAdminUpstreamError = !superAdminResult.ok && superAdminResult.status >= 500;

  const orgUrl = `${supabaseUrl}/rest/v1/rpc/current_user_organization_id`;
  const orgResult = await fetchJson<string>(orgUrl, {
    method: "POST",
    headers,
    body: "{}",
  });

  const organizationId =
    orgResult.ok && typeof orgResult.data === "string" && orgResult.data.length > 0
      ? orgResult.data
      : null;
  const orgUpstreamError = !orgResult.ok && orgResult.status >= 500;

  if (!organizationId) {
    return {
      organizationId: null,
      isTherapist: false,
      isAdmin: false,
      isSuperAdmin,
      upstreamError: superAdminUpstreamError || orgUpstreamError,
    };
  }

  const roleUrl = `${supabaseUrl}/rest/v1/rpc/user_has_role_for_org`;
  const therapistResult = await fetchJson<boolean>(roleUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({ role_name: "therapist", target_organization_id: organizationId }),
  });
  const adminResult = await fetchJson<boolean>(roleUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({ role_name: "admin", target_organization_id: organizationId }),
  });
  const therapistUpstreamError = !therapistResult.ok && therapistResult.status >= 500;
  const adminUpstreamError = !adminResult.ok && adminResult.status >= 500;
  return {
    organizationId,
    isTherapist: therapistResult.ok && therapistResult.data === true,
    isAdmin: adminResult.ok && adminResult.data === true,
    isSuperAdmin,
    upstreamError:
      superAdminUpstreamError ||
      orgUpstreamError ||
      therapistUpstreamError ||
      adminUpstreamError,
  };
}

