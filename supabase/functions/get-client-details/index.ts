import { createClient } from "npm:@supabase/supabase-js@2.50.0";
import { createProtectedRoute, corsHeaders, logApiAccess, RouteOptions } from "../_shared/auth-middleware.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
);

export default createProtectedRoute(async (req: Request, userContext) => {
  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      {
        status: 405,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }

  try {
    const { clientId } = await req.json();

    if (!clientId) {
      return new Response(
        JSON.stringify({ error: 'Client ID is required' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Verify user has permission to view client details
    // Therapists can only see their assigned clients, admins can see all
    let query = supabase
      .from("clients")
      .select("*")
      .eq("id", clientId);

    // Apply access control based on role
    if (userContext.profile.role === 'therapist') {
      // Therapists can only see clients assigned to them
      query = query.eq('therapist_id', userContext.user.id);
    } else if (userContext.profile.role === 'client') {
      // Clients can only see their own details
      query = query.eq('id', userContext.user.id);
    }
    // Admins and super_admins can see all clients (no additional filter)

    const { data, error } = await query.single();

    if (error) {
      console.error('Error fetching client details:', error);
      logApiAccess('POST', '/get-client-details', userContext, 500);
      
      return new Response(
        JSON.stringify({ error: `Error fetching client: ${error.message}` }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    if (!data) {
      logApiAccess('POST', '/get-client-details', userContext, 404);
      return new Response(
        JSON.stringify({ error: 'Client not found or access denied' }),
        {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    logApiAccess('POST', '/get-client-details', userContext, 200);
    return new Response(
      JSON.stringify({ client: data }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error("Error fetching client details:", error);
    logApiAccess('POST', '/get-client-details', userContext, 500);
    
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
}, RouteOptions.authenticated); // Require authentication for all roles