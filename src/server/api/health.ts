import { getRuntimeSupabaseConfig } from "../runtimeConfig";
import { corsHeadersForRequest, isDisallowedOriginRequest } from "./shared";

const JSON_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};

export const healthHandler = async (request: Request): Promise<Response> => {
  if (isDisallowedOriginRequest(request)) {
    return new Response(JSON.stringify({ error: "Origin not allowed" }), {
      status: 403,
      headers: { ...JSON_HEADERS, ...corsHeadersForRequest(request) },
    });
  }

  if (request.method === "OPTIONS") {
    return new Response("ok", {
      status: 200,
      headers: { ...JSON_HEADERS, ...corsHeadersForRequest(request) },
    });
  }

  if (request.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...JSON_HEADERS, ...corsHeadersForRequest(request) },
    });
  }

  try {
    const config = getRuntimeSupabaseConfig();
    const payload = {
      status: "ok",
      readiness: "ready",
      timestamp: new Date().toISOString(),
      checks: {
        runtimeConfig: Boolean(config.supabaseUrl) && Boolean(config.supabaseAnonKey),
      },
    };
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { ...JSON_HEADERS, ...corsHeadersForRequest(request) },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed health checks";
    return new Response(
      JSON.stringify({
        status: "degraded",
        readiness: "not_ready",
        timestamp: new Date().toISOString(),
        error: message,
      }),
      {
        status: 503,
        headers: { ...JSON_HEADERS, ...corsHeadersForRequest(request) },
      },
    );
  }
};
