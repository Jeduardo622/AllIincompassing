import { createClient } from "npm:@supabase/supabase-js@2.50.0";
import { createProtectedRoute, corsHeaders, logApiAccess, RouteOptions } from "../_shared/auth-middleware.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
);

interface AssignTherapistRequest {
  userId: string;
  therapistId: string;
}

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
    // Parse the request body
    const { userId, therapistId }: AssignTherapistRequest = await req.json();

    if (!userId || !therapistId) {
      return new Response(
        JSON.stringify({ error: 'User ID and therapist ID are required' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Get user email using Supabase Admin API
    const { data: userData, error: userError } = await supabase.auth.admin.getUserById(userId);
    if (userError || !userData.user) {
      console.error('Error fetching user:', userError);
      logApiAccess('POST', '/assign-therapist-user', userContext, 404);
      
      return new Response(
        JSON.stringify({ error: `Error fetching user: ${userError?.message || "User not found"}` }),
        {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const userEmail = userData.user.email;

    // Validate that the therapist exists
    const { data: therapistData, error: therapistError } = await supabase
      .from('therapists')
      .select('id, full_name, is_active')
      .eq('id', therapistId)
      .single();

    if (therapistError || !therapistData) {
      console.error('Error fetching therapist:', therapistError);
      logApiAccess('POST', '/assign-therapist-user', userContext, 404);
      
      return new Response(
        JSON.stringify({ error: 'Therapist not found' }),
        {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    if (!therapistData.is_active) {
      return new Response(
        JSON.stringify({ error: 'Cannot assign to inactive therapist' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Check if this is updating an existing client or creating a new relationship
    const { data: existingClient } = await supabase
      .from('clients')
      .select('id, therapist_id')
      .eq('id', userId)
      .single();

    let result;
    if (existingClient) {
      // Update existing client's therapist assignment
      const { data: updateData, error: updateError } = await supabase
        .from('clients')
        .update({ 
          therapist_id: therapistId,
          updated_at: new Date().toISOString()
        })
        .eq('id', userId)
        .select()
        .single();

      if (updateError) {
        throw new Error(`Error updating client assignment: ${updateError.message}`);
      }

      result = {
        action: 'updated',
        client: updateData,
        previousTherapistId: existingClient.therapist_id
      };
    } else {
      // Create new client record (assuming the user exists but isn't a client yet)
      const { data: newClient, error: createError } = await supabase
        .from('clients')
        .insert({
          id: userId,
          email: userEmail,
          therapist_id: therapistId,
          full_name: userData.user.user_metadata?.full_name || userEmail.split('@')[0],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .select()
        .single();

      if (createError) {
        throw new Error(`Error creating client record: ${createError.message}`);
      }

      result = {
        action: 'created',
        client: newClient
      };
    }

    // Log the assignment action for audit purposes
    const { error: logError } = await supabase
      .from('admin_actions')
      .insert({
        admin_user_id: userContext.user.id,
        action_type: 'therapist_assignment',
        target_user_id: userId,
        action_details: {
          therapist_id: therapistId,
          therapist_name: therapistData.full_name,
          action: result.action,
          user_email: userEmail
        }
      });

    if (logError) {
      console.warn('Failed to log admin action:', logError);
    }

    logApiAccess('POST', '/assign-therapist-user', userContext, 200);
    return new Response(
      JSON.stringify({
        success: true,
        message: `User ${result.action === 'created' ? 'created as client and assigned' : 'reassigned'} to therapist successfully`,
        data: {
          userId,
          userEmail,
          therapistId,
          therapistName: therapistData.full_name,
          action: result.action,
          client: result.client
        }
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    console.error("Error assigning therapist to user:", error);
    logApiAccess('POST', '/assign-therapist-user', userContext, 500);
    
    return new Response(
      JSON.stringify({ 
        success: false,
        error: error.message || 'Failed to assign therapist to user' 
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
}, RouteOptions.admin); // Require admin role for therapist assignment