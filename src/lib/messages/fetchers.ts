import { supabase } from '../supabase';
import { fetchStaffRecipients } from './fetchStaffRecipients';
import { isMessagingSchemaUnavailable } from './errors';
import type {
  Message,
  MessageThreadListItem,
} from './types';

export { fetchStaffRecipients };

export const fetchMessageThreads = async (
  organizationId: string,
  userId: string,
): Promise<{ threads: MessageThreadListItem[]; schemaUnavailable: boolean }> => {
  try {
    const { data: participants, error: participantError } = await supabase
      .from('message_thread_participants')
      .select('thread_id, last_read_at, archived_at, muted_at, joined_at, organization_id, user_id')
      .eq('user_id', userId)
      .eq('organization_id', organizationId)
      .is('archived_at', null);

    if (participantError) {
      if (isMessagingSchemaUnavailable(participantError)) {
        return { threads: [], schemaUnavailable: true };
      }
      throw participantError;
    }

    const threadIds = (participants ?? []).map((row) => row.thread_id);
    if (threadIds.length === 0) {
      return { threads: [], schemaUnavailable: false };
    }

    const { data: threads, error: threadError } = await supabase
      .from('message_threads')
      .select('*')
      .eq('organization_id', organizationId)
      .in('id', threadIds)
      .order('updated_at', { ascending: false });

    if (threadError) {
      if (isMessagingSchemaUnavailable(threadError)) {
        return { threads: [], schemaUnavailable: true };
      }
      throw threadError;
    }

    const participantByThread = new Map(
      (participants ?? []).map((row) => [row.thread_id, row]),
    );

    const { data: recentMessages, error: messagesError } = await supabase
      .from('messages')
      .select('thread_id, body, created_at')
      .in('thread_id', threadIds)
      .order('created_at', { ascending: false });

    if (messagesError && !isMessagingSchemaUnavailable(messagesError)) {
      throw messagesError;
    }

    const latestByThread = new Map<string, { body: string; created_at: string }>();
    for (const message of recentMessages ?? []) {
      if (!latestByThread.has(message.thread_id)) {
        latestByThread.set(message.thread_id, {
          body: message.body,
          created_at: message.created_at,
        });
      }
    }

    const list: MessageThreadListItem[] = (threads ?? []).map((thread) => {
      const participant = participantByThread.get(thread.id);
      const latest = latestByThread.get(thread.id);
      return {
        ...thread,
        participant: participant
          ? {
              thread_id: thread.id,
              user_id: userId,
              organization_id: organizationId,
              joined_at: participant.joined_at,
              last_read_at: participant.last_read_at,
              archived_at: participant.archived_at,
              muted_at: participant.muted_at,
            }
          : undefined,
        last_message_preview: latest?.body ?? null,
        last_message_at: latest?.created_at ?? null,
      };
    });

    return { threads: list, schemaUnavailable: false };
  } catch (error) {
    if (isMessagingSchemaUnavailable(error)) {
      return { threads: [], schemaUnavailable: true };
    }
    throw error;
  }
};

export const fetchThreadMessages = async (threadId: string): Promise<Message[]> => {
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: true });

  if (error) {
    if (isMessagingSchemaUnavailable(error)) {
      return [];
    }
    throw error;
  }

  return (data ?? []) as Message[];
};

export const fetchMessageThread = async (threadId: string) => {
  const { data, error } = await supabase
    .from('message_threads')
    .select('*')
    .eq('id', threadId)
    .maybeSingle();

  if (error) {
    if (isMessagingSchemaUnavailable(error)) {
      return null;
    }
    throw error;
  }

  return data;
};

