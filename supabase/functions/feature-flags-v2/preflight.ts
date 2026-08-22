import { resolveAllowedOrigin } from "../_shared/cors.ts";

const STATIC_ALLOWED_ORIGINS = [
  "https://app.allincompassing.ai",
  "https://preview.allincompassing.ai",
  "https://staging.allincompassing.ai",
  "http://localhost:3000",
  "http://localhost:5173",
];
const envAllowedOrigins = (Deno.env.get("EDGE_ALLOWED_ORIGINS") ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const ALLOWED_ORIGINS = Array.from(
  new Set([...STATIC_ALLOWED_ORIGINS, ...envAllowedOrigins]),
);
const PRIMARY_ALLOWED_ORIGIN = ALLOWED_ORIGINS[0] ??
  "https://app.allincompassing.ai";
const adminAllowedOrigins = new Set(ALLOWED_ORIGINS);

export const BASE_CORS_HEADERS = {
  "Access-Control-Allow-Origin": resolveAllowedOrigin(),
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Authorization, Content-Type, X-Client-Info, apikey",
  "Access-Control-Max-Age": "86400",
};

export const resolveRequestOrigin = (
  req: Request,
): { origin: string | null; requestedOrigin: string | null } => {
  const requestedOrigin = req.headers.get("origin");
  if (!requestedOrigin) {
    return { origin: null, requestedOrigin: null };
  }

  if (adminAllowedOrigins.has(requestedOrigin)) {
    return { origin: requestedOrigin, requestedOrigin };
  }

  return { origin: null, requestedOrigin };
};

export const buildAdminCorsHeaders = (
  origin: string | null,
): Record<string, string> => ({
  "Access-Control-Allow-Origin": origin ?? PRIMARY_ALLOWED_ORIGIN,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Authorization, Content-Type, X-Client-Info, apikey",
  "Access-Control-Max-Age": "86400",
  Vary: "Origin",
});

export const buildRuntimeCorsHeaders = (
  origin: string | null,
): Record<string, string> => ({
  "Access-Control-Allow-Origin": origin ?? PRIMARY_ALLOWED_ORIGIN,
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  Vary: "Origin",
});

const respond = (
  origin: string | null,
  status: number,
  body: Record<string, unknown>,
) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...BASE_CORS_HEADERS,
      ...buildAdminCorsHeaders(origin),
      "Content-Type": "application/json",
    },
  });

export const handlePreflightRequest = (req: Request): Response | null => {
  if (req.method !== "OPTIONS") {
    return null;
  }

  const { origin, requestedOrigin } = resolveRequestOrigin(req);
  if (requestedOrigin && !origin) {
    return respond(origin, 403, { error: "Origin not allowed" });
  }

  const requestedMethod =
    (req.headers.get("Access-Control-Request-Method") || "").toUpperCase();
  if (!requestedMethod || requestedMethod === "GET") {
    return new Response(null, {
      status: 204,
      headers: buildRuntimeCorsHeaders(origin),
    });
  }

  const headers = buildAdminCorsHeaders(origin);
  const requestedHeaders = req.headers.get("Access-Control-Request-Headers");
  if (requestedHeaders) {
    headers["Access-Control-Allow-Headers"] = requestedHeaders;
  }

  return new Response(null, { status: 204, headers });
};
