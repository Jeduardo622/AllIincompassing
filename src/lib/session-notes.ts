import type { PostgrestError } from '@supabase/supabase-js';
import type { SessionGoalMeasurementEntry, SessionNote } from '../types';
import type { Database } from './generated/database.types';
import { normalizeGoalMeasurementEntry } from './goal-measurements';
import { callApi } from './api';
import { supabase } from './supabase';

type ClientSessionNoteRow = Database['public']['Tables']['client_session_notes']['Row'];

interface TherapistSummary {
  readonly full_name: string | null;
  readonly title: string | null;
}

export const normalizeSessionGoalMeasurementEntry = (
  rawValue: unknown,
): SessionGoalMeasurementEntry | null => {
  return normalizeGoalMeasurementEntry(rawValue, undefined, { fallbackMetricUnit: null });
};

export const normalizeSessionGoalMeasurementMap = (
  rawValue: unknown,
): Record<string, SessionGoalMeasurementEntry> | null => {
  if (!rawValue || typeof rawValue !== 'object') {
    return null;
  }

  const entries = Object.entries(rawValue)
    .map(([goalId, entry]) => [goalId, normalizeSessionGoalMeasurementEntry(entry)] as const)
    .filter((entry): entry is readonly [string, SessionGoalMeasurementEntry] => Boolean(entry[1]));

  return entries.length > 0 ? Object.fromEntries(entries) : null;
};

const TABLE = 'client_session_notes';
const SESSION_NOTE_SELECT_COLUMNS = `
  id,
  authorization_id,
  client_id,
  created_at,
  end_time,
  goal_ids,
  goal_measurements,
  goal_notes,
  goals_addressed,
  is_locked,
  narrative,
  organization_id,
  service_code,
  session_date,
  session_duration,
  session_id,
  signed_at,
  start_time,
  therapist_id,
  updated_at
`;

const SESSION_NOTE_WITH_THERAPIST_SELECT = `
  ${SESSION_NOTE_SELECT_COLUMNS},
  therapists:therapist_id (
    full_name,
    title
  )
`;

const mapRowToSessionNote = (
  row: ClientSessionNoteRow,
  therapist: TherapistSummary | null
): SessionNote => ({
  id: row.id,
  date: row.session_date,
  start_time: row.start_time,
  end_time: row.end_time,
  service_code: row.service_code,
  therapist_id: row.therapist_id,
  therapist_name: therapist?.full_name ?? 'Unknown Therapist',
  goals_addressed: row.goals_addressed ?? [],
  goal_ids: row.goal_ids ?? [],
  goal_measurements: normalizeSessionGoalMeasurementMap(row.goal_measurements),
  goal_notes: row.goal_notes as Record<string, string> | null ?? null,
  session_id: row.session_id ?? null,
  narrative: row.narrative,
  is_locked: row.is_locked,
  client_id: row.client_id,
  authorization_id: row.authorization_id,
  organization_id: row.organization_id,
  session_duration: row.session_duration,
  signed_at: row.signed_at,
  created_at: row.created_at,
  updated_at: row.updated_at,
});

export interface FetchClientSessionNotesOptions {
  readonly limit?: number;
}

export const fetchClientSessionNotes = async (
  clientId: string,
  organizationId: string | null,
  options: FetchClientSessionNotesOptions = {}
): Promise<SessionNote[]> => {
  if (!clientId) {
    return [];
  }

  if (!organizationId) {
    throw new Error('Organization context is required to load session notes.');
  }

  const limit = options.limit ?? 100;

  const { data, error } = await supabase
    .from(TABLE)
    .select(SESSION_NOTE_WITH_THERAPIST_SELECT)
    .eq('client_id', clientId)
    .eq('organization_id', organizationId)
    .order('session_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    throw error;
  }

  return (data ?? []).map((row) =>
    mapRowToSessionNote(
      row as ClientSessionNoteRow & { therapists: TherapistSummary | null },
      (row as { therapists: TherapistSummary | null }).therapists ?? null
    )
  );
};

export interface CreateClientSessionNoteInput {
  readonly clientId: string;
  readonly authorizationId: string;
  readonly therapistId: string;
  readonly organizationId: string;
  readonly createdBy: string;
  readonly serviceCode: string;
  readonly sessionDate: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly sessionDuration: number;
  readonly goalsAddressed: string[];
  readonly goalIds?: string[];
  readonly goalMeasurements?: Record<string, SessionGoalMeasurementEntry> | null;
  readonly goalNotes?: Record<string, string> | null;
  readonly narrative: string;
  readonly isLocked: boolean;
  readonly sessionId?: string | null;
}

export interface UpsertClientSessionNoteForSessionInput {
  readonly sessionId: string;
  readonly clientId: string;
  readonly authorizationId: string;
  readonly therapistId: string;
  readonly organizationId: string;
  readonly actorUserId: string;
  readonly serviceCode: string;
  readonly sessionDate: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly goalsAddressed: string[];
  readonly goalIds: string[];
  readonly goalMeasurements?: Record<string, SessionGoalMeasurementEntry> | null;
  readonly goalNotes: Record<string, string>;
  readonly narrative: string;
  readonly captureMergeGoalIds?: string[];
}

