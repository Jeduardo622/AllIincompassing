import { z } from "zod";
import type { SessionGoalMeasurementEntry, SessionNote } from "../../types";
import { normalizeGoalMeasurementEntry } from "../../lib/goal-measurements";
import { isValidSessionNoteGoalKey } from "../../lib/session-adhoc-targets";
import {
  corsHeadersForRequest,
  errorResponse,
  fetchAuthenticatedUserIdWithStatus,
  fetchJson,
  getAccessToken,
  getSupabaseConfig,
  isDisallowedOriginRequest,
  jsonForRequest,
  resolveOrgAndRoleWithStatus,
} from "./shared";

type SessionNoteRow = {
  id: string;
  authorization_id: string;
  client_id: string;
  created_at: string;
  end_time: string;
  goal_ids: string[] | null;
  goal_measurements: Record<string, unknown> | null;
  goal_notes: Record<string, string> | null;
  goals_addressed: string[] | null;
  is_locked: boolean;
  narrative: string;
  organization_id: string;
  service_code: string;
  session_date: string;
  session_duration: number | null;
  session_id: string | null;
  signed_at: string | null;
  start_time: string;
  therapist_id: string;
  updated_at: string;
  therapists?: {
    full_name: string | null;
    title: string | null;
  } | null;
};

const selectColumns = [
  "id",
  "authorization_id",
  "client_id",
  "created_at",
  "end_time",
  "goal_ids",
  "goal_measurements",
  "goal_notes",
  "goals_addressed",
  "is_locked",
  "narrative",
  "organization_id",
  "service_code",
  "session_date",
  "session_duration",
  "session_id",
  "signed_at",
  "start_time",
  "therapist_id",
  "updated_at",
  "therapists:therapist_id(full_name,title)",
].join(",");

const upsertSchema = z.object({
  noteId: z.string().uuid().optional(),
  sessionId: z.string().uuid().optional().nullable(),
  clientId: z.string().uuid(),
  authorizationId: z.string().uuid(),
  therapistId: z.string().uuid(),
  serviceCode: z.string().min(1),
  sessionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  endTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  goalIds: z.array(z.string().min(1).refine((id) => isValidSessionNoteGoalKey(id))).default([]),
  goalsAddressed: z.array(z.string()).optional(),
  goalNotes: z.record(z.string()).default({}),
  goalMeasurements: z.record(z.unknown()).nullable().optional(),
  narrative: z.string().default(""),
  isLocked: z.boolean().default(false),
});

const normalizeTime = (value: string): string => {
  if (!value) {
    return "00:00:00";
  }
  if (value.length === 5) {
    return `${value}:00`;
  }
  return value;
};

const calculateSessionDurationMinutes = (startTime: string, endTime: string): number => {
  const start = Date.parse(`1970-01-01T${normalizeTime(startTime)}Z`);
  const end = Date.parse(`1970-01-01T${normalizeTime(endTime)}Z`);

  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) {
    return 0;
  }

  return Math.round((end - start) / 60000);
};

const trimGoalNotes = (goalNotes: Record<string, string>): Record<string, string> | null => {
  const cleaned = Object.fromEntries(
    Object.entries(goalNotes)
      .map(([goalId, noteText]) => [goalId, noteText.trim()])
      .filter(([goalId, noteText]) => isValidSessionNoteGoalKey(goalId) && noteText.length > 0),
  );

  return Object.keys(cleaned).length > 0 ? cleaned : null;
};

const normalizeGoalMeasurements = (
  rawMeasurements: Record<string, unknown> | null | undefined,
): Record<string, SessionGoalMeasurementEntry> | null => {
  if (!rawMeasurements || typeof rawMeasurements !== "object") {
    return null;
  }

  const entries = Object.entries(rawMeasurements)
    .map(([goalId, value]) => {
      if (!isValidSessionNoteGoalKey(goalId)) {
        return null;
      }
      const normalized = normalizeGoalMeasurementEntry(value, undefined, { fallbackMetricUnit: null });
      return normalized ? ([goalId, normalized] as const) : null;
    })
    .filter((entry): entry is readonly [string, SessionGoalMeasurementEntry] => Boolean(entry));

  return entries.length > 0 ? Object.fromEntries(entries) : null;
};

const mapRowToSessionNote = (row: SessionNoteRow): SessionNote => ({
  id: row.id,
  date: row.session_date,
  start_time: row.start_time,
  end_time: row.end_time,
  service_code: row.service_code,
  therapist_id: row.therapist_id,
  therapist_name: row.therapists?.full_name ?? "Unknown Therapist",
  goals_addressed: row.goals_addressed ?? [],
  goal_ids: row.goal_ids ?? [],
  goal_measurements: normalizeGoalMeasurements(row.goal_measurements),
  goal_notes: (row.goal_notes as Record<string, string> | null) ?? null,
  session_id: row.session_id,
  narrative: row.narrative,
  is_locked: row.is_locked,
  client_id: row.client_id,
  authorization_id: row.authorization_id,
  organization_id: row.organization_id,
  session_duration: row.session_duration ?? 0,
  signed_at: row.signed_at,
  created_at: row.created_at,
  updated_at: row.updated_at,
});

