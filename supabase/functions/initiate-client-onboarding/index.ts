import { z } from "zod";
import {
  createProtectedRoute,
  corsHeadersForRequest,
  logApiAccess,
  RouteOptions,
  tokenResponseCacheHeaders,
  type Role,
} from "../_shared/auth-middleware.ts";
import { createRequestClient, supabaseAdmin } from "../_shared/database.ts";
import { getUserOrThrow } from "../_shared/auth.ts";
import { assertUserHasOrgRole, requireOrg } from "../_shared/org.ts";
import { errorEnvelope, getRequestId, rateLimit } from "../lib/http/error.ts";

const PREFILL_TOKEN_TTL_MINUTES = 15;
const ALLOWED_SERVICE_PREFERENCES = new Set([
  "In clinic",
  "In home",
  "Telehealth",
  "School / Daycare / Preschool",
]);

const OnboardingSchema = z.object({
  client_name: z.string().trim().min(1).max(200),
  client_email: z.string().trim().email().max(320),
  date_of_birth: z.string().trim().optional(),
  insurance_provider: z.string().trim().max(200).optional(),
  referral_source: z.string().trim().max(200).optional(),
  service_preference: z.array(z.string().trim().min(1).max(100)).max(25).optional(),
});

const ConsumePrefillSchema = z.object({
  prefill_token: z.string().trim().uuid(),
});

type StoredPrefillPayload = {
  first_name: string;
  last_name: string;
  email: string;
  date_of_birth?: string;
  insurance_provider?: string;
  referral_source?: string;
  service_preference?: string[];
};

const parseClientName = (rawName: string) => {
  const normalized = rawName.trim().replace(/\s+/g, " ");
  const [firstName, ...rest] = normalized.split(" ");
  return {
    firstName,
    lastName: rest.join(" "),
  };
};

const sanitizeServicePreference = (values: string[] | undefined) => (
  values
    ? values
      .map((value) => value.trim())
      .filter((value) => value.length > 0 && ALLOWED_SERVICE_PREFERENCES.has(value))
    : []
);

