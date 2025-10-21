const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
import { createRequestClient } from "../_shared/database.ts";
import { createProtectedRoute, RouteOptions } from "../_shared/auth-middleware.ts";

export default createProtectedRoute(async (req, userContext) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const db = createRequestClient(req);

    const { therapistId } = await req.json();
    if (!therapistId) return new Response(JSON.stringify({ error: "Therapist ID is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const isTherapist = userContext.profile.role === "therapist";
    const isAdmin = userContext.profile.role === "admin" || userContext.profile.role === "super_admin";

    if (isTherapist && userContext.user.id !== therapistId) {
      return new Response(JSON.stringify({ error: "Access denied" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (!isAdmin && !isTherapist) {
      return new Response(JSON.stringify({ error: "Access denied" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data, error } = await db.from("therapists").select("*").eq("id", therapistId).single();
    if (error) return new Response(JSON.stringify({ error: `Error fetching therapist: ${error.message}` }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    return new Response(JSON.stringify({ therapist: data }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("Error fetching therapist details:", error);
    return new Response(JSON.stringify({ error: (error as any).message }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
}, RouteOptions.authenticated);
