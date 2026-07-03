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
    const sessionId = url.searchParams.get("session_id");
    const targetId = url.searchParams.get("target_id");
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
