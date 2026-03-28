import { z } from "npm:zod@3.23.8";
import { createRequestClient } from "../_shared/database.ts";
import { createProtectedRoute, RouteOptions } from "../_shared/auth-middleware.ts";
import { assertUserHasOrgRole, orgScopedQuery, requireOrg } from "../_shared/org.ts";

const goalSchema = z.object({
  client_id: z.string().uuid(),
  program_id: z.string().uuid(),
  title: z.string().trim().min(1),
  description: z.string().trim().min(1),
  target_behavior: z.string().optional(),
  measurement_type: z.string().optional(),
  original_text: z.string().trim().min(1),
  goal_type: z.enum(["child", "parent"]).optional(),
  clinical_context: z.string().optional(),
  baseline_data: z.string().optional(),
  target_criteria: z.string().optional(),
  mastery_criteria: z.string().optional(),
  maintenance_criteria: z.string().optional(),
  generalization_criteria: z.string().optional(),
  objective_data_points: z.array(z.record(z.unknown())).optional(),
  status: z.enum(["active", "paused", "mastered", "archived"]).optional(),
});

const goalUpdateSchema = goalSchema.partial().extend({
  client_id: z.string().uuid().optional(),
  program_id: z.string().uuid().optional(),
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const hasAllowedRole = async (orgId: string, userId: string, db: ReturnType<typeof createRequestClient>) => {
  const [isTherapist, isAdmin, isSuperAdmin] = await Promise.all([
    assertUserHasOrgRole(db, orgId, "therapist", { targetTherapistId: userId }),
    assertUserHasOrgRole(db, orgId, "admin"),
    assertUserHasOrgRole(db, orgId, "super_admin"),
  ]);
  return isTherapist || isAdmin || isSuperAdmin;
};

const loadProgram = async (db: ReturnType<typeof createRequestClient>, orgId: string, programId: string) => {
  const { data, error } = await orgScopedQuery(db, "programs", orgId)
    .select("id,client_id")
    .eq("id", programId)
    .limit(1);
  if (error || !data || data.length === 0) return null;
  return data[0] as { id: string; client_id: string };
};

export const handleGoals = async (req: Request) => {
  const db = createRequestClient(req);
  const orgId = await requireOrg(db);
  const { data: authData, error: authError } = await db.auth.getUser();
  if (authError || !authData?.user) {
    return json({ error: "Missing authorization token" }, 401);
  }
  const userId = authData.user.id;
  const allowed = await hasAllowedRole(orgId, userId, db);
  if (!allowed) return json({ error: "Forbidden" }, 403);

  if (req.method === "GET") {
    const url = new URL(req.url);
    const programId = url.searchParams.get("program_id");
    if (!programId) return json({ error: "program_id is required" }, 400);
    if (!z.string().uuid().safeParse(programId).success) return json({ error: "program_id must be a valid UUID" }, 400);

    const { data, error } = await orgScopedQuery(db, "goals", orgId)
      .select(
        "id,organization_id,client_id,program_id,title,description,target_behavior,measurement_type,original_text,goal_type,clinical_context,baseline_data,target_criteria,mastery_criteria,maintenance_criteria,generalization_criteria,objective_data_points,status,created_at,updated_at",
      )
      .eq("program_id", programId)
      .order("created_at", { ascending: false });
    if (error) return json([], 200);
    return json(data ?? []);
  }

  if (req.method === "POST") {
    let payload: unknown;
    try {
      payload = await req.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }
    const parsed = goalSchema.safeParse(payload);
    if (!parsed.success) return json({ error: "Invalid request body" }, 400);

    const program = await loadProgram(db, orgId, parsed.data.program_id);
    if (!program) return json({ error: "program_id is not in scope for this organization" }, 403);
    if (program.client_id !== parsed.data.client_id) return json({ error: "program_id does not belong to client_id" }, 400);

    const { data, error } = await db
      .from("goals")
      .insert([{ ...parsed.data, organization_id: orgId }])
      .select("*")
      .limit(1);
    if (error) return json({ error: "Failed to create goal" }, 500);
    return json(data?.[0] ?? null, 201);
  }

  if (req.method === "PATCH") {
    const url = new URL(req.url);
    const goalId = url.searchParams.get("goal_id");
    if (!goalId) return json({ error: "goal_id is required" }, 400);
    if (!z.string().uuid().safeParse(goalId).success) return json({ error: "goal_id must be a valid UUID" }, 400);

    let payload: unknown;
    try {
      payload = await req.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }
    const parsed = goalUpdateSchema.safeParse(payload);
    if (!parsed.success || Object.keys(parsed.data).length === 0) return json({ error: "Invalid request body" }, 400);

    if (parsed.data.program_id || parsed.data.client_id) {
      const { data: currentGoal, error: goalLookupError } = await orgScopedQuery(db, "goals", orgId)
        .select("id,client_id,program_id")
        .eq("id", goalId)
        .limit(1);
      if (goalLookupError || !currentGoal || currentGoal.length === 0) {
        return json({ error: "Goal not found in organization scope" }, 404);
      }
      const existing = currentGoal[0] as { id: string; client_id: string; program_id: string };
      const effectiveProgramId = parsed.data.program_id ?? existing.program_id;
      const effectiveClientId = parsed.data.client_id ?? existing.client_id;
      const program = await loadProgram(db, orgId, effectiveProgramId);
      if (!program) return json({ error: "program_id is not in scope for this organization" }, 403);
      if (program.client_id !== effectiveClientId) return json({ error: "program_id does not belong to client_id" }, 400);
    }

    const { data, error } = await orgScopedQuery(db, "goals", orgId)
      .update(parsed.data)
      .eq("id", goalId)
      .select("*")
      .limit(1);
    if (error) return json({ error: "Failed to update goal" }, 500);
    if (!data || data.length === 0) {
      return json({ error: "goal_id is not in scope for this organization" }, 403);
    }
    return json(data[0]);
  }

  return json({ error: "Method not allowed" }, 405);
};

export default createProtectedRoute((req) => handleGoals(req), RouteOptions.therapist);
