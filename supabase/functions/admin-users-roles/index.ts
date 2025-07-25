import { createClient } from "npm:@supabase/supabase-js@2.50.0";
import { createProtectedRoute, corsHeaders, logApiAccess, RouteOptions } from "../_shared/auth-middleware.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
);

interface RoleUpdateRequest {
  role: 'client' | 'therapist' | 'admin' | 'super_admin';
  is_active?: boolean;
}

export default createProtectedRoute(async (req: Request, userContext) => {
  if (req.method !== 'PATCH') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      {
        status: 405,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }

  try {
    // Extract user ID from URL path
    const url = new URL(req.url);
    const pathSegments = url.pathname.split('/');
    const userIdIndex = pathSegments.findIndex(segment => segment === 'users') + 1;
    const userId = pathSegments[userIdIndex];

    if (!userId) {
      return new Response(
        JSON.stringify({ error: 'User ID is required' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(userId)) {
      return new Response(
        JSON.stringify({ error: 'Invalid user ID format' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const { role, is_active }: RoleUpdateRequest = await req.json();

    // Validate role
    const validRoles = ['client', 'therapist', 'admin', 'super_admin'];
    if (!role || !validRoles.includes(role)) {
      return new Response(
        JSON.stringify({ error: 'Valid role is required', validRoles }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Check if user exists
    const { data: existingUser, error: fetchError } = await supabase
      .from('profiles')
      .select('id, email, role, is_active')
      .eq('id', userId)
      .single();

    if (fetchError || !existingUser) {
      return new Response(
        JSON.stringify({ error: 'User not found' }),
        {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Prevent self-demotion from super_admin
    if (userId === userContext.user.id && userContext.profile.role === 'super_admin' && role !== 'super_admin') {
      return new Response(
        JSON.stringify({ error: 'Cannot demote yourself from super_admin role' }),
        {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Prevent deactivating yourself
    if (userId === userContext.user.id && is_active === false) {
      return new Response(
        JSON.stringify({ error: 'Cannot deactivate your own account' }),
        {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Build update object
    const updateData: any = { role };
    if (is_active !== undefined) {
      updateData.is_active = is_active;
    }

    // Update user role and status
    const { data: updatedUser, error: updateError } = await supabase
      .from('profiles')
      .update(updateData)
      .eq('id', userId)
      .select('id, email, role, first_name, last_name, full_name, is_active, updated_at')
      .single();

    if (updateError || !updatedUser) {
      console.error('Role update error:', updateError);
      return new Response(
        JSON.stringify({ error: 'Failed to update user role' }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Log the role change
    logApiAccess('PATCH', `/admin/users/${userId}/roles`, userContext, 200);

    return new Response(
      JSON.stringify({
        message: 'User role updated successfully',
        user: {
          id: updatedUser.id,
          email: updatedUser.email,
          role: updatedUser.role,
          first_name: updatedUser.first_name,
          last_name: updatedUser.last_name,
          full_name: updatedUser.full_name,
          is_active: updatedUser.is_active,
          updated_at: updatedUser.updated_at,
        },
        changes: {
          previous_role: existingUser.role,
          new_role: updatedUser.role,
          previous_active: existingUser.is_active,
          new_active: updatedUser.is_active,
        },
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Role update error:', error);
    logApiAccess('PATCH', '/admin/users/:id/roles', userContext, 500);
    
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
}, RouteOptions.superAdmin);