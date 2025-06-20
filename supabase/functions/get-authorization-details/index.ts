import { createClient } from "npm:@supabase/supabase-js@2.50.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const supabase = createClient(supabaseUrl, supabaseServiceKey);

Deno.serve(async (req) => {
  // Handle CORS preflight request
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  try {
    const { authorizationId } = await req.json();

    if (!authorizationId) {
      throw new Error("Authorization ID is required");
    }

    const { data, error } = await supabase
      .from("authorizations")
      .select(`
        *,
        client:clients(id, full_name, email),
        provider:therapists(id, full_name, email),
        services:authorization_services(*)
      `)
      .eq("id", authorizationId)
      .single();

    if (error) {
      throw new Error(`Error fetching authorization: ${error.message}`);
    }

    return new Response(
      JSON.stringify({ authorization: data }),
      {
        headers: { 
          ...corsHeaders,
          "Content-Type": "application/json" 
        },
      }
    );
  } catch (error) {
    console.error("Error fetching authorization details:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 400,
        headers: { 
          ...corsHeaders,
          "Content-Type": "application/json" 
        },
      }
    );
  }
});