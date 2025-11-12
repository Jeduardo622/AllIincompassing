import "../bootstrapSupabase";
import { getRequiredServerEnv } from "../env";
import { getDefaultOrganizationId } from "../runtimeConfig";
import { logger } from "../../lib/logger/logger";
import { toError } from "../../lib/logger/normalizeError";

const JSON_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...CORS_HEADERS, ...extra },
  });
}

async function fetchJson<T = unknown>(url: string, init: RequestInit): Promise<{ status: number; ok: boolean; data: T | null }>
{
  const response = await fetch(url, init);
  const status = response.status;
  const ok = response.ok;
  const text = await response.text();
  if (text.length === 0) {
    return { status, ok, data: null };
  }
  try {
    return { status, ok, data: JSON.parse(text) as T };
  } catch {
    return { status, ok, data: null };
  }
}

export async function dashboardHandler(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: { ...CORS_HEADERS } });
  }

  if (request.method !== "GET") {
    return json({ error: "Method not allowed" }, 405);
  }

  const authHeader = request.headers.get("Authorization");
  const accessToken = typeof authHeader === "string" ? authHeader.replace(/^Bearer\s+/i, "").trim() : "";
  if (!authHeader || accessToken.length === 0) {
    return json({ error: "Missing authorization token" }, 401, { "WWW-Authenticate": "Bearer" });
  }

  const supabaseUrl = getRequiredServerEnv("SUPABASE_URL");
  const anonKey = getRequiredServerEnv("SUPABASE_ANON_KEY");
  const serviceRoleKey = getRequiredServerEnv("SUPABASE_SERVICE_ROLE_KEY");

  // Resolve organization context from the user's JWT
  try {
    const orgUrl = `${supabaseUrl.replace(/\/$/, "")}/rest/v1/rpc/current_user_organization_id`;
    const orgResult = await fetchJson<string>(orgUrl, {
      method: "POST",
      headers: {
        ...JSON_HEADERS,
        apikey: anonKey,
        Authorization: `Bearer ${accessToken}`,
      },
      body: "{}",
    });

    const fallbackOrgId = (() => {
      try {
        return getDefaultOrganizationId();
      } catch {
        return null;
      }
    })();

    const resolvedOrganizationId =
      orgResult.ok && typeof orgResult.data === "string" && orgResult.data.length > 0
        ? orgResult.data
        : fallbackOrgId;

    if (!resolvedOrganizationId) {
      return json({ error: "Access denied" }, 403);
    }

    if ((!orgResult.ok || !orgResult.data) && fallbackOrgId) {
      logger.warn("Dashboard request falling back to default organization", { fallbackOrgId });
    }

    // Optional: basic role check using helper RPC when available
    const roleUrl = `${supabaseUrl.replace(/\/$/, "")}/rest/v1/rpc/user_has_role_for_org`;
    const rolePayload = { role_name: "org_member", target_organization_id: resolvedOrganizationId } as Record<string, unknown>;
    const roleResult = await fetchJson<boolean>(roleUrl, {
      method: "POST",
      headers: {
        ...JSON_HEADERS,
        apikey: anonKey,
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(rolePayload),
    });

    if (!roleResult.ok || roleResult.data !== true) {
      return json({ error: "Forbidden" }, 403);
    }

    // Call the hardened dashboard RPC. This function is restricted at the DB level.
    // We call as service_role after validating the requester and org context.
    const dashboardUrl = `${supabaseUrl.replace(/\/$/, "")}/rest/v1/rpc/get_dashboard_data`;
    const rpcResult = await fetchJson<unknown>(dashboardUrl, {
      method: "POST",
      headers: {
        ...JSON_HEADERS,
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
      body: "{}",
    });

    if (!rpcResult.ok) {
      const status = rpcResult.status === 42501 ? 403 : rpcResult.status;
      return json({ error: "Dashboard RPC failed" }, status > 0 ? status : 500);
    }

    // Return the raw payload expected by the client hook
    return new Response(JSON.stringify(rpcResult.data ?? {}), {
      status: 200,
      headers: { ...JSON_HEADERS, ...CORS_HEADERS },
    });
  } catch (error) {
    logger.error("/api/dashboard failed", { error: toError(error, "dashboard proxy error") });
    return json({ error: "Internal Server Error" }, 500);
  }
}


