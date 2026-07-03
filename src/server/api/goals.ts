import { z } from "zod";
import {
  CORS_HEADERS,
  currentUserCanManageProgramsGoals,
  fetchJson,
  getAccessToken,
  getSupabaseConfig,
  json,
  resolveOrgAndRoleWithStatus,
} from "./shared";

type PostgrestErrorPayload = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
};

const goalSchema = z.object({
  client_id: z.string().uuid(),
  program_id: z.string().uuid(),
  domain_id: z.string().uuid().optional().nullable(),
  title: z.string().trim().min(1),
  description: z.string().trim().min(1),
  target_behavior: z.string().optional(),
  measurement_type: z.string().optional(),
  original_text: z.string().trim().min(1),
  goal_type: z.enum(["child", "parent"]).optional(),
  clinical_goal_type: z.enum(["behavior", "skill"]).optional().nullable(),
  clinical_context: z.string().optional(),
  baseline_data: z.string().optional(),
  baseline: z.string().optional(),
  target_criteria: z.string().optional(),
  mastery_criteria: z.string().optional(),
  maintenance_criteria: z.string().optional(),
  generalization_criteria: z.string().optional(),
  teaching_strategies: z.string().optional(),
  operational_definition: z.string().optional(),
  objective_data_points: z.array(z.record(z.unknown())).optional(),
  source: z.enum(["manual", "fba_extraction"]).optional(),
  status: z.enum(["draft", "active", "paused", "mastered", "archived"]).optional(),
});

const goalUpdateSchema = goalSchema.partial().extend({
  client_id: z.string().uuid().optional(),
  program_id: z.string().uuid().optional(),
});

const isUuid = (value: string): boolean => z.string().uuid().safeParse(value).success;

const isMissingGoalTypeColumnError = (value: unknown): value is PostgrestErrorPayload => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const payload = value as PostgrestErrorPayload;
  if (typeof payload.message !== "string") {
    return false;
  }
  return /goal_type/i.test(payload.message) && /column/i.test(payload.message);
};

