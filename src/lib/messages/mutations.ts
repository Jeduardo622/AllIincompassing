import { supabase } from '../supabase';
import { MESSAGE_BODY_MAX_LENGTH } from './constants';
import { isMessagingSchemaUnavailable } from './errors';
import type { CreateThreadInput } from './types';

export const validateMessageBody = (body: string): string | null => {
  const trimmed = body.trim();
  if (!trimmed) {
    return 'Message cannot be empty.';
  }
  if (trimmed.length > MESSAGE_BODY_MAX_LENGTH) {
    return `Message must be at most ${MESSAGE_BODY_MAX_LENGTH} characters.`;
  }
  return null;
};

export const sendThreadMessage = async (threadId: string, body: string, senderId: string) => {
  const validationError = validateMessageBody(body);
  if (validationError) {
    throw new Error(validationError);
  }

  const { data, error } = await supabase
    .from('messages')
    .insert({
      thread_id: threadId,
      sender_id: senderId,
      body: body.trim(),
    })
    .select('*')
    .single();

  if (error) {
    if (isMessagingSchemaUnavailable(error)) {
      throw new Error('Messaging is not available until database migrations are applied.');
    }
    throw error;
  }

  await supabase
    .from('message_thread_participants')
    .update({ last_read_at: new Date().toISOString() })
    .eq('thread_id', threadId)
    .eq('user_id', senderId);

  return data;
};

export const createMessageThread = async (input: CreateThreadInput): Promise<string> => {
  const { data, error } = await supabase.rpc('create_staff_message_thread', {
    p_subject: input.subject?.trim() || null,
    p_thread_type: input.threadType,
    p_participant_user_ids: input.participantUserIds,
  });

  if (error) {
    if (isMessagingSchemaUnavailable(error)) {
      throw new Error('Messaging is not available until database migrations are applied.');
    }
    throw error;
  }

  if (typeof data === 'string') {
    return data;
  }

  if (data && typeof data === 'object' && 'id' in data && typeof (data as { id: unknown }).id === 'string') {
    return (data as { id: string }).id;
  }

  throw new Error('Unexpected response when creating a message thread.');
};

export const markThreadRead = async (threadId: string, userId: string) => {
  const { error } = await supabase
    .from('message_thread_participants')
    .update({ last_read_at: new Date().toISOString() })
    .eq('thread_id', threadId)
    .eq('user_id', userId);

  if (error && !isMessagingSchemaUnavailable(error)) {
    throw error;
  }
};
