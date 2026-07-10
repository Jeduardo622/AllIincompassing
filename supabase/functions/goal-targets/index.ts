import { z } from "npm:zod@3.23.8";
import { createRequestClient } from "../_shared/database.ts";
import { corsHeadersForRequest } from "../_shared/cors.ts";
import { createProtectedRoute, RouteOptions } from "../_shared/auth-middleware.ts";

const measurementTypeSchema = z.enum([
  "correctIncorrect",
  "frequency",
  "rate",
  "duration",
  "timeSample",
  "taskAnalysis",
  "latency",
  "IRT",
]);

const targetStatusSchema = z.enum(["draft", "active", "mastered", "archived"]);

const createGoalTargetSchema = z.object({
  goal_id: z.string().uuid(),
  name: z.string().trim().min(1),
  measurement_type: measurementTypeSchema,
  graph_config: z.record(z.unknown()).optional(),
  status: targetStatusSchema.optional(),
  sort_order: z.number().int().optional(),
});

const updateGoalTargetSchema = createGoalTargetSchema
  .omit({ goal_id: true })
  .partial()
  .refine((value) => Object.keys(value).length > 0, "At least one field is required");

const json = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeadersForRequest(req),
      "Content-Type": "application/json",
    },
  });

const isUuid = (value: string): boolean => z.string().uuid().safeParse(value).success;

type CapabilityResult = { allowed: boolean; upstreamError: boolean };

const requireOrg = async (db: ReturnType<typeof createRequestClient>): Promise<string | null> => {
  const { data, error } = await db.rpc("current_user_organization_id");
  if (error || typeof data !== "string" || data.length === 0) {
    return null;
  }
  return data;
};

const currentUserCanManageProgramsGoals = async (
  db: ReturnType<typeof createRequestClient>,
  orgId: string,
): Promise<CapabilityResult> => {
  const { data, error } = await db.rpc("current_user_can_manage_programs_goals", {
    target_organization_id: orgId,
  });
  if (error) {
    console.error("current_user_can_manage_programs_goals rpc error", error);
    return { allowed: false, upstreamError: true };
  }
  return { allowed: data === true, upstreamError: false };
};

const currentUserCanDeleteGoalTargets = async (
  db: ReturnType<typeof createRequestClient>,
  orgId: string,
): Promise<CapabilityResult> => {
  const { data, error } = await db.rpc("current_user_can_delete_goal_targets", {
    target_organization_id: orgId,
  });
  if (error) {
    console.error("current_user_can_delete_goal_targets rpc error", error);
    return { allowed: false, upstreamError: true };
  }
  return { allowed: data === true, upstreamError: false };
};

const loadGoalScope = async (
  db: ReturnType<typeof createRequestClient>,
  orgId: string,
  goalId: string,
): Promise<{ id: string; client_id: string } | null> => {
  const { data, error } = await db
    .from("goals")
    .select("id,client_id")
    .eq("organization_id", orgId)
    .eq("id", goalId)
    .limit(1);
  if (error || !data || data.length === 0) {
    return null;
  }
  return data[0] as unknown as { id: string; client_id: string };
};