export async function goalsHandler(request: Request): Promise<Response> {
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
  const organizationId = role.organizationId;
  if (!organizationId) {
    return json({ error: "Forbidden" }, 403);
  }

  const { supabaseUrl, anonKey } = getSupabaseConfig();
  const headers = {
    "Content-Type": "application/json",
    apikey: anonKey,
    Authorization: `Bearer ${accessToken}`,
  };

  const loadProgram = async (programId: string): Promise<{ id: string; client_id: string } | null> => {
    const programLookupUrl = `${supabaseUrl}/rest/v1/programs?select=id,client_id&id=eq.${programId}&organization_id=eq.${organizationId}&limit=1`;
    const lookupResult = await fetchJson<Array<{ id: string; client_id: string }>>(programLookupUrl, {
      method: "GET",
      headers,
    });
    if (!lookupResult.ok || !Array.isArray(lookupResult.data) || lookupResult.data.length === 0) {
      return null;
    }
    return lookupResult.data[0] ?? null;
  };

  if (request.method === "GET") {
    const url = new URL(request.url);
    const programId = url.searchParams.get("program_id");
    if (!programId) {
      return json({ error: "program_id is required" }, 400);
    }
    if (!isUuid(programId)) {
      return json({ error: "program_id must be a valid UUID" }, 400);
    }

    const baseSelect =
      "id,organization_id,client_id,program_id,domain_id,title,description,target_behavior,measurement_type,original_text,clinical_goal_type,clinical_context,baseline_data,baseline,target_criteria,mastery_criteria,maintenance_criteria,generalization_criteria,teaching_strategies,operational_definition,objective_data_points,source,status,created_at,updated_at";
    const goalsUrlWithType = `${supabaseUrl}/rest/v1/goals?select=${baseSelect},goal_type&organization_id=eq.${organizationId}&program_id=eq.${programId}&order=created_at.desc`;
    const result = await fetchJson(goalsUrlWithType, { method: "GET", headers });
    if (!result.ok && isMissingGoalTypeColumnError(result.data)) {
      const goalsUrlWithoutType = `${supabaseUrl}/rest/v1/goals?select=${baseSelect}&organization_id=eq.${organizationId}&program_id=eq.${programId}&order=created_at.desc`;
      const fallbackResult = await fetchJson<Array<Record<string, unknown>>>(goalsUrlWithoutType, {
        method: "GET",
        headers,
      });
      if (!fallbackResult.ok) {
        return json({ error: "Failed to load goals" }, fallbackResult.status || 500);
      }
      const withDefaultGoalType = Array.isArray(fallbackResult.data)
        ? fallbackResult.data.map((goal) => ({ ...goal, goal_type: "child" }))
        : [];
      return json(withDefaultGoalType);
    }
    if (!result.ok) {
      return json({ error: "Failed to load goals" }, result.status || 500);
    }
    return json(result.data ?? []);
  }

  if (request.method === "POST") {
    const canManage = await currentUserCanManageProgramsGoals(accessToken, organizationId);
    if (canManage.upstreamError) {
      return json({ error: "Unable to validate program-goal access" }, 502);
    }
    if (!canManage.allowed) {
      return json({ error: "Forbidden" }, 403);
    }

    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }

    const parsed = goalSchema.safeParse(payload);
    if (!parsed.success) {
      return json({ error: "Invalid request body" }, 400);
    }
    const program = await loadProgram(parsed.data.program_id);
    if (!program) {
      return json({ error: "program_id is not in scope for this organization" }, 403);
    }
    if (program.client_id !== parsed.data.client_id) {
      return json({ error: "program_id does not belong to client_id" }, 400);
    }

    const createPayload = {
      ...parsed.data,
      organization_id: organizationId,
    };

    const goalsUrl = `${supabaseUrl}/rest/v1/goals`;
    const result = await fetchJson(goalsUrl, {
      method: "POST",
      headers: { ...headers, Prefer: "return=representation" },
      body: JSON.stringify(createPayload),
    });

    if (!result.ok) {
      return json({ error: "Failed to create goal" }, result.status || 500);
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
    const goalId = url.searchParams.get("goal_id");
    if (!goalId) {
      return json({ error: "goal_id is required" }, 400);
    }
    if (!isUuid(goalId)) {
      return json({ error: "goal_id must be a valid UUID" }, 400);
    }

    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }

    const parsed = goalUpdateSchema.safeParse(payload);
    if (!parsed.success || Object.keys(parsed.data).length === 0) {
      return json({ error: "Invalid request body" }, 400);
    }

    if (parsed.data.program_id || parsed.data.client_id) {
      const goalLookupUrl = `${supabaseUrl}/rest/v1/goals?select=id,client_id,program_id&id=eq.${goalId}&organization_id=eq.${organizationId}&limit=1`;
      const goalLookup = await fetchJson<Array<{ id: string; client_id: string; program_id: string }>>(
        goalLookupUrl,
        { method: "GET", headers },
      );
      if (!goalLookup.ok) {
        return json({ error: "Failed to validate goal update scope" }, goalLookup.status || 500);
      }
      const existingGoal = Array.isArray(goalLookup.data) ? goalLookup.data[0] : null;
      if (!existingGoal) {
        return json({ error: "Goal not found in organization scope" }, 404);
      }

      const effectiveProgramId = parsed.data.program_id ?? existingGoal.program_id;
      const effectiveClientId = parsed.data.client_id ?? existingGoal.client_id;
      const program = await loadProgram(effectiveProgramId);
      if (!program) {
        return json({ error: "program_id is not in scope for this organization" }, 403);
      }
      if (program.client_id !== effectiveClientId) {
        return json({ error: "program_id does not belong to client_id" }, 400);
      }
    }

    const goalsUrl = `${supabaseUrl}/rest/v1/goals?id=eq.${goalId}&organization_id=eq.${organizationId}`;
    const result = await fetchJson(goalsUrl, {
      method: "PATCH",
      headers: { ...headers, Prefer: "return=representation" },
      body: JSON.stringify(parsed.data),
    });

    if (!result.ok) {
      return json({ error: "Failed to update goal" }, result.status || 500);
    }
    const updatedGoal = Array.isArray(result.data) ? result.data[0] : result.data;
    if (!updatedGoal) {
      return json({ error: "goal_id is not in scope for this organization" }, 403);
    }
    return json(updatedGoal);
  }

  return json({ error: "Method not allowed" }, 405);
}
