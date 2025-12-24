import type { PostgrestError } from '@supabase/supabase-js';
import type { SessionNote } from '../types';
import type { Database } from './generated/database.types';
import { supabase } from './supabase';

type ClientSessionNoteRow = Database['public']['Tables']['client_session_notes']['Row'];
type ClientSessionNoteInsert = Database['public']['Tables']['client_session_notes']['Insert'];

interface TherapistSummary {
  readonly full_name: string | null;
  readonly title: string | null;
}

const TABLE = 'client_session_notes';

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
  options: FetchClientSessionNotesOptions = {}
): Promise<SessionNote[]> => {
  if (!clientId) {
    return [];
  }

  const limit = options.limit ?? 100;

  const { data, error } = await supabase
    .from(TABLE)
    .select(
      `
        *,
        therapists:therapist_id (
          full_name,
          title
        )
      `
    )
    .eq('client_id', clientId)
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
    narrative: payload.narrative,
    is_locked: payload.isLocked,
    signed_at: payload.isLocked ? new Date().toISOString() : null,
    session_id: payload.sessionId ?? null,
  };

  const { data, error } = await supabase
    .from(TABLE)
    .insert(insertPayload)
    .select(
      `
        *,
        therapists:therapist_id (
          full_name,
          title
        )
      `
    )
    .single();

  if (error || !data) {
    throw (error ?? new Error('Unable to create session note'));
  }

  return mapRowToSessionNote(
    data as ClientSessionNoteRow & { therapists: TherapistSummary | null },
    (data as { therapists: TherapistSummary | null }).therapists ?? null
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

