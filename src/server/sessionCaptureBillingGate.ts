import { fetchJson, getSupabaseConfig } from "./api/shared";

/** Resolve the active organization's database-owned session capture policy. */
export const resolveSessionCaptureStrictBillingPolicy = async (
  accessToken: string,
  organizationId: string,
): Promise<{ strict: boolean; upstreamError: boolean }> => {
  const { supabaseUrl, anonKey } = getSupabaseConfig();
  const result = await fetchJson<boolean>(
    `${supabaseUrl}/rest/v1/rpc/get_session_capture_strict_billing_gate`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: anonKey,
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ target_organization_id: organizationId }),
    },
  );
  if (!result.ok || typeof result.data !== "boolean") {
    return { strict: true, upstreamError: true };
  }
  return { strict: result.data, upstreamError: false };
};
