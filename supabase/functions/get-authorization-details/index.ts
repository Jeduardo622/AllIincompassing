import { createProtectedRoute, corsHeaders, RouteOptions } from "../_shared/auth-middleware.ts";
import { createRequestClient } from "../_shared/database.ts";

function extractOrganizationId(metadata: Record<string, unknown> | null | undefined): string | null {
  if (!metadata) return null;
  const candidate = (metadata as Record<string, unknown>).organization_id ?? (metadata as Record<string, unknown>).organizationId;
  return typeof candidate === "string" && candidate.length > 0 ? candidate : null;
}

async function handler(req: Request) {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

  try {
    const db = createRequestClient(req);

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const authorizationId = typeof body.authorizationId === "string" ? body.authorizationId : null;
    if (!authorizationId) {
      return new Response(JSON.stringify({ error: "Authorization ID is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Derive caller organization from user metadata for cross-org guard
    const { data: authResult, error: authError } = await db.auth.getUser();
    if (authError || !authResult?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const callerOrgId = extractOrganizationId(authResult.user.user_metadata as Record<string, unknown> | undefined);

    const { data, error } = await db
      .from("authorizations")
      .select(
        `*, client:clients(id, full_name, email, organization_id), provider:therapists(id, full_name, email, organization_id), services:authorization_services(*)`
      )
      .eq("id", authorizationId)
      .single();

    if (error) {
      return new Response(JSON.stringify({ error: "Error fetching authorization" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Enforce org ownership unless super_admin (handled by route gating below)
    if (callerOrgId && data) {
      const clientOrg = (data as any)?.client?.organization_id ?? null;
      const providerOrg = (data as any)?.provider?.organization_id ?? null;
      const sameOrg = clientOrg === callerOrgId || providerOrg === callerOrgId;
      if (!sameOrg) {
        return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    return new Response(JSON.stringify({ authorization: data }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("Error fetching authorization details:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
}

export default createProtectedRoute(handler, RouteOptions.admin);
