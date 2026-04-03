import "../bootstrapSupabase";
import { bookSession } from "../bookSession";
import {
  consumeRateLimit,
  corsHeadersForRequest,
  errorResponse,
  fetchAuthenticatedUserIdWithStatus,
  fetchJson,
  getSupabaseConfig,
  isDisallowedOriginRequest,
  jsonForRequest,
  resolveOrgAndRoleWithStatus,
} from "./shared";
import { getApiAuthorityMode, proxyToEdgeAuthority } from "./edgeAuthority";
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

function shouldFallbackToLegacyBooking(status: number): boolean {
  return status === 404 || status === 408 || status >= 500;
}

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

async function assertBookRequestScope(
  request: Request,
  accessToken: string,
  body: BookSessionApiRequestBody,
): Promise<Response | null> {
  const { organizationId, isTherapist, isAdmin, isSuperAdmin, upstreamError: roleUpstreamError } =
    await resolveOrgAndRoleWithStatus(accessToken);
  if (roleUpstreamError) {
    return errorResponse(request, "upstream_error", "Unable to validate organization access", { status: 502 });
  }
  if (!organizationId || (!isTherapist && !isAdmin && !isSuperAdmin)) {
    return errorResponse(request, "forbidden", "Forbidden", { status: 403 });
  }

  const { userId: currentUserId, upstreamError: userUpstreamError } = await fetchAuthenticatedUserIdWithStatus(accessToken);
  if (userUpstreamError) {
    return errorResponse(request, "upstream_error", "Unable to validate authenticated user", { status: 502 });
  }
  if (!currentUserId) {
    return errorResponse(request, "forbidden", "Forbidden", { status: 403 });
  }

  if (isTherapist && body.session.therapist_id !== currentUserId) {
    return errorResponse(request, "forbidden", "Forbidden", { status: 403 });
  }

  const { supabaseUrl, anonKey } = getSupabaseConfig();
  const headers = {
    "Content-Type": "application/json",
    apikey: anonKey,
    Authorization: `Bearer ${accessToken}`,
  };
  const encodedOrgId = encodeURIComponent(organizationId);
  const encodedTherapistId = encodeURIComponent(body.session.therapist_id);
  const encodedClientId = encodeURIComponent(body.session.client_id);
  const encodedProgramId = encodeURIComponent(body.session.program_id);
  const encodedGoalId = encodeURIComponent(body.session.goal_id);

  const therapistUrl = `${supabaseUrl}/rest/v1/therapists?select=id&organization_id=eq.${encodedOrgId}&id=eq.${encodedTherapistId}`;
  const clientUrl = `${supabaseUrl}/rest/v1/clients?select=id&organization_id=eq.${encodedOrgId}&id=eq.${encodedClientId}`;
  const programUrl = `${supabaseUrl}/rest/v1/programs?select=id,client_id&organization_id=eq.${encodedOrgId}&id=eq.${encodedProgramId}`;
  const goalUrl = `${supabaseUrl}/rest/v1/goals?select=id,program_id&organization_id=eq.${encodedOrgId}&id=eq.${encodedGoalId}`;

  const [therapistResult, clientResult, programResult, goalResult] = await Promise.all([
    fetchJson<Array<{ id: string }>>(therapistUrl, { method: "GET", headers }),
    fetchJson<Array<{ id: string }>>(clientUrl, { method: "GET", headers }),
    fetchJson<Array<{ id: string; client_id: string }>>(programUrl, { method: "GET", headers }),
    fetchJson<Array<{ id: string; program_id: string }>>(goalUrl, { method: "GET", headers }),
  ]);

  if (!therapistResult.ok || !clientResult.ok || !programResult.ok || !goalResult.ok) {
    return errorResponse(request, "upstream_error", "Unable to verify booking entities", { status: 502 });
  }

  const therapistExists = therapistResult.ok && Array.isArray(therapistResult.data) && therapistResult.data.length > 0;
  const clientExists = clientResult.ok && Array.isArray(clientResult.data) && clientResult.data.length > 0;
  const program = Array.isArray(programResult.data) ? programResult.data[0] : null;
  const goal = Array.isArray(goalResult.data) ? goalResult.data[0] : null;

  if (!therapistExists || !clientExists || !program || !goal) {
    return errorResponse(request, "not_found", "Booking entities not found", { status: 404 });
  }

  if (program.client_id !== body.session.client_id || goal.program_id !== body.session.program_id) {
    return errorResponse(request, "validation_error", "Invalid booking relationships", { status: 400 });
  }

  return null;
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

  const rateLimit = await consumeRateLimit(request, {
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

  if (getApiAuthorityMode() === "edge") {
    try {
      const forwarded = await proxyToEdgeAuthority(request, {
        functionName: "sessions-book",
        accessToken,
        method: "POST",
        body: JSON.stringify(body),
      });
      const forwardedBody = await forwarded.text();
      if (!shouldFallbackToLegacyBooking(forwarded.status)) {
        const forwardedHeaders: Record<string, string> = {};
        const retryAfter = forwarded.headers.get("Retry-After");
        const returnedIdempotency = forwarded.headers.get("Idempotency-Key");
        if (retryAfter) {
          forwardedHeaders["Retry-After"] = retryAfter;
        }
        if (returnedIdempotency) {
          forwardedHeaders["Idempotency-Key"] = returnedIdempotency;
        }
        return new Response(forwardedBody, {
          status: forwarded.status,
          headers: {
            ...corsHeadersForRequest(request),
            ...JSON_CONTENT_TYPE_HEADER,
            ...forwardedHeaders,
          },
        });
      }

      logger.warn("Edge booking authority unavailable; falling back to legacy booking", {
        metadata: {
          status: forwarded.status,
        },
        context: { handler: "bookHandler" },
      });
    } catch (error) {
      logger.warn("Edge booking authority request failed; falling back to legacy booking", {
        error: toError(error, "Edge booking authority request failed"),
        context: { handler: "bookHandler" },
      });
    }
  }

  const scopeErrorResponse = await assertBookRequestScope(request, accessToken, body);
  if (scopeErrorResponse) {
    return scopeErrorResponse;
  }

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
        },
        status,
        headers,
      );
    }

    if (status === 429) {
      const headers = retryAfterSeconds !== null ? { "Retry-After": String(retryAfterSeconds) } : {};
      return errorResponse(
        request,
        "rate_limited",
        "Booking request was rate limited",
        {
          status: 429,
          headers,
          extra: {
            retryAfterSeconds,
          },
        },
      );
    }

    const isUnauthorized = status === 401;
    const isForbidden = status === 403;
    const isValidationFailure = status === 400;
    const isUpstreamFailure = status >= 500;
    return errorResponse(
      request,
      isUnauthorized
        ? "unauthorized"
        : isForbidden
          ? "forbidden"
          : isValidationFailure
            ? "validation_error"
            : isUpstreamFailure
              ? "upstream_error"
              : "internal_error",
      "Booking failed",
      {
        status,
        extra: {
          conflictCode: conflictCode ?? null,
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
