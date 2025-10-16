import { z } from "npm:zod@3.23.8";
import { SignJWT } from "npm:jose@5.8.0";
import {
  createProtectedRoute,
  corsHeaders,
  logApiAccess,
  RouteOptions,
} from "../_shared/auth-middleware.ts";
import { createRequestClient, supabaseAdmin } from "../_shared/database.ts";
import { getLogger } from "../_shared/logging.ts";

type JsonRecord = Record<string, unknown>;

const MAX_IMPERSONATION_MINUTES = 30;
const DEFAULT_IMPERSONATION_MINUTES = 15;

const issueSchema = z
  .object({
    action: z.literal("issue").optional(),
    targetUserId: z.string().uuid().optional(),
    targetUserEmail: z.string().email().optional(),
    expiresInMinutes: z
      .number({ invalid_type_error: "expiresInMinutes must be a number" })
      .int()
      .positive()
      .max(MAX_IMPERSONATION_MINUTES)
      .optional(),
    reason: z
      .string()
      .trim()
      .min(1, "Reason cannot be empty")
      .max(500, "Reason is too long")
      .optional(),
  })
  .refine(
    payload => Boolean(payload.targetUserId || payload.targetUserEmail),
    {
      message: "Either targetUserId or targetUserEmail must be provided",
      path: ["targetUserId"],
    },
  );

const revokeSchema = z.object({
  action: z.literal("revoke"),
  auditId: z.string().uuid(),
});

const resolveOrganizationId = (metadata: JsonRecord | null | undefined): string | null => {
  if (!metadata) return null;
  const candidate = ["organization_id", "organizationId"].reduce<string | null>((found, key) => {
    if (found) return found;
    const value = metadata[key];
    return typeof value === "string" && value.length > 0 ? value : null;
  }, null);

  if (!candidate) return null;

  try {
    return z.string().uuid().parse(candidate);
  } catch {
    return null;
  }
};

const sanitizeIpAddress = (value: string | null): string | null => {
  if (!value) return null;
  const trimmed = value.split(",")[0]?.trim() ?? "";
  if (!trimmed) return null;
  const ipv4Pattern = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
  const ipv6Pattern = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/;
  return ipv4Pattern.test(trimmed) || ipv6Pattern.test(trimmed) ? trimmed : null;
};

const toMinutesWithinRange = (value: number | undefined): number => {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return DEFAULT_IMPERSONATION_MINUTES;
  }
  const minimum = 1;
  return Math.max(minimum, Math.min(MAX_IMPERSONATION_MINUTES, value));
};

const buildErrorResponse = (status: number, message: string) =>
  new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const getJwtSecret = (): Uint8Array | null => {
  const secret = Deno.env.get("SUPABASE_JWT_SECRET");
  if (!secret) {
    return null;
  }
  return new TextEncoder().encode(secret);
};

const loadTargetUser = async (payload: { targetUserId?: string; targetUserEmail?: string }) => {
  if (payload.targetUserId) {
    const { data, error } = await supabaseAdmin.auth.admin.getUserById(payload.targetUserId);
    return { data, error };
  }

  if (payload.targetUserEmail) {
    const { data, error } = await supabaseAdmin.auth.admin.getUserByEmail(payload.targetUserEmail);
    return { data, error };
  }

  return { data: { user: null }, error: null };
};