const toDate = (value: string): Date => new Date(`${value}T00:00:00.000Z`);

const fetchExistingNote = async (
  supabaseUrl: string,
  headers: Record<string, string>,
  organizationId: string,
  options: { noteId?: string; sessionId?: string | null },
): Promise<{ id: string; is_locked: boolean } | null> => {
  if (options.noteId) {
    const url =
      `${supabaseUrl}/rest/v1/client_session_notes?select=id,is_locked` +
      `&organization_id=eq.${encodeURIComponent(organizationId)}` +
      `&id=eq.${encodeURIComponent(options.noteId)}&limit=1`;
    const result = await fetchJson<Array<{ id: string; is_locked: boolean }>>(url, {
      method: "GET",
      headers,
    });
    return result.ok && result.data && result.data.length > 0 ? result.data[0] : null;
  }

  if (options.sessionId) {
    const url =
      `${supabaseUrl}/rest/v1/client_session_notes?select=id,is_locked` +
      `&organization_id=eq.${encodeURIComponent(organizationId)}` +
      `&session_id=eq.${encodeURIComponent(options.sessionId)}&limit=1`;
    const result = await fetchJson<Array<{ id: string; is_locked: boolean }>>(url, {
      method: "GET",
      headers,
    });
    return result.ok && result.data && result.data.length > 0 ? result.data[0] : null;
  }

  return null;
};

const fetchSessionNoteById = async (
  supabaseUrl: string,
  headers: Record<string, string>,
  organizationId: string,
  noteId: string,
): Promise<SessionNoteRow | null> => {
  const url =
    `${supabaseUrl}/rest/v1/client_session_notes?select=${encodeURIComponent(selectColumns)}` +
    `&organization_id=eq.${encodeURIComponent(organizationId)}` +
    `&id=eq.${encodeURIComponent(noteId)}&limit=1`;
  const result = await fetchJson<SessionNoteRow[]>(url, { method: "GET", headers });
  return result.ok && result.data && result.data.length > 0 ? result.data[0] : null;
};

