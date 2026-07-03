import { z } from "npm:zod@3.23.8";
import { createRequestClient } from "../_shared/database.ts";
import { corsHeadersForRequest } from "../_shared/cors.ts";
import { createProtectedRoute, RouteOptions } from "../_shared/auth-middleware.ts";

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

type TargetScope = {
  id: string;
  client_id: string;
  goal_id: string;
  measurement_type: string;
};

type SessionScope = {
  id: string;
  client_id: string;
  therapist_id: string;
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
type LockStateResult = { locked: boolean; upstreamError: boolean };

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

const requireOrg = async (db: ReturnType<typeof createRequestClient>): Promise<string | null> => {
  const { data, error } = await db.rpc("current_user_organization_id");
  if (error || typeof data !== "string" || data.length === 0) {
    return null;
  }
  return data;
};

const canTakeClientData = async (
  db: ReturnType<typeof createRequestClient>,
  orgId: string,
  clientId: string,
): Promise<CapabilityResult> => {
  const { data, error } = await db.rpc("current_user_can_take_client_data", {
    target_organization_id: orgId,
    target_client_id: clientId,
  });
  if (error) {
    console.error("current_user_can_take_client_data rpc error", error);
    return { allowed: false, upstreamError: true };
  }
  return { allowed: data === true, upstreamError: false };
};

const canManageLockedTrialEvents = async (
  db: ReturnType<typeof createRequestClient>,
  orgId: string,
): Promise<CapabilityResult> => {
  const { data, error } = await db.rpc("current_user_can_manage_locked_trial_event", {
    target_organization_id: orgId,
  });
  if (error) {
    console.error("current_user_can_manage_locked_trial_event rpc error", error);
    return { allowed: false, upstreamError: true };
  }
  return { allowed: data === true, upstreamError: false };
};

const sessionHasLockedNote = async (
  db: ReturnType<typeof createRequestClient>,
  sessionId: string,
): Promise<LockStateResult> => {
  const { data, error } = await db.rpc("session_has_locked_note", {
    target_session_id: sessionId,
  });
  if (error) {
    console.error("session_has_locked_note rpc error", error);
    return { locked: true, upstreamError: true };
  }
  return { locked: data === true, upstreamError: false };
};

export const handleTrialEvents = async (req: Request) => {
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
    const sessionId = url.searchParams.get("session_id");
    const targetId = url.searchParams.get("target_id");
    if (!sessionId && !targetId) return json(req, { error: "session_id or target_id is required" }, 400);
    if (sessionId && !isUuid(sessionId)) return json(req, { error: "session_id must be a valid UUID" }, 400);
    if (targetId && !isUuid(targetId)) return json(req, { error: "target_id must be a valid UUID" }, 400);

    let query = db
      .from("trial_events")
      .select("*")
      .eq("organization_id", orgId)
      .order("event_timestamp", { ascending: true })
      .order("trial_number", { ascending: true });
    if (sessionId) query = query.eq("session_id", sessionId);
    if (targetId) query = query.eq("target_id", targetId);

    const { data, error } = await query;
    if (error) return json(req, { error: "Failed to load trial events" }, 500);
    return json(req, data ?? []);
  }

  if (req.method === "POST") {
    let payload: unknown;
    try {
      payload = await req.json();
    } catch {
      return json(req, { error: "Invalid JSON body" }, 400);
    }
    const parsed = createTrialEventSchema.safeParse(payload);
    if (!parsed.success) return json(req, { error: "Invalid request body" }, 400);

    const { data: targets, error: targetError } = await db
      .from("goal_targets")
      .select("id,client_id,goal_id,measurement_type")
      .eq("organization_id", orgId)
      .eq("id", parsed.data.target_id)
      .limit(1);
    const target = !targetError && targets && targets.length > 0 ? targets[0] as unknown as TargetScope : null;
    if (!target) return json(req, { error: "target_id is not in scope for this organization" }, 403);

    const { data: sessions, error: sessionError } = await db
      .from("sessions")
      .select("id,client_id,therapist_id")
      .eq("organization_id", orgId)
      .eq("id", parsed.data.session_id)
      .limit(1);
    const session = !sessionError && sessions && sessions.length > 0 ? sessions[0] as unknown as SessionScope : null;
    if (!session) return json(req, { error: "session_id is not in scope for this organization" }, 403);
    if (session.client_id !== target.client_id) {
      return json(req, { error: "session_id and target_id must belong to the same client" }, 400);
    }
    const measurementPayloadError = validateMeasurementPayload(target.measurement_type, parsed.data);
    if (measurementPayloadError) {
      return json(req, { error: measurementPayloadError }, 400);
    }

    const canCapture = await canTakeClientData(db, orgId, session.client_id);
    if (canCapture.upstreamError) return json(req, { error: "Unable to validate trial-event capture access" }, 502);
    if (!canCapture.allowed) return json(req, { error: "Forbidden" }, 403);

    const lockState = await sessionHasLockedNote(db, session.id);
    if (lockState.upstreamError) return json(req, { error: "Unable to validate session lock state" }, 502);
    if (lockState.locked) {
      const canManageLocked = await canManageLockedTrialEvents(db, orgId);
      if (canManageLocked.upstreamError) return json(req, { error: "Unable to validate locked-session trial-event access" }, 502);
      if (!canManageLocked.allowed) return json(req, { error: "Session is locked for trial-event changes" }, 409);
    }

    const { data, error } = await db
      .from("trial_events")
      .insert([{
        organization_id: orgId,
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
        created_by: authData.user.id,
      }])
      .select("*")
      .limit(1);
    if (error) return json(req, { error: "Failed to create trial event" }, error.code === "23505" ? 409 : 500);
    return json(req, data?.[0] ?? null, 201);
  }

  return json(req, { error: "Method not allowed" }, 405);
};

const handler = createProtectedRoute((req) => handleTrialEvents(req), RouteOptions.programsGoals);

Deno.serve(handler);

export default handler;
