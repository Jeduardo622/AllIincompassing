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
  .strict()
  .refine((value) => Object.keys(value).length > 0, "At least one field is required");
const phaseSchema = z.enum(["baseline", "teaching", "generalization", "mastery"]);
const criteriaSchema = z.object({ action: z.literal("set_criteria"), target_id: z.string().uuid(), phase: phaseSchema,
  metric: z.enum(["percent_correct", "percent_independent", "total_value", "average_value"]).nullable(),
  comparator: z.enum(["gte", "lte"]).nullable(), threshold: z.number().finite().min(0).nullable(),
  min_observations: z.number().int().positive().nullable(), consecutive_sessions: z.number().int().positive().nullable(),
  clinical_note: z.string().nullable().optional(), expected_version: z.number().int().nonnegative(),
}).refine((v) => [v.metric, v.comparator, v.threshold, v.min_observations, v.consecutive_sessions].every((x) => x === null)
  || [v.metric, v.comparator, v.threshold, v.min_observations, v.consecutive_sessions].every((x) => x !== null));
const reorderSchema = z.object({ action: z.literal("reorder"), goal_id: z.string().uuid(), targets: z.array(z.object({
  target_id: z.string().uuid(), expected_version: z.number().int().nonnegative(),
})).min(1) }).refine((v) => new Set(v.targets.map((target) => target.target_id)).size === v.targets.length);
const overrideSchema = z.object({ action: z.literal("override_progression"), target_id: z.string().uuid(),
  target_phase: phaseSchema, current_target_id: z.string().uuid().nullable(), reason: z.string().trim().min(1),
  expected_version: z.number().int().nonnegative() });
const progressionActionSchema = z.union([criteriaSchema, reorderSchema, overrideSchema]);
const progressionOwnedFields = new Set(["current_phase", "is_current", "progression_version", "evaluation_window_started_at"]);
const phaseOrder = new Map(["baseline", "teaching", "generalization", "mastery"].map((phase, index) => [phase, index]));
const orderCriteria = (data: unknown): unknown => Array.isArray(data) ? [...data].sort((a, b) =>
  (phaseOrder.get((a as { phase?: string }).phase ?? "") ?? 99) - (phaseOrder.get((b as { phase?: string }).phase ?? "") ?? 99)) : data;
const mapDatabaseError = (error: { code?: string } | null, fallback: string) => {
  if (error?.code === "40001") return { error: "Progression version conflict", status: 409 };
  if (error?.code === "42501") return { error: "Forbidden", status: 403 };
  if (error?.code === "22023" || error?.code === "23514") return { error: "Invalid request body", status: 400 };
  return { error: fallback, status: 502 };
};

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
    const action = url.searchParams.get("action");
    const goalId = url.searchParams.get("goal_id");
    const targetId = url.searchParams.get("target_id");
    if (!goalId && !targetId) return json(req, { error: "goal_id or target_id is required" }, 400);
    if (goalId && !isUuid(goalId)) return json(req, { error: "goal_id must be a valid UUID" }, 400);
    if (targetId && !isUuid(targetId)) return json(req, { error: "target_id must be a valid UUID" }, 400);

    if (action === "criteria") {
      if (!targetId) return json(req, { error: "target_id is required" }, 400);
      const { data, error } = await db.from("goal_target_phase_criteria").select("*")
        .eq("organization_id", orgId).eq("target_id", targetId).order("phase", { ascending: true });
      return error ? json(req, { error: "Failed to load progression criteria" }, 502) : json(req, orderCriteria(data ?? []));
    }
    if (action === "transition_history") {
      if (!targetId && !goalId) return json(req, { error: "goal_id or target_id is required" }, 400);
      let history = db.from("goal_target_transitions").select("*").eq("organization_id", orgId);
      history = targetId ? history.eq("target_id", targetId) : history.eq("goal_id", goalId!);
      const { data, error } = await history.order("transitioned_at", { ascending: false }).order("id", { ascending: false });
      return error ? json(req, { error: "Failed to load progression history" }, 502) : json(req, data ?? []);
    }
    if (action) return json(req, { error: "Invalid action" }, 400);

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

  if (req.method === "POST" || req.method === "PUT") {
    let payload: unknown;
    try {
      payload = await req.json();
    } catch {
      return json(req, { error: "Invalid JSON body" }, 400);
    }
    if (payload && typeof payload === "object" && "action" in payload) {
      const action = progressionActionSchema.safeParse(payload);
      if (!action.success) return json(req, { error: "Invalid request body" }, 400);
      let rpc: string; let args: Record<string, unknown>;
      if (action.data.action === "override_progression") {
        rpc = "override_goal_target_progression";
        args = { target_goal_target_id: action.data.target_id, target_phase: action.data.target_phase,
          target_current_goal_target_id: action.data.current_target_id, reason: action.data.reason,
          expected_version: action.data.expected_version };
      } else if (action.data.action === "set_criteria") {
        rpc = "set_goal_target_phase_criterion";
        args = { target_goal_target_id: action.data.target_id, target_phase: action.data.phase,
          target_metric: action.data.metric, target_comparator: action.data.comparator,
          target_threshold: action.data.threshold, target_min_observations: action.data.min_observations,
          target_consecutive_sessions: action.data.consecutive_sessions,
          target_clinical_note: action.data.clinical_note ?? null, expected_version: action.data.expected_version };
      } else {
        rpc = "reorder_goal_targets";
        args = { target_goal_id: action.data.goal_id, ordered_target_ids: action.data.targets.map((t) => t.target_id),
          expected_versions: action.data.targets.map((t) => t.expected_version) };
      }
      const { data, error } = await db.rpc(rpc, args);
      if (error) { const mapped = mapDatabaseError(error, "Failed to update target progression"); return json(req, { error: mapped.error }, mapped.status); }
      return json(req, Array.isArray(data) && rpc !== "reorder_goal_targets" ? data[0] : data);
    }
    if (req.method === "PUT") return json(req, { error: "Invalid request body" }, 400);
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
    if (payload && typeof payload === "object") {
      const record = payload as Record<string, unknown>;
      if (Object.keys(record).some((field) => progressionOwnedFields.has(field)) || record.status === "mastered") {
        return json(req, { error: "Progression state must be changed through a progression action" }, 400);
      }
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