export interface UpdateClientSessionNoteInput {
  readonly noteId: string;
  readonly clientId: string;
  readonly authorizationId: string;
  readonly therapistId: string;
  readonly organizationId: string;
  readonly actorUserId: string;
  readonly serviceCode: string;
  readonly sessionDate: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly sessionDuration: number;
  readonly goalsAddressed: string[];
  readonly goalIds?: string[];
  readonly goalMeasurements?: Record<string, SessionGoalMeasurementEntry> | null;
  readonly goalNotes?: Record<string, string> | null;
  readonly narrative: string;
  readonly isLocked: boolean;
  readonly sessionId?: string | null;
}

export interface SessionNoteUpsertApiPayload {
  readonly noteId?: string;
  readonly sessionId?: string | null;
  readonly clientId: string;
  readonly authorizationId: string;
  readonly therapistId: string;
  readonly serviceCode: string;
  readonly sessionDate: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly goalIds: string[];
  readonly goalsAddressed?: string[];
  readonly goalNotes: Record<string, string>;
  readonly goalMeasurements?: Record<string, SessionGoalMeasurementEntry> | null;
  readonly narrative: string;
  readonly isLocked: boolean;
  /** Server merges only these goal keys from the request into the existing session note. */
  readonly captureMergeGoalIds?: string[];
}

/**
 * Single writer path for therapist-facing persistence of `client_session_notes` rows:
 * server `POST /api/session-notes/upsert` (see `src/server/api/session-notes-upsert.ts`).
 * Do not add parallel Supabase insert/update/upsert/delete call sites on this table in app code.
 */
const invokeSessionNoteUpsertApi = async (
  payload: SessionNoteUpsertApiPayload,
): Promise<SessionNote> => {
  const response = await callApi('/api/session-notes/upsert', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const fallbackMessage = 'Failed to save session note.';
    try {
      const errorBody = await response.json() as { error?: unknown; message?: unknown };
      const message = typeof errorBody.error === 'string'
        ? errorBody.error
        : typeof errorBody.message === 'string'
          ? errorBody.message
          : fallbackMessage;
      throw new Error(message);
    } catch (error) {
      if (error instanceof Error && error.message !== fallbackMessage) {
        throw error;
      }
      throw new Error(fallbackMessage);
    }
  }

  return await response.json() as SessionNote;
};

export const createClientSessionNote = async (
  payload: CreateClientSessionNoteInput
): Promise<SessionNote> => {
  return invokeSessionNoteUpsertApi({
    sessionId: payload.sessionId ?? null,
    clientId: payload.clientId,
    authorizationId: payload.authorizationId,
    therapistId: payload.therapistId,
    serviceCode: payload.serviceCode,
    sessionDate: payload.sessionDate,
    startTime: payload.startTime,
    endTime: payload.endTime,
    goalIds: payload.goalIds ?? [],
    goalsAddressed: payload.goalsAddressed,
    goalNotes: payload.goalNotes ?? {},
    goalMeasurements: payload.goalMeasurements ?? null,
    narrative: payload.narrative,
    isLocked: payload.isLocked,
  });
};

export const updateClientSessionNote = async (
  payload: UpdateClientSessionNoteInput,
): Promise<SessionNote> => {
  return invokeSessionNoteUpsertApi({
    noteId: payload.noteId,
    sessionId: payload.sessionId ?? null,
    clientId: payload.clientId,
    authorizationId: payload.authorizationId,
    therapistId: payload.therapistId,
    serviceCode: payload.serviceCode,
    sessionDate: payload.sessionDate,
    startTime: payload.startTime,
    endTime: payload.endTime,
    goalIds: payload.goalIds ?? [],
    goalsAddressed: payload.goalsAddressed,
    goalNotes: payload.goalNotes ?? {},
    goalMeasurements: payload.goalMeasurements ?? null,
    narrative: payload.narrative,
    isLocked: payload.isLocked,
  });
};

export const upsertClientSessionNoteForSession = async (
  payload: UpsertClientSessionNoteForSessionInput,
): Promise<SessionNote> => {
  const sessionDuration = calculateSessionDurationMinutes(payload.startTime, payload.endTime);
  if (sessionDuration <= 0) {
    throw new Error('End time must be later than start time.');
  }

  return invokeSessionNoteUpsertApi({
    sessionId: payload.sessionId,
    clientId: payload.clientId,
    authorizationId: payload.authorizationId,
    therapistId: payload.therapistId,
    serviceCode: payload.serviceCode,
    sessionDate: payload.sessionDate,
    startTime: payload.startTime,
    endTime: payload.endTime,
    goalIds: payload.goalIds,
    goalsAddressed: payload.goalsAddressed,
    goalNotes: payload.goalNotes,
    goalMeasurements: payload.goalMeasurements ?? null,
    narrative: payload.narrative,
    isLocked: false,
    ...(payload.captureMergeGoalIds?.length ? { captureMergeGoalIds: payload.captureMergeGoalIds } : {}),
  });
};

const normalizeTime = (value: string): string => {
  if (!value) {
    return '00:00:00';
  }
  if (value.length === 5) {
    return `${value}:00`;
  }
  return value;
};

export const calculateSessionDurationMinutes = (startTime: string, endTime: string): number => {
  const start = Date.parse(`1970-01-01T${normalizeTime(startTime)}Z`);
  const end = Date.parse(`1970-01-01T${normalizeTime(endTime)}Z`);

  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) {
    return 0;
  }

  return Math.round((end - start) / 60000);
};

export const isSupabaseError = (error: unknown): error is PostgrestError => {
  return Boolean(error && typeof error === 'object' && 'message' in error && 'code' in error);
};