export const handleGoalTargets = async (req: Request) => {
  const db = createRequestClient(req);
  const orgId = await requireOrg(db);
  if (!orgId) {
    return json(req, { error: "Forbidden" }, 403);
  }

  const { data: authData, error: authError } = await db.auth.getUser();
  if (authError || !authData?.user) {
    return json(req, { error: "Missing authorization token" }, 401);
  }

  if (req.method === "GET") {
    const url = new URL(req.url);
    const goalId = url.searchParams.get("goal_id");
    const targetId = url.searchParams.get("target_id");
    if (!goalId && !targetId) return json(req, { error: "goal_id or target_id is required" }, 400);
    if (goalId && !isUuid(goalId)) return json(req, { error: "goal_id must be a valid UUID" }, 400);
    if (targetId && !isUuid(targetId)) return json(req, { error: "target_id must be a valid UUID" }, 400);

    let query = db
      .from("goal_targets")
      .select("*")
      .eq("organization_id", orgId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (goalId) query = query.eq("goal_id", goalId);
    if (targetId) query = query.eq("id", targetId);

    const { data, error } = await query;
    if (error) return json(req, { error: "Failed to load goal targets" }, 500);
    return json(req, data ?? []);
  }

  if (req.method === "DELETE") {
    const url = new URL(req.url);
    const targetId = url.searchParams.get("target_id");
    if (!targetId) return json(req, { error: "target_id is required" }, 400);
    if (!isUuid(targetId)) return json(req, { error: "target_id must be a valid UUID" }, 400);

    const canDelete = await currentUserCanDeleteGoalTargets(db, orgId);
    if (canDelete.upstreamError) return json(req, { error: "Unable to validate goal-target delete access" }, 502);
    if (!canDelete.allowed) return json(req, { error: "Forbidden" }, 403);

    const { data: targets, error: targetError } = await db
      .from("goal_targets")
      .select("id,status")
      .eq("organization_id", orgId)
      .eq("id", targetId)
      .limit(1);
    if (targetError) return json(req, { error: "Failed to load goal target" }, 502);
    const target = targets?.[0] as { id: string; status: string } | undefined;
    if (!target) return json(req, { error: "Goal target not found" }, 404);
    if (target.status !== "archived") {
      return json(req, { error: "Only archived goal targets can be deleted" }, 409);
    }

    const { data, error } = await db
      .from("goal_targets")
      .delete()
      .eq("organization_id", orgId)
      .eq("id", targetId)
      .select("id")
      .limit(1);
    if (error && error.code === "23503") {
      return json(req, { error: "Goal target has trial history and cannot be deleted" }, 409);
    }
    if (error) return json(req, { error: "Failed to delete goal target" }, 502);
    if (!data || data.length === 0) {
      return json(req, { error: "Goal target has trial history or is no longer eligible for deletion" }, 409);
    }
    return json(req, data[0]);
  }

  const allowed = await currentUserCanManageProgramsGoals(db, orgId);
  if (allowed.upstreamError) return json(req, { error: "Unable to validate program-goal access" }, 502);
  if (!allowed.allowed) return json(req, { error: "Forbidden" }, 403);

  if (req.method === "POST") {
    let payload: unknown;
    try {
      payload = await req.json();
    } catch {
      return json(req, { error: "Invalid JSON body" }, 400);
    }
    const parsed = createGoalTargetSchema.safeParse(payload);
    if (!parsed.success) return json(req, { error: "Invalid request body" }, 400);

    const goal = await loadGoalScope(db, orgId, parsed.data.goal_id);
    if (!goal) return json(req, { error: "goal_id is not in scope for this organization" }, 403);

    const { data, error } = await db
      .from("goal_targets")
      .insert([{
        organization_id: orgId,
        client_id: goal.client_id,
        goal_id: goal.id,
        name: parsed.data.name,
        measurement_type: parsed.data.measurement_type,
        graph_config: parsed.data.graph_config ?? {},
        status: parsed.data.status ?? "active",
        sort_order: parsed.data.sort_order ?? 0,
        created_by: authData.user.id,
      }])
      .select("*")
      .limit(1);
    if (error) return json(req, { error: "Failed to create goal target" }, 500);
    return json(req, data?.[0] ?? null, 201);
  }

  if (req.method === "PATCH") {
    const url = new URL(req.url);
    const targetId = url.searchParams.get("target_id");
    if (!targetId) return json(req, { error: "target_id is required" }, 400);
    if (!isUuid(targetId)) return json(req, { error: "target_id must be a valid UUID" }, 400);

    let payload: unknown;
    try {
      payload = await req.json();
    } catch {
      return json(req, { error: "Invalid JSON body" }, 400);
    }
    const parsed = updateGoalTargetSchema.safeParse(payload);
    if (!parsed.success) return json(req, { error: "Invalid request body" }, 400);

    const { data, error } = await db
      .from("goal_targets")
      .update({ ...parsed.data, updated_by: authData.user.id })
      .eq("organization_id", orgId)
      .eq("id", targetId)
      .select("*")
      .limit(1);
    if (error) return json(req, { error: "Failed to update goal target" }, 500);
    if (!data || data.length === 0) return json(req, { error: "target_id is not in scope for this organization" }, 403);
    return json(req, data[0]);
  }

  return json(req, { error: "Method not allowed" }, 405);
};

const handler = createProtectedRoute((req) => handleGoalTargets(req), RouteOptions.programsGoals);

Deno.serve(handler);

export default handler;
