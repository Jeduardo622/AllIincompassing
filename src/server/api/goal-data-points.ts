import { z } from "zod";
import {
  CORS_HEADERS,
  fetchJson,
  getAccessToken,
  getAccessTokenSubject,
  getSupabaseConfig,
  json,
  resolveOrgAndRole,
} from "./shared";

const createGoalDataPointSchema = z.object({
  goal_id: z.string().uuid(),
  client_id: z.string().uuid().optional(),
  session_id: z.string().uuid().optional(),
  assessment_document_id: z.string().uuid().optional(),
  source: z.enum(["manual", "assessment_extraction", "session_note", "ai_inferred"]).optional(),
  metric_name: z.string().trim().min(1),
  metric_value: z.number().optional(),
  metric_unit: z.string().trim().optional(),
  metric_payload: z.record(z.unknown()).optional(),
  observed_at: z.string().datetime().optional(),
});

const isUuid = (value: string): boolean => z.string().uuid().safeParse(value).success;

export async function goalDataPointsHandler(request: Request): Promise<Response> {
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
    const goalId = url.searchParams.get("goal_id");
    const sessionId = url.searchParams.get("session_id");

    if (!goalId && !sessionId) {
      return json({ error: "goal_id or session_id is required" }, 400);
    }
    if (goalId && !isUuid(goalId)) {
      return json({ error: "goal_id must be a valid UUID" }, 400);
    }
    if (sessionId && !isUuid(sessionId)) {
      return json({ error: "session_id must be a valid UUID" }, 400);
    }

    const filters = [
      `organization_id=eq.${encodeURIComponent(organizationId)}`,
      goalId ? `goal_id=eq.${encodeURIComponent(goalId)}` : null,
      sessionId ? `session_id=eq.${encodeURIComponent(sessionId)}` : null,
    ]
      .filter(Boolean)
      .join("&");

    const result = await fetchJson(
      `${supabaseUrl}/rest/v1/goal_data_points?select=*&${filters}&order=observed_at.desc,created_at.desc`,
      { method: "GET", headers },
    );
    if (!result.ok) {
      return json({ error: "Failed to load goal data points" }, result.status || 500);
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

    const parsed = createGoalDataPointSchema.safeParse(payload);
    if (!parsed.success) {
      return json({ error: "Invalid request body" }, 400);
    }

    const goalLookup = await fetchJson<Array<{ id: string; client_id: string }>>(
      `${supabaseUrl}/rest/v1/goals?select=id,client_id&id=eq.${encodeURIComponent(
        parsed.data.goal_id,
      )}&organization_id=eq.${encodeURIComponent(organizationId)}&limit=1`,
      { method: "GET", headers },
    );
    const goal = Array.isArray(goalLookup.data) ? goalLookup.data[0] : null;
    if (!goalLookup.ok || !goal) {
      return json({ error: "goal_id is not in scope for this organization" }, 403);
    }

    const resolvedClientId = parsed.data.client_id ?? goal.client_id;
    if (resolvedClientId !== goal.client_id) {
      return json({ error: "client_id does not match goal_id" }, 400);
    }

    if (parsed.data.session_id) {
      const sessionLookup = await fetchJson<Array<{ id: string; client_id: string }>>(
        `${supabaseUrl}/rest/v1/sessions?select=id,client_id&id=eq.${encodeURIComponent(
          parsed.data.session_id,
        )}&organization_id=eq.${encodeURIComponent(organizationId)}&limit=1`,
        { method: "GET", headers },
      );
      const session = Array.isArray(sessionLookup.data) ? sessionLookup.data[0] : null;
      if (!sessionLookup.ok || !session) {
        return json({ error: "session_id is not in scope for this organization" }, 403);
      }
      if (session.client_id !== resolvedClientId) {
        return json({ error: "session_id does not belong to the same client as goal_id" }, 400);
      }
    }

    const actorId = getAccessTokenSubject(accessToken);
    const createPayload = {
      organization_id: organizationId,
      client_id: resolvedClientId,
      goal_id: parsed.data.goal_id,
      session_id: parsed.data.session_id ?? null,
      assessment_document_id: parsed.data.assessment_document_id ?? null,
      source: parsed.data.source ?? "manual",
      metric_name: parsed.data.metric_name,
      metric_value: typeof parsed.data.metric_value === "number" ? parsed.data.metric_value : null,
      metric_unit: parsed.data.metric_unit ?? null,
      metric_payload: parsed.data.metric_payload ?? {},
      observed_at: parsed.data.observed_at ?? new Date().toISOString(),
      created_by: actorId,
    };

    const result = await fetchJson(`${supabaseUrl}/rest/v1/goal_data_points`, {
      method: "POST",
      headers: { ...headers, Prefer: "return=representation" },
      body: JSON.stringify(createPayload),
    });
    if (!result.ok) {
      return json({ error: "Failed to create goal data point" }, result.status || 500);
    }
    return json(Array.isArray(result.data) ? result.data[0] : result.data, 201);
  }

  return json({ error: "Method not allowed" }, 405);
}
