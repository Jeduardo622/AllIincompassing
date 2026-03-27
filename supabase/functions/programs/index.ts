import { z } from "npm:zod@3.23.8";
import { createRequestClient } from "../_shared/database.ts";
import { corsHeadersForRequest, createProtectedRoute, RouteOptions } from "../_shared/auth-middleware.ts";
import { assertUserHasOrgRole, orgScopedQuery, requireOrg } from "../_shared/org.ts";

const programSchema = z.object({
  client_id: z.string().uuid(),
  name: z.string().trim().min(1),
  description: z.string().trim().optional(),
  status: z.enum(["active", "inactive", "archived"]).optional(),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
});

const programUpdateSchema = programSchema.partial().extend({
  client_id: z.string().uuid().optional(),
});

const json = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeadersForRequest(req),
      "Content-Type": "application/json",
    },
  });

const hasAllowedRole = async (orgId: string, userId: string, db: ReturnType<typeof createRequestClient>) => {
  const [isTherapist, isAdmin, isSuperAdmin] = await Promise.all([
    assertUserHasOrgRole(db, orgId, "therapist", { targetTherapistId: userId }),
    assertUserHasOrgRole(db, orgId, "admin"),
    assertUserHasOrgRole(db, orgId, "super_admin"),
  ]);
  return isTherapist || isAdmin || isSuperAdmin;
};

export const handlePrograms = async (req: Request) => {
  const db = createRequestClient(req);
  const orgId = await requireOrg(db);
  const { data: authData, error: authError } = await db.auth.getUser();
  if (authError || !authData?.user) {
    return json(req, { error: "Missing authorization token" }, 401);
  }
  const userId = authData.user.id;

  const allowed = await hasAllowedRole(orgId, userId, db);
  if (!allowed) {
    return json(req, { error: "Forbidden" }, 403);
  }

  if (req.method === "GET") {
    const url = new URL(req.url);
    const clientId = url.searchParams.get("client_id");
    if (!clientId) return json(req, { error: "client_id is required" }, 400);
    if (!z.string().uuid().safeParse(clientId).success) return json(req, { error: "client_id must be a valid UUID" }, 400);

    const { data, error } = await orgScopedQuery(db, "programs", orgId)
      .select("id,organization_id,client_id,name,description,status,start_date,end_date,created_at,updated_at")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false });
    if (error) return json(req, { error: "Failed to load programs" }, 500);
    return json(req, data ?? []);
  }

  if (req.method === "POST") {
    let payload: unknown;
    try {
      payload = await req.json();
    } catch {
      return json(req, { error: "Invalid JSON body" }, 400);
    }
    const parsed = programSchema.safeParse(payload);
    if (!parsed.success) return json(req, { error: "Invalid request body" }, 400);

    const { data: clients, error: clientError } = await orgScopedQuery(db, "clients", orgId)
      .select("id")
      .eq("id", parsed.data.client_id)
      .limit(1);
    if (clientError || !clients || clients.length === 0) {
      return json(req, { error: "client_id is not in scope for this organization" }, 403);
    }

    const { data, error } = await db
      .from("programs")
      .insert([{ ...parsed.data, organization_id: orgId }])
      .select("*")
      .limit(1);
    if (error) return json(req, { error: "Failed to create program" }, 500);
    return json(req, data?.[0] ?? null, 201);
  }

  if (req.method === "PATCH") {
    const url = new URL(req.url);
    const programId = url.searchParams.get("program_id");
    if (!programId) return json(req, { error: "program_id is required" }, 400);
    if (!z.string().uuid().safeParse(programId).success) return json(req, { error: "program_id must be a valid UUID" }, 400);

    let payload: unknown;
    try {
      payload = await req.json();
    } catch {
      return json(req, { error: "Invalid JSON body" }, 400);
    }
    const parsed = programUpdateSchema.safeParse(payload);
    if (!parsed.success || Object.keys(parsed.data).length === 0) return json(req, { error: "Invalid request body" }, 400);

    if (parsed.data.client_id) {
      const { data: clients, error: clientError } = await orgScopedQuery(db, "clients", orgId)
        .select("id")
        .eq("id", parsed.data.client_id)
        .limit(1);
      if (clientError || !clients || clients.length === 0) {
        return json(req, { error: "client_id is not in scope for this organization" }, 403);
      }
    }

    const { data, error } = await orgScopedQuery(db, "programs", orgId)
      .update(parsed.data)
      .eq("id", programId)
      .select("*")
      .limit(1);
    if (error) return json(req, { error: "Failed to update program" }, 500);
    if (!data || data.length === 0) {
      return json(req, { error: "program_id is not in scope for this organization" }, 403);
    }
    return json(req, data[0]);
  }

  return json(req, { error: "Method not allowed" }, 405);
};

export default createProtectedRoute((req) => handlePrograms(req), RouteOptions.therapist);
