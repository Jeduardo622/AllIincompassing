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

export interface ClientNote {
  readonly id: string;
  readonly content: string;
  readonly createdAt: string;
  readonly status: string | null;
  readonly createdBy: string | null;
  readonly createdByName: string | null;
  readonly isVisibleToParent: boolean;
  readonly isVisibleToTherapist: boolean;
}

export interface ClientIssue {
  readonly id: string;
  readonly category: string | null;
  readonly description: string | null;
  readonly status: string | null;
  readonly priority: string | null;
  readonly dateOpened: string | null;
  readonly lastAction: string | null;
}

export interface GuardianContactConfirmationResult {
  readonly confirmedAt: string;
  readonly metadata: Record<string, unknown>;
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

export interface GuardianContactMetadataEntry {
  readonly clientId: string;
  readonly metadata: Record<string, unknown>;
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

export interface FetchClientNotesOptions {
  readonly visibleToParentOnly?: boolean;
}

const parseClientNote = (row: Record<string, unknown>): ClientNote | null => {
  const id = typeof row.id === 'string' ? row.id : null;
  const content = typeof row.content === 'string' ? row.content : '';
  const createdAt = typeof row.created_at === 'string' ? row.created_at : null;
  const status = typeof row.status === 'string' ? row.status : null;
  const createdBy = typeof row.created_by === 'string' ? row.created_by : null;
  const isVisibleToParent = Boolean(row.is_visible_to_parent);
  const isVisibleToTherapist = Boolean(row.is_visible_to_therapist ?? true);

  if (!id || !createdAt) {
    return null;
  }

  const profile = (row.created_by_profile ?? null) as Record<string, unknown> | null;
  const createdByName = typeof profile?.full_name === 'string' ? profile.full_name : null;

  return {
    id,
    content,
    createdAt,
    status,
    createdBy,
    createdByName,
    isVisibleToParent,
    isVisibleToTherapist,
  };
};

export const fetchClientNotes = async (
  clientId: string,
  options: FetchClientNotesOptions = {},
  client: ClientsSupabaseClient = supabase
): Promise<ClientNote[]> => {
  const query = client
    .from('client_notes')
    .select(
      `
        id,
        content,
        status,
        created_at,
        created_by,
        is_visible_to_parent,
        is_visible_to_therapist,
        created_by_profile:profiles!client_notes_created_by_fkey(full_name)
      `
    )
    .eq('client_id', clientId)
    .order('created_at', { ascending: false });

  if (options.visibleToParentOnly) {
    query.eq('is_visible_to_parent', true);
  }

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  return (data ?? [])
    .map((row) => parseClientNote(row as Record<string, unknown>))
    .filter((note): note is ClientNote => note !== null);
};

const parseClientIssue = (row: Record<string, unknown>): ClientIssue | null => {
  const id = typeof row.id === 'string' ? row.id : null;
  if (!id) {
    return null;
  }

  const category = typeof row.category === 'string' ? row.category : null;
  const description = typeof row.description === 'string' ? row.description : null;
  const status = typeof row.status === 'string' ? row.status : null;
  const priority = typeof row.priority === 'string' ? row.priority : null;
  const dateOpened = typeof row.date_opened === 'string' ? row.date_opened : null;
  const lastAction = typeof row.last_action === 'string' ? row.last_action : null;

  return {
    id,
    category,
    description,
    status,
    priority,
    dateOpened,
    lastAction,
  };
};

export const fetchClientIssues = async (
  clientId: string,
  client: ClientsSupabaseClient = supabase
): Promise<ClientIssue[]> => {
  const { data, error } = await client
    .from('client_issues')
    .select('*')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false });

  if (error) {
    // Allow deployments that have not created the issues table yet to continue gracefully.
    if ((error as { code?: string }).code === '42P01') {
      return [];
    }

    if (typeof error.message === 'string' && error.message.includes('client_issues')) {
      return [];
    }

    throw error;
  }

  return (data ?? [])
    .map((row) => parseClientIssue(row as Record<string, unknown>))
    .filter((issue): issue is ClientIssue => issue !== null);
};

export const confirmGuardianContactInfo = async (
  guardianId: string,
  clientId: string,
  client: ClientsSupabaseClient = supabase
): Promise<GuardianContactConfirmationResult> => {
  const confirmedAt = new Date().toISOString();

  const { data: existing, error: fetchError } = await client
    .from('client_guardians')
    .select('id, metadata')
    .eq('guardian_id', guardianId)
    .eq('client_id', clientId)
    .eq('deleted_at', null)
    .maybeSingle();

  if (fetchError) {
    throw fetchError;
  }

  if (!existing) {
    throw new Error('Guardian link not found for confirmation');
  }

  const currentMetadata = (existing.metadata as Record<string, unknown> | null) ?? {};
  const metadata = {
    ...currentMetadata,
    last_confirmed_at: confirmedAt,
  };

  const { data: updated, error: updateError } = await client
    .from('client_guardians')
    .update({ metadata })
    .eq('id', existing.id)
    .select('metadata')
    .single();

  if (updateError) {
    throw updateError;
  }

  return {
    confirmedAt,
    metadata: (updated?.metadata as Record<string, unknown> | null) ?? metadata,
  };
};

export const fetchGuardianContactMetadata = async (
  guardianId: string,
  client: ClientsSupabaseClient = supabase,
): Promise<GuardianContactMetadataEntry[]> => {
  const { data, error } = await client
    .from('client_guardians')
    .select('client_id, metadata')
    .eq('guardian_id', guardianId)
    .eq('deleted_at', null);

  if (error) {
    throw error;
  }

  return (data ?? [])
    .map((row) => ({
      clientId: String((row as Record<string, unknown>).client_id ?? ''),
      metadata: ((row as Record<string, unknown>).metadata as Record<string, unknown> | null) ?? {},
    }))
    .filter((entry) => Boolean(entry.clientId));
};
