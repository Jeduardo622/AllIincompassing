import { bookSession } from "../bookSession";
import type {
  BookSessionApiRequestBody,
  BookSessionApiResponse,
  BookSessionRequest,
} from "../types";

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
  idempotencyKey?: string,
): BookSessionRequest {
  return {
    ...body,
    idempotencyKey,
  };
}

export async function bookHandler(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: CORS_HEADERS });
  }

  if (request.method !== "POST") {
    return jsonResponse({ success: false, error: "Method not allowed" }, 405);
  }

  let body: BookSessionApiRequestBody;
  try {
    body = await request.json();
  } catch (error) {
    console.error("Failed to parse booking payload", error);
    return jsonResponse({ success: false, error: "Invalid JSON body" }, 400);
  }

  if (!body || typeof body !== "object" || !body.session) {
    return jsonResponse({ success: false, error: "Missing session payload" }, 400);
  }

  try {
    const idempotencyKey = request.headers.get("Idempotency-Key") ?? undefined;
    const result = await bookSession(normalizePayload(body, idempotencyKey));
    const headers = idempotencyKey
      ? { "Idempotency-Key": idempotencyKey }
      : {};
    return jsonResponse({ success: true, data: result }, 200, headers);
  } catch (error) {
    const status = typeof (error as { status?: number })?.status === "number"
      ? (error as { status: number }).status
      : 500;
    const message = error instanceof Error ? error.message : "Failed to book session";
    console.error("Session booking failed", error);
    return jsonResponse({ success: false, error: message }, status);
  }
}
