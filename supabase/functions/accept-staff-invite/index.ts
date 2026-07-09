import { z } from "zod";
import {
  corsHeadersForRequest,
  createPublicRoute,
} from "../_shared/auth-middleware.ts";
import { supabaseAdmin } from "../_shared/database.ts";

const ACCEPT_INVITE_PATH = "/accept-staff-invite";
const MIN_PASSWORD_LENGTH = 8;

const StaffRoleSchema = z.enum(["bt", "therapist", "midtier", "admin_schedule", "admin", "bcba", "super_admin"]);

const AcceptInviteRequestSchema = z.object({
  token: z.string().trim().min(16),
  password: z.string().min(MIN_PASSWORD_LENGTH),
  first_name: z.string().trim().max(100).optional(),
  last_name: z.string().trim().max(100).optional(),
});

type StaffRole = z.infer<typeof StaffRoleSchema>;

type InviteTokenRecord = {
  id: string;
  email: string;
  organization_id: string;
  token_hash: string;
  expires_at: string;
  created_by: string;
  role: string;
};

const jsonResponse = (req: Request, status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeadersForRequest(req), "Content-Type": "application/json" },
  });

const toHex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

const hashToken = async (token: string) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return toHex(digest);
};

const normalizeOptionalName = (value: string | undefined) => {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
};

const deleteInviteToken = async (tokenHash: string) => {
  const { error } = await supabaseAdmin
    .from("admin_invite_tokens")
    .delete()
    .eq("token_hash", tokenHash);

  if (error) {
    console.warn("Failed to delete staff invite token", { code: "staff_invite_delete_failed" });
  }
};

const createUserRole = async (userId: string, role: StaffRole, grantedBy: string) => {
  const { data: roleRow, error: roleError } = await supabaseAdmin
    .from("roles")
    .select("id,name")
    .eq("name", role)
    .single();

  if (roleError || !roleRow?.id) {
    return { error: "role_not_configured" };
  }

  const { error: userRoleError } = await supabaseAdmin
    .from("user_roles")
    .upsert(
      {
        user_id: userId,
        role_id: roleRow.id,
        granted_by: grantedBy,
        granted_at: new Date().toISOString(),
        is_active: true,
      },
      { onConflict: "user_id,role_id" },
    );

  if (userRoleError) {
    return { error: "role_assignment_failed" };
  }

  return { error: null };
};

async function handleAcceptStaffInvite(req: Request) {
  if (req.method !== "POST") {
    return jsonResponse(req, 405, { error: "method_not_allowed" });
  }

  const parsed = AcceptInviteRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return jsonResponse(req, 400, {
      error: "invalid_payload",
      details: parsed.error.flatten(),
    });
  }

  const tokenHash = await hashToken(parsed.data.token);
  const { data: invite, error: inviteError } = await supabaseAdmin
    .from("admin_invite_tokens")
    .select("id,email,organization_id,token_hash,expires_at,created_by,role")
    .eq("token_hash", tokenHash)
    .single();

  if (inviteError || !invite) {
    return jsonResponse(req, 404, { error: "invite_not_found" });
  }

  const inviteRecord = invite as InviteTokenRecord;
  if (new Date(inviteRecord.expires_at).getTime() <= Date.now()) {
    await deleteInviteToken(tokenHash);
    return jsonResponse(req, 410, { error: "invite_expired" });
  }

  const roleResult = StaffRoleSchema.safeParse(inviteRecord.role);
  if (!roleResult.success) {
    return jsonResponse(req, 409, { error: "invite_role_not_supported" });
  }

  const firstName = normalizeOptionalName(parsed.data.first_name);
  const lastName = normalizeOptionalName(parsed.data.last_name);
  const fullName = [firstName, lastName].filter(Boolean).join(" ") || null;

  const { data: createdUserResult, error: createUserError } = await supabaseAdmin.auth.admin.createUser({
    email: inviteRecord.email,
    password: parsed.data.password,
    email_confirm: true,
    user_metadata: {
      first_name: firstName,
      last_name: lastName,
      organization_id: inviteRecord.organization_id,
      organizationId: inviteRecord.organization_id,
      role: roleResult.data,
      invited_by: inviteRecord.created_by,
      accepted_invite_id: inviteRecord.id,
    },
  });

  const userId = createdUserResult?.user?.id;
  if (createUserError || !userId) {
    return jsonResponse(req, 409, { error: "account_creation_failed" });
  }

  const cleanupCreatedUser = async () => {
    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (error) {
      console.warn("Failed to clean up partially accepted staff invite user", {
        code: "staff_invite_cleanup_failed",
      });
    }
  };

  const roleAssignment = await createUserRole(userId, roleResult.data, inviteRecord.created_by);
  if (roleAssignment.error) {
    await cleanupCreatedUser();
    return jsonResponse(req, 500, { error: roleAssignment.error });
  }

  const { error: profileError } = await supabaseAdmin
    .from("profiles")
    .upsert(
      {
        id: userId,
        email: inviteRecord.email,
        first_name: firstName,
        last_name: lastName,
        full_name: fullName,
        organization_id: inviteRecord.organization_id,
        role: roleResult.data,
        is_active: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    );

  if (profileError) {
    await cleanupCreatedUser();
    return jsonResponse(req, 500, { error: "profile_sync_failed" });
  }

  const { error: actionError } = await supabaseAdmin.from("admin_actions").insert({
    admin_user_id: inviteRecord.created_by,
    target_user_id: userId,
    organization_id: inviteRecord.organization_id,
    action_type: "staff_invite_accepted",
    action_details: {
      invite_id: inviteRecord.id,
      email: inviteRecord.email,
      role: roleResult.data,
      path: ACCEPT_INVITE_PATH,
    },
  });

  if (actionError) {
    console.warn("Failed to log staff invite acceptance", { code: "staff_invite_accept_log_failed" });
  }

  await deleteInviteToken(tokenHash);

  return jsonResponse(req, 200, {
    email: inviteRecord.email,
    role: roleResult.data,
  });
}

export const handler = createPublicRoute(async (req) => handleAcceptStaffInvite(req));

Deno.serve(handler);

export default handler;
