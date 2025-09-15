const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
import { createRequestClient } from "../_shared/database.ts";
import { getUserOrThrow } from "../_shared/auth.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  try {
    const db = createRequestClient(req);
    await getUserOrThrow(db);

    const { therapistId } = await req.json();
    if (!therapistId) throw new Error("Therapist ID is required");

    const { data, error } = await db.from("therapists").select("*").eq("id", therapistId).single();
    if (error) throw new Error(`Error fetching therapist: ${error.message}`);

    return new Response(JSON.stringify({ therapist: data }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("Error fetching therapist details:", error);
    return new Response(JSON.stringify({ error: (error as any).message }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
