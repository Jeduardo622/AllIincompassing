import { z } from "zod";
import {
  consumeRateLimit,
  corsHeadersForRequest,
  errorResponse,
  getAccessToken,
  isDisallowedOriginRequest,
} from "./shared";
import { proxyToEdgeAuthority } from "./edgeAuthority";

const completeSessionSchema = z.object({
  session_id: z.string().uuid(),
  outcome: z.enum(["completed", "no-show"]),
  notes: z.string().nullable().optional(),
});

export async function sessionsCompleteHandler(request: Request): Promise<Response> {
  const traceHeaders: Record<string, string> = {};
  const requestId = request.headers.get("x-request-id")?.trim();
  const correlationId = request.headers.get("x-correlation-id")?.trim();
  const agentOperationId = request.headers.get("x-agent-operation-id")?.trim();
  if (requestId) {
    traceHeaders["x-request-id"] = requestId;
  }
  if (correlationId) {
    traceHeaders["x-correlation-id"] = correlationId;
  }
  if (agentOperationId) {
    traceHeaders["x-agent-operation-id"] = agentOperationId;
  }

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
      keyPrefix: "api:sessions-complete",
      maxRequests: 60,
      windowMs: 60_000,
    });
    if (rateLimit.limited) {
      return errorResponse(request, "rate_limited", "Too many session completion requests", {
        headers: { ...traceHeaders, "Retry-After": String(rateLimit.retryAfterSeconds) },
      });
    }

    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return errorResponse(request, "validation_error", "Invalid JSON body", {
        headers: traceHeaders,
      });
    }

    const parsed = completeSessionSchema.safeParse(payload);
    if (!parsed.success) {
      return errorResponse(request, "validation_error", "Invalid request body", {
        headers: traceHeaders,
      });
    }

    const forwarded = await proxyToEdgeAuthority(request, {
      functionName: "sessions-complete",
      accessToken,
      method: "POST",
      body: JSON.stringify(parsed.data),
    });
    const bodyText = await forwarded.text();
    const retryAfter = forwarded.headers.get("Retry-After");

    return new Response(bodyText, {
      status: forwarded.status,
      headers: {
        ...corsHeadersForRequest(request),
        ...traceHeaders,
        "Content-Type": "application/json",
        ...(retryAfter ? { "Retry-After": retryAfter } : {}),
      },
    });
  } catch {
    return errorResponse(request, "upstream_error", "Failed to complete session", {
      status: 502,
      headers: traceHeaders,
    });
  }
}
