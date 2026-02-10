import { z } from "zod";
import { CORS_HEADERS, fetchJson, getAccessToken, getSupabaseConfig, json, resolveOrgAndRole } from "./shared";

const startSessionSchema = z.object({
  session_id: z.string().uuid(),
  program_id: z.string().uuid(),
  goal_id: z.string().uuid(),
  goal_ids: z.array(z.string().uuid()).optional(),
  started_at: z.string().optional(),
});

function decodeJwtSubject(accessToken: string): string | null {
  const [, payload] = accessToken.split(".");
  if (!payload) {
    return null;
  }

  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const parsed = JSON.parse(atob(padded)) as { sub?: unknown };
    return typeof parsed.sub === "string" && parsed.sub.length > 0 ? parsed.sub : null;
  } catch {
    return null;
  }
}

export async function sessionsStartHandler(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: { ...CORS_HEADERS } });
  }

  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const accessToken = getAccessToken(request);
  if (!accessToken) {
    return json({ error: "Missing authorization token" }, 401, { "WWW-Authenticate": "Bearer" });
  }

  const { organizationId, isTherapist, isAdmin, isSuperAdmin } = await resolveOrgAndRole(accessToken);
  if (!organizationId || (!isTherapist && !isAdmin && !isSuperAdmin)) {
    return json({ error: "Forbidden" }, 403);
  }

  const currentUserId = decodeJwtSubject(accessToken);
  if (!currentUserId) {
    return json({ error: "Forbidden" }, 403);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const parsed = startSessionSchema.safeParse(payload);
  if (!parsed.success) {
    return json({ error: "Invalid request body" }, 400);
  }

  const { session_id, program_id, goal_id, goal_ids, started_at } = parsed.data;
  const normalizedGoalIds = Array.isArray(goal_ids) ? goal_ids : [];
  const mergedGoalIds = Array.from(new Set([goal_id, ...normalizedGoalIds]));

  const { supabaseUrl, anonKey } = getSupabaseConfig();
  const headers = {
    "Content-Type": "application/json",
    apikey: anonKey,
    Authorization: `Bearer ${accessToken}`,
  };

  const sessionUrl = `${supabaseUrl}/rest/v1/sessions?select=id,client_id,organization_id,program_id,goal_id,therapist_id,started_at&organization_id=eq.${organizationId}&id=eq.${session_id}`;
  const sessionResult = await fetchJson<Array<{
    id: string;
    client_id: string;
    organization_id: string;
    therapist_id: string;
    started_at: string | null;
  }>>(sessionUrl, {
    method: "GET",
    headers,
  });
  if (!sessionResult.ok || !sessionResult.data || sessionResult.data.length === 0) {
    return json({ error: "Session not found" }, 404);
  }

  const sessionRow = sessionResult.data[0];
  if (isTherapist && sessionRow.therapist_id !== currentUserId) {
    return json({ error: "Forbidden" }, 403);
  }

  if (sessionRow.started_at) {
    return json({ error: "Session already started" }, 409);
  }
  const goalUrl = `${supabaseUrl}/rest/v1/goals?select=id,program_id,client_id,organization_id&organization_id=eq.${organizationId}&id=eq.${goal_id}&program_id=eq.${program_id}&client_id=eq.${sessionRow.client_id}`;
  const goalResult = await fetchJson<Array<{ id: string }>>(goalUrl, { method: "GET", headers });
  if (!goalResult.ok || !goalResult.data || goalResult.data.length === 0) {
    return json({ error: "Goal not found for this program" }, 404);
  }

  if (mergedGoalIds.length > 0) {
    const goalsUrl = `${supabaseUrl}/rest/v1/goals?select=id,program_id,client_id,organization_id&organization_id=eq.${organizationId}&program_id=eq.${program_id}&client_id=eq.${sessionRow.client_id}&id=in.(${mergedGoalIds.join(",")})`;
    const goalsResult = await fetchJson<Array<{ id: string }>>(goalsUrl, { method: "GET", headers });
    if (!goalsResult.ok || !goalsResult.data || goalsResult.data.length !== mergedGoalIds.length) {
      return json({ error: "One or more goals are invalid for this session" }, 400);
    }
  }

  const updatePayload = {
    program_id,
    goal_id,
    started_at: started_at ?? new Date().toISOString(),
  };
  const updateUrl = `${supabaseUrl}/rest/v1/sessions?id=eq.${session_id}&organization_id=eq.${organizationId}&started_at=is.null`;
  const updateResult = await fetchJson<Array<{ id: string; started_at: string }>>(updateUrl, {
    method: "PATCH",
    headers: { ...headers, Prefer: "return=representation" },
    body: JSON.stringify(updatePayload),
  });

  if (!updateResult.ok) {
    return json({ error: "Failed to start session" }, updateResult.status || 500);
  }
  if (!Array.isArray(updateResult.data) || updateResult.data.length === 0) {
    return json({ error: "Session already started" }, 409);
  }

  if (mergedGoalIds.length > 0) {
    const goalsPayload = mergedGoalIds.map((goal) => ({
      session_id,
      goal_id: goal,
      organization_id: organizationId,
      client_id: sessionRow.client_id,
      program_id,
    }));
    const sessionGoalsUrl = `${supabaseUrl}/rest/v1/session_goals?on_conflict=session_id,goal_id`;
    const goalsInsert = await fetchJson(sessionGoalsUrl, {
      method: "POST",
      headers: { ...headers, Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify(goalsPayload),
    });
    if (!goalsInsert.ok) {
      return json({ error: "Failed to attach goals to session" }, goalsInsert.status || 500);
    }
  }

  return json(updateResult.data[0]);
}
