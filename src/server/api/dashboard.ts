import {
  consumeRateLimit,
  corsHeadersForRequest,
  errorResponse,
  isDisallowedOriginRequest,
} from "./shared";
import { proxyToEdgeAuthority } from "./edgeAuthority";

const JSON_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
};

export async function dashboardHandler(request: Request): Promise<Response> {
  if (isDisallowedOriginRequest(request)) {
    return errorResponse(request, "forbidden", "Origin not allowed", { status: 403 });
  }

  if (request.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: { ...JSON_HEADERS, ...corsHeadersForRequest(request) } });
  }

  if (request.method !== "GET") {
    return errorResponse(request, "validation_error", "Method not allowed", { status: 405 });
  }

  const rateLimit = await consumeRateLimit(request, {
    keyPrefix: "api:dashboard",
    maxRequests: 120,
    windowMs: 60_000,
  });
  if (rateLimit.limited) {
    return errorResponse(request, "rate_limited", "Too many dashboard requests", {
      headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
    });
  }

  const bearerPayload = (value: string | null): string => {
    if (!value) {
      return "";
    }
    const trimmed = value.trim();
    if (!/^Bearer\s+/i.test(trimmed)) {
      return "";
    }
    return trimmed.replace(/^Bearer\s+/i, "").trim();
  };
  const accessToken =
    bearerPayload(request.headers.get("Authorization")) ||
    bearerPayload(request.headers.get("X-Supabase-Authorization"));
  if (!accessToken) {
    return errorResponse(request, "unauthorized", "Missing authorization token", {
      headers: { "WWW-Authenticate": "Bearer" },
    });
  }

  const forwarded = await proxyToEdgeAuthority(request, {
    functionName: "get-dashboard-data",
    accessToken,
    method: "GET",
  });
  const body = await forwarded.text();
  const retryAfter = forwarded.headers.get("Retry-After");
  return new Response(body, {
    status: forwarded.status,
    headers: {
      ...JSON_HEADERS,
      ...corsHeadersForRequest(request),
      ...(retryAfter ? { "Retry-After": retryAfter } : {}),
    },
  });
}


