import { z } from "zod";
import { getOptionalServerEnv } from "../env";
import {
  CORS_HEADERS,
  currentUserCanCaptureTrialEvent,
  currentUserCanManageLockedTrialEvent,
  fetchAuthenticatedUserIdWithStatus,
  fetchJson,
  getAccessToken,
  getSupabaseConfig,
  json,
  resolveOrgAndRoleWithStatus,
  sessionHasLockedNote,
} from "./shared";

const responseSchema = z.enum([
  "correct",
  "incorrect",
  "noResponse",
  "independent",
  "prompted",
  "notObserved",
]);

const responseRequiredMeasurementTypes = new Set(["correctIncorrect", "taskAnalysis"]);
const valueRequiredMeasurementTypes = new Set(["frequency", "rate", "duration", "timeSample", "latency", "IRT"]);

const createTrialEventSchema = z.object({
  session_id: z.string().uuid(),
  target_id: z.string().uuid(),
  trial_number: z.number().int().positive(),
  response: responseSchema.optional().nullable(),
  prompt_type: z.string().trim().optional().nullable(),
  prompt_level: z.string().trim().optional().nullable(),
  value: z.number().nonnegative().optional().nullable(),
  timestamp: z.string().datetime().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const isUuid = (value: string): boolean => z.string().uuid().safeParse(value).success;

type TargetScope = {
  id: string;
  organization_id: string;
  client_id: string;
  goal_id: string;
  measurement_type: string;
};

type SessionScope = {
  id: string;
  organization_id: string;
  client_id: string;
  therapist_id: string;
};

type TrialEventReadScope = {
  clientId: string;
};

type PromptOutcomesQuery = {
  clientId: string;
  goalId: string;
  startAt: string;
  endBefore: string;
};

const promptOutcomeResponseValues = new Set(["correct", "incorrect", "noResponse"]);
const maxPromptOutcomeWindowMs = 366 * 24 * 60 * 60 * 1000;
const maxPromptOutcomeRows = 5000;
const promptOutcomeFetchLimit = maxPromptOutcomeRows + 1;

type PromptOutcomeRow = {
  id: string;
  session_id: string;
  target_id: string;
  goal_id: string;
  therapist_id: string;
  response: string | null;
  event_timestamp: string;
  sessions?: unknown;
};

const buildHeaders = (anonKey: string, accessToken: string): Record<string, string> => ({
  "Content-Type": "application/json",
  apikey: anonKey,
  Authorization: `Bearer ${accessToken}`,
});

const buildServiceRoleHeaders = (): Record<string, string> | null => {
  const serviceRoleKey = getOptionalServerEnv("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  if (!serviceRoleKey) {
    return null;
  }
  return {
    "Content-Type": "application/json",
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
  };
};

const toUtcDateString = (value: string): string => new Date(value).toISOString().slice(0, 10);

const isUtcDayBoundary = (value: string): boolean =>
  new Date(value).toISOString().endsWith("T00:00:00.000Z");

const validateMeasurementPayload = (
  measurementType: string,
  payload: z.infer<typeof createTrialEventSchema>,
): string | null => {
  if (responseRequiredMeasurementTypes.has(measurementType)) {
    if (!payload.response) {
      return "response is required for this target measurement type";
    }
    if (typeof payload.value === "number") {
      return "value is not allowed for this target measurement type";
    }
    return null;
  }

  if (valueRequiredMeasurementTypes.has(measurementType)) {
    if (typeof payload.value !== "number") {
      return "value is required for this target measurement type";
    }
    if (payload.response) {
      return "response is not allowed for this target measurement type";
    }
  }

  return null;
};

const parsePromptOutcomesQuery = (url: URL): { value: PromptOutcomesQuery | null; error?: string } => {
  const clientId = url.searchParams.get("client_id");
  const goalId = url.searchParams.get("goal_id");
  const startAt = url.searchParams.get("start_at");
  const endBefore = url.searchParams.get("end_before");

  if (!clientId) {
    return { value: null, error: "client_id is required for view=prompt_outcomes" };
  }
  if (!goalId) {
    return { value: null, error: "goal_id is required for view=prompt_outcomes" };
  }
  if (!startAt) {
    return { value: null, error: "start_at is required for view=prompt_outcomes" };
  }
  if (!endBefore) {
    return { value: null, error: "end_before is required for view=prompt_outcomes" };
  }
  if (!isUuid(clientId)) {
    return { value: null, error: "client_id must be a valid UUID" };
  }
  if (!isUuid(goalId)) {
    return { value: null, error: "goal_id must be a valid UUID" };
  }

  const startAtResult = z.string().datetime().safeParse(startAt);
  if (!startAtResult.success) {
    return { value: null, error: "start_at must be a valid ISO 8601 datetime" };
  }
  const endBeforeResult = z.string().datetime().safeParse(endBefore);
  if (!endBeforeResult.success) {
    return { value: null, error: "end_before must be a valid ISO 8601 datetime" };
  }

  const startAtMs = Date.parse(startAt);
  const endBeforeMs = Date.parse(endBefore);
  if (!Number.isFinite(startAtMs) || !Number.isFinite(endBeforeMs)) {
    return { value: null, error: "start_at and end_before must be valid datetimes" };
  }
  if (startAtMs >= endBeforeMs) {
    return { value: null, error: "start_at must be before end_before" };
  }
  if (endBeforeMs - startAtMs > maxPromptOutcomeWindowMs) {
    return { value: null, error: "Prompt outcome query window cannot exceed 366 days" };
  }
  if (!isUtcDayBoundary(startAt) || !isUtcDayBoundary(endBefore)) {
    return { value: null, error: "start_at and end_before must be UTC day boundaries at 00:00:00.000Z" };
  }

  return {
    value: {
      clientId,
      goalId,
      startAt,
      endBefore,
    },
  };
};

const resolveTrialEventReadScope = async (
  supabaseUrl: string,
  headers: Record<string, string>,
  organizationId: string,
  sessionId: string | null,
  targetId: string | null,
): Promise<{ scope: TrialEventReadScope | null; response?: Response }> => {
  let clientId: string | null = null;

  if (targetId) {
    const targetResult = await fetchJson<TargetScope[]>(
      `${supabaseUrl}/rest/v1/goal_targets?select=id,organization_id,client_id,goal_id,measurement_type&id=eq.${encodeURIComponent(
        targetId,
      )}&organization_id=eq.${encodeURIComponent(organizationId)}&limit=1`,
      { method: "GET", headers },
    );
    if (!targetResult.ok) {
      return { scope: null, response: json({ error: "Unable to validate trial-event target access" }, targetResult.status || 500) };
    }
    const target = Array.isArray(targetResult.data) ? targetResult.data[0] ?? null : null;
    if (!target) {
      return { scope: null, response: json({ error: "target_id is not in scope for this organization" }, 403) };
    }
    clientId = target.client_id;
  }

  if (sessionId) {
    const sessionResult = await fetchJson<SessionScope[]>(
      `${supabaseUrl}/rest/v1/sessions?select=id,organization_id,client_id,therapist_id&id=eq.${encodeURIComponent(
        sessionId,
      )}&organization_id=eq.${encodeURIComponent(organizationId)}&limit=1`,
      { method: "GET", headers },
    );
    if (!sessionResult.ok) {
      return { scope: null, response: json({ error: "Unable to validate trial-event session access" }, sessionResult.status || 500) };
    }
    const session = Array.isArray(sessionResult.data) ? sessionResult.data[0] ?? null : null;
    if (!session) {
      return { scope: null, response: json({ error: "session_id is not in scope for this organization" }, 403) };
    }
    if (clientId && session.client_id !== clientId) {
      return { scope: null, response: json({ error: "session_id and target_id must belong to the same client" }, 400) };
    }
    clientId = session.client_id;
  }

  return clientId ? { scope: { clientId } } : { scope: null, response: json({ error: "session_id or target_id is required" }, 400) };
};

export async function trialEventsHandler(request: Request): Promise<Response> {
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

  const { userId: actorUserId, upstreamError: actorUpstreamError } = await fetchAuthenticatedUserIdWithStatus(accessToken);
  if (actorUpstreamError) {
    return json({ error: "Unable to validate authenticated user" }, 502);
  }
  if (!actorUserId) {
    return json({ error: "Forbidden" }, 403);
  }

  const { supabaseUrl, anonKey } = getSupabaseConfig();
  const headers = buildHeaders(anonKey, accessToken);
  const serviceRoleHeaders = buildServiceRoleHeaders();
  const organizationId = role.organizationId;

  if (request.method === "GET") {
    const url = new URL(request.url);
    const view = url.searchParams.get("view");
    const clientId = url.searchParams.get("client_id");
    const sessionId = url.searchParams.get("session_id");
    const targetId = url.searchParams.get("target_id");

    if (clientId && (sessionId || targetId) && view !== "prompt_outcomes") {
      return json({ error: "client_id cannot be combined with session_id or target_id unless view=prompt_outcomes" }, 400);
    }

    if (view === "prompt_outcomes") {
      if (sessionId || targetId) {
        return json({ error: "view=prompt_outcomes cannot be combined with session_id or target_id" }, 400);
      }

      const promptOutcomesQuery = parsePromptOutcomesQuery(url);
      if (!promptOutcomesQuery.value) {
        return json({ error: promptOutcomesQuery.error ?? "Invalid prompt outcomes query" }, 400);
      }

      const { clientId, goalId, startAt, endBefore } = promptOutcomesQuery.value;
      const canRead = await currentUserCanCaptureTrialEvent(accessToken, organizationId, clientId);
      if (canRead.upstreamError) {
        return json({ error: "Unable to validate trial-event read access" }, 502);
      }
      if (!canRead.allowed) {
        return json({ error: "Forbidden" }, 403);
      }
      if (!serviceRoleHeaders) {
        return json({ error: "Unable to validate trial-event read scope" }, 502);
      }

      const clientScopeResult = await fetchJson<Array<{ id: string }>>(
        `${supabaseUrl}/rest/v1/clients?select=id&id=eq.${encodeURIComponent(
          clientId,
        )}&organization_id=eq.${encodeURIComponent(organizationId)}&limit=1`,
        { method: "GET", headers: serviceRoleHeaders },
      );
      if (!clientScopeResult.ok) {
        return json({ error: "Unable to validate trial-event client access" }, clientScopeResult.status || 500);
      }
      const clientInScope = Array.isArray(clientScopeResult.data) ? clientScopeResult.data[0] ?? null : null;
      if (!clientInScope) {
        return json({ error: "client_id is not in scope for this organization" }, 403);
      }

      const goalScopeResult = await fetchJson<Array<{ id: string; client_id: string }>>(
        `${supabaseUrl}/rest/v1/goals?select=id,client_id&id=eq.${encodeURIComponent(
          goalId,
        )}&organization_id=eq.${encodeURIComponent(organizationId)}&client_id=eq.${encodeURIComponent(clientId)}&limit=1`,
        { method: "GET", headers: serviceRoleHeaders },
      );
      if (!goalScopeResult.ok) {
        return json({ error: "Unable to validate trial-event goal access" }, goalScopeResult.status || 500);
      }
      const goalInScope = Array.isArray(goalScopeResult.data) ? goalScopeResult.data[0] ?? null : null;
      if (!goalInScope || goalInScope.client_id !== clientId) {
        return json({ error: "goal_id is not in scope for this client" }, 403);
      }

      const startDate = toUtcDateString(startAt);
      const endDate = toUtcDateString(endBefore);

      const filters = [
        `select=id,session_id,target_id,goal_id,therapist_id,response,event_timestamp,sessions!inner(client_session_notes!inner(session_date))`,
        `organization_id=eq.${encodeURIComponent(organizationId)}`,
        `client_id=eq.${encodeURIComponent(clientId)}`,
        `goal_id=eq.${encodeURIComponent(goalId)}`,
        `sessions.client_session_notes.organization_id=eq.${encodeURIComponent(organizationId)}`,
        `sessions.client_session_notes.client_id=eq.${encodeURIComponent(clientId)}`,
        `sessions.client_session_notes.session_date=gte.${encodeURIComponent(startDate)}`,
        `sessions.client_session_notes.session_date=lt.${encodeURIComponent(endDate)}`,
        "prompt_type=not.is.null",
        `response=in.(${encodeURIComponent(Array.from(promptOutcomeResponseValues).join(","))})`,
        "order=event_timestamp.asc,trial_number.asc",
        `limit=${promptOutcomeFetchLimit}`,
      ].join("&");

      const result = await fetchJson(`${supabaseUrl}/rest/v1/trial_events?${filters}`, {
        method: "GET",
        headers,
      });
      if (!result.ok) {
        return json({ error: "Failed to load prompt outcomes" }, result.status || 500);
      }

      const rows = Array.isArray(result.data) ? (result.data as PromptOutcomeRow[]) : [];
      if (rows.length > maxPromptOutcomeRows) {
        return json({ error: "Prompt outcome query exceeds 5000 events" }, 422);
      }
      return json(
        rows.map(({ id, session_id, target_id, goal_id, therapist_id, response, event_timestamp }) => ({
          id,
          session_id,
          target_id,
          goal_id,
          therapist_id,
          response,
          event_timestamp,
        })),
      );
    }

    if (!sessionId && !targetId) {
      return json({ error: "session_id or target_id is required" }, 400);
    }
    if (sessionId && !isUuid(sessionId)) {
      return json({ error: "session_id must be a valid UUID" }, 400);
    }
    if (targetId && !isUuid(targetId)) {
      return json({ error: "target_id must be a valid UUID" }, 400);
    }

    if (!serviceRoleHeaders) {
      return json({ error: "Unable to validate trial-event read scope" }, 502);
    }

    const readScope = await resolveTrialEventReadScope(supabaseUrl, serviceRoleHeaders, organizationId, sessionId, targetId);
    if (!readScope.scope) {
      return readScope.response ?? json({ error: "Forbidden" }, 403);
    }
    const canRead = await currentUserCanCaptureTrialEvent(accessToken, organizationId, readScope.scope.clientId);
    if (canRead.upstreamError) {
      return json({ error: "Unable to validate trial-event read access" }, 502);
    }
    if (!canRead.allowed) {
      return json({ error: "Forbidden" }, 403);
    }

    const filters = [
      `organization_id=eq.${encodeURIComponent(organizationId)}`,
      sessionId ? `session_id=eq.${encodeURIComponent(sessionId)}` : null,
      targetId ? `target_id=eq.${encodeURIComponent(targetId)}` : null,
    ].filter(Boolean).join("&");

    const result = await fetchJson(
      `${supabaseUrl}/rest/v1/trial_events?select=*&${filters}&order=event_timestamp.asc,trial_number.asc`,
      { method: "GET", headers },
    );
    if (!result.ok) {
      return json({ error: "Failed to load trial events" }, result.status || 500);
    }
    return json(result.data ?? []);
  }

  if (request.method === "POST") {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }

    const parsed = createTrialEventSchema.safeParse(body);
    if (!parsed.success) {
      return json({ error: "Invalid request body" }, 400);
    }
    if (!serviceRoleHeaders) {
      return json({ error: "Unable to validate trial-event scope" }, 502);
    }

    const targetResult = await fetchJson<TargetScope[]>(
      `${supabaseUrl}/rest/v1/goal_targets?select=id,organization_id,client_id,goal_id,measurement_type&id=eq.${encodeURIComponent(
        parsed.data.target_id,
      )}&organization_id=eq.${encodeURIComponent(organizationId)}&limit=1`,
      { method: "GET", headers: serviceRoleHeaders },
    );
    if (!targetResult.ok) {
      return json({ error: "Unable to validate trial-event target access" }, targetResult.status || 500);
    }
    const target = targetResult.ok && Array.isArray(targetResult.data) ? targetResult.data[0] ?? null : null;
    if (!target) {
      return json({ error: "target_id is not in scope for this organization" }, 403);
    }

    const sessionResult = await fetchJson<SessionScope[]>(
      `${supabaseUrl}/rest/v1/sessions?select=id,organization_id,client_id,therapist_id&id=eq.${encodeURIComponent(
        parsed.data.session_id,
      )}&organization_id=eq.${encodeURIComponent(organizationId)}&limit=1`,
      { method: "GET", headers: serviceRoleHeaders },
    );
    if (!sessionResult.ok) {
      return json({ error: "Unable to validate trial-event session access" }, sessionResult.status || 500);
    }
    const session = sessionResult.ok && Array.isArray(sessionResult.data) ? sessionResult.data[0] ?? null : null;
    if (!session) {
      return json({ error: "session_id is not in scope for this organization" }, 403);
    }
    if (session.client_id !== target.client_id) {
      return json({ error: "session_id and target_id must belong to the same client" }, 400);
    }
    const measurementPayloadError = validateMeasurementPayload(target.measurement_type, parsed.data);
    if (measurementPayloadError) {
      return json({ error: measurementPayloadError }, 400);
    }

    const canCapture = await currentUserCanCaptureTrialEvent(accessToken, organizationId, session.client_id);
    if (canCapture.upstreamError) {
      return json({ error: "Unable to validate trial-event capture access" }, 502);
    }
    if (!canCapture.allowed) {
      return json({ error: "Forbidden" }, 403);
    }

    const lockState = await sessionHasLockedNote(accessToken, session.id);
    if (lockState.upstreamError) {
      return json({ error: "Unable to validate session lock state" }, 502);
    }
    if (lockState.locked) {
      const canManageLocked = await currentUserCanManageLockedTrialEvent(accessToken, organizationId);
      if (canManageLocked.upstreamError) {
        return json({ error: "Unable to validate locked-session trial-event access" }, 502);
      }
      if (!canManageLocked.allowed) {
        return json({ error: "Session is locked for trial-event changes" }, 409);
      }
    }

    const payload = {
      organization_id: organizationId,
      client_id: session.client_id,
      session_id: session.id,
      target_id: target.id,
      goal_id: target.goal_id,
      therapist_id: session.therapist_id,
      trial_number: parsed.data.trial_number,
      response: parsed.data.response ?? null,
      prompt_type: parsed.data.prompt_type ?? null,
      prompt_level: parsed.data.prompt_level ?? null,
      value: typeof parsed.data.value === "number" ? parsed.data.value : null,
      event_timestamp: parsed.data.timestamp ?? new Date().toISOString(),
      metadata: parsed.data.metadata ?? {},
      created_by: actorUserId,
    };

    const result = await fetchJson(`${supabaseUrl}/rest/v1/trial_events`, {
      method: "POST",
      headers: { ...headers, Prefer: "return=representation" },
      body: JSON.stringify(payload),
    });
    if (!result.ok) {
      if (result.status === 409) {
        return json({ error: "trial_number already exists for this session target" }, 409);
      }
      return json({ error: "Failed to create trial event" }, result.status || 500);
    }
    return json(Array.isArray(result.data) ? result.data[0] : result.data, 201);
  }

  return json({ error: "Method not allowed" }, 405);
}
