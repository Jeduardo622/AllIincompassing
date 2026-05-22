import { supabase } from '../supabase';

type RpcParticipantNameRow = {
  user_id: string;
  full_name: string | null;
};

const isMissingRpc = (error: { code?: string; message?: string }): boolean => {
  const message = (error.message ?? '').toLowerCase();
  return error.code === 'PGRST202' || message.includes('list_staff_message_thread_participant_names');
};

/**
 * Thread-scoped display names for message senders.
 * Uses SECURITY DEFINER RPC so participants can resolve co-participant names
 * without profiles_select_self RLS blocking cross-user reads.
 */
export const fetchThreadParticipantNames = async (
  threadId: string,
): Promise<Map<string, string>> => {
  const { data, error } = await supabase.rpc('list_staff_message_thread_participant_names', {
    p_thread_id: threadId,
  });

  if (error) {
    if (isMissingRpc(error)) {
      throw new Error(
        'Thread participant names are not available until the list_staff_message_thread_participant_names migration is applied.',
      );
    }
    throw error;
  }

  const map = new Map<string, string>();
  for (const row of (data ?? []) as RpcParticipantNameRow[]) {
    const name = row.full_name?.trim() || 'Staff member';
    map.set(row.user_id, name);
  }
  return map;
};
