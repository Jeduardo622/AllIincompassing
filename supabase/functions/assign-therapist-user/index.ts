import { createProtectedRoute, corsHeaders, logApiAccess, RouteOptions } from "../_shared/auth-middleware.ts";
import { supabaseAdmin, createRequestClient } from "../_shared/database.ts";
import { assertAdmin } from "../_shared/auth.ts";

const db = supabaseAdmin;

interface AssignTherapistRequest { userId: string; therapistId: string; }

export default createProtectedRoute(async (req: Request, userContext) => {
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  try {
    const caller = createRequestClient(req);
    await assertAdmin(caller);

    const { userId, therapistId }: AssignTherapistRequest = await req.json();
    if (!userId || !therapistId) return new Response(JSON.stringify({ error: 'User ID and therapist ID are required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const { data: userData, error: userError } = await db.auth.admin.getUserById(userId);
    if (userError || !userData.user) {
      console.error('Error fetching user:', userError);
      logApiAccess('POST', '/assign-therapist-user', userContext, 404);
      return new Response(JSON.stringify({ error: `Error fetching user: ${userError?.message || "User not found"}` }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const userEmail = userData.user.email;

    const { data: therapistData, error: therapistError } = await db.from('therapists').select('id, full_name, is_active').eq('id', therapistId).single();
    if (therapistError || !therapistData) {
      console.error('Error fetching therapist:', therapistError);
      logApiAccess('POST', '/assign-therapist-user', userContext, 404);
      return new Response(JSON.stringify({ error: 'Therapist not found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (!therapistData.is_active) return new Response(JSON.stringify({ error: 'Cannot assign to inactive therapist' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const { data: existingClient } = await db.from('clients').select('id, therapist_id').eq('id', userId).single();

    let result: any;
    if (existingClient) {
      const { data: updateData, error: updateError } = await db.from('clients').update({ therapist_id: therapistId, updated_at: new Date().toISOString() }).eq('id', userId).select().single();
      if (updateError) throw new Error(`Error updating client assignment: ${updateError.message}`);
      result = { action: 'updated', client: updateData, previousTherapistId: (existingClient as any).therapist_id };
    } else {
      const { data: newClient, error: createError } = await db.from('clients').insert({ id: userId, email: userEmail, therapist_id: therapistId, full_name: (userData.user as any).user_metadata?.full_name || userEmail.split('@')[0], created_at: new Date().toISOString(), updated_at: new Date().toISOString() }).select().single();
      if (createError) throw new Error(`Error creating client record: ${createError.message}`);
      result = { action: 'created', client: newClient };
    }

    const { error: logError } = await db.from('admin_actions').insert({ admin_user_id: userContext.user.id, action_type: 'therapist_assignment', target_user_id: userId, action_details: { therapist_id: therapistId, therapist_name: therapistData.full_name, action: result.action, user_email: userEmail } });
    if (logError) console.warn('Failed to log admin action:', logError);

    logApiAccess('POST', '/assign-therapist-user', userContext, 200);
    return new Response(JSON.stringify({ success: true, message: `User ${result.action === 'created' ? 'created as client and assigned' : 'reassigned'} to therapist successfully`, data: { userId, userEmail, therapistId, therapistName: therapistData.full_name, action: result.action, client: result.client } }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error('Error assigning therapist to user:', error);
    logApiAccess('POST', '/assign-therapist-user', userContext, 500);
    return new Response(JSON.stringify({ success: false, error: (error as any).message || 'Failed to assign therapist to user' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
}, RouteOptions.admin);
