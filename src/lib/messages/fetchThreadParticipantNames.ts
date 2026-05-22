import { supabase } from '../supabase';

type RpcParticipantNameRow = {
  user_id: string;
  full_name: string | null;
};

/**
 * Thread-scoped display names for message senders.
 * Uses SECURITY DEFINER RPC so participants can resolve co-participant names
 * without profiles_select_self RLS blocking cross-user reads.
 *
 * Re-throws PostgREST errors as-is so callers can detect PGRST202 / schema-cache
 * failures via isMessagingSchemaUnavailable without losing error metadata.
 */
export const fetchThreadParticipantNames = async (
  threadId: string,
): Promise<Map<string, string>> => {
  const { data, error } = await supabase.rpc('list_staff_message_thread_participant_names', {
    p_thread_id: threadId,
  });

  if (error) {
    throw error;
  }

  const map = new Map<string, string>();
  for (const row of (data ?? []) as RpcParticipantNameRow[]) {
    const name = row.full_name?.trim() || 'Staff member';
    map.set(row.user_id, name);
  }
  return map;
};
