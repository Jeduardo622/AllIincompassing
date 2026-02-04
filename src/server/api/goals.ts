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

  if (request.method === "GET") {
    const url = new URL(request.url);
    const programId = url.searchParams.get("program_id");
    if (!programId) {
      return json({ error: "program_id is required" }, 400);
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
