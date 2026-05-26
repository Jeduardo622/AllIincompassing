import { supabase } from '../supabase';
import { fetchStaffRecipients } from './fetchStaffRecipients';
import { fetchThreadParticipantNames } from './fetchThreadParticipantNames';
import { isMessagingSchemaUnavailable } from './errors';
import type {
  Message,
  MessageThreadParticipant,
  MessageThreadListItem,
} from './types';

export { fetchStaffRecipients };

const isThreadUnread = (
  participant: Pick<MessageThreadParticipant, 'last_read_at' | 'muted_at' | 'archived_at'> | undefined,
  latestMessageAt: string | null | undefined,
): boolean => {
  if (!participant || participant.archived_at || participant.muted_at || !latestMessageAt) {
    return false;
  }

  if (!participant.last_read_at) {
    return true;
  }

  return new Date(latestMessageAt).getTime() > new Date(participant.last_read_at).getTime();
};

const fetchParticipantNamesByThread = async (
  threadIds: string[],
  currentUserId: string,
): Promise<Map<string, string[]>> => {
  const participantNames = await Promise.all(threadIds.map(async (threadId) => {
    const names = await fetchThreadParticipantNames(threadId);
    return [
      threadId,
      Array.from(names.entries())
        .filter(([userId]) => userId !== currentUserId)
        .map(([, name]) => name),
    ] as const;
  }));

  return new Map(participantNames);
};

export const fetchMessageThreads = async (
  organizationId: string,
  userId: string,
): Promise<{ threads: MessageThreadListItem[]; schemaUnavailable: boolean; unreadThreadCount: number }> => {
  try {
    const { data: participants, error: participantError } = await supabase
      .from('message_thread_participants')
      .select('thread_id, last_read_at, archived_at, muted_at, joined_at, organization_id, user_id')
      .eq('user_id', userId)
      .eq('organization_id', organizationId)
      .is('archived_at', null);

    if (participantError) {
      if (isMessagingSchemaUnavailable(participantError)) {
        return { threads: [], schemaUnavailable: true, unreadThreadCount: 0 };
      }
      throw participantError;
    }

    const threadIds = (participants ?? []).map((row) => row.thread_id);
    if (threadIds.length === 0) {
      return { threads: [], schemaUnavailable: false, unreadThreadCount: 0 };
    }

    const { data: threads, error: threadError } = await supabase
      .from('message_threads')
      .select('*')
      .eq('organization_id', organizationId)
      .in('id', threadIds)
      .order('updated_at', { ascending: false });

    if (threadError) {
      if (isMessagingSchemaUnavailable(threadError)) {
        return { threads: [], schemaUnavailable: true, unreadThreadCount: 0 };
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

    const threadIdsNeedingParticipantNames = (threads ?? [])
      .filter((thread) => thread.thread_type === 'direct' && !(thread.subject ?? '').trim())
      .map((thread) => thread.id);

    const participantNamesByThread = await fetchParticipantNamesByThread(
      threadIdsNeedingParticipantNames,
      userId,
    ).catch((nameError) => {
      if (isMessagingSchemaUnavailable(nameError)) {
        return new Map<string, string[]>();
      }
      throw nameError;
    });

    const list: MessageThreadListItem[] = (threads ?? []).map((thread) => {
      const participant = participantByThread.get(thread.id);
      const latest = latestByThread.get(thread.id);
      const isUnread = isThreadUnread(participant, latest?.created_at ?? null);
      return {
        ...thread,
        participant_names: participantNamesByThread.get(thread.id) ?? [],
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
        isUnread,
      };
    });

    return {
      threads: list,
      schemaUnavailable: false,
      unreadThreadCount: list.filter((thread) => thread.isUnread).length,
    };
  } catch (error) {
    if (isMessagingSchemaUnavailable(error)) {
      return { threads: [], schemaUnavailable: true, unreadThreadCount: 0 };
    }
    throw error;
  }
};

export const fetchThreadMessages = async (threadId: string): Promise<Message[]> => {
  const [messagesResult, participantNames] = await Promise.all([
    supabase
      .from('messages')
      .select('*')
      .eq('thread_id', threadId)
      .order('created_at', { ascending: true }),
    fetchThreadParticipantNames(threadId).catch((nameError) => {
      if (isMessagingSchemaUnavailable(nameError)) {
        return new Map<string, string>();
      }
      throw nameError;
    }),
  ]);

  const { data, error } = messagesResult;

  if (error) {
    if (isMessagingSchemaUnavailable(error)) {
      return [];
    }
    throw error;
  }

  return ((data ?? []) as Message[]).map((message) => ({
    ...message,
    sender_name: participantNames.get(message.sender_id) ?? 'Staff member',
  }));
};

export const fetchMessageThread = async (threadId: string, currentUserId: string) => {
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

  if (!data) {
    return null;
  }

  const participantNames = await fetchThreadParticipantNames(threadId).catch((nameError) => {
    if (isMessagingSchemaUnavailable(nameError)) {
      return new Map<string, string>();
    }
    throw nameError;
  });

  return {
    ...data,
    participant_names: Array.from(participantNames.entries())
      .filter(([userId]) => userId !== currentUserId)
      .map(([, name]) => name),
  };
};

