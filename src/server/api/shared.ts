import { getOptionalServerEnv, getRequiredServerEnv } from "../env";

const JSON_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
};

export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
};

type FetchResult<T> = { status: number; ok: boolean; data: T | null };

export function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...CORS_HEADERS, ...extra },
  });
}

export function getAccessToken(request: Request): string | null {
  const authHeader = request.headers.get("Authorization");
  const accessToken = typeof authHeader === "string" ? authHeader.replace(/^Bearer\s+/i, "").trim() : "";
  return accessToken.length > 0 ? accessToken : null;
}

export function getSupabaseConfig(): { supabaseUrl: string; anonKey: string } {
  const supabaseUrl =
    getOptionalServerEnv("SUPABASE_URL") ||
    getOptionalServerEnv("SUPABASE_DATABASE_URL") ||
    getRequiredServerEnv("VITE_SUPABASE_URL");

  const anonKey =
    getOptionalServerEnv("SUPABASE_ANON_KEY") ||
    getRequiredServerEnv("VITE_SUPABASE_ANON_KEY");

  return { supabaseUrl: supabaseUrl.replace(/\/$/, ""), anonKey };
}

export async function fetchJson<T = unknown>(url: string, init: RequestInit): Promise<FetchResult<T>> {
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

export async function resolveOrgAndRole(accessToken: string): Promise<{
  organizationId: string | null;
  isTherapist: boolean;
  isAdmin: boolean;
  isSuperAdmin: boolean;
}> {
  const { supabaseUrl, anonKey } = getSupabaseConfig();
  const headers = {
    ...JSON_HEADERS,
    apikey: anonKey,
    Authorization: `Bearer ${accessToken}`,
  };

  const orgUrl = `${supabaseUrl}/rest/v1/rpc/current_user_organization_id`;
  const orgResult = await fetchJson<string>(orgUrl, {
    method: "POST",
    headers,
    body: "{}",
  });

  const organizationId =
    orgResult.ok && typeof orgResult.data === "string" && orgResult.data.length > 0
      ? orgResult.data
      : null;

  if (!organizationId) {
    return { organizationId: null, isTherapist: false, isAdmin: false, isSuperAdmin: false };
  }

  const roleUrl = `${supabaseUrl}/rest/v1/rpc/user_has_role_for_org`;
  const therapistResult = await fetchJson<boolean>(roleUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({ role_name: "therapist", target_organization_id: organizationId }),
  });
  const adminResult = await fetchJson<boolean>(roleUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({ role_name: "admin", target_organization_id: organizationId }),
  });
  const superAdminUrl = `${supabaseUrl}/rest/v1/rpc/current_user_is_super_admin`;
  const superAdminResult = await fetchJson<boolean>(superAdminUrl, {
    method: "POST",
    headers,
    body: "{}",
  });

  return {
    organizationId,
    isTherapist: therapistResult.ok && therapistResult.data === true,
    isAdmin: adminResult.ok && adminResult.data === true,
    isSuperAdmin: superAdminResult.ok && superAdminResult.data === true,
  };
}