export async function sessionNotesUpsertHandler(request: Request): Promise<Response> {
  if (isDisallowedOriginRequest(request)) {
    return errorResponse(request, "forbidden", "Origin not allowed", { status: 403 });
  }

  if (request.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeadersForRequest(request) });
  }

  if (request.method !== "POST") {
    return errorResponse(request, "validation_error", "Method not allowed", { status: 405 });
  }

  const accessToken = getAccessToken(request);
  if (!accessToken) {
    return errorResponse(request, "unauthorized", "Missing authorization token", {
      headers: { "WWW-Authenticate": "Bearer" },
    });
  }

  const { organizationId, isTherapist, isAdmin, isSuperAdmin, upstreamError: roleUpstreamError } =
    await resolveOrgAndRoleWithStatus(accessToken);
  if (roleUpstreamError) {
    return errorResponse(request, "upstream_error", "Unable to validate organization access", { status: 502 });
  }
  if (!organizationId || (!isTherapist && !isAdmin && !isSuperAdmin)) {
    return errorResponse(request, "forbidden", "Forbidden");
  }

  const { userId: actorUserId, upstreamError: actorUpstreamError } = await fetchAuthenticatedUserIdWithStatus(accessToken);
  if (actorUpstreamError) {
    return errorResponse(request, "upstream_error", "Unable to validate authenticated user", { status: 502 });
  }
  if (!actorUserId) {
    return errorResponse(request, "forbidden", "Forbidden");
  }

  let payload: z.infer<typeof upsertSchema>;
  try {
    const body = await request.json();
    const parsed = upsertSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(request, "validation_error", "Invalid request body");
    }
    payload = parsed.data;
  } catch {
    return errorResponse(request, "validation_error", "Invalid JSON body");
  }

  const sessionDuration = calculateSessionDurationMinutes(payload.startTime, payload.endTime);
  if (sessionDuration <= 0) {
    return errorResponse(request, "validation_error", "End time must be later than start time.");
  }

  const normalizedGoalNotes = trimGoalNotes(payload.goalNotes);
  const normalizedGoalMeasurements = normalizeGoalMeasurements(payload.goalMeasurements ?? null);

  const { supabaseUrl, anonKey } = getSupabaseConfig();
  const headers = {
    "Content-Type": "application/json",
    apikey: anonKey,
    Authorization: `Bearer ${accessToken}`,
  };

  const authorizationUrl =
    `${supabaseUrl}/rest/v1/authorizations?select=` +
    encodeURIComponent(
      "id,organization_id,client_id,status,start_date,end_date,services:authorization_services(service_code,approved_units)",
    ) +
    `&id=eq.${encodeURIComponent(payload.authorizationId)}&limit=1`;
  const authorizationResult = await fetchJson<Array<{
    id: string;
    organization_id: string;
    client_id: string;
    status: string;
    start_date: string;
    end_date: string;
    services: Array<{ service_code: string; approved_units: number | null }> | null;
  }>>(authorizationUrl, { method: "GET", headers });

  if (!authorizationResult.ok || !authorizationResult.data || authorizationResult.data.length === 0) {
    return errorResponse(request, "not_found", "Authorization not found");
  }

  const authorization = authorizationResult.data[0];
  if (authorization.organization_id !== organizationId) {
    return errorResponse(request, "forbidden", "Authorization does not belong to the active organization.");
  }
  if (authorization.client_id !== payload.clientId) {
    return errorResponse(request, "validation_error", "Client does not match the selected authorization.");
  }
  if (authorization.status !== "approved") {
    return errorResponse(request, "validation_error", "Authorization must be approved before saving session notes.");
  }

  const sessionDate = toDate(payload.sessionDate);
  if (sessionDate < toDate(authorization.start_date) || sessionDate > toDate(authorization.end_date)) {
    return errorResponse(request, "validation_error", "Session date must be within the authorization date range.");
  }

  const hasAuthorizedService = (authorization.services ?? []).some(
    (service) => service.service_code === payload.serviceCode,
  );
  if (!hasAuthorizedService) {
    return errorResponse(request, "validation_error", "Selected service code is not part of this authorization.");
  }

  const existingNote = await fetchExistingNote(supabaseUrl, headers, organizationId, {
    noteId: payload.noteId,
    sessionId: payload.noteId ? null : payload.sessionId,
  });

  if (payload.noteId && !existingNote) {
    return errorResponse(request, "not_found", "Session note not found.");
  }

  if (existingNote?.is_locked) {
    return errorResponse(request, "conflict", "Session note is locked and cannot be edited.", { status: 409 });
  }

  const writePayload = {
    authorization_id: payload.authorizationId,
    client_id: payload.clientId,
    therapist_id: payload.therapistId,
    organization_id: organizationId,
    service_code: payload.serviceCode,
    session_date: payload.sessionDate,
    start_time: payload.startTime,
    end_time: payload.endTime,
    session_duration: sessionDuration,
    goals_addressed: payload.goalsAddressed ?? [],
    goal_ids: payload.goalIds.length > 0 ? payload.goalIds : null,
    goal_measurements: normalizedGoalMeasurements,
    goal_notes: normalizedGoalNotes,
    narrative: payload.narrative.trim(),
    is_locked: payload.isLocked,
    signed_at: payload.isLocked ? new Date().toISOString() : null,
    session_id: payload.sessionId ?? null,
  };

  let noteId = existingNote?.id ?? null;
  if (!noteId) {
    const insertResult = await fetchJson<Array<{ id: string }>>(
      `${supabaseUrl}/rest/v1/client_session_notes`,
      {
        method: "POST",
        headers: { ...headers, Prefer: "return=representation" },
        body: JSON.stringify({
          ...writePayload,
          created_by: actorUserId,
        }),
      },
    );
    if (!insertResult.ok || !insertResult.data || insertResult.data.length === 0) {
      return errorResponse(request, "upstream_error", "Unable to create session note", {
        status: insertResult.status || 502,
      });
    }
    noteId = insertResult.data[0].id;
  } else {
    const updateUrl =
      `${supabaseUrl}/rest/v1/client_session_notes?id=eq.${encodeURIComponent(noteId)}` +
      `&organization_id=eq.${encodeURIComponent(organizationId)}`;
    const updateResult = await fetchJson<Array<{ id: string }>>(updateUrl, {
      method: "PATCH",
      headers: { ...headers, Prefer: "return=representation" },
      body: JSON.stringify(writePayload),
    });
    if (!updateResult.ok || !updateResult.data || updateResult.data.length === 0) {
      return errorResponse(request, "upstream_error", "Unable to update session note", {
        status: updateResult.status || 502,
      });
    }
  }

  const savedRow = await fetchSessionNoteById(supabaseUrl, headers, organizationId, noteId);
  if (!savedRow) {
    return errorResponse(request, "upstream_error", "Unable to load saved session note", { status: 502 });
  }

  return jsonForRequest(request, mapRowToSessionNote(savedRow));
}
