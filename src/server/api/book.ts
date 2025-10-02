import "../bootstrapSupabase";
import { bookSession } from "../bookSession";
import {
  bookSessionApiRequestBodySchema,
  type BookSessionApiRequestBody,
  type BookSessionApiResponse,
  type BookSessionRequest,
} from "../types";
import { logger } from "../../lib/logger/logger";
import { toError } from "../../lib/logger/normalizeError";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, idempotency-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(
  body: BookSessionApiResponse,
  status = 200,
  extraHeaders: Record<string, string> = {},
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...CORS_HEADERS,
      ...extraHeaders,
    },
  });
}

function normalizePayload(
  body: BookSessionApiRequestBody,
  idempotencyKey: string | undefined,
  accessToken: string,
): BookSessionRequest {
  return {
    ...body,
    idempotencyKey,
    accessToken,
  };
}

export async function bookHandler(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: CORS_HEADERS });
  }

  if (request.method !== "POST") {
    return jsonResponse({ success: false, error: "Method not allowed" }, 405);
  }

  const authHeader = request.headers.get("Authorization");
  const accessToken = typeof authHeader === "string"
    ? authHeader.replace(/^Bearer\s+/i, "").trim()
    : "";

  if (!authHeader || accessToken.length === 0) {
    return jsonResponse(
      { success: false, error: "Missing authorization token" },
      401,
      { "WWW-Authenticate": "Bearer" },
    );
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch (error) {
    logger.warn("Failed to parse booking payload", { error: toError(error), context: { handler: "bookHandler" } });
    return jsonResponse({ success: false, error: "Invalid JSON body" }, 400);
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
    return jsonResponse(
      { success: false, error: "Invalid request body", code: "invalid_request" },
      400,
    );
  }

  const body: BookSessionApiRequestBody = parseResult.data;

  try {
    const idempotencyKey = request.headers.get("Idempotency-Key") ?? undefined;
    const result = await bookSession(normalizePayload(body, idempotencyKey, accessToken));
    const headers = idempotencyKey
      ? { "Idempotency-Key": idempotencyKey }
      : {};
    return jsonResponse({ success: true, data: result }, 200, headers);
  } catch (error) {
    const status = typeof (error as { status?: number })?.status === "number"
      ? (error as { status: number }).status
      : 500;
    const normalizedError = toError(error, "Booking failed");
    logger.error("Session booking failed", {
      error: normalizedError,
      metadata: {
        status,
        name: normalizedError.name,
      },
      context: { handler: "bookHandler" },
    });
    return jsonResponse({ success: false, error: "Booking failed" }, status);
  }
}
