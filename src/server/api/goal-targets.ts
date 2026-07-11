import { z } from "zod";
import {
  CORS_HEADERS,
  currentUserCanDeleteGoalTargets,
  currentUserCanManageProgramsGoals,
  fetchJson,
  getAccessToken,
  getAccessTokenSubject,
  getSupabaseConfig,
  json,
  resolveOrgAndRoleWithStatus,
} from "./shared";

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
const criteriaSchema = z.object({
  action: z.literal("set_criteria"), target_id: z.string().uuid(), phase: phaseSchema,
  metric: z.enum(["percent_correct", "percent_independent", "total_value", "average_value"]).nullable(),
  comparator: z.enum(["gte", "lte"]).nullable(), threshold: z.number().finite().min(0).nullable(),
  min_observations: z.number().int().positive().nullable(), consecutive_sessions: z.number().int().positive().nullable(),
  clinical_note: z.string().nullable().optional(), expected_version: z.number().int().nonnegative(),
}).refine((v) => [v.metric, v.comparator, v.threshold, v.min_observations, v.consecutive_sessions]
  .every((item) => item === null) || [v.metric, v.comparator, v.threshold, v.min_observations, v.consecutive_sessions]
  .every((item) => item !== null));
const reorderSchema = z.object({
  action: z.literal("reorder"), goal_id: z.string().uuid(),
  targets: z.array(z.object({ target_id: z.string().uuid(), expected_version: z.number().int().nonnegative() })).min(1),
}).refine((v) => new Set(v.targets.map((target) => target.target_id)).size === v.targets.length);
const overrideSchema = z.object({
  action: z.literal("override_progression"), target_id: z.string().uuid(), target_phase: phaseSchema,
  current_target_id: z.string().uuid().nullable(), reason: z.string().trim().min(1),
  expected_version: z.number().int().nonnegative(),
});
const completeMasterySchema = z.object({
  action: z.literal("complete_mastery"), target_id: z.string().uuid(),
  reason: z.string().trim().min(1), expected_version: z.number().int().nonnegative(),
});
const progressionActionSchema = z.union([criteriaSchema, reorderSchema, overrideSchema, completeMasterySchema]);
const progressionOwnedFields = new Set(["current_phase", "is_current", "progression_version", "evaluation_window_started_at"]);
const phaseOrder = new Map(["baseline", "teaching", "generalization", "mastery"].map((phase, index) => [phase, index]));
const orderCriteria = (data: unknown): unknown => Array.isArray(data) ? [...data].sort((a, b) =>
  (phaseOrder.get((a as { phase?: string }).phase ?? "") ?? 99) - (phaseOrder.get((b as { phase?: string }).phase ?? "") ?? 99)) : data;

const isUuid = (value: string): boolean => z.string().uuid().safeParse(value).success;

type GoalScope = {
  id: string;
  organization_id: string;
  client_id: string;
};

const databaseError = (data: unknown, fallback: string): { body: { error: string }; status: number } => {
  const error = data && typeof data === "object" ? data as { code?: unknown; message?: unknown } : {};
  if (error.code === "40001") return { body: { error: "Progression version conflict" }, status: 409 };
  if (error.code === "42501") return { body: { error: "Forbidden" }, status: 403 };
  if (error.code === "22023" || error.code === "23514") return { body: { error: "Invalid request body" }, status: 400 };
  return { body: { error: fallback }, status: 502 };
};

const buildHeaders = (anonKey: string, accessToken: string): Record<string, string> => ({
  "Content-Type": "application/json",
  apikey: anonKey,
  Authorization: `Bearer ${accessToken}`,
});

async function loadGoalScope(
  supabaseUrl: string,
  headers: Record<string, string>,
  organizationId: string,
  goalId: string,
): Promise<GoalScope | null> {
  const result = await fetchJson<GoalScope[]>(
    `${supabaseUrl}/rest/v1/goals?select=id,organization_id,client_id&id=eq.${encodeURIComponent(
      goalId,
    )}&organization_id=eq.${encodeURIComponent(organizationId)}&limit=1`,
    { method: "GET", headers },
  );
  return result.ok && Array.isArray(result.data) ? result.data[0] ?? null : null;
}

