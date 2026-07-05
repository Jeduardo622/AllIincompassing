import { corsHeadersForRequest } from "../_shared/cors.ts";

interface RoleUpdateRequest { target_user_id?: string; role: 'client' | 'bt' | 'therapist' | 'midtier' | 'admin_schedule' | 'admin' | 'bcba' | 'super_admin'; is_active?: boolean; }

type AppRole = RoleUpdateRequest["role"];

const ADMIN_ROLE_AUDIT_TIMEOUT_MS = 2_500;

const CANONICAL_ROLE_NAMES: AppRole[] = [
  "super_admin",
  "bcba",
  "admin",
  "admin_schedule",
  "midtier",
  "therapist",
  "bt",
  "client",
];

const ROLE_RANK: Record<AppRole, number> = {
  super_admin: 8,
  bcba: 8,
  admin: 7,
  admin_schedule: 6,
  midtier: 5,
  therapist: 4,
  bt: 3,
  client: 1,
};

/**
 * `profiles.role` is not authoritative: middleware and RLS use `user_roles` + helpers
 * (`current_user_is_super_admin`, `get_user_role_from_junction`). Authenticated clients
 * cannot reliably mutate another user's `user_roles` or `profiles` rows across org scopes (RLS),
 * so apply target-user changes with the service role after this super-admin-only route has
 * authorized the caller.
 */
async function syncCanonicalUserRoles(
  supabaseAdmin: any,
  targetUserId: string,
  role: AppRole,
  grantedBy: string,
): Promise<string | null> {
  const { data: roleRows, error: rolesError } = await supabaseAdmin
    .from("roles")
    .select("id,name")
    .in("name", CANONICAL_ROLE_NAMES);

  if (rolesError || !roleRows?.length) {
    console.error("syncCanonicalUserRoles: failed to load roles", rolesError);
    return "Failed to resolve canonical roles";
  }

  const roleIdByName = new Map<string, string>();
  for (const row of roleRows) {
    if (typeof row.name === "string" && typeof row.id === "string") {
      roleIdByName.set(row.name, row.id);
    }
  }

  const allStandardIds = CANONICAL_ROLE_NAMES
    .map((name) => roleIdByName.get(name))
    .filter((id): id is string => Boolean(id));

  if (role === "client") {
    const { error: clearError } = await supabaseAdmin
      .from("user_roles")
      .delete()
      .eq("user_id", targetUserId)
      .in("role_id", allStandardIds);
    if (clearError) {
      console.error("syncCanonicalUserRoles: clear standard roles failed", clearError);
      return "Failed to update role assignments";
    }
    return null;
  }

  const targetRank = ROLE_RANK[role];
  const elevatedIds = CANONICAL_ROLE_NAMES
    .filter((name) => ROLE_RANK[name] > targetRank)
    .map((name) => roleIdByName.get(name))
    .filter((id): id is string => Boolean(id));

  if (elevatedIds.length > 0) {
    const { error: delError } = await supabaseAdmin
      .from("user_roles")
      .delete()
      .eq("user_id", targetUserId)
      .in("role_id", elevatedIds);
    if (delError) {
      console.error("syncCanonicalUserRoles: delete elevated roles failed", delError);
      return "Failed to update role assignments";
    }
  }

  const targetRoleId = roleIdByName.get(role);
  if (!targetRoleId) {
    return "Target role is not configured";
  }

  const nowIso = new Date().toISOString();
  const { error: upsertError } = await supabaseAdmin.from("user_roles").upsert(
    {
      user_id: targetUserId,
      role_id: targetRoleId,
      granted_by: grantedBy,
      granted_at: nowIso,
      is_active: true,
    },
    { onConflict: "user_id,role_id" },
  );

  if (upsertError) {
    console.error("syncCanonicalUserRoles: upsert failed", upsertError);
    return "Failed to update role assignments";
  }
  return null;
}

