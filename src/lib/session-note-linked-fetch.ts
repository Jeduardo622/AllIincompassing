import { supabase } from './supabase';

/** Columns always expected on `client_session_notes` for SessionModal hydration. */
const LINKED_NOTE_BASE_SELECT =
  'id, authorization_id, service_code, narrative, goal_notes, goal_ids, goals_addressed';

const LINKED_NOTE_FULL_SELECT = `${LINKED_NOTE_BASE_SELECT}, goal_measurements`;

export type LinkedClientSessionNoteRow = {
  id: string;
  authorization_id: string;
  service_code: string;
  narrative: string | null;
  goal_notes: unknown;
  goal_measurements: unknown;
  goal_ids: string[] | null;
  goals_addressed: string[] | null;
};

/**
 * PostgREST / Postgres signals when `select` references a column missing from the schema cache
 * (e.g. production DB behind app migrations).
 */
export const isMissingColumnSelectError = (
  error: { code?: string; message?: string; details?: string; hint?: string } | null,
): boolean => {
  if (!error) {
    return false;
  }
  if (error.code === 'PGRST204') {
    return true;
  }
  if (typeof error.code === 'string' && error.code.length > 0 && error.code !== '42703') {
    return false;
  }
  const messageParts = [error.message, error.details, error.hint]
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
    .join(' ');
  if (error.code === '42703' && /goal_measurements/i.test(messageParts)) {
    return true;
  }
  if (/goal_measurements/i.test(messageParts) && /column|does not exist|schema cache/i.test(messageParts)) {
    return true;
  }
  return false;
};

/**
 * Latest `client_session_notes` row for a session. Retries without `goal_measurements` when the
 * column is absent so older databases do not return HTTP 400 for the whole modal.
 */
export async function fetchLinkedClientSessionNoteForSession(params: {
  sessionId: string;
  organizationId: string;
}): Promise<LinkedClientSessionNoteRow | null> {
  const run = (select: string) =>
    supabase
      .from('client_session_notes')
      .select(select)
      .eq('session_id', params.sessionId)
      .eq('organization_id', params.organizationId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

  const full = await run(LINKED_NOTE_FULL_SELECT);
  if (!full.error) {
    return (full.data ?? null) as LinkedClientSessionNoteRow | null;
  }

  if (isMissingColumnSelectError(full.error)) {
    const base = await run(LINKED_NOTE_BASE_SELECT);
    if (base.error) {
      throw base.error;
    }
    const row = base.data as Omit<LinkedClientSessionNoteRow, 'goal_measurements'> | null;
    if (!row) {
      return null;
    }
    return { ...row, goal_measurements: null };
  }

  throw full.error;
}
