import {
  corsHeaders,
  createProtectedRoute,
  logApiAccess,
  RouteOptions,
  type Role,
  type UserContext,
} from "../_shared/auth-middleware.ts";
import { createRequestClient, supabaseAdmin } from "../_shared/database.ts";

interface ResetAdminPasswordPayload {
  email: string;
  new_password: string;
}

interface AdminUserRecord {
  email?: string;
  raw_user_meta_data?: Record<string, unknown> | null;
}

const ADMIN_USER_FETCH_LIMIT = 500;
const MIN_PASSWORD_LENGTH = 8;

const respond = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const normalizeString = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

const parseOrganizationFromMetadata = (metadata: Record<string, unknown> | null | undefined) => {
  if (!metadata || typeof metadata !== "object") return null;
  const snake = metadata["organization_id"];
  if (typeof snake === "string" && snake.trim().length > 0) return snake.trim();
  const camel = metadata["organizationId"];
  if (typeof camel === "string" && camel.trim().length > 0) return camel.trim();
  return null;
};

const resolveCallerOrg = async (context: UserContext): Promise<string | null> => {
  const { data, error } = await supabaseAdmin.auth.admin.getUserById(context.user.id);
  if (error || !data?.user) {
    console.error("Failed to resolve caller metadata", { error, callerId: context.user.id });
    return null;
  }

  return parseOrganizationFromMetadata(
    data.user.user_metadata as Record<string, unknown> | undefined,
  );
};

const canManageAllOrganizations = (role: Role) => role === "super_admin";

const invokeCanonicalReset = async (normalizedEmail: string, normalizedPassword: string) => {
  const primaryResult = await supabaseAdmin.rpc("admin_reset_user_password", {
    user_email: normalizedEmail,
    new_password: normalizedPassword,
  });

  if (!primaryResult.error) {
    return null;
  }

  if (primaryResult.error.code !== "PGRST202") {
    return primaryResult.error;
  }

  const legacyResult = await supabaseAdmin.rpc("reset_user_password", {
    target_email: normalizedEmail,
    new_password: normalizedPassword,
  });

  return legacyResult.error ?? null;
};

const handler = createProtectedRoute(
  async (req, userContext) => {
    if (req.method !== "POST") {
      return respond(405, { error: "Method not allowed" });
    }

    let payload: Partial<ResetAdminPasswordPayload>;
    try {
      payload = await req.json();
    } catch {
      return respond(400, { error: "Invalid JSON payload" });
    }

    const normalizedEmail = normalizeString(payload.email).toLowerCase();
    if (!normalizedEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalizedEmail)) {
      return respond(400, { error: "A valid email address is required." });
    }

    const normalizedPassword = normalizeString(payload.new_password);
    if (normalizedPassword.length < MIN_PASSWORD_LENGTH) {
      return respond(400, { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` });
    }

    const requestClient = createRequestClient(req);
    const callerCanManageAllOrgs = canManageAllOrganizations(userContext.profile.role);

    let scopedOrganizationId: string | null = null;
    if (!callerCanManageAllOrgs) {
      scopedOrganizationId = await resolveCallerOrg(userContext);
      if (!scopedOrganizationId) {
        logApiAccess("POST", "/admin/reset-user-password", userContext, 400);
        return respond(400, { error: "Caller is missing organization metadata." });
      }
    }

    const { data: adminRows, error: adminRowsError } = await requestClient.rpc("get_admin_users_paged", {
      organization_id: scopedOrganizationId,
      p_limit: ADMIN_USER_FETCH_LIMIT,
      p_offset: 0,
    });

    if (adminRowsError) {
      const status = adminRowsError.code === "42501" ? 403 : 500;
      logApiAccess("POST", "/admin/reset-user-password", userContext, status);
      return respond(status, {
        error: status === 403 ? "Access denied" : "Failed to validate admin scope.",
      });
    }

    const adminList = Array.isArray(adminRows) ? adminRows as AdminUserRecord[] : [];
    const targetAdmin = adminList.find((entry) => normalizeString(entry.email).toLowerCase() === normalizedEmail);

    if (!targetAdmin) {
      const status = callerCanManageAllOrgs ? 404 : 403;
      logApiAccess("POST", "/admin/reset-user-password", userContext, status);
      return respond(status, {
        error: callerCanManageAllOrgs
          ? "Admin user not found."
          : "Target admin is outside the caller organization.",
      });
    }

    const resetError = await invokeCanonicalReset(normalizedEmail, normalizedPassword);
    if (resetError) {
      console.error("admin_reset_user_password failed", { error: resetError, email: normalizedEmail });
      logApiAccess("POST", "/admin/reset-user-password", userContext, 500);
      return respond(500, { error: "Failed to reset admin password." });
    }

    logApiAccess("POST", "/admin/reset-user-password", userContext, 200);
    return respond(200, { email: normalizedEmail });
  },
  RouteOptions.admin,
);

Deno.serve(handler);

export default handler;
