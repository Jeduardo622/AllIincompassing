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
    // Get the JWT token from the request
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("Missing Authorization header");
    }

    // Verify the JWT token
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      throw new Error("Invalid token or user not found");
    }

    // Verify user has admin privileges
    const { data: userRoles } = await supabase.rpc('get_user_roles', {}, {
      headers: { Authorization: `Bearer ${token}` }
    });

    const isAdmin = userRoles?.[0]?.roles?.includes('admin') || false;
    if (!isAdmin) {
      throw new Error("Only admins can assign therapist-user relationships");
    }

    // Parse the request body
    const { userId, therapistId } = await req.json();

    if (!userId || !therapistId) {
      throw new Error("User ID and therapist ID are required");
    }

    // Get user email
    const { data: userData, error: userError } = await supabase.auth.admin.getUserById(userId);
    if (userError || !userData.user) {
      throw new Error(`Error fetching user: ${userError?.message || "User not found"}`);
    }

    const userEmail = userData.user.email;
    
    // Assign therapist role
    const { error: roleError } = await supabase.rpc('assign_therapist_role', {
      user_email: userEmail,
      therapist_id: therapistId
    });
    
    if (roleError) {
      throw new Error(`Error assigning therapist role: ${roleError.message}`);
    }

    // Update user metadata
    const { error: updateError } = await supabase.auth.admin.updateUserById(
      userId,
      { user_metadata: { therapist_id: therapistId } }
    );
    
    if (updateError) {
      throw new Error(`Error updating user metadata: ${updateError.message}`);
    }

    return new Response(
      JSON.stringify({ 
        success: true,
        message: "Therapist-user relationship assigned successfully" 
      }),
      {
        headers: { 
          ...corsHeaders,
          "Content-Type": "application/json" 
        },
      }
    );
  } catch (error) {
    console.error("Error assigning therapist-user relationship:", error);
    return new Response(
      JSON.stringify({ 
        success: false,
        error: error.message || "An error occurred while assigning therapist-user relationship"
      }),
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