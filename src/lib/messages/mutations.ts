import { supabase } from '../supabase';
import { MESSAGE_BODY_MAX_LENGTH } from './constants';
import type { CreateThreadInput, SendMessageInput } from './types';

const normalizeBody = (body: string): string => {
  const trimmed = body.trim();
  if (!trimmed) {
    throw new Error('Message body cannot be empty');
  }
  if (trimmed.length > MESSAGE_BODY_MAX_LENGTH) {
    throw new Error(`Message body must be at most ${MESSAGE_BODY_MAX_LENGTH} characters`);
  }
  return trimmed;
};

export async function createThread(input: CreateThreadInput): Promise<string> {
  const { data, error } = await supabase.rpc('create_staff_message_thread', {
    p_subject: input.subject?.trim() || null,
    p_thread_type: input.threadType,
    p_participant_user_ids: input.participantUserIds,
  });

  if (error) {
    throw error;
  }
  if (typeof data !== 'string' || !data) {
    throw new Error('create_staff_message_thread returned an unexpected payload');
  }
  return data;
}

export async function sendMessage(input: SendMessageInput): Promise<void> {
  const body = normalizeBody(input.body);
  const { error } = await supabase.from('messages').insert({
    thread_id: input.threadId,
    sender_id: input.senderId,
    body,
  });

  if (error) {
    throw error;
  }
}

export async function markThreadRead(threadId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('message_thread_participants')
    .update({ last_read_at: new Date().toISOString() })
    .eq('thread_id', threadId)
    .eq('user_id', userId);

  if (error) {
    throw error;
  }
}
