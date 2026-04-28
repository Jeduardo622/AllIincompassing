import {
  consumeRateLimit,
  corsHeadersForRequest,
  errorResponse,
  getRequestId,
  isDisallowedOriginRequest,
} from "./shared";
import { getEdgeAuthorityBaseUrl, proxyToEdgeAuthority } from "./edgeAuthority";
import { serverLogger } from "../../lib/logger/server";

const JSON_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
};

const DASHBOARD_UPSTREAM_TIMEOUT_MS = 8_000;

class DashboardUpstreamConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DashboardUpstreamConfigError";
  }
}

const isProxyTransportFailure = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.trim().toLowerCase();
  return (
    message.includes("fetch failed") ||
    message.includes("network") ||
    message.includes("load failed") ||
    message.includes("aborted")
  );
};

const withRequestId = (request: Request, requestId: string): Request => {
  if (request.headers.get("x-request-id")?.trim()) {
    return request;
  }

  const headers = new Headers(request.headers);
  headers.set("x-request-id", requestId);
  return new Request(request, { headers });
};

const describeEdgeTarget = (baseUrl: string): { protocol: string; host: string; projectRef?: string } => {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new DashboardUpstreamConfigError("Dashboard Edge authority URL is invalid");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new DashboardUpstreamConfigError("Dashboard Edge authority URL must use http or https");
  }

  const hostname = parsed.hostname;
  const projectRef = hostname.endsWith(".supabase.co") ? hostname.split(".")[0] : undefined;
  return {
    protocol: parsed.protocol.replace(":", ""),
    host: hostname,
    ...(projectRef ? { projectRef } : {}),
  };
};

const getHeaderSuffix = (value: string | null): string | undefined => {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 8 ? trimmed.slice(-8) : undefined;
};

const readUpstreamBody = (response: Response, signal: AbortSignal): Promise<string> => {
  if (signal.aborted) {
    return Promise.reject(new DOMException("The operation was aborted", "AbortError"));
  }

  return new Promise<string>((resolve, reject) => {
    const onAbort = () => reject(new DOMException("The operation was aborted", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    response.text().then(
      (body) => {
        signal.removeEventListener("abort", onAbort);
        resolve(body);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
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

  const requestId = getRequestId(request);
  const requestWithId = withRequestId(request, requestId);
  const startedAt = Date.now();
  let target: ReturnType<typeof describeEdgeTarget> | undefined;
  let timedOut = false;
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => {
    timedOut = true;
    abortController.abort();
  }, DASHBOARD_UPSTREAM_TIMEOUT_MS);

  try {
    target = describeEdgeTarget(getEdgeAuthorityBaseUrl());
    serverLogger.info("dashboard proxy request started", {
      requestId,
      correlationIdSuffix: getHeaderSuffix(requestWithId.headers.get("x-correlation-id")),
      netlifyRequestIdSuffix: getHeaderSuffix(requestWithId.headers.get("x-nf-request-id")),
      target,
      timeoutMs: DASHBOARD_UPSTREAM_TIMEOUT_MS,
    });

    const forwarded = await proxyToEdgeAuthority(requestWithId, {
      functionName: "get-dashboard-data",
      accessToken,
      method: "GET",
      signal: abortController.signal,
    });
    const body = await readUpstreamBody(forwarded, abortController.signal);
    const retryAfter = forwarded.headers.get("Retry-After");
    serverLogger.info("dashboard proxy upstream completed", {
      requestId,
      status: forwarded.status,
      elapsedMs: Date.now() - startedAt,
      target,
    });
    return new Response(body, {
      status: forwarded.status,
      headers: {
        ...JSON_HEADERS,
        ...corsHeadersForRequest(requestWithId),
        "x-request-id": requestId,
        ...(retryAfter ? { "Retry-After": retryAfter } : {}),
      },
    });
  } catch (error) {
    const elapsedMs = Date.now() - startedAt;
    if (error instanceof DashboardUpstreamConfigError || timedOut || isProxyTransportFailure(error)) {
      serverLogger.warn("dashboard proxy upstream failed", {
        requestId,
        elapsedMs,
        timedOut,
        timeoutMs: DASHBOARD_UPSTREAM_TIMEOUT_MS,
        target,
        errorName: error instanceof Error ? error.name : typeof error,
      });
      return errorResponse(requestWithId, "upstream_error", "Failed to load dashboard data", {
        status: 502,
        headers: { "x-request-id": requestId },
        extra: {
          upstream: "get-dashboard-data",
          timedOut,
          elapsedMs,
        },
      });
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}


