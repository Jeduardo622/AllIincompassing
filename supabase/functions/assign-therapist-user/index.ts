import { createProtectedRoute, corsHeaders, logApiAccess, RouteOptions } from "../_shared/auth-middleware.ts";
import { supabaseAdmin, createRequestClient } from "../_shared/database.ts";
import { assertAdminOrSuperAdmin } from "../_shared/auth.ts";

interface AssignTherapistRequest { userId: string; therapistId: string; }

const extractOrganizationId = (source: Record<string, unknown> | null | undefined): string | null => {
  if (!source) return null;
  const possibleKeys = ['organization_id', 'organizationId'] as const;
  for (const key of possibleKeys) {
    const value = source[key];
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return null;
};

export default createProtectedRoute(async (req: Request, userContext) => {
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  try {
    const adminClient = createRequestClient(req);
    await assertAdminOrSuperAdmin(adminClient);

    const { userId, therapistId }: AssignTherapistRequest = await req.json();
    if (!userId || !therapistId) return new Response(JSON.stringify({ error: 'User ID and therapist ID are required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const { data: authUserResult, error: authUserError } = await adminClient.auth.getUser();
    if (authUserError || !authUserResult?.user) {
      console.error('Error resolving authenticated admin:', authUserError);
      logApiAccess('POST', '/assign-therapist-user', userContext, 401);
      return new Response(JSON.stringify({ error: 'Unable to verify admin context' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const callerOrganizationId = extractOrganizationId(authUserResult.user.user_metadata as Record<string, unknown> | null | undefined);
    if (!callerOrganizationId) {
      logApiAccess('POST', '/assign-therapist-user', userContext, 403);
      return new Response(JSON.stringify({ error: 'Admin organization context is required' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Service role access is required for Supabase auth.admin endpoints; we scope results to the caller's organization before use.
    const serviceRoleClient = supabaseAdmin;
    const { data: userData, error: userError } = await serviceRoleClient.auth.admin.getUserById(userId);
    if (userError || !userData.user) {
      console.error('Error fetching user:', userError);
      logApiAccess('POST', '/assign-therapist-user', userContext, 404);
      return new Response(JSON.stringify({ error: `Error fetching user: ${userError?.message || "User not found"}` }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const targetUser = userData.user;
    const targetOrganizationId = extractOrganizationId(targetUser.user_metadata as Record<string, unknown> | null | undefined);
    if (!targetOrganizationId || targetOrganizationId !== callerOrganizationId) {
      logApiAccess('POST', '/assign-therapist-user', userContext, 403);
      return new Response(JSON.stringify({ error: 'Cannot assign therapists for users outside your organization' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const userEmail = targetUser.email;
    if (!userEmail) {
      return new Response(JSON.stringify({ error: 'Target user email is missing' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { data: therapistData, error: therapistError } = await adminClient.from('therapists').select('id, full_name, is_active').eq('id', therapistId).single();
    if (therapistError || !therapistData) {
      console.error('Error fetching therapist:', therapistError);
      logApiAccess('POST', '/assign-therapist-user', userContext, 404);
      return new Response(JSON.stringify({ error: 'Therapist not found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const therapistOrganizationId = extractOrganizationId(therapistData as unknown as Record<string, unknown>);
    if (therapistOrganizationId && therapistOrganizationId !== callerOrganizationId) {
      logApiAccess('POST', '/assign-therapist-user', userContext, 403);
      return new Response(JSON.stringify({ error: 'Cannot assign therapists from a different organization' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (!therapistData.is_active) return new Response(JSON.stringify({ error: 'Cannot assign to inactive therapist' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const { data: existingClient } = await adminClient.from('clients').select('id, therapist_id').eq('id', userId).single();

    let result: any;
    if (existingClient) {
      const { data: updateData, error: updateError } = await adminClient
        .from('clients')
        .update({
          therapist_id: therapistId,
          updated_at: new Date().toISOString(),
          organization_id: callerOrganizationId,
        })
        .eq('id', userId)
        .select()
        .single();
      if (updateError) throw new Error(`Error updating client assignment: ${updateError.message}`);
      result = { action: 'updated', client: updateData, previousTherapistId: (existingClient as any).therapist_id };
    } else {
      const { data: newClient, error: createError } = await adminClient
        .from('clients')
        .insert({
          id: userId,
          email: userEmail,
          therapist_id: therapistId,
          full_name:
            (targetUser as any).user_metadata?.full_name || userEmail.split('@')[0],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          organization_id: callerOrganizationId,
        })
        .select()
        .single();
      if (createError) throw new Error(`Error creating client record: ${createError.message}`);
      result = { action: 'created', client: newClient };
    }

    const { error: logError } = await adminClient.from('admin_actions').insert({ admin_user_id: userContext.user.id, action_type: 'therapist_assignment', target_user_id: userId, action_details: { therapist_id: therapistId, therapist_name: therapistData.full_name, action: result.action, user_email: userEmail } });
    if (logError) console.warn('Failed to log admin action:', logError);

    logApiAccess('POST', '/assign-therapist-user', userContext, 200);
    return new Response(JSON.stringify({ success: true, message: `User ${result.action === 'created' ? 'created as client and assigned' : 'reassigned'} to therapist successfully`, data: { userId, userEmail, therapistId, therapistName: therapistData.full_name, action: result.action, client: result.client } }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error('Error assigning therapist to user:', error);
    logApiAccess('POST', '/assign-therapist-user', userContext, 500);
    return new Response(JSON.stringify({ success: false, error: (error as any).message || 'Failed to assign therapist to user' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
}, RouteOptions.admin);