const hashPrefillToken = async (prefillToken: string): Promise<string> => {
  const encoded = new TextEncoder().encode(prefillToken);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  const bytes = new Uint8Array(digest);
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

const resolveConsumeRole = (role: Role): Role | null => {
  switch (role) {
    case "super_admin":
      return "super_admin";
    case "admin":
      return "admin";
    case "therapist":
      return "therapist";
    case "client":
      return null;
    default: {
      const unreachableRole: never = role;
      console.warn("Unsupported role for onboarding consume", { role: unreachableRole });
      return null;
    }
  }
};

export const __TESTING__ = {
  parseClientName,
  sanitizeServicePreference,
  hashPrefillToken,
  resolveConsumeRole,
};

const handler = createProtectedRoute(async (req: Request, userContext) => {
  if (req.method !== "POST") {
    return errorEnvelope({ requestId: getRequestId(req), code: "method_not_allowed", message: "Method not allowed", status: 405 });
  }

  const requestId = getRequestId(req);
  const responseHeaders = corsHeadersForRequest(req);
  const jsonHeaders = { ...responseHeaders, ...tokenResponseCacheHeaders, "Content-Type": "application/json" };
  try {
    const db = createRequestClient(req);
    await getUserOrThrow(db);

    const orgId = await requireOrg(db);
    const payload = await req.json();

    const consumeParsed = ConsumePrefillSchema.safeParse(payload);
    if (consumeParsed.success) {
      const roleToCheck = resolveConsumeRole(userContext.profile.role);
      if (!roleToCheck) {
        logApiAccess("POST", "/initiate-client-onboarding", userContext, 403);
        return errorEnvelope({ requestId, code: "forbidden", message: "Access denied", status: 403, headers: responseHeaders });
      }

      const ip = req.headers.get("x-forwarded-for") || "unknown";
      const consumeLimiter = rateLimit(`onboarding-consume:${orgId}:${ip}`, 45, 60_000);
      if (!consumeLimiter.allowed) {
        return errorEnvelope({
          requestId,
          code: "rate_limited",
          message: "Too many requests",
          status: 429,
          headers: { ...responseHeaders, "Retry-After": String(consumeLimiter.retryAfter ?? 60) },
        });
      }

      const hasConsumeAccess = await assertUserHasOrgRole(db, orgId, roleToCheck, {});
      if (!hasConsumeAccess) {
        logApiAccess("POST", "/initiate-client-onboarding", userContext, 403);
        return errorEnvelope({ requestId, code: "forbidden", message: "Access denied", status: 403, headers: responseHeaders });
      }

      const tokenHash = await hashPrefillToken(consumeParsed.data.prefill_token);
      const nowIso = new Date().toISOString();
      const { data: consumedPrefill, error: consumeError } = await supabaseAdmin
        .from("client_onboarding_prefills")
        .update({
          consumed_at: nowIso,
          consumed_by_user_id: userContext.user.id,
        })
        .eq("token_hash", tokenHash)
        .eq("organization_id", orgId)
        .is("consumed_at", null)
        .gt("expires_at", nowIso)
        .select("payload")
        .maybeSingle<{ payload: StoredPrefillPayload }>();

      if (consumeError) {
        console.error("Failed to consume onboarding prefill token", { requestId, error: consumeError.message });
        return errorEnvelope({
          requestId,
          code: "internal_error",
          message: "Unable to load onboarding prefill",
          status: 500,
          headers: responseHeaders,
        });
      }

      if (!consumedPrefill?.payload) {
        return errorEnvelope({
          requestId,
          code: "prefill_not_found",
          message: "Prefill token is invalid, expired, or already used",
          status: 404,
          headers: responseHeaders,
        });
      }

      logApiAccess("POST", "/initiate-client-onboarding", userContext, 200);
      return new Response(
        JSON.stringify({
          success: true,
          prefill: consumedPrefill.payload,
          requestId,
        }),
        {
          headers: jsonHeaders,
        },
      );
    }

    const parsed = OnboardingSchema.safeParse(payload);
    if (!parsed.success) {
      return errorEnvelope({ requestId, code: "invalid_body", message: "Invalid request body", status: 400, headers: responseHeaders });
    }

    const roleToCheck = userContext.profile.role === "super_admin" ? "super_admin" : "admin";
    const hasAccess = await assertUserHasOrgRole(db, orgId, roleToCheck, {});
    if (!hasAccess) {
      logApiAccess("POST", "/initiate-client-onboarding", userContext, 403);
      return errorEnvelope({ requestId, code: "forbidden", message: "Access denied", status: 403, headers: responseHeaders });
    }

    const ip = req.headers.get("x-forwarded-for") || "unknown";
    const limiter = rateLimit(`onboarding:${orgId}:${ip}`, 30, 60_000);
    if (!limiter.allowed) {
      return errorEnvelope({
        requestId,
        code: "rate_limited",
        message: "Too many requests",
        status: 429,
        headers: { ...responseHeaders, "Retry-After": String(limiter.retryAfter ?? 60) },
      });
    }

    const {
      client_name,
      client_email,
      date_of_birth,
      insurance_provider,
      referral_source,
      service_preference,
    } = parsed.data;

    const { firstName, lastName } = parseClientName(client_name);
    const cleanedServicePreference = sanitizeServicePreference(service_preference);

    const prefillPayload: StoredPrefillPayload = {
      first_name: firstName,
      last_name: lastName,
      email: client_email,
    };

    if (date_of_birth) {
      prefillPayload.date_of_birth = date_of_birth;
    }
    if (insurance_provider) {
      prefillPayload.insurance_provider = insurance_provider;
    }
    if (referral_source) {
      prefillPayload.referral_source = referral_source;
    }
    if (cleanedServicePreference.length > 0) {
      prefillPayload.service_preference = cleanedServicePreference;
    }

    const prefillToken = crypto.randomUUID();
    const prefillTokenHash = await hashPrefillToken(prefillToken);
    const expiresAt = new Date(Date.now() + PREFILL_TOKEN_TTL_MINUTES * 60_000).toISOString();

    const { error: prefillError } = await supabaseAdmin
      .from("client_onboarding_prefills")
      .insert({
        organization_id: orgId,
        created_by_user_id: userContext.user.id,
        token_hash: prefillTokenHash,
        payload: prefillPayload,
        expires_at: expiresAt,
      });
    if (prefillError) {
      console.error("Failed to store onboarding prefill payload", { requestId, error: prefillError.message });
      return errorEnvelope({
        requestId,
        code: "internal_error",
        message: "Unable to initiate onboarding",
        status: 500,
        headers: responseHeaders,
      });
    }

    const onboardingUrl = `/clients/new?prefill_token=${encodeURIComponent(prefillToken)}`;

    const { error: auditError } = await supabaseAdmin.from("admin_actions").insert({
      admin_user_id: userContext.user.id,
      target_user_id: null,
      organization_id: orgId,
      action_type: "client_onboarding_link_created",
      action_details: {
        has_client_email: true,
        has_last_name: Boolean(lastName),
        has_referral_source: Boolean(referral_source),
        prefill_ttl_minutes: PREFILL_TOKEN_TTL_MINUTES,
        service_preference: cleanedServicePreference,
      },
    });
    if (auditError) {
      console.warn("Failed to log onboarding action", { requestId, error: auditError.message });
    }

    logApiAccess("POST", "/initiate-client-onboarding", userContext, 200);
    return new Response(
      JSON.stringify({
        success: true,
        onboardingUrl,
        expiresAt,
        message: "Client onboarding initiated successfully",
        requestId,
      }),
      {
        headers: jsonHeaders,
      },
    );
  } catch (error) {
    const status = typeof (error as { status?: number }).status === "number"
      ? (error as { status: number }).status
      : 500;
    const code = status === 403 ? "forbidden" : "internal_error";
    const message = status === 403 ? "Access denied" : "Unexpected error";
    console.error("Error initiating client onboarding:", error);
    logApiAccess("POST", "/initiate-client-onboarding", userContext, status);
    return errorEnvelope({ requestId, code, message, status, headers: responseHeaders });
  }
}, RouteOptions.therapist);

Deno.serve(handler);

export default handler;
