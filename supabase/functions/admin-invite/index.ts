import { z } from "zod";
import {
  createProtectedRoute,
  corsHeaders,
  logApiAccess,
  RouteOptions,
  type UserContext,
} from "../_shared/auth-middleware.ts";
import { createRequestClient } from "../_shared/database.ts";
import { assertAdminOrSuperAdmin } from "../_shared/auth.ts";

const DEFAULT_EXPIRATION_HOURS = 72;
const MIN_EXPIRATION_HOURS = 1;
const MAX_EXPIRATION_HOURS = 24 * 7;
const ADMIN_INVITE_PATH = "/admin/invite";

const InviteRequestSchema = z.object({
  email: z.string().email(),
  organizationId: z.string().uuid().optional(),
  expiresInHours: z
    .number()
    .int()
    .min(MIN_EXPIRATION_HOURS)
    .max(MAX_EXPIRATION_HOURS)
    .optional(),
  role: z.enum(["admin", "super_admin"]).optional(),
});

type InviteRequest = z.infer<typeof InviteRequestSchema>;

type InviteTokenRecord = {
  id: string;
  expires_at: string | null;
};

type InviteLookupResult = {
  data: InviteTokenRecord | null;
  error: { message?: string } | null;
};

type InsertInviteResult = {
  data: InviteTokenRecord | null;
  error: { message?: string } | null;
};

const jsonResponse = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const extractOrganizationId = (metadata: Record<string, unknown> | null | undefined): string | null => {
  if (!metadata) return null;
  const candidate = metadata.organization_id ?? metadata.organizationId;
  return typeof candidate === "string" && candidate.length > 0 ? candidate : null;
};

const normalizeEmail = (email: string) => email.trim().toLowerCase();

const toHex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes))
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");

const hashToken = async (token: string) => {
  const encoded = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return toHex(digest);
};

const ensureEmailServiceConfig = () => {
  const emailServiceUrl = Deno.env.get("ADMIN_INVITE_EMAIL_URL") ?? "";
  const portalBaseUrl = Deno.env.get("ADMIN_PORTAL_URL") ?? "";
  return {
    emailServiceUrl: emailServiceUrl.trim(),
    portalBaseUrl: portalBaseUrl.trim(),
  };
};

const buildInviteUrl = (baseUrl: string, token: string) => {
  const trimmed = baseUrl.replace(/\/$/, "");
  return `${trimmed}/accept-invite?token=${token}`;
};

async function sendInviteEmail(
  url: string,
  payload: {
    to: string;
    inviteUrl: string;
    expiresAt: string;
    organizationId: string;
    role: string;
  },
): Promise<{ status: "sent" | "failed"; error?: string }> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        template: "admin-invite",
        to: payload.to,
        variables: {
          invite_url: payload.inviteUrl,
          expires_at: payload.expiresAt,
          organization_id: payload.organizationId,
          role: payload.role,
        },
      }),
    });

    if (!response.ok) {
      return {
        status: "failed",
        error: `Email service responded with status ${response.status}`,
      };
    }

    return { status: "sent" };
  } catch (error) {
    return {
      status: "failed",
      error: error instanceof Error ? error.message : "Unknown email delivery error",
    };
  }
}

