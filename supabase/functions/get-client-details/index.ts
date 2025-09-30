import type { SupabaseClient } from "npm:@supabase/supabase-js@2.50.0";
import { createRequestClient } from "../_shared/database.ts";
import {
  createProtectedRoute,
  corsHeaders,
  logApiAccess,
  RouteOptions,
  type UserContext,
} from "../_shared/auth-middleware.ts";
import { getUserOrThrow } from "../_shared/auth.ts";

type RoleName = "therapist" | "admin" | "super_admin" | "client";

async function userHasRoleForOrg(
  db: SupabaseClient,
  role: RoleName,
  targets: {
    target_client_id?: string;
    target_organization_id?: string;
  },
): Promise<boolean> {
  const { data, error } = await db.rpc("user_has_role_for_org", {
    role_name: role,
    ...targets,
  });

  if (error) {
    console.error("Role check failed", error);
    throw new Response(
      JSON.stringify({ error: "Role validation failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  return Boolean(data);
}

interface HandlerOptions {
  req: Request;
  userContext: UserContext;
  db?: SupabaseClient;
}

async function selectClientForTherapist(
  db: SupabaseClient,
  clientId: string,
  therapistId: string,
) {
  return db
    .from("clients")
    .select(`
      *,
      sessions:sessions!inner (
        id,
        therapist_id
      )
    `)
    .eq("id", clientId)
    .eq("sessions.therapist_id", therapistId)
    .single();
}

async function selectClient(db: SupabaseClient, clientId: string) {
  return db
    .from("clients")
    .select("*")
    .eq("id", clientId)
    .single();
}

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(
    JSON.stringify(body),
    {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
}

export async function handleGetClientDetails({
  req,
  userContext,
  db: providedDb,
}: HandlerOptions): Promise<Response> {
  if (req.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  const db = providedDb ?? createRequestClient(req);

  await getUserOrThrow(db);

  const { clientId } = await req.json();

  if (!clientId) {
    return jsonResponse(400, { error: "Client ID is required" });
  }

  const isTherapist = userContext.profile.role === "therapist";
  const isClient = userContext.profile.role === "client";
  const isSuperAdmin = userContext.profile.role === "super_admin";
  const isAdmin = userContext.profile.role === "admin" || isSuperAdmin;

  try {
    let queryResult;

    if (isTherapist) {
      const hasAccess = await userHasRoleForOrg(db, "therapist", { target_client_id: clientId });
      if (!hasAccess) {
        logApiAccess("POST", "/get-client-details", userContext, 403);
        return jsonResponse(403, { error: "Access denied" });
      }

      queryResult = await selectClientForTherapist(db, clientId, userContext.user.id);
    } else if (isAdmin) {
      const roleToCheck: RoleName = isSuperAdmin ? "super_admin" : "admin";
      const hasAccess = await userHasRoleForOrg(db, roleToCheck, { target_client_id: clientId });
      if (!hasAccess) {
        logApiAccess("POST", "/get-client-details", userContext, 403);
        return jsonResponse(403, { error: "Access denied" });
      }

      queryResult = await selectClient(db, clientId);
    } else if (isClient) {
      if (userContext.user.id !== clientId) {
        logApiAccess("POST", "/get-client-details", userContext, 403);
        return jsonResponse(403, { error: "Access denied" });
      }

      const hasAccess = await userHasRoleForOrg(db, "client", { target_client_id: clientId });
      if (!hasAccess) {
        logApiAccess("POST", "/get-client-details", userContext, 403);
        return jsonResponse(403, { error: "Access denied" });
      }

      queryResult = await selectClient(db, clientId);
    } else {
      logApiAccess("POST", "/get-client-details", userContext, 403);
      return jsonResponse(403, { error: "Access denied" });
    }

    const { data, error } = queryResult;

    if (error) {
      console.error("Error fetching client details:", error);
      logApiAccess("POST", "/get-client-details", userContext, 500);
      return jsonResponse(500, { error: `Error fetching client: ${error.message}` });
    }

    if (!data) {
      logApiAccess("POST", "/get-client-details", userContext, 404);
      return jsonResponse(404, { error: "Client not found or access denied" });
    }

    const isArchived = Boolean((data as { deleted_at?: string | null }).deleted_at);
    if (isArchived && !isAdmin) {
      logApiAccess("POST", "/get-client-details", userContext, 404);
      return jsonResponse(404, { error: "Client not found or archived" });
    }

    logApiAccess("POST", "/get-client-details", userContext, 200);
    return jsonResponse(200, { client: data });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }

    console.error("Error fetching client details:", error);
    logApiAccess("POST", "/get-client-details", userContext, 500);
    return jsonResponse(500, { error: (error as Error).message || "Internal server error" });
  }
}

export const handler = createProtectedRoute(
  (req: Request, userContext) => handleGetClientDetails({ req, userContext }),
  RouteOptions.authenticated,
);

export default handler;
