import {
  corsHeadersForRequest,
  handleCors,
  logApiAccess,
  type Role,
  type UserContext,
} from "../_shared/auth-middleware.ts";
import { supabaseAdmin, createRequestClient } from "../_shared/database.ts";
import { getUserOrThrow } from "../_shared/auth.ts";
import { errorEnvelope, getRequestId } from "../lib/http/error.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.50.0";

interface AssignTherapistRequest { userId: string; therapistId: string; }

const assignmentAdminRoles = ['bcba', 'org_super_admin', 'org_admin', 'admin'] as const;

export async function resolveAssignmentAdminRole(
  client: SupabaseClient,
  organizationId: string,
): Promise<Role | null> {
  const [superAdminResult, ...roleResults] = await Promise.all([
    client.rpc('current_user_is_super_admin'),
    ...assignmentAdminRoles.map((roleName) => client.rpc('user_has_role_for_org', {
      role_name: roleName,
      target_organization_id: organizationId,
    })),
  ]);

  if (superAdminResult.error || roleResults.some((result) => result.error)) {
    throw new Response('Role check failed', { status: 500 });
  }
  if (superAdminResult.data === true) return 'super_admin';

  const grantedIndex = roleResults.findIndex((result) => result.data === true);
  if (grantedIndex === 0) return 'bcba';
  if (grantedIndex > 0) return 'admin';
  return null;
}