export async function goalTargetsHandler(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: { ...CORS_HEADERS } });
  }

  const accessToken = getAccessToken(request);
  if (!accessToken) {
    return json({ error: "Missing authorization token" }, 401, { "WWW-Authenticate": "Bearer" });
  }

  const role = await resolveOrgAndRoleWithStatus(accessToken);
  if (role.upstreamError) {
    return json({ error: "Unable to validate organization access" }, 502);
  }
  if (!role.organizationId) {
    return json({ error: "Forbidden" }, 403);
  }

  const { supabaseUrl, anonKey } = getSupabaseConfig();
  const headers = buildHeaders(anonKey, accessToken);
  const organizationId = role.organizationId;

  if (request.method === "GET") {
    const url = new URL(request.url);
    const action = url.searchParams.get("action");
    const goalId = url.searchParams.get("goal_id");
    const targetId = url.searchParams.get("target_id");
    if (!goalId && !targetId) {
      return json({ error: "goal_id or target_id is required" }, 400);
    }
    if (goalId && !isUuid(goalId)) {
      return json({ error: "goal_id must be a valid UUID" }, 400);
    }
    if (targetId && !isUuid(targetId)) {
      return json({ error: "target_id must be a valid UUID" }, 400);
    }

    if (action === "criteria") {
      if (!targetId) return json({ error: "target_id is required" }, 400);
      const result = await fetchJson(`${supabaseUrl}/rest/v1/goal_target_phase_criteria?select=*&organization_id=eq.${encodeURIComponent(organizationId)}&target_id=eq.${encodeURIComponent(targetId)}&order=phase.asc`, { method: "GET", headers });
      return result.ok ? json(orderCriteria(result.data ?? [])) : json({ error: "Failed to load progression criteria" }, 502);
    }
    if (action === "transition_history") {
      if (!targetId && !goalId) return json({ error: "goal_id or target_id is required" }, 400);
      const scope = targetId ? `target_id=eq.${encodeURIComponent(targetId)}` : `goal_id=eq.${encodeURIComponent(goalId!)}`;
      const result = await fetchJson(`${supabaseUrl}/rest/v1/goal_target_transitions?select=*&organization_id=eq.${encodeURIComponent(organizationId)}&${scope}&order=transitioned_at.desc,id.desc`, { method: "GET", headers });
      return result.ok ? json(result.data ?? []) : json({ error: "Failed to load progression history" }, 502);
    }
    if (action) return json({ error: "Invalid action" }, 400);

    const filters = [
      `organization_id=eq.${encodeURIComponent(organizationId)}`,
      goalId ? `goal_id=eq.${encodeURIComponent(goalId)}` : null,
      targetId ? `id=eq.${encodeURIComponent(targetId)}` : null,
    ].filter(Boolean).join("&");

    const result = await fetchJson(
      `${supabaseUrl}/rest/v1/goal_targets?select=*&${filters}&order=sort_order.asc,created_at.asc`,
      { method: "GET", headers },
    );
    if (!result.ok) {
      return json({ error: "Failed to load goal targets" }, result.status || 500);
    }
    return json(result.data ?? []);
  }

  if (request.method === "DELETE") {
    const url = new URL(request.url);
    const targetId = url.searchParams.get("target_id");
    if (!targetId) {
      return json({ error: "target_id is required" }, 400);
    }
    if (!isUuid(targetId)) {
      return json({ error: "target_id must be a valid UUID" }, 400);
    }

    const canDelete = await currentUserCanDeleteGoalTargets(accessToken, organizationId);
    if (canDelete.upstreamError) {
      return json({ error: "Unable to validate goal-target delete access" }, 502);
    }
    if (!canDelete.allowed) {
      return json({ error: "Forbidden" }, 403);
    }

    const encodedTargetId = encodeURIComponent(targetId);
    const encodedOrganizationId = encodeURIComponent(organizationId);
    const targetResult = await fetchJson<Array<{ id: string; status: string }>>(
      `${supabaseUrl}/rest/v1/goal_targets?select=id,status&id=eq.${encodedTargetId}&organization_id=eq.${encodedOrganizationId}&limit=1`,
      { method: "GET", headers },
    );
    if (!targetResult.ok) {
      return json({ error: "Failed to load goal target" }, 502);
    }
    const target = Array.isArray(targetResult.data) ? targetResult.data[0] : null;
    if (!target) {
      return json({ error: "Goal target not found" }, 404);
    }
    if (target.status !== "archived") {
      return json({ error: "Only archived goal targets can be deleted" }, 409);
    }

    const deleteResult = await fetchJson<Array<{ id: string }>>(
      `${supabaseUrl}/rest/v1/goal_targets?id=eq.${encodedTargetId}&organization_id=eq.${encodedOrganizationId}`,
      {
        method: "DELETE",
        headers: { ...headers, Prefer: "return=representation" },
      },
    );
    if (!deleteResult.ok) {
      const errorCode =
        deleteResult.data && !Array.isArray(deleteResult.data) && typeof deleteResult.data === "object"
          ? (deleteResult.data as { code?: unknown }).code
          : null;
      if (errorCode === "23503") {
        return json({ error: "Goal target has trial history and cannot be deleted" }, 409);
      }
      return json({ error: "Failed to delete goal target" }, 502);
    }
    const deleted = Array.isArray(deleteResult.data) ? deleteResult.data[0] : null;
    if (!deleted) {
      return json({ error: "Goal target has trial history or is no longer eligible for deletion" }, 409);
    }
    return json(deleted);
  }

  if (request.method === "POST" || request.method === "PUT") {
    const canManage = await currentUserCanManageProgramsGoals(accessToken, organizationId);
    if (canManage.upstreamError) {
      return json({ error: "Unable to validate program-goal access" }, 502);
    }
    if (!canManage.allowed) {
      return json({ error: "Forbidden" }, 403);
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }

    if (body && typeof body === "object" && "action" in body) {
      const action = progressionActionSchema.safeParse(body);
      if (!action.success) return json({ error: "Invalid request body" }, 400);
      let rpc: string;
      let args: Record<string, unknown>;
      if (action.data.action === "complete_mastery") {
        rpc = "complete_goal_target_mastery";
        args = { target_goal_target_id: action.data.target_id, reason: action.data.reason,
          expected_version: action.data.expected_version };
      } else if (action.data.action === "override_progression") {
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
        args = { target_goal_id: action.data.goal_id,
          ordered_target_ids: action.data.targets.map((target) => target.target_id),
          expected_versions: action.data.targets.map((target) => target.expected_version) };
      }
      const result = await fetchJson(`${supabaseUrl}/rest/v1/rpc/${rpc}`, { method: "POST", headers, body: JSON.stringify(args) });
      if (!result.ok) { const mapped = databaseError(result.data, "Failed to update target progression"); return json(mapped.body, mapped.status); }
      return json(Array.isArray(result.data) && rpc !== "reorder_goal_targets" ? result.data[0] : result.data);
    }

    if (request.method === "PUT") return json({ error: "Invalid request body" }, 400);

    const parsed = createGoalTargetSchema.safeParse(body);
    if (!parsed.success) {
      return json({ error: "Invalid request body" }, 400);
    }

    const goal = await loadGoalScope(supabaseUrl, headers, organizationId, parsed.data.goal_id);
    if (!goal) {
      return json({ error: "goal_id is not in scope for this organization" }, 403);
    }

    const payload = {
      organization_id: organizationId,
      client_id: goal.client_id,
      goal_id: goal.id,
      name: parsed.data.name,
      measurement_type: parsed.data.measurement_type,
      graph_config: parsed.data.graph_config ?? {},
      status: parsed.data.status ?? "active",
      sort_order: parsed.data.sort_order ?? 0,
      created_by: getAccessTokenSubject(accessToken),
    };

    const result = await fetchJson(`${supabaseUrl}/rest/v1/goal_targets`, {
      method: "POST",
      headers: { ...headers, Prefer: "return=representation" },
      body: JSON.stringify(payload),
    });
    if (!result.ok) {
      return json({ error: "Failed to create goal target" }, result.status || 500);
    }
    return json(Array.isArray(result.data) ? result.data[0] : result.data, 201);
  }

  if (request.method === "PATCH") {
    const canManage = await currentUserCanManageProgramsGoals(accessToken, organizationId);
    if (canManage.upstreamError) {
      return json({ error: "Unable to validate program-goal access" }, 502);
    }
    if (!canManage.allowed) {
      return json({ error: "Forbidden" }, 403);
    }

    const url = new URL(request.url);
    const targetId = url.searchParams.get("target_id");
    if (!targetId) {
      return json({ error: "target_id is required" }, 400);
    }
    if (!isUuid(targetId)) {
      return json({ error: "target_id must be a valid UUID" }, 400);
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }

    if (body && typeof body === "object") {
      const record = body as Record<string, unknown>;
      if (Object.keys(record).some((field) => progressionOwnedFields.has(field)) || record.status === "mastered") {
        return json({ error: "Progression state must be changed through a progression action" }, 400);
      }
    }
    const parsed = updateGoalTargetSchema.safeParse(body);
    if (!parsed.success) {
      return json({ error: "Invalid request body" }, 400);
    }

    if (parsed.data.status === "archived") {
      const currentTarget = await fetchJson<Array<{ id: string; is_current: boolean; status: string }>>(
        `${supabaseUrl}/rest/v1/goal_targets?select=id,is_current,status&id=eq.${encodeURIComponent(targetId)}` +
          `&organization_id=eq.${encodeURIComponent(organizationId)}&limit=1`,
        { method: "GET", headers },
      );
      if (!currentTarget.ok) {
        return json({ error: "Failed to load goal target" }, 502);
      }
      const target = Array.isArray(currentTarget.data) ? currentTarget.data[0] : null;
      if (!target) {
        return json({ error: "target_id is not in scope for this organization" }, 403);
      }
      if (target.is_current) {
        return json({ error: "Select another current target before archiving this target" }, 409);
      }
    }

    const payload = {
      ...parsed.data,
      updated_by: getAccessTokenSubject(accessToken),
    };

    const result = await fetchJson(
      `${supabaseUrl}/rest/v1/goal_targets?id=eq.${encodeURIComponent(targetId)}&organization_id=eq.${encodeURIComponent(
        organizationId,
      )}`,
      {
        method: "PATCH",
        headers: { ...headers, Prefer: "return=representation" },
        body: JSON.stringify(payload),
      },
    );
    if (!result.ok) {
      return json({ error: "Failed to update goal target" }, result.status || 500);
    }
    const updated = Array.isArray(result.data) ? result.data[0] : result.data;
    if (!updated) {
      return json({ error: "target_id is not in scope for this organization" }, 403);
    }
    return json(updated);
  }

  return json({ error: "Method not allowed" }, 405);
}
