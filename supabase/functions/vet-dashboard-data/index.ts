/**
 * Compatibility alias for legacy clients still invoking `vet-dashboard-data`.
 * Proxies to the canonical `get-dashboard-data` edge function.
 */
const BASE_CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, X-Client-Info, apikey, content-type, x-request-id",
  Vary: "Origin",
  "Content-Type": "application/json",
};

const resolveAllowedOrigin = (req: Request): string | null => {
  const origin = req.headers.get("Origin");
  if (!origin) {
    return null;
  }

  const configured = [
    Deno.env.get("FRONTEND_URL"),
    Deno.env.get("APP_URL"),
    Deno.env.get("VITE_APP_URL"),
    Deno.env.get("VITE_FRONTEND_URL"),
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.replace(/\/+$/, ""));

  if (origin.startsWith("http://localhost:") || origin.startsWith("http://127.0.0.1:")) {
    return origin;
  }
  if (origin.endsWith(".netlify.app")) {
    return origin;
  }
  if (configured.includes(origin.replace(/\/+$/, ""))) {
    return origin;
  }

  return null;
};

const corsHeadersForRequest = (req: Request): Record<string, string> => {
  const allowedOrigin = resolveAllowedOrigin(req);
  return allowedOrigin
    ? {
        ...BASE_CORS_HEADERS,
        "Access-Control-Allow-Origin": allowedOrigin,
      }
    : { ...BASE_CORS_HEADERS };
};

const jsonError = (req: Request, status: number, message: string): Response =>
  new Response(JSON.stringify({ success: false, error: message }), {
    status,
    headers: corsHeadersForRequest(req),
  });

const buildForwardHeaders = (req: Request): Headers => {
  const headers = new Headers();
  const auth = req.headers.get("Authorization");
  if (auth) {
    headers.set("Authorization", auth);
  }

  const apiKey = req.headers.get("apikey");
  if (apiKey) {
    headers.set("apikey", apiKey);
  }

  const traceHeaders = ["x-request-id", "x-correlation-id", "x-agent-operation-id"];
  for (const name of traceHeaders) {
    const value = req.headers.get(name);
    if (value && value.trim().length > 0) {
      headers.set(name, value);
    }
  }

  // Preserve client metadata expected by Supabase telemetry when present.
  const clientInfo = req.headers.get("x-client-info") ?? req.headers.get("X-Client-Info");
  if (clientInfo) {
    headers.set("x-client-info", clientInfo);
  }

  if (req.method === "POST") {
    headers.set("Content-Type", req.headers.get("Content-Type") ?? "application/json");
  }

  return headers;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeadersForRequest(req) });
  }

  if (req.method !== "GET" && req.method !== "POST") {
    return jsonError(req, 405, "Method not allowed");
  }

  const baseUrl = Deno.env.get("SUPABASE_URL");
  if (!baseUrl) {
    return jsonError(req, 500, "Missing SUPABASE_URL");
  }

  const targetUrl = `${baseUrl.replace(/\/$/, "")}/functions/v1/get-dashboard-data`;

  try {
    const forwardHeaders = buildForwardHeaders(req);
    const forwarded = await fetch(targetUrl, {
      method: req.method,
      headers: forwardHeaders,
      body: req.method === "POST" ? await req.text() : undefined,
    });
    const payload = await forwarded.text();

    return new Response(payload, {
      status: forwarded.status,
      headers: {
        ...corsHeadersForRequest(req),
        "Content-Type": forwarded.headers.get("Content-Type") ?? "application/json",
      },
    });
  } catch {
    return jsonError(req, 502, "Failed to proxy to get-dashboard-data");
  }
});
