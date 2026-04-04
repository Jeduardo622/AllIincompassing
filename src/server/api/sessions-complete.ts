import { z } from "zod";
import {
  consumeRateLimit,
  corsHeadersForRequest,
  errorResponse,
  getAccessToken,
  isDisallowedOriginRequest,
} from "./shared";
import { getRuntimeSupabaseConfig } from "../runtimeConfig";

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

    const { supabaseUrl, supabaseAnonKey } = getRuntimeSupabaseConfig();
    const functionUrl = `${supabaseUrl}/functions/v1/sessions-complete`;
    const forwardHeaders = new Headers({
      "Content-Type": "application/json",
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${accessToken}`,
    });
    const requestIdHeader = request.headers.get("x-request-id");
    const correlationIdHeader = request.headers.get("x-correlation-id");
    const agentOperationIdHeader = request.headers.get("x-agent-operation-id");
    if (requestIdHeader) {
      forwardHeaders.set("x-request-id", requestIdHeader);
    }
    if (correlationIdHeader) {
      forwardHeaders.set("x-correlation-id", correlationIdHeader);
    }
    if (agentOperationIdHeader) {
      forwardHeaders.set("x-agent-operation-id", agentOperationIdHeader);
    }
    const forwarded = await fetch(functionUrl, {
      method: "POST",
      headers: forwardHeaders,
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
