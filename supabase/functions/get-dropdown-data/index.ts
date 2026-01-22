import { z } from "zod";
import { createProtectedRoute, corsHeaders, logApiAccess, RouteOptions } from "../_shared/auth-middleware.ts";
import { createRequestClient, supabaseAdmin } from "../_shared/database.ts";
import { getUserOrThrow } from "../_shared/auth.ts";
import { assertUserHasOrgRole, orgScopedQuery, requireOrg } from "../_shared/org.ts";
import { errorEnvelope, getRequestId, rateLimit } from "../lib/http/error.ts";

interface DropdownData {
  therapists: Array<{ id: string; full_name: string; email: string; status: string; specialties?: string[] }>;
  clients: Array<{ id: string; full_name: string; email: string; status: string }>;
  locations: Array<{ id: string; name: string; type: string }>;
  serviceTypes: Array<{ id: string; name: string; description: string }>;
  sessionStatuses: Array<{ value: string; label: string; color: string }>;
  authorizationStatuses: Array<{ value: string; label: string; color: string }>;
}

const DataTypeSchema = z.enum([
  "therapists",
  "clients",
  "locations",
  "serviceTypes",
  "sessionStatuses",
  "authorizationStatuses",
  "all",
]);

const parseDataTypes = (raw: string | null) => {
  if (!raw) return ["all"] as const;
  const parsed = raw.split(",").map((entry) => entry.trim()).filter(Boolean);
  return parsed.length > 0 ? parsed : ["all"];
};

const fetchDropdownData = async (
  db: ReturnType<typeof createRequestClient>,
  orgId: string,
  includeInactive: boolean,
  dataTypes: string[],
): Promise<Partial<DropdownData>> => {
  const dropdownData: Partial<DropdownData> = {};

  if (dataTypes.includes("therapists") || dataTypes.includes("all")) {
    let therapistQuery = orgScopedQuery(db, "therapists", orgId)
      .select("id, full_name, email, status, specialties")
      .is("deleted_at", null);
    if (!includeInactive) therapistQuery = therapistQuery.eq("status", "active");
    const { data: therapists, error: therapistError } = await therapistQuery.order("full_name");
    if (therapistError) throw therapistError;
    dropdownData.therapists = therapists || [];
  }

  if (dataTypes.includes("clients") || dataTypes.includes("all")) {
    let clientQuery = orgScopedQuery(db, "clients", orgId)
      .select("id, full_name, email, status")
      .is("deleted_at", null);
    if (!includeInactive) clientQuery = clientQuery.eq("status", "active");
    const { data: clients, error: clientError } = await clientQuery.order("full_name");
    if (clientError) throw clientError;
    dropdownData.clients = clients || [];
  }

  if (dataTypes.includes("locations") || dataTypes.includes("all")) {
    dropdownData.locations = [
      { id: "clinic", name: "In Clinic", type: "physical" },
      { id: "home", name: "In Home", type: "physical" },
      { id: "telehealth", name: "Telehealth", type: "virtual" },
      { id: "community", name: "Community", type: "physical" },
      { id: "school", name: "School", type: "physical" },
    ];
  }

  if (dataTypes.includes("serviceTypes") || dataTypes.includes("all")) {
    dropdownData.serviceTypes = [
      { id: "individual_therapy", name: "Individual Therapy", description: "One-on-one therapy session" },
      { id: "group_therapy", name: "Group Therapy", description: "Group therapy session" },
      { id: "family_therapy", name: "Family Therapy", description: "Family therapy session" },
      { id: "consultation", name: "Consultation", description: "Consultation meeting" },
      { id: "assessment", name: "Assessment", description: "Initial or ongoing assessment" },
      { id: "training", name: "Training", description: "Skills training session" },
    ];
  }

  if (dataTypes.includes("sessionStatuses") || dataTypes.includes("all")) {
    dropdownData.sessionStatuses = [
      { value: "scheduled", label: "Scheduled", color: "blue" },
      { value: "in_progress", label: "In Progress", color: "yellow" },
      { value: "completed", label: "Completed", color: "green" },
      { value: "cancelled", label: "Cancelled", color: "red" },
      { value: "no_show", label: "No Show", color: "orange" },
      { value: "rescheduled", label: "Rescheduled", color: "purple" },
    ];
  }

  if (dataTypes.includes("authorizationStatuses") || dataTypes.includes("all")) {
    dropdownData.authorizationStatuses = [
      { value: "pending", label: "Pending", color: "yellow" },
      { value: "approved", label: "Approved", color: "green" },
      { value: "denied", label: "Denied", color: "red" },
      { value: "expired", label: "Expired", color: "gray" },
      { value: "cancelled", label: "Cancelled", color: "red" },
    ];
  }

  return dropdownData;
};

export const __TESTING__ = {
  fetchDropdownData,
  parseDataTypes,
};

const handler = createProtectedRoute(async (req: Request, userContext) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const requestId = getRequestId(req);
  try {
    const db = createRequestClient(req);
    await getUserOrThrow(db);

    const orgId = await requireOrg(db);
    const roleToCheck = userContext.profile.role === "super_admin" ? "super_admin" : userContext.profile.role === "admin" ? "admin" : "therapist";
    const hasAccess = await assertUserHasOrgRole(db, orgId, roleToCheck);
    if (!hasAccess) {
      logApiAccess("GET", "/get-dropdown-data", userContext, 403);
      return errorEnvelope({ requestId, code: "forbidden", message: "Access denied", status: 403 });
    }

    const ip = req.headers.get("x-forwarded-for") || "unknown";
    const limiter = rateLimit(`dropdown:${orgId}:${ip}`, 120, 60_000);
    if (!limiter.allowed) {
      return errorEnvelope({
        requestId,
        code: "rate_limited",
        message: "Too many requests",
        status: 429,
        headers: { "Retry-After": String(limiter.retryAfter ?? 60) },
      });
    }

    const url = new URL(req.url);
    const includeInactive = url.searchParams.get("include_inactive") === "true";
    const rawTypes = parseDataTypes(url.searchParams.get("types"));
    const parsedTypes = z.array(DataTypeSchema).safeParse(rawTypes);
    if (!parsedTypes.success) {
      return errorEnvelope({ requestId, code: "invalid_query", message: "Invalid types filter", status: 400 });
    }

    const dropdownData = await fetchDropdownData(db, orgId, includeInactive, parsedTypes.data);

    if (userContext.profile.role === "admin" || userContext.profile.role === "super_admin") {
      const { error: auditError } = await supabaseAdmin.from("admin_actions").insert({
        admin_user_id: userContext.user.id,
        target_user_id: null,
        organization_id: orgId,
        action_type: "dropdown_data_accessed",
        action_details: {
          types: parsedTypes.data,
          include_inactive: includeInactive,
        },
      });
      if (auditError) {
        console.warn("Failed to log dropdown audit event", { requestId, error: auditError.message });
      }
    }

    logApiAccess("GET", "/get-dropdown-data", userContext, 200);
    return new Response(
      JSON.stringify({
        success: true,
        data: dropdownData,
        cached: false,
        lastUpdated: new Date().toISOString(),
        requestId,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    const status = typeof (error as { status?: number }).status === "number"
      ? (error as { status: number }).status
      : 500;
    const code = status === 403 ? "forbidden" : "internal_error";
    const message = status === 403 ? "Access denied" : "Unexpected error";
    console.error("Dropdown data error:", error);
    logApiAccess("GET", "/get-dropdown-data", userContext, status);
    return errorEnvelope({ requestId, code, message, status });
  }
}, RouteOptions.therapist);

Deno.serve(handler);

export default handler;
