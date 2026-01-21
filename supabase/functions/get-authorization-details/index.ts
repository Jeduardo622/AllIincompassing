import { createProtectedRoute, corsHeaders, RouteOptions, type UserContext } from "../_shared/auth-middleware.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.50.0";
import { createRequestClient } from "../_shared/database.ts";
import { MissingOrgContextError, orgScopedQuery, requireOrg } from "../_shared/org.ts";

interface HandlerOptions {
  req: Request;
  userContext: UserContext;
  db?: SupabaseClient;
}

export async function handleGetAuthorizationDetails({
  req,
  userContext,
  db: providedDb,
}: HandlerOptions) {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

  try {
    const db = providedDb ?? createRequestClient(req);
    const orgId = await requireOrg(db);

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const authorizationId = typeof body.authorizationId === "string" ? body.authorizationId : null;
    if (!authorizationId) {
      return new Response(JSON.stringify({ error: "Authorization ID is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data, error } = await orgScopedQuery(db, "authorizations", orgId)
      .select(
        `*, client:clients(id, full_name, email, organization_id), provider:therapists(id, full_name, email, organization_id), services:authorization_services(*)`
      )
      .eq("id", authorizationId)
      .single();

    if (error) {
      return new Response(JSON.stringify({ error: "Error fetching authorization" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ authorization: data }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    if (error instanceof MissingOrgContextError) {
      return new Response(JSON.stringify({ error: error.message, role: userContext.profile.role }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    console.error("Error fetching authorization details:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
}

export default createProtectedRoute(
  (req: Request, userContext: UserContext) => handleGetAuthorizationDetails({ req, userContext }),
  RouteOptions.admin,
);
