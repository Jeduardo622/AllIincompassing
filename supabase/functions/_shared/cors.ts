const STATIC_ALLOWED_ORIGINS = [
  "https://app.allincompassing.ai",
  "https://preview.allincompassing.ai",
  "https://staging.allincompassing.ai",
  "http://127.0.0.1:4173",
  "http://localhost:4173",
  "http://localhost:3000",
  "http://localhost:5173",
] as const;

const parseAllowedOrigins = (): string[] =>
  (Deno.env.get("CORS_ALLOWED_ORIGINS") ?? Deno.env.get("API_ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

export const getAllowedOrigins = (): string[] => {
  const merged = new Set<string>([...STATIC_ALLOWED_ORIGINS, ...parseAllowedOrigins()]);
  return Array.from(merged);
};

export function resolveAllowedOrigin(requestOrigin?: string | null): string {
  const origins = getAllowedOrigins();
  const defaultOrigin = origins[0] ?? "https://app.allincompassing.ai";
  if (!requestOrigin || requestOrigin.trim().length === 0) {
    return defaultOrigin;
  }
  return origins.includes(requestOrigin) ? requestOrigin : defaultOrigin;
}

export function resolveAllowedOriginForRequest(req: Request): string | null {
  const requestOrigin = req.headers.get("origin");
  if (!requestOrigin) {
    return resolveAllowedOrigin(null);
  }
  const origins = getAllowedOrigins();
  return origins.includes(requestOrigin) ? requestOrigin : null;
}

export function corsHeadersForRequest(req: Request): Record<string, string> {
  const origin = resolveAllowedOrigin(req.headers.get("origin"));
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Client-Info, x-client-info, apikey, idempotency-key, x-request-id, x-correlation-id, x-agent-operation-id",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

