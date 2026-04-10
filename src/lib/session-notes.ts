import type { PostgrestError } from '@supabase/supabase-js';
import type { SessionGoalMeasurementEntry, SessionNote } from '../types';
import type { Database } from './generated/database.types';
import { supabase } from './supabase';

type ClientSessionNoteRow = Database['public']['Tables']['client_session_notes']['Row'];
type ClientSessionNoteInsert = Database['public']['Tables']['client_session_notes']['Insert'];

interface TherapistSummary {
  readonly full_name: string | null;
  readonly title: string | null;
}

const toOptionalNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const toOptionalString = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export const normalizeSessionGoalMeasurementEntry = (
  rawValue: unknown,
): SessionGoalMeasurementEntry | null => {
  if (!rawValue || typeof rawValue !== 'object') {
    return null;
  }

  const candidate = rawValue as {
    version?: unknown;
    data?: Record<string, unknown>;
  } & Record<string, unknown>;
  const sourceData =
    candidate.data && typeof candidate.data === 'object'
      ? candidate.data
      : candidate;
  const normalized: SessionGoalMeasurementEntry = {
    version: 1,
    data: {
      measurement_type: toOptionalString(sourceData.measurement_type),
      metric_label: toOptionalString(sourceData.metric_label) ?? 'Count',
      metric_unit: toOptionalString(sourceData.metric_unit),
      metric_value: toOptionalNumber(
        sourceData.metric_value ?? sourceData.count ?? sourceData.value,
      ),
      opportunities: toOptionalNumber(
        sourceData.opportunities ?? sourceData.trials,
      ),
      prompt_level: toOptionalString(
        sourceData.prompt_level ?? sourceData.promptLevel,
      ),
      note: toOptionalString(sourceData.note ?? sourceData.comment),
    },
  };

  const { data } = normalized;
  const hasMeaningfulValue =
    (data.metric_value !== null && data.metric_value !== undefined) ||
    (data.opportunities !== null && data.opportunities !== undefined) ||
    Boolean(data.prompt_level) ||
    Boolean(data.note);

  return hasMeaningfulValue ? normalized : null;
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

export const createClientSessionNote = async (
  payload: CreateClientSessionNoteInput
): Promise<SessionNote> => {
  const { data: authorization, error: authError } = await supabase
    .from('authorizations')
    .select(
      `
        id,
        organization_id,
        status,
        start_date,
        end_date,
        services:authorization_services (
          service_code,
          approved_units
        )
      `
    )
    .eq('id', payload.authorizationId)
    .single();

  if (authError || !authorization) {
    throw (authError ?? new Error('Authorization not found.'));
  }

  if (authorization.organization_id !== payload.organizationId) {
    throw new Error('Authorization does not belong to the active organization.');
  }

  if (authorization.status !== 'approved') {
    throw new Error('Authorization must be approved before creating session notes.');
  }

  const sessionDate = new Date(payload.sessionDate);
  if (sessionDate < new Date(authorization.start_date) || sessionDate > new Date(authorization.end_date)) {
    throw new Error('Session date must be within the authorization date range.');
  }

  const matchedService = (authorization.services ?? []).find(
    (service) => service.service_code === payload.serviceCode
  );

  if (!matchedService) {
    throw new Error('Selected service code is not part of this authorization.');
  }

  const goalNotesValue =
    payload.goalNotes && Object.keys(payload.goalNotes).length > 0
      ? payload.goalNotes
      : null;
  const goalMeasurementsValue =
    payload.goalMeasurements && Object.keys(payload.goalMeasurements).length > 0
      ? payload.goalMeasurements
      : null;

  const insertPayload: ClientSessionNoteInsert = {
    authorization_id: payload.authorizationId,
    client_id: payload.clientId,
    therapist_id: payload.therapistId,
    created_by: payload.createdBy,
    organization_id: payload.organizationId,
    service_code: payload.serviceCode,
    session_date: payload.sessionDate,
    start_time: payload.startTime,
    end_time: payload.endTime,
    session_duration: payload.sessionDuration,
    goals_addressed: payload.goalsAddressed,
    goal_ids: payload.goalIds ?? null,
    goal_measurements: goalMeasurementsValue,
    goal_notes: goalNotesValue,
    narrative: payload.narrative,
    is_locked: payload.isLocked,
    signed_at: payload.isLocked ? new Date().toISOString() : null,
    session_id: payload.sessionId ?? null,
  };

  const { data, error } = await supabase
    .from(TABLE)
    .insert(insertPayload)
    .select(SESSION_NOTE_WITH_THERAPIST_SELECT)
    .single();

  if (error || !data) {
    throw (error ?? new Error('Unable to create session note'));
  }

  return mapRowToSessionNote(
    data as ClientSessionNoteRow & { therapists: TherapistSummary | null },
    (data as { therapists: TherapistSummary | null }).therapists ?? null
  );
};

export const updateClientSessionNote = async (
  payload: UpdateClientSessionNoteInput,
): Promise<SessionNote> => {
  const { data: existingRow, error: existingError } = await supabase
    .from(TABLE)
    .select('id, is_locked')
    .eq('id', payload.noteId)
    .eq('organization_id', payload.organizationId)
    .maybeSingle();

  if (existingError) {
    throw existingError;
  }

  if (!existingRow?.id) {
    throw new Error('Session note not found.');
  }

  if (existingRow.is_locked) {
    throw new Error('Session note is locked and cannot be edited.');
  }

  const { data: authorization, error: authError } = await supabase
    .from('authorizations')
    .select(
      `
        id,
        organization_id,
        status,
        start_date,
        end_date,
        services:authorization_services (
          service_code,
          approved_units
        )
      `
    )
    .eq('id', payload.authorizationId)
    .single();

  if (authError || !authorization) {
    throw (authError ?? new Error('Authorization not found.'));
  }

  if (authorization.organization_id !== payload.organizationId) {
    throw new Error('Authorization does not belong to the active organization.');
  }

  if (authorization.status !== 'approved') {
    throw new Error('Authorization must be approved before editing session notes.');
  }

  const sessionDate = new Date(payload.sessionDate);
  if (sessionDate < new Date(authorization.start_date) || sessionDate > new Date(authorization.end_date)) {
    throw new Error('Session date must be within the authorization date range.');
  }

  const matchedService = (authorization.services ?? []).find(
    (service) => service.service_code === payload.serviceCode
  );

  if (!matchedService) {
    throw new Error('Selected service code is not part of this authorization.');
  }

  const goalNotesValue =
    payload.goalNotes && Object.keys(payload.goalNotes).length > 0
      ? Object.fromEntries(
          Object.entries(payload.goalNotes)
            .map(([goalId, noteText]) => [goalId, noteText.trim()])
            .filter(([, noteText]) => noteText.length > 0),
        )
      : null;
  const goalMeasurementsValue =
    payload.goalMeasurements && Object.keys(payload.goalMeasurements).length > 0
      ? payload.goalMeasurements
      : null;

  const { data, error } = await supabase
    .from(TABLE)
    .update({
      authorization_id: payload.authorizationId,
      client_id: payload.clientId,
      therapist_id: payload.therapistId,
      updated_by: payload.actorUserId,
      organization_id: payload.organizationId,
      service_code: payload.serviceCode,
      session_date: payload.sessionDate,
      start_time: payload.startTime,
      end_time: payload.endTime,
      session_duration: payload.sessionDuration,
      goals_addressed: payload.goalsAddressed,
      goal_ids: payload.goalIds ?? null,
      goal_measurements: goalMeasurementsValue,
      goal_notes: goalNotesValue,
      narrative: payload.narrative.trim(),
      is_locked: payload.isLocked,
      signed_at: payload.isLocked ? new Date().toISOString() : null,
      session_id: payload.sessionId ?? null,
    })
    .eq('id', payload.noteId)
    .eq('organization_id', payload.organizationId)
    .select(SESSION_NOTE_WITH_THERAPIST_SELECT)
    .single();

  if (error || !data) {
    throw (error ?? new Error('Unable to update session note'));
  }

  return mapRowToSessionNote(
    data as ClientSessionNoteRow & { therapists: TherapistSummary | null },
    (data as { therapists: TherapistSummary | null }).therapists ?? null,
  );
};

export const upsertClientSessionNoteForSession = async (
  payload: UpsertClientSessionNoteForSessionInput,
): Promise<SessionNote> => {
  const trimmedNarrative = payload.narrative.trim();
  const cleanedGoalNotes = Object.fromEntries(
    Object.entries(payload.goalNotes)
      .map(([goalId, noteText]) => [goalId, noteText.trim()])
      .filter(([, noteText]) => noteText.length > 0),
  );
  const cleanedGoalMeasurements =
    payload.goalMeasurements && Object.keys(payload.goalMeasurements).length > 0
      ? payload.goalMeasurements
      : null;
  const sessionDuration = calculateSessionDurationMinutes(payload.startTime, payload.endTime);
  if (sessionDuration <= 0) {
    throw new Error('End time must be later than start time.');
  }

  const { data: existingRow, error: existingError } = await supabase
    .from(TABLE)
    .select('id, is_locked')
    .eq('session_id', payload.sessionId)
    .eq('organization_id', payload.organizationId)
    .maybeSingle();

  if (existingError) {
    throw existingError;
  }

  if (existingRow?.is_locked) {
    throw new Error('Session note is locked and cannot be edited from schedule.');
  }

  if (!existingRow?.id) {
    return createClientSessionNote({
      authorizationId: payload.authorizationId,
      clientId: payload.clientId,
      createdBy: payload.actorUserId,
      organizationId: payload.organizationId,
      therapistId: payload.therapistId,
      serviceCode: payload.serviceCode,
      sessionDate: payload.sessionDate,
      startTime: payload.startTime,
      endTime: payload.endTime,
      sessionDuration,
      goalsAddressed: payload.goalsAddressed,
      goalIds: payload.goalIds,
      goalMeasurements: cleanedGoalMeasurements,
      goalNotes: cleanedGoalNotes,
      narrative: trimmedNarrative,
      isLocked: false,
      sessionId: payload.sessionId,
    });
  }

  const { data, error } = await supabase
    .from(TABLE)
    .update({
      authorization_id: payload.authorizationId,
      therapist_id: payload.therapistId,
      service_code: payload.serviceCode,
      session_date: payload.sessionDate,
      start_time: payload.startTime,
      end_time: payload.endTime,
      session_duration: sessionDuration,
      goals_addressed: payload.goalsAddressed,
      goal_ids: payload.goalIds,
      goal_measurements: cleanedGoalMeasurements,
      goal_notes: Object.keys(cleanedGoalNotes).length > 0 ? cleanedGoalNotes : null,
      narrative: trimmedNarrative,
      session_id: payload.sessionId,
    })
    .eq('id', existingRow.id)
    .eq('organization_id', payload.organizationId)
    .select(SESSION_NOTE_WITH_THERAPIST_SELECT)
    .single();

  if (error || !data) {
    throw (error ?? new Error('Unable to update session note'));
  }

  return mapRowToSessionNote(
    data as ClientSessionNoteRow & { therapists: TherapistSummary | null },
    (data as { therapists: TherapistSummary | null }).therapists ?? null,
  );
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
