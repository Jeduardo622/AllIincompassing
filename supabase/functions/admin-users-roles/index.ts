import { createProtectedRoute, corsHeaders, logApiAccess, RouteOptions } from "../_shared/auth-middleware.ts";
import { createRequestClient } from "../_shared/database.ts";
import { assertAdmin } from "../_shared/auth.ts";

interface RoleUpdateRequest { role: 'client' | 'therapist' | 'admin' | 'super_admin'; is_active?: boolean; }

export default createProtectedRoute(async (req: Request, userContext) => {
  if (req.method !== 'PATCH') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  try {
    const adminClient = createRequestClient(req);
    await assertAdmin(adminClient);

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

    logApiAccess('PATCH', `/admin/users/${userId}/roles`, userContext, 200);

    return new Response(JSON.stringify({ message: 'User role updated successfully', user: { id: updatedUser.id, email: updatedUser.email, role: updatedUser.role, first_name: updatedUser.first_name, last_name: updatedUser.last_name, full_name: updatedUser.full_name, is_active: updatedUser.is_active, updated_at: updatedUser.updated_at } }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error('Role update error:', error);
    logApiAccess('PATCH', '/admin/users/:id/roles', userContext, 500);
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
}, RouteOptions.superAdmin);
