import {
  corsHeaders,
  createProtectedRoute,
  logApiAccess,
  RouteOptions,
  type Role,
  type UserContext,
} from "../_shared/auth-middleware.ts";
import { supabaseAdmin } from "../_shared/database.ts";

interface CreateAdminPayload {
  email: string;
  password: string;
  first_name: string;
  last_name: string;
  title?: string;
  organization_id?: string | null;
  reason: string;
}

const MIN_PASSWORD_LENGTH = 8;
const MIN_REASON_LENGTH = 10;

const respond = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const normalizeString = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

const normalizeUuid = (value: unknown) => {
  const normalized = normalizeString(value);
  return normalized && /^[0-9a-fA-F-]{36}$/.test(normalized) ? normalized : null;
};

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

const validatePayload = (payload: Partial<CreateAdminPayload>) => {
  const email = normalizeString(payload.email).toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { error: "A valid email address is required." };
  }

  const password = normalizeString(payload.password);
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` };
  }

  const firstName = normalizeString(payload.first_name);
  const lastName = normalizeString(payload.last_name);
  if (!firstName || !lastName) {
    return { error: "First and last name are required." };
  }

  const reason = normalizeString(payload.reason);
  if (reason.length < MIN_REASON_LENGTH) {
    return { error: `Reason must be at least ${MIN_REASON_LENGTH} characters.` };
  }

  return {
    normalizedEmail: email,
    normalizedPassword: password,
    firstName,
    lastName,
    title: normalizeString(payload.title),
    reason,
    requestedOrganization: normalizeUuid(payload.organization_id ?? null),
  };
};

export default createProtectedRoute(
  async (req, userContext) => {
    if (req.method !== "POST") {
      return respond(405, { error: "Method not allowed" });
    }

    let payload: Partial<CreateAdminPayload>;
    try {
      payload = await req.json();
    } catch {
      return respond(400, { error: "Invalid JSON payload" });
    }

    const validation = validatePayload(payload);
    if ("error" in validation) {
      return respond(400, { error: validation.error });
    }

    const {
      normalizedEmail,
      normalizedPassword,
      firstName,
      lastName,
      title,
      reason,
      requestedOrganization,
    } = validation;

    let resolvedOrganization = requestedOrganization;
    if (canManageAllOrganizations(userContext.profile.role)) {
      if (!resolvedOrganization) {
        return respond(400, { error: "organization_id is required for super admins." });
      }
    } else {
      const callerOrg = await resolveCallerOrg(userContext);
      if (!callerOrg) {
        return respond(400, { error: "Caller is missing organization metadata." });
      }
      if (resolvedOrganization && resolvedOrganization !== callerOrg) {
        return respond(403, { error: "Caller organization mismatch." });
      }
      resolvedOrganization = callerOrg;
    }

    if (!resolvedOrganization) {
      return respond(400, { error: "Organization context is required to create an admin." });
    }

    try {
      const createResult = await supabaseAdmin.auth.admin.createUser({
        email: normalizedEmail,
        password: normalizedPassword,
        email_confirm: true,
        user_metadata: {
          first_name: firstName,
          last_name: lastName,
          title: title || null,
          is_admin: true,
          organization_id: resolvedOrganization,
          organizationId: resolvedOrganization,
        },
      });

      if (createResult.error || !createResult.data?.user) {
        const message = createResult.error?.message ?? "Failed to create admin user.";
        const status = message.toLowerCase().includes("already registered") ? 409 : 400;
        console.error("Admin user creation failed", {
          error: createResult.error,
          email: normalizedEmail,
        });
        logApiAccess("POST", "/admin/create-user", userContext, status);
        return respond(status, { error: message });
      }

      const { error: roleError } = await supabaseAdmin.rpc("assign_admin_role", {
        user_email: normalizedEmail,
        organization_id: resolvedOrganization,
        reason,
      });

      if (roleError) {
        console.error("assign_admin_role failed", { error: roleError, email: normalizedEmail });
        logApiAccess("POST", "/admin/create-user", userContext, 500);
        return respond(500, { error: "User created, but assigning admin role failed." });
      }

      logApiAccess("POST", "/admin/create-user", userContext, 200);

      return respond(200, {
        user_id: createResult.data.user.id,
        email: normalizedEmail,
        organization_id: resolvedOrganization,
      });
    } catch (error) {
      console.error("Unhandled admin creation error", { error, email: normalizedEmail });
      logApiAccess("POST", "/admin/create-user", userContext, 500);
      return respond(500, { error: "Internal server error." });
    }
  },
  RouteOptions.admin,
);

