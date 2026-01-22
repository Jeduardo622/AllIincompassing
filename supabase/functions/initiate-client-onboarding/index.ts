import { z } from "zod";
import { createProtectedRoute, corsHeaders, logApiAccess, RouteOptions } from "../_shared/auth-middleware.ts";
import { createRequestClient, supabaseAdmin } from "../_shared/database.ts";
import { getUserOrThrow } from "../_shared/auth.ts";
import { assertUserHasOrgRole, requireOrg } from "../_shared/org.ts";
import { errorEnvelope, getRequestId, rateLimit } from "../lib/http/error.ts";

const OnboardingSchema = z.object({
  client_name: z.string().trim().min(1).max(200),
  client_email: z.string().trim().email().max(320),
  date_of_birth: z.string().trim().optional(),
  insurance_provider: z.string().trim().max(200).optional(),
  referral_source: z.string().trim().max(200).optional(),
  service_preference: z.array(z.string().trim().min(1).max(100)).max(25).optional(),
});

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
    ? values.map((value) => value.trim()).filter((value) => value.length > 0)
    : []
);

export const __TESTING__ = {
  parseClientName,
  sanitizeServicePreference,
};

const handler = createProtectedRoute(async (req: Request, userContext) => {
  if (req.method !== "POST") {
    return errorEnvelope({ requestId: getRequestId(req), code: "method_not_allowed", message: "Method not allowed", status: 405 });
  }

  const requestId = getRequestId(req);
  try {
    const db = createRequestClient(req);
    await getUserOrThrow(db);

    const orgId = await requireOrg(db);
    const roleToCheck = userContext.profile.role === "super_admin" ? "super_admin" : "admin";
    const hasAccess = await assertUserHasOrgRole(db, orgId, roleToCheck, {});
    if (!hasAccess) {
      logApiAccess("POST", "/initiate-client-onboarding", userContext, 403);
      return errorEnvelope({ requestId, code: "forbidden", message: "Access denied", status: 403 });
    }

    const ip = req.headers.get("x-forwarded-for") || "unknown";
    const limiter = rateLimit(`onboarding:${orgId}:${ip}`, 30, 60_000);
    if (!limiter.allowed) {
      return errorEnvelope({
        requestId,
        code: "rate_limited",
        message: "Too many requests",
        status: 429,
        headers: { "Retry-After": String(limiter.retryAfter ?? 60) },
      });
    }

    const payload = await req.json();
    const parsed = OnboardingSchema.safeParse(payload);
    if (!parsed.success) {
      return errorEnvelope({ requestId, code: "invalid_body", message: "Invalid request body", status: 400 });
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

    const queryParams = new URLSearchParams();
    queryParams.append("first_name", firstName);
    queryParams.append("last_name", lastName);
    queryParams.append("email", client_email);

    if (date_of_birth) {
      queryParams.append("date_of_birth", date_of_birth);
    }
    if (insurance_provider) {
      queryParams.append("insurance_provider", insurance_provider);
    }
    if (referral_source) {
      queryParams.append("referral_source", referral_source);
    }
    if (cleanedServicePreference.length > 0) {
      queryParams.append("service_preference", cleanedServicePreference.join(","));
    }

    const onboardingUrl = `/clients/new?${queryParams.toString()}`;

    const { error: auditError } = await supabaseAdmin.from("admin_actions").insert({
      admin_user_id: userContext.user.id,
      target_user_id: null,
      organization_id: orgId,
      action_type: "client_onboarding_link_created",
      action_details: {
        client_email,
        has_last_name: Boolean(lastName),
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
        message: "Client onboarding initiated successfully",
        requestId,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
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
    return errorEnvelope({ requestId, code, message, status });
  }
}, RouteOptions.admin);

Deno.serve(handler);

export default handler;
