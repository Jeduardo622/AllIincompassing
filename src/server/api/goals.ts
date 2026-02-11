import { z } from "zod";
import { CORS_HEADERS, fetchJson, getAccessToken, getSupabaseConfig, json, resolveOrgAndRole } from "./shared";

const goalSchema = z.object({
  client_id: z.string().uuid(),
  program_id: z.string().uuid(),
  title: z.string().trim().min(1),
  description: z.string().trim().min(1),
  target_behavior: z.string().optional(),
  measurement_type: z.string().optional(),
  original_text: z.string().trim().min(1),
  clinical_context: z.string().optional(),
  baseline_data: z.string().optional(),
  target_criteria: z.string().optional(),
  status: z.enum(["active", "paused", "mastered", "archived"]).optional(),
});

const goalUpdateSchema = goalSchema.partial().extend({
  client_id: z.string().uuid().optional(),
  program_id: z.string().uuid().optional(),
});

const isUuid = (value: string): boolean => z.string().uuid().safeParse(value).success;

export async function goalsHandler(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: { ...CORS_HEADERS } });
  }

  const accessToken = getAccessToken(request);
  if (!accessToken) {
    return json({ error: "Missing authorization token" }, 401, { "WWW-Authenticate": "Bearer" });
  }

  const { organizationId, isTherapist, isAdmin, isSuperAdmin } = await resolveOrgAndRole(accessToken);
  if (!organizationId || (!isTherapist && !isAdmin && !isSuperAdmin)) {
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

    const goalsUrl = `${supabaseUrl}/rest/v1/goals?select=id,organization_id,client_id,program_id,title,description,target_behavior,measurement_type,original_text,clinical_context,baseline_data,target_criteria,status,created_at,updated_at&organization_id=eq.${organizationId}&program_id=eq.${programId}&order=created_at.desc`;
    const result = await fetchJson(goalsUrl, { method: "GET", headers });
    if (!result.ok) {
      return json({ error: "Failed to load goals" }, result.status || 500);
    }
    return json(result.data ?? []);
  }

  if (request.method === "POST") {
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

    return json(Array.isArray(result.data) ? result.data[0] : result.data);
  }

  return json({ error: "Method not allowed" }, 405);
}
