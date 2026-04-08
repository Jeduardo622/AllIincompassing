import {
  createProtectedRoute,
  extractBearerToken,
  RouteOptions,
} from "../_shared/auth-middleware.ts";
import { corsHeadersForRequest } from "../_shared/cors.ts";

/**
 * Generic email dispatch edge route. The app historically referenced `functions/v1/emails` but the
 * implementation was not versioned in-repo; callers expect CORS + JSON. When `EMAILS_HTTP_PROXY_URL`
 * is set, POST bodies are forwarded to that HTTPS endpoint with the caller Authorization header.
 * Otherwise returns 503 so operators can wire the proxy or remove stale clients.
 */
const json = (req: Request, body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeadersForRequest(req),
      "Content-Type": "application/json",
    },
  });

const resolveHttpsProxyUrl = (raw: string): string | null => {
  const trimmed = raw.trim();
  if (!trimmed.length) return null;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
};

async function handleEmails(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return json(req, { error: "Method not allowed" }, 405);
  }

  const proxyUrl = resolveHttpsProxyUrl(Deno.env.get("EMAILS_HTTP_PROXY_URL") ?? "");
  if (!proxyUrl) {
    return json(req, {
      error: "email_dispatch_not_configured",
      message:
        "Set EMAILS_HTTP_PROXY_URL to an HTTPS URL that accepts POST JSON email payloads, or stop calling functions/v1/emails.",
    }, 503);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(req, { error: "Invalid JSON body" }, 400);
  }

  const headers: HeadersInit = {
    "Content-Type": "application/json",
  };
  const token = extractBearerToken(req);
  if (token) {
    (headers as Record<string, string>)["Authorization"] = `Bearer ${token}`;
  }

  let upstream: Response;
  try {
    upstream = await fetch(proxyUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  } catch (error) {
    console.error("emails proxy fetch failed", error);
    return json(req, { error: "email_proxy_unreachable" }, 502);
  }

  const text = await upstream.text();
  const contentType = upstream.headers.get("Content-Type") ?? "application/json";
  return new Response(text, {
    status: upstream.status,
    headers: {
      ...corsHeadersForRequest(req),
      "Content-Type": contentType,
    },
  });
}

export default createProtectedRoute((req) => handleEmails(req), RouteOptions.therapist);
