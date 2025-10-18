import type { SupabaseClient } from '@supabase/supabase-js';
import type { Client } from '../../types';
import type { Database } from '../generated/database.types';
import { supabase } from '../supabase';
import { CLIENT_SELECT } from './select';

export type ClientsSupabaseClient = SupabaseClient<Database>;

type GuardianPortalRpcRow = Database['public']['Functions']['get_guardian_client_portal']['Returns'][number];

export interface GuardianPortalTherapistSummary {
  readonly id: string | null;
  readonly fullName: string | null;
}

export interface GuardianPortalSession {
  readonly id: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly status: string;
  readonly therapist: GuardianPortalTherapistSummary | null;
}

export interface GuardianPortalNote {
  readonly id: string;
  readonly content?: string | null;
  readonly createdAt?: string | null;
  readonly status?: string | null;
  readonly createdBy?: string | null;
  readonly createdByName?: string | null;
}

export interface GuardianPortalClient {
  readonly clientId: string;
  readonly fullName: string;
  readonly dateOfBirth: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly status: string | null;
  readonly relationship: string | null;
  readonly isPrimaryGuardian: boolean;
  readonly upcomingSessions: GuardianPortalSession[];
  readonly notes: GuardianPortalNote[];
}

const parseTherapistSummary = (value: unknown): GuardianPortalTherapistSummary | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id : null;
  const fullName = typeof record.full_name === 'string'
    ? record.full_name
    : typeof record.fullName === 'string'
      ? record.fullName
      : null;

  if (!id && !fullName) {
    return null;
  }

  return { id, fullName };
};

const parseGuardianSession = (input: unknown): GuardianPortalSession | null => {
  if (!input || typeof input !== 'object') {
    return null;
  }

  const record = input as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id : null;
  const startTime = typeof record.start_time === 'string' ? record.start_time : null;
  const endTime = typeof record.end_time === 'string' ? record.end_time : null;
  const status = typeof record.status === 'string' ? record.status : null;

  if (!id || !startTime || !endTime || !status) {
    return null;
  }

  return {
    id,
    startTime,
    endTime,
    status,
    therapist: parseTherapistSummary(record.therapist ?? record.therapist_summary ?? null),
  };
};

const parseGuardianNote = (input: unknown): GuardianPortalNote | null => {
  if (!input || typeof input !== 'object') {
    return null;
  }

  const record = input as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id : null;

  if (!id) {
    return null;
  }

  return {
    id,
    content: typeof record.content === 'string' ? record.content : null,
    createdAt: typeof record.created_at === 'string' ? record.created_at : null,
    status: typeof record.status === 'string' ? record.status : null,
    createdBy: typeof record.created_by === 'string' ? record.created_by : null,
    createdByName: typeof record.created_by_name === 'string' ? record.created_by_name : null,
  };
};

const parseGuardianPortalRow = (row: GuardianPortalRpcRow): GuardianPortalClient => {
  const rawSessions = Array.isArray(row.upcoming_sessions) ? row.upcoming_sessions : [];
  const rawNotes = Array.isArray(row.guardian_notes) ? row.guardian_notes : [];

  const upcomingSessions = rawSessions
    .map((item) => parseGuardianSession(item))
    .filter((session): session is GuardianPortalSession => session !== null);

  const notes = rawNotes
    .map((item) => parseGuardianNote(item))
    .filter((note): note is GuardianPortalNote => note !== null);

  return {
    clientId: row.client_id,
    fullName: row.client_full_name,
    dateOfBirth: row.client_date_of_birth ?? null,
    email: row.client_email ?? null,
    phone: row.client_phone ?? null,
    status: row.client_status ?? null,
    relationship: row.guardian_relationship ?? null,
    isPrimaryGuardian: Boolean(row.guardian_is_primary),
    upcomingSessions,
    notes,
  };
};

const DEFAULT_ORDER_COLUMN = 'full_name';

export const fetchClients = async (
  client: ClientsSupabaseClient = supabase
): Promise<Client[]> => {
  const { data, error } = await client
    .from('clients')
    .select(CLIENT_SELECT)
    .order(DEFAULT_ORDER_COLUMN, { ascending: true });

  if (error) {
    throw error;
  }

  return (data ?? []) as Client[];
};

export const fetchClientById = async (
  clientId: string,
  client: ClientsSupabaseClient = supabase
): Promise<Client | null> => {
  const { data, error } = await client
    .from('clients')
    .select(CLIENT_SELECT)
    .eq('id', clientId)
    .single();

  if (error) {
    throw error;
  }

  return (data ?? null) as Client | null;
};

export const fetchGuardianClients = async (
  client: ClientsSupabaseClient = supabase
): Promise<GuardianPortalClient[]> => {
  const { data, error } = await client.rpc('get_guardian_client_portal');

  if (error) {
    throw error;
  }

  return (data ?? []).map(parseGuardianPortalRow);
};

export const fetchGuardianClientById = async (
  clientId: string,
  client: ClientsSupabaseClient = supabase
): Promise<GuardianPortalClient | null> => {
  const { data, error } = await client.rpc('get_guardian_client_portal', {
    p_client_id: clientId,
  });

  if (error) {
    throw error;
  }

  const [first] = data ?? [];
  return first ? parseGuardianPortalRow(first) : null;
};
