/**
 * Compatibility alias for legacy clients still invoking `vet-dashboard-data`.
 * Proxies to the canonical `get-dashboard-data` edge function.
 */
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, X-Client-Info, apikey, content-type, x-request-id",
  "Content-Type": "application/json",
};

const jsonError = (status: number, message: string): Response =>
  new Response(JSON.stringify({ success: false, error: message }), {
    status,
    headers: CORS_HEADERS,
  });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: CORS_HEADERS });
  }

  if (req.method !== "GET" && req.method !== "POST") {
    return jsonError(405, "Method not allowed");
  }

  const baseUrl = Deno.env.get("SUPABASE_URL");
  if (!baseUrl) {
    return jsonError(500, "Missing SUPABASE_URL");
  }

  const targetUrl = `${baseUrl.replace(/\/$/, "")}/functions/v1/get-dashboard-data`;

  try {
    const forwarded = await fetch(targetUrl, {
      method: req.method,
      headers: req.headers,
      body: req.method === "POST" ? await req.text() : undefined,
    });
    const payload = await forwarded.text();

    return new Response(payload, {
      status: forwarded.status,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": forwarded.headers.get("Content-Type") ?? "application/json",
      },
    });
  } catch {
    return jsonError(502, "Failed to proxy to get-dashboard-data");
  }
});
