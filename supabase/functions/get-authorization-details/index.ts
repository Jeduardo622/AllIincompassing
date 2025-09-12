import { createRequestClient } from "../_shared/database.ts";
import { getUserOrThrow } from "../_shared/auth.ts";

const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  try {
    const db = createRequestClient(req);
    await getUserOrThrow(db);

    const { authorizationId } = await req.json();
    if (!authorizationId) throw new Error("Authorization ID is required");

    const { data, error } = await db
      .from("authorizations")
      .select(`*, client:clients(id, full_name, email), provider:therapists(id, full_name, email), services:authorization_services(*)`)
      .eq("id", authorizationId)
      .single();

    if (error) throw new Error(`Error fetching authorization: ${error.message}`);
    return new Response(JSON.stringify({ authorization: data }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("Error fetching authorization details:", error);
    return new Response(JSON.stringify({ error: (error as any).message }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