async function runBestEffortAudit(work: () => Promise<void>): Promise<void> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const audit = work().catch((error) => {
    console.error("Failed to enrich admin action metadata:", error);
  });

  try {
    await Promise.race([
      audit,
      new Promise<void>((resolve) => {
        timeoutId = setTimeout(() => {
          console.error("Admin role audit enrichment timed out");
          resolve();
        }, ADMIN_ROLE_AUDIT_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function loadAdminRoleDeps() {
  const { createRequestClient, supabaseAdmin } = await import("../_shared/database.ts");

  return { createRequestClient, supabaseAdmin };
}

async function handleRoleUpdate(req: Request, userContext: any, corsHeaders: Record<string, string>, logApiAccess: any) {
  if (req.method !== 'PATCH') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  try {
    const { createRequestClient, supabaseAdmin } = await loadAdminRoleDeps();
    const adminClient = createRequestClient(req);

    const body = await req.json().catch(() => null) as RoleUpdateRequest | null;
    if (!body || typeof body !== "object") return new Response(JSON.stringify({ error: 'Valid role update request is required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const url = new URL(req.url);
    const pathSegments = url.pathname.split('/');
    const userIdIndex = pathSegments.findIndex(segment => segment === 'users') + 1;
    const pathUserId = userIdIndex > 0 ? pathSegments[userIdIndex] : "";
    const bodyUserId = typeof body.target_user_id === "string" ? body.target_user_id.trim() : "";
    const userId = pathUserId || bodyUserId;

    if (!userId) return new Response(JSON.stringify({ error: 'User ID is required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    if (pathUserId && bodyUserId && pathUserId !== bodyUserId) return new Response(JSON.stringify({ error: 'Target user ID mismatch' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(userId)) return new Response(JSON.stringify({ error: 'Invalid user ID format' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const { role, is_active } = body;
    const validRoles = CANONICAL_ROLE_NAMES;
    if (!role || !validRoles.includes(role)) return new Response(JSON.stringify({ error: 'Valid role is required', validRoles }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const { data: existingUser } = await supabaseAdmin.from('profiles').select('id, email, role, is_active').eq('id', userId).single();
    if (!existingUser) return new Response(JSON.stringify({ error: 'User not found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    if (
      userId === userContext.user.id
      && (userContext.profile.role === 'super_admin' || userContext.profile.role === 'bcba')
      && role !== userContext.profile.role
    ) return new Response(JSON.stringify({ error: `Cannot demote yourself from ${userContext.profile.role} role` }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    if (userId === userContext.user.id && is_active === false) return new Response(JSON.stringify({ error: 'Cannot deactivate your own account' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const updateData: any = { role }; if (is_active !== undefined) updateData.is_active = is_active;

    const junctionError = await syncCanonicalUserRoles(supabaseAdmin, userId, role, userContext.user.id);
    if (junctionError) {
      return new Response(JSON.stringify({ error: junctionError }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { data: updatedUser, error: updateError } = await supabaseAdmin
      .from('profiles').update(updateData).eq('id', userId)
      .select('id, email, role, first_name, last_name, full_name, is_active, updated_at').single();

    if (updateError || !updatedUser) {
      console.error('Role update error:', updateError);
      return new Response(JSON.stringify({ error: 'Failed to update user role' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    await runBestEffortAudit(async () => {
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
            old_role: existingUser.role,
            new_role: role,
            old_is_active: existingUser.is_active,
            is_active: updateData.is_active ?? existingUser.is_active,
          },
        });

      if (actionLogError) {
        console.error('Failed to record admin action:', actionLogError);
      }
    });

    logApiAccess('PATCH', `/admin/users/${userId}/roles`, userContext, 200);

    return new Response(JSON.stringify({ message: 'User role updated successfully', user: { id: updatedUser.id, email: updatedUser.email, role: updatedUser.role, first_name: updatedUser.first_name, last_name: updatedUser.last_name, full_name: updatedUser.full_name, is_active: updatedUser.is_active, updated_at: updatedUser.updated_at } }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error('Role update error:', error);
    logApiAccess('PATCH', '/admin/users/:id/roles', userContext, 500);
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
}

let protectedHandlerPromise: Promise<(req: Request) => Promise<Response>> | null = null;

function withRequestCors(response: Response, req: Request): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeadersForRequest(req))) {
    headers.set(key, value);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function getProtectedHandler(): Promise<(req: Request) => Promise<Response>> {
  if (!protectedHandlerPromise) {
    protectedHandlerPromise = import("../_shared/auth-middleware.ts").then((auth) =>
      auth.createProtectedRoute(
        (req: Request, userContext) => handleRoleUpdate(req, userContext, corsHeadersForRequest(req), auth.logApiAccess),
        auth.RouteOptions.superAdmin,
      )
    );
  }
  return protectedHandlerPromise;
}

export async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeadersForRequest(req),
    });
  }

  const protectedHandler = await getProtectedHandler();
  const response = await protectedHandler(req);
  return withRequestCors(response, req);
}

if (typeof Deno !== "undefined" && typeof Deno.serve === "function") {
  Deno.serve(handler);
}

export default handler;