export default createProtectedRoute(async (req, userContext) => {
  const logger = getLogger(req, {
    functionName: "super-admin-impersonate",
    userId: userContext.user.id,
  });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const jwtSecret = getJwtSecret();
  if (!jwtSecret) {
    return buildErrorResponse(500, "JWT secret not configured");
  }

  let rawPayload: unknown;
  try {
    rawPayload = await req.json();
  } catch (error) {
    console.error("Failed to parse impersonation payload", error);
    return buildErrorResponse(400, "Invalid JSON payload");
  }

  const payload = (rawPayload as JsonRecord) ?? {};
  const action = typeof payload.action === "string" ? payload.action : "issue";

  if (action === "revoke") {
    const parseResult = revokeSchema.safeParse(payload);
    if (!parseResult.success) {
      return buildErrorResponse(400, parseResult.error.issues[0]?.message ?? "Invalid revoke payload");
    }

    const requestClient = createRequestClient(req);
    const nowIso = new Date().toISOString();
    const { data, error } = await requestClient
      .from("impersonation_audit")
      .update({ revoked_at: nowIso, revoked_by: userContext.user.id })
      .eq("id", parseResult.data.auditId)
      .eq("actor_user_id", userContext.user.id)
      .is("revoked_at", null)
      .select("id, revoked_at")
      .single();

    if (error) {
      console.error("Failed to revoke impersonation token", error);
      return buildErrorResponse(400, "Unable to revoke impersonation token");
    }

    logApiAccess("POST", "/super-admin/impersonate", userContext, 200);
    return new Response(JSON.stringify({ revoked: true, auditId: data.id, revokedAt: data.revoked_at }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const parseResult = issueSchema.safeParse(payload);
  if (!parseResult.success) {
    return buildErrorResponse(400, parseResult.error.issues[0]?.message ?? "Invalid impersonation payload");
  }

  const requestClient = createRequestClient(req);

  const [{ data: actorData, error: actorError }, { data: targetData, error: targetError }] = await Promise.all([
    supabaseAdmin.auth.admin.getUserById(userContext.user.id),
    loadTargetUser(parseResult.data),
  ]);

  if (actorError || !actorData?.user) {
    console.error("Failed to load actor metadata", actorError);
    return buildErrorResponse(500, "Unable to resolve actor metadata");
  }

  if (targetError || !targetData?.user) {
    console.error("Failed to load target user", targetError);
    return buildErrorResponse(404, "Target user not found");
  }

  const actorMetadata = actorData.user.user_metadata as JsonRecord | undefined;
  const targetMetadata = targetData.user.user_metadata as JsonRecord | undefined;

  const actorOrganizationId = resolveOrganizationId(actorMetadata);
  const targetOrganizationId = resolveOrganizationId(targetMetadata);

  if (!actorOrganizationId) {
    return buildErrorResponse(403, "Actor is missing organization context");
  }

  if (!targetOrganizationId) {
    return buildErrorResponse(422, "Target user is missing organization context");
  }

  if (actorOrganizationId !== targetOrganizationId) {
    return buildErrorResponse(403, "Cross-organization impersonation is not permitted");
  }

  const expiresInMinutes = toMinutesWithinRange(parseResult.data.expiresInMinutes);
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + expiresInMinutes * 60_000);

  const tokenJti = crypto.randomUUID();
  const auditId = crypto.randomUUID();
  const reason = parseResult.data.reason ?? null;

  const sanitizedIp = sanitizeIpAddress(req.headers.get("x-forwarded-for"));
  const userAgent = req.headers.get("user-agent") ?? null;

  try {
    const jwt = await new SignJWT({
      sub: targetData.user.id,
      aud: "authenticated",
      role: targetMetadata?.role ?? "client",
      impersonation: {
        actor_user_id: userContext.user.id,
        audit_id: auditId,
        actor_role: userContext.profile.role,
      },
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(Math.floor(issuedAt.getTime() / 1000))
      .setExpirationTime(`${expiresInMinutes}m`)
      .setSubject(targetData.user.id)
      .setJti(tokenJti)
      .setIssuer("super-admin-impersonate")
      .sign(jwtSecret);

    // Persist audit BEFORE returning token; if persistence fails, abort
    const { data: insertedAudit, error: insertError } = await requestClient
      .from("impersonation_audit")
      .insert({
        id: auditId,
        actor_user_id: userContext.user.id,
        target_user_id: targetData.user.id,
        actor_organization_id: actorOrganizationId,
        target_organization_id: targetOrganizationId,
        token_jti: tokenJti,
        issued_at: issuedAt.toISOString(),
        expires_at: expiresAt.toISOString(),
        reason,
        actor_ip: sanitizedIp,
        actor_user_agent: userAgent,
      })
      .select("id, expires_at, token_jti")
      .single();

    if (insertError || !insertedAudit) {
      logger.error("audit_persist_failed", { error: insertError ?? "unknown" });
      return buildErrorResponse(500, "Unable to record impersonation audit");
    }

    // Enqueue revocation job for safety (processed by background worker/cron)
    const { error: queueError } = await requestClient.rpc("enqueue_impersonation_revocation", {
      p_audit_id: insertedAudit.id,
      p_token_jti: tokenJti,
    });
    if (queueError) {
      // Non-fatal; token still issued, but we log for ops visibility
      logger.warn("revocation_queue_enqueue_failed", { error: queueError });
    }

    logApiAccess("POST", "/super-admin/impersonate", userContext, 201);
    return new Response(
      JSON.stringify({
        token: jwt,
        expiresAt: expiresAt.toISOString(),
        auditId: insertedAudit.id,
        tokenJti: insertedAudit.token_jti,
        expiresInMinutes,
      }),
      {
        status: 201,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    logger.error("issue_error", { error: error instanceof Error ? error.message : String(error) });
    return buildErrorResponse(500, "Failed to create impersonation token");
  }
}, RouteOptions.superAdmin);
