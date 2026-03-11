import { supabase } from "./supabase";
import { buildSupabaseEdgeUrl } from "./runtimeConfig";

const generateRequestId = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
};

const withTraceHeaders = (headers: Headers): Headers => {
  const requestId = headers.get("x-request-id") ?? generateRequestId();
  const correlationId = headers.get("x-correlation-id") ?? requestId;

  headers.set("x-request-id", requestId);
  headers.set("x-correlation-id", correlationId);
  return headers;
};

export async function callApi(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = withTraceHeaders(new Headers(init.headers));
  if (!headers.has("Content-Type") && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  try {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }
  } catch {
    // Best effort: allow unauthenticated calls to surface 401s.
  }

  return fetch(path, { ...init, headers });
}

export async function callEdgeFunctionHttp(functionName: string, init: RequestInit = {}): Promise<Response> {
  const headers = withTraceHeaders(new Headers(init.headers));
  if (!headers.has("Content-Type") && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  try {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }
  } catch {
    // Best effort: allow unauthenticated calls to surface 401s.
  }

  const url = buildSupabaseEdgeUrl(functionName);
  return fetch(url, { ...init, headers });
}