export default async (req: Request): Promise<Response> => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const responseHeaders = { ...corsHeadersForRequest(req), 'Content-Type': 'application/json' };
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: responseHeaders });

  let userContext: UserContext | null = null;
  try {
    const adminClient = createRequestClient(req);
    const caller = await getUserOrThrow(adminClient);

    const { userId, therapistId }: AssignTherapistRequest = await req.json();
    if (!userId || !therapistId) return new Response(JSON.stringify({ error: 'User ID and therapist ID are required' }), { status: 400, headers: responseHeaders });

    // Profile organization is server-controlled; auth user_metadata is user-editable
    // and must never authorize tenant-scoped assignment.
    const serviceRoleClient = supabaseAdmin;
    const { data: profileRows, error: profileError } = await serviceRoleClient
      .from('profiles')
      .select('id, email, organization_id, is_active')
      .in('id', [caller.id, userId]);
    if (profileError) {
      console.error('Error resolving assignment profiles:', profileError);
      logApiAccess('POST', '/assign-therapist-user', userContext, 500);
      return new Response(JSON.stringify({ error: 'Unable to verify organization context' }), { status: 500, headers: responseHeaders });
    }

    const callerProfile = profileRows?.find((profile) => profile.id === caller.id);
    const targetProfile = profileRows?.find((profile) => profile.id === userId);
    const callerOrganizationId = callerProfile?.organization_id ?? null;
    if (!callerOrganizationId || callerProfile?.is_active !== true) {
      logApiAccess('POST', '/assign-therapist-user', null, 403);
      return new Response(JSON.stringify({ error: 'Admin organization context is required' }), { status: 403, headers: responseHeaders });
    }

    const callerRole = await resolveAssignmentAdminRole(adminClient, callerOrganizationId);
    if (!callerRole) {
      logApiAccess('POST', '/assign-therapist-user', null, 403);
      return new Response(JSON.stringify({ error: 'Insufficient permissions' }), { status: 403, headers: responseHeaders });
    }

    userContext = {
      user: { id: caller.id, email: caller.email ?? null },
      profile: {
        id: caller.id,
        email: typeof callerProfile.email === 'string' ? callerProfile.email : null,
        role: callerRole,
        is_active: true,
      },
    };
    if (!targetProfile?.organization_id || targetProfile.is_active !== true || targetProfile.organization_id !== callerOrganizationId) {
      logApiAccess('POST', '/assign-therapist-user', userContext, 403);
      return new Response(JSON.stringify({ error: 'Cannot assign therapists for users outside your organization' }), { status: 403, headers: responseHeaders });
    }

    // Service role access is required for Supabase auth.admin endpoints; we scope results to the caller's organization before use.
    const { data: userData, error: userError } = await serviceRoleClient.auth.admin.getUserById(userId);
    if (userError || !userData.user) {
      console.error('Error fetching user:', userError);
      logApiAccess('POST', '/assign-therapist-user', userContext, 404);
      return new Response(JSON.stringify({ error: `Error fetching user: ${userError?.message || "User not found"}` }), { status: 404, headers: responseHeaders });
    }

    const targetUser = userData.user;
    const userEmail = targetUser.email;
    if (!userEmail) {
      return new Response(JSON.stringify({ error: 'Target user email is missing' }), { status: 400, headers: responseHeaders });
    }

    const { data: therapistData, error: therapistError } = await adminClient
      .from('therapists')
      .select('id, full_name, status, organization_id, deleted_at')
      .eq('id', therapistId)
      .single();
    if (therapistError || !therapistData) {
      console.error('Error fetching therapist:', therapistError);
      logApiAccess('POST', '/assign-therapist-user', userContext, 404);
      return new Response(JSON.stringify({ error: 'Therapist not found' }), { status: 404, headers: responseHeaders });
    }

    if ((therapistData as { deleted_at?: string | null }).deleted_at) {
      logApiAccess('POST', '/assign-therapist-user', userContext, 400);
      return new Response(JSON.stringify({ error: 'Cannot assign archived therapist' }), { status: 400, headers: responseHeaders });
    }

    if (!therapistData.organization_id || therapistData.organization_id !== callerOrganizationId) {
      logApiAccess('POST', '/assign-therapist-user', userContext, 403);
      return new Response(JSON.stringify({ error: 'Cannot assign therapists from a different organization' }), { status: 403, headers: responseHeaders });
    }

    if (therapistData.status !== 'active') return new Response(JSON.stringify({ error: 'Cannot assign to inactive therapist' }), { status: 400, headers: responseHeaders });

    const { data: existingClient } = await adminClient
      .from('clients')
      .select('id, therapist_id, organization_id')
      .eq('id', userId)
      .single();

    let result: any;
    if (existingClient) {
      const { data: updateData, error: updateError } = await adminClient
        .from('clients')
        .update({
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

    const primaryTherapistId = (result.client as { therapist_id?: string | null }).therapist_id ?? null;
    if (!primaryTherapistId) {
      const { data: primedClient, error: primeError } = await adminClient
        .from('clients')
        .update({
          therapist_id: therapistId,
          therapist_assigned_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', userId)
        .is('therapist_id', null)
        .select()
        .single();

      if (primeError) throw new Error(`Error setting primary therapist: ${primeError.message}`);
      if (primedClient) {
        result.client = primedClient;
      }
    }

    const linkOrganizationId =
      ((result.client as { organization_id?: string | null }).organization_id ?? callerOrganizationId);
    const { error: linkError } = await adminClient
      .from('client_therapist_links')
      .upsert(
        {
          client_id: userId,
          therapist_id: therapistId,
          organization_id: linkOrganizationId,
        },
        { onConflict: 'client_id,therapist_id' },
      );
    if (linkError) throw new Error(`Error creating therapist link: ${linkError.message}`);

    const { error: logError } = await adminClient.from('admin_actions').insert({
      admin_user_id: caller.id,
      action_type: 'therapist_assignment',
      target_user_id: userId,
      organization_id: callerOrganizationId,
      action_details: {
        therapist_id: therapistId,
        therapist_name: therapistData.full_name,
        action: result.action,
        user_email: userEmail,
      },
    });
    if (logError) console.warn('Failed to log admin action:', logError);

    logApiAccess('POST', '/assign-therapist-user', userContext, 200);
    return new Response(JSON.stringify({ success: true, message: `User ${result.action === 'created' ? 'created as client and assigned' : 'linked'} to therapist successfully`, data: { userId, userEmail, therapistId, therapistName: therapistData.full_name, action: result.action, client: result.client } }), { status: 200, headers: responseHeaders });
  } catch (error) {
    console.error('Error assigning therapist to user:', error);
    if (error instanceof Response) {
      const code = error.status === 401 ? 'unauthorized' : error.status === 403 ? 'forbidden' : 'internal_error';
      return errorEnvelope({
        requestId: getRequestId(req),
        code,
        message: await error.text(),
        status: error.status,
        headers: corsHeadersForRequest(req),
      });
    }
    logApiAccess('POST', '/assign-therapist-user', userContext, 500);
    return new Response(JSON.stringify({ success: false, error: (error as any).message || 'Failed to assign therapist to user' }), { status: 500, headers: responseHeaders });
  }
};
