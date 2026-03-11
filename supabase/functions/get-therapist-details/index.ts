import { resolveAllowedOrigin } from "../_shared/cors.ts";
const corsHeaders = { "Access-Control-Allow-Origin": resolveAllowedOrigin(), "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
import { createRequestClient } from "../_shared/database.ts";
import { createProtectedRoute, RouteOptions } from "../_shared/auth-middleware.ts";
import { errorEnvelope, getRequestId } from "../lib/http/error.ts";

export default createProtectedRoute(async (req, userContext) => {
  const requestId = getRequestId(req);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") {
    return errorEnvelope({
      requestId,
      code: "validation_error",
      message: "Method not allowed",
      status: 405,
      headers: corsHeaders,
    });
  }

  try {
    const db = createRequestClient(req);

    const { therapistId } = await req.json();
    if (!therapistId) {
      return errorEnvelope({
        requestId,
        code: "validation_error",
        message: "Therapist ID is required",
        headers: corsHeaders,
      });
    }

    const isTherapist = userContext.profile.role === "therapist";
    const isAdmin = userContext.profile.role === "admin" || userContext.profile.role === "super_admin";

    if (isTherapist && userContext.user.id !== therapistId) {
      return errorEnvelope({
        requestId,
        code: "forbidden",
        message: "Access denied",
        headers: corsHeaders,
      });
    }

    if (!isAdmin && !isTherapist) {
      return errorEnvelope({
        requestId,
        code: "forbidden",
        message: "Access denied",
        headers: corsHeaders,
      });
    }

    const { data, error } = await db.from("therapists").select("*").eq("id", therapistId).single();
    if (error) {
      return errorEnvelope({
        requestId,
        code: "not_found",
        message: `Error fetching therapist: ${error.message}`,
        status: 404,
        headers: corsHeaders,
      });
    }

    return new Response(JSON.stringify({ therapist: data }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("Error fetching therapist details:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return errorEnvelope({
      requestId,
      code: "internal_error",
      message,
      headers: corsHeaders,
    });
  }
}, RouteOptions.authenticated);
