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
const INVITE_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const MAX_INVITES_PER_ADMIN_PER_WINDOW = 10;

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
  id: string | null;
  expires_at: string | null;
  status: "active_invite_exists" | "created" | "rate_limited" | string;
};

type InsertInviteResult = {
  data: InviteTokenRecord[] | null;
  error: { message?: string } | null;
};

const jsonResponse = (status: number, body: Record<string, unknown>, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, ...headers, "Content-Type": "application/json" },
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
    const rawToken = crypto.randomUUID().replace(/-/g, "");
    const tokenHash = await hashToken(rawToken);

    const insertedInvite = (await adminClient.rpc("create_admin_invite_token_rate_limited", {
      p_email: normalizedEmail,
      p_token_hash: tokenHash,
      p_organization_id: targetOrganizationId,
      p_expires_at: expiresAt.toISOString(),
      p_created_by: userContext.user.id,
      p_role: desiredRole,
    })) as InsertInviteResult;

    if (insertedInvite.error || !insertedInvite.data?.[0]) {
      console.error("Failed to insert invite token", { code: 'invite_insert_failed' });
      logApiAccess("POST", ADMIN_INVITE_PATH, userContext, 500);
      return jsonResponse(500, { error: "invite_creation_failed" });
    }

    const inviteResult = insertedInvite.data[0];
    if (inviteResult.status === "active_invite_exists") {
      logApiAccess("POST", ADMIN_INVITE_PATH, userContext, 409);
      return jsonResponse(409, { error: "active_invite_exists" });
    }

    if (inviteResult.status === "rate_limited") {
      logApiAccess("POST", ADMIN_INVITE_PATH, userContext, 429);
      return jsonResponse(
        429,
        {
          error: "invite_rate_limit_exceeded",
          retry_after_seconds: Math.ceil(INVITE_RATE_LIMIT_WINDOW_MS / 1000),
        },
        { "Retry-After": String(Math.ceil(INVITE_RATE_LIMIT_WINDOW_MS / 1000)) },
      );
    }

    if (inviteResult.status !== "created" || !inviteResult.id || !inviteResult.expires_at) {
      console.error("Unexpected invite RPC result", { code: 'invite_rpc_unexpected_status' });
      logApiAccess("POST", ADMIN_INVITE_PATH, userContext, 500);
      return jsonResponse(500, { error: "invite_creation_failed" });
    }

    const { emailServiceUrl, portalBaseUrl } = ensureEmailServiceConfig();
    if (!emailServiceUrl) {
      console.error("ADMIN_INVITE_EMAIL_URL is not configured", { code: 'invite_email_url_missing' });
      logApiAccess("POST", ADMIN_INVITE_PATH, userContext, 500);
      return jsonResponse(500, { error: "email_service_unconfigured" });
    }

    if (!portalBaseUrl) {
      console.error("ADMIN_PORTAL_URL is not configured", { code: 'portal_url_missing' });
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
        invite_id: inviteResult.id,
        role: desiredRole,
        email_delivery_status: emailResult.status,
        ...(emailResult.error ? { email_error: emailResult.error } : {}),
      },
    });

    if (actionError) {
      console.warn("Failed to log admin invite action", { code: 'admin_action_log_failed' });
    }

    if (emailResult.status === "failed") {
      logApiAccess("POST", ADMIN_INVITE_PATH, userContext, 502);
      return jsonResponse(502, { error: "email_delivery_failed" });
    }

    logApiAccess("POST", ADMIN_INVITE_PATH, userContext, 201);
    return jsonResponse(201, {
      inviteId: inviteResult.id,
      expiresAt: inviteResult.expires_at,
    });
  } catch (error) {
    console.error("Unexpected admin invite error", { code: 'unexpected_invite_error' });
    logApiAccess("POST", ADMIN_INVITE_PATH, userContext, 500);
    return jsonResponse(500, { error: "internal_server_error" });
  }
}

export const handler = createProtectedRoute(handleInvite, RouteOptions.admin);

export default handler;
