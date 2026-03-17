import "../bootstrapSupabase";
import { bookSession } from "../bookSession";
import {
  consumeRateLimit,
  corsHeadersForRequest,
  errorResponse,
  isDisallowedOriginRequest,
  jsonForRequest,
} from "./shared";
import {
  bookSessionApiRequestBodySchema,
  type BookSessionApiRequestBody,
  type BookSessionApiResponse,
  type BookSessionRequest,
} from "../types";
import { logger } from "../../lib/logger/logger";
import { toError } from "../../lib/logger/normalizeError";

const JSON_CONTENT_TYPE_HEADER: Record<string, string> = {
  "Content-Type": "application/json",
};

function normalizePayload(
  body: BookSessionApiRequestBody,
  idempotencyKey: string | undefined,
  accessToken: string,
  trace?: {
    requestId?: string;
    correlationId?: string;
    agentOperationId?: string;
  },
): BookSessionRequest {
  return {
    ...body,
    idempotencyKey,
    accessToken,
    trace,
  };
}

function deriveRetryAfterSeconds(retryAfter: string | null | undefined): number | null {
  if (!retryAfter || retryAfter.trim().length === 0) {
    return null;
  }
  const retryAtMs = Date.parse(retryAfter);
  if (!Number.isFinite(retryAtMs)) {
    return null;
  }
  const seconds = Math.ceil((retryAtMs - Date.now()) / 1000);
  return Math.max(0, seconds);
}

export async function bookHandler(request: Request): Promise<Response> {
  if (isDisallowedOriginRequest(request)) {
    return errorResponse(request, "forbidden", "Origin not allowed", { status: 403 });
  }

  if (request.method === "OPTIONS") {
    return new Response("ok", {
      status: 200,
      headers: { ...JSON_CONTENT_TYPE_HEADER, ...corsHeadersForRequest(request) },
    });
  }

  if (request.method !== "POST") {
    return errorResponse(request, "validation_error", "Method not allowed", { status: 405 });
  }

  const rateLimit = consumeRateLimit(request, {
    keyPrefix: "api:book",
    maxRequests: 30,
    windowMs: 60_000,
  });
  if (rateLimit.limited) {
    return errorResponse(request, "rate_limited", "Too many booking requests", {
      headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
    });
  }

  const authHeader = request.headers.get("Authorization");
  const accessToken = typeof authHeader === "string"
    ? authHeader.replace(/^Bearer\s+/i, "").trim()
    : "";

  if (!authHeader || accessToken.length === 0) {
    return errorResponse(request, "unauthorized", "Missing authorization token", {
      headers: { "WWW-Authenticate": "Bearer" },
    });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch (error) {
    logger.warn("Failed to parse booking payload", { error: toError(error), context: { handler: "bookHandler" } });
    return errorResponse(request, "validation_error", "Invalid JSON body");
  }

  const parseResult = bookSessionApiRequestBodySchema.safeParse(rawBody);

  if (!parseResult.success) {
    logger.warn("Rejected invalid booking payload", {
      metadata: parseResult.error.issues.map((issue) => ({
        code: issue.code,
        path: issue.path.join("."),
        message: issue.message,
      })),
      context: { handler: "bookHandler" },
    });
    return errorResponse(request, "validation_error", "Invalid request body", {
      extra: { code: "invalid_request" },
    });
  }

  const body: BookSessionApiRequestBody = parseResult.data;

  try {
    const idempotencyKey = request.headers.get("Idempotency-Key") ?? undefined;
    const trace = {
      requestId: request.headers.get("x-request-id") ?? undefined,
      correlationId: request.headers.get("x-correlation-id") ?? undefined,
      agentOperationId: request.headers.get("x-agent-operation-id") ?? undefined,
    };
    const result = await bookSession(normalizePayload(body, idempotencyKey, accessToken, trace));
    const headers = idempotencyKey
      ? { ...JSON_CONTENT_TYPE_HEADER, "Idempotency-Key": idempotencyKey }
      : { ...JSON_CONTENT_TYPE_HEADER };
    return jsonForRequest(request, { success: true, data: result } satisfies BookSessionApiResponse, 200, headers);
  } catch (error) {
    const status = typeof (error as { status?: number })?.status === "number"
      ? (error as { status: number }).status
      : 500;
    const conflictCode = typeof (error as { code?: unknown })?.code === "string"
      ? (error as { code: string }).code
      : undefined;
    const retryAfter = typeof (error as { retryAfter?: unknown })?.retryAfter === "string"
      ? (error as { retryAfter: string }).retryAfter
      : null;
    const explicitRetryAfterSeconds = typeof (error as { retryAfterSeconds?: unknown })?.retryAfterSeconds === "number"
      ? (error as { retryAfterSeconds: number }).retryAfterSeconds
      : null;
    const retryAfterSeconds = explicitRetryAfterSeconds ?? deriveRetryAfterSeconds(retryAfter);
    const orchestration = (error as { orchestration?: unknown })?.orchestration;
    const normalizedError = toError(error, "Booking failed");
    logger.error("Session booking failed", {
      error: normalizedError,
      metadata: {
        status,
        name: normalizedError.name,
      },
      context: { handler: "bookHandler" },
    });
    if (status === 409) {
      const hint = retryAfterSeconds !== null
        ? `The selected slot is unavailable. Retry after about ${retryAfterSeconds} seconds or choose a different time.`
        : "The selected slot is unavailable. Refresh the schedule or choose a different time.";
      const headers = retryAfterSeconds !== null ? { "Retry-After": String(retryAfterSeconds) } : {};
      return jsonForRequest(
        request,
        {
          success: false,
          error: "Booking failed",
          code: conflictCode,
          hint,
          retryAfter,
          retryAfterSeconds,
          orchestration: typeof orchestration === "object" && orchestration !== null
            ? orchestration as Record<string, unknown>
            : null,
        },
        status,
        headers,
      );
    }

    const isUnauthorized = status === 401;
    return errorResponse(
      request,
      isUnauthorized ? "unauthorized" : status === 403 ? "forbidden" : status === 409 ? "conflict" : "internal_error",
      "Booking failed",
      {
        status,
        extra: {
          conflictCode: conflictCode ?? null,
          upstream: "sessions-hold/sessions-confirm",
          upstreamMessage: normalizedError.message,
          inputProgramId: (body?.session as Record<string, unknown> | undefined)?.program_id ?? null,
          inputGoalId: (body?.session as Record<string, unknown> | undefined)?.goal_id ?? null,
          ...(isUnauthorized
            ? {
                hint:
                  "Authorization was rejected by the downstream session orchestration path. Verify runtime Supabase URL/key parity between API and edge functions.",
              }
            : {}),
        },
      },
    );
  }
}