async function handleInvite(req: Request, userContext: UserContext) {
  if (req.method !== "POST") {
    return jsonResponse(405, { error: "method_not_allowed" });
  }

  try {
    const adminClient = createRequestClient(req);
    await assertAdminOrSuperAdmin(adminClient);

    const payloadResult = InviteRequestSchema.safeParse(await req.json());
    if (!payloadResult.success) {
      return jsonResponse(400, {
        error: "invalid_payload",
        details: payloadResult.error.flatten(),
      });
    }

    const payload: InviteRequest = payloadResult.data;

    const { data: authResult, error: authError } = await adminClient.auth.getUser();
    if (authError || !authResult?.user) {
      logApiAccess("POST", ADMIN_INVITE_PATH, userContext, 401);
      return jsonResponse(401, { error: "unauthorized" });
    }

    const callerOrganizationId = extractOrganizationId(authResult.user.user_metadata as Record<string, unknown> | undefined);
    const normalizedEmail = normalizeEmail(payload.email);
    const targetOrganizationId = payload.organizationId ?? callerOrganizationId;

    if (!targetOrganizationId) {
      logApiAccess("POST", ADMIN_INVITE_PATH, userContext, 403);
      return jsonResponse(403, { error: "organization_context_required" });
    }

    if (userContext.profile.role !== "super_admin" && targetOrganizationId !== callerOrganizationId) {
      logApiAccess("POST", ADMIN_INVITE_PATH, userContext, 403);
      return jsonResponse(403, { error: "cross_org_invite_forbidden" });
    }

    const desiredRole = payload.role ?? "admin";
    if (desiredRole === "super_admin" && userContext.profile.role !== "super_admin") {
      logApiAccess("POST", ADMIN_INVITE_PATH, userContext, 403);
      return jsonResponse(403, { error: "insufficient_role_for_target" });
    }

    const now = new Date();
    const expiresInHours = payload.expiresInHours ?? DEFAULT_EXPIRATION_HOURS;
    const expiresAt = new Date(now.getTime() + expiresInHours * 60 * 60 * 1000);

    const existingInvite = (await adminClient
      .from("admin_invite_tokens")
      .select("id, expires_at")
      .eq("email", normalizedEmail)
      .eq("organization_id", targetOrganizationId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()) as InviteLookupResult;

    if (existingInvite.error) {
      console.error("Failed to lookup existing invite", existingInvite.error);
      logApiAccess("POST", ADMIN_INVITE_PATH, userContext, 500);
      return jsonResponse(500, { error: "invite_lookup_failed" });
    }

    const activeInvite = existingInvite.data;
    if (activeInvite?.expires_at) {
      const expiresAtDate = new Date(activeInvite.expires_at);
      if (!Number.isNaN(expiresAtDate.getTime()) && expiresAtDate.getTime() > now.getTime()) {
        logApiAccess("POST", ADMIN_INVITE_PATH, userContext, 409);
        return jsonResponse(409, { error: "active_invite_exists" });
      }
    }

    if (activeInvite?.id) {
      const { error: deleteError } = await adminClient
        .from("admin_invite_tokens")
        .delete()
        .eq("id", activeInvite.id);

      if (deleteError) {
        console.error("Failed to prune expired invite", deleteError);
      }
    }

    const rawToken = crypto.randomUUID().replace(/-/g, "");
    const tokenHash = await hashToken(rawToken);

    const insertedInvite = (await adminClient
      .from("admin_invite_tokens")
      .insert({
        email: normalizedEmail,
        token_hash: tokenHash,
        organization_id: targetOrganizationId,
        expires_at: expiresAt.toISOString(),
        created_by: userContext.user.id,
        role: desiredRole,
      })
      .select("id, expires_at")
      .single()) as InsertInviteResult;

    if (insertedInvite.error || !insertedInvite.data) {
      console.error("Failed to insert invite token", insertedInvite.error);
      logApiAccess("POST", ADMIN_INVITE_PATH, userContext, 500);
      return jsonResponse(500, { error: "invite_creation_failed" });
    }

    const { emailServiceUrl, portalBaseUrl } = ensureEmailServiceConfig();
    if (!emailServiceUrl) {
      console.error("ADMIN_INVITE_EMAIL_URL is not configured");
      logApiAccess("POST", ADMIN_INVITE_PATH, userContext, 500);
      return jsonResponse(500, { error: "email_service_unconfigured" });
    }

    if (!portalBaseUrl) {
      console.error("ADMIN_PORTAL_URL is not configured");
      logApiAccess("POST", ADMIN_INVITE_PATH, userContext, 500);
      return jsonResponse(500, { error: "portal_url_unconfigured" });
    }

    const inviteUrl = buildInviteUrl(portalBaseUrl, rawToken);

    const emailResult = await sendInviteEmail(emailServiceUrl, {
      to: normalizedEmail,
      inviteUrl,
      expiresAt: expiresAt.toISOString(),
      organizationId: targetOrganizationId,
      role: desiredRole,
    });

    const { error: actionError } = await adminClient.from("admin_actions").insert({
      admin_user_id: userContext.user.id,
      target_user_id: null,
      organization_id: targetOrganizationId,
      action_type: "admin_invite_sent",
      action_details: {
        email: normalizedEmail,
        expires_at: expiresAt.toISOString(),
        invite_id: insertedInvite.data.id,
        role: desiredRole,
        email_delivery_status: emailResult.status,
        ...(emailResult.error ? { email_error: emailResult.error } : {}),
      },
    });

    if (actionError) {
      console.warn("Failed to log admin invite action", actionError);
    }

    if (emailResult.status === "failed") {
      logApiAccess("POST", ADMIN_INVITE_PATH, userContext, 502);
      return jsonResponse(502, { error: "email_delivery_failed" });
    }

    logApiAccess("POST", ADMIN_INVITE_PATH, userContext, 201);
    return jsonResponse(201, {
      inviteId: insertedInvite.data.id,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (error) {
    console.error("Unexpected admin invite error", error);
    logApiAccess("POST", ADMIN_INVITE_PATH, userContext, 500);
    return jsonResponse(500, { error: "internal_server_error" });
  }
}

export const handler = createProtectedRoute(handleInvite, RouteOptions.admin);

export default handler;
