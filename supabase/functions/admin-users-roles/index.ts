import { createProtectedRoute, corsHeaders, logApiAccess, RouteOptions } from "../_shared/auth-middleware.ts";
import { createRequestClient, supabaseAdmin } from "../_shared/database.ts";
import { assertAdminOrSuperAdmin } from "../_shared/auth.ts";

interface RoleUpdateRequest { role: 'client' | 'therapist' | 'admin' | 'super_admin'; is_active?: boolean; }

export default createProtectedRoute(async (req: Request, userContext) => {
  if (req.method !== 'PATCH') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  try {
    const adminClient = createRequestClient(req);
    await assertAdminOrSuperAdmin(adminClient);

    const url = new URL(req.url);
    const pathSegments = url.pathname.split('/');
    const userIdIndex = pathSegments.findIndex(segment => segment === 'users') + 1;
    const userId = pathSegments[userIdIndex];

    if (!userId) return new Response(JSON.stringify({ error: 'User ID is required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(userId)) return new Response(JSON.stringify({ error: 'Invalid user ID format' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const { role, is_active }: RoleUpdateRequest = await req.json();
    const validRoles = ['client', 'therapist', 'admin', 'super_admin'];
    if (!role || !validRoles.includes(role)) return new Response(JSON.stringify({ error: 'Valid role is required', validRoles }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const { data: existingUser } = await adminClient.from('profiles').select('id, email, role, is_active').eq('id', userId).single();
    if (!existingUser) return new Response(JSON.stringify({ error: 'User not found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    if (userId === userContext.user.id && userContext.profile.role === 'super_admin' && role !== 'super_admin') return new Response(JSON.stringify({ error: 'Cannot demote yourself from super_admin role' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    if (userId === userContext.user.id && is_active === false) return new Response(JSON.stringify({ error: 'Cannot deactivate your own account' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const updateData: any = { role }; if (is_active !== undefined) updateData.is_active = is_active;

    const { data: updatedUser, error: updateError } = await adminClient
      .from('profiles').update(updateData).eq('id', userId)
      .select('id, email, role, first_name, last_name, full_name, is_active, updated_at').single();

    if (updateError || !updatedUser) {
      console.error('Role update error:', updateError);
      return new Response(JSON.stringify({ error: 'Failed to update user role' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    try {
      const [actorResponse, targetResponse] = await Promise.all([
        supabaseAdmin.auth.admin.getUserById(userContext.user.id),
        supabaseAdmin.auth.admin.getUserById(userId),
      ]);

      const actorOrg = (actorResponse.data?.user?.user_metadata as Record<string, unknown> | undefined)?.organization_id
        ?? (actorResponse.data?.user?.user_metadata as Record<string, unknown> | undefined)?.organizationId
        ?? null;
      const targetOrg = (targetResponse.data?.user?.user_metadata as Record<string, unknown> | undefined)?.organization_id
        ?? (targetResponse.data?.user?.user_metadata as Record<string, unknown> | undefined)?.organizationId
        ?? null;
      const organizationId = targetOrg ?? actorOrg ?? null;

      const { error: actionLogError } = await adminClient
        .from('admin_actions')
        .insert({
          admin_user_id: userContext.user.id,
          target_user_id: userId,
          organization_id: organizationId,
          action_type: 'role_update',
          action_details: {
            new_role: role,
            is_active: updateData.is_active ?? existingUser.is_active,
          },
        });

      if (actionLogError) {
        console.error('Failed to record admin action:', actionLogError);
      }
    } catch (logError) {
      console.error('Failed to enrich admin action metadata:', logError);
    }

    logApiAccess('PATCH', `/admin/users/${userId}/roles`, userContext, 200);

    return new Response(JSON.stringify({ message: 'User role updated successfully', user: { id: updatedUser.id, email: updatedUser.email, role: updatedUser.role, first_name: updatedUser.first_name, last_name: updatedUser.last_name, full_name: updatedUser.full_name, is_active: updatedUser.is_active, updated_at: updatedUser.updated_at } }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error('Role update error:', error);
    logApiAccess('PATCH', '/admin/users/:id/roles', userContext, 500);
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
}, RouteOptions.superAdmin);
