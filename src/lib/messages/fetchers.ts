import { supabase } from '../supabase';
import { STAFF_ROLE_NAMES } from './constants';
import type {
  MessageThreadType,
  StaffMember,
  StaffMessage,
  ThreadDetail,
  ThreadListItem,
  ThreadParticipantProfile,
} from './types';

const isStaffRoleName = (name: string): boolean =>
  (STAFF_ROLE_NAMES as readonly string[]).includes(name);

const roleRowIsActive = (isActive: boolean | null, expiresAt: string | null): boolean => {
  if (isActive === false) {
    return false;
  }
  if (!expiresAt) {
    return true;
  }
  const parsed = new Date(expiresAt);
  if (Number.isNaN(parsed.getTime())) {
    return true;
  }
  return parsed.getTime() > Date.now();
};

const toThreadType = (value: string): MessageThreadType =>
  value === 'group' ? 'group' : 'direct';

type InboxParticipantRow = {
  thread_id: string;
  last_read_at: string | null;
  thread: {
    id: string;
    subject: string | null;
    thread_type: string;
    updated_at: string;
  } | null;
};

export async function listInboxThreads(userId: string): Promise<ThreadListItem[]> {
  const { data, error } = await supabase
    .from('message_thread_participants')
    .select(
      `
      thread_id,
      last_read_at,
      thread:message_threads (
        id,
        subject,
        thread_type,
        updated_at
      )
    `,
    )
    .eq('user_id', userId)
    .is('archived_at', null);

  if (error) {
    throw error;
  }

  const rows = (data ?? []) as InboxParticipantRow[];
  const threadIds = rows
    .map((row) => row.thread?.id ?? row.thread_id)
    .filter((id): id is string => Boolean(id));

  const latestByThread = new Map<
    string,
    { body: string; created_at: string; sender_id: string }
  >();

  if (threadIds.length > 0) {
    const { data: messageRows, error: messagesError } = await supabase
      .from('messages')
      .select('id, thread_id, body, created_at, sender_id')
      .in('thread_id', threadIds)
      .order('created_at', { ascending: false });

    if (messagesError) {
      throw messagesError;
    }

    for (const message of messageRows ?? []) {
      if (!latestByThread.has(message.thread_id)) {
        latestByThread.set(message.thread_id, message);
      }
    }
  }

  const items: ThreadListItem[] = [];

  for (const row of rows) {
    const thread = row.thread;
    if (!thread) {
      continue;
    }
    const latest = latestByThread.get(thread.id);
    items.push({
      threadId: thread.id,
      subject: thread.subject,
      threadType: toThreadType(thread.thread_type),
      updatedAt: thread.updated_at,
      lastReadAt: row.last_read_at,
      latestMessageBody: latest?.body ?? null,
      latestMessageAt: latest?.created_at ?? null,
      latestMessageSenderId: latest?.sender_id ?? null,
    });
  }

  items.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  return items;
}

export async function getThreadDetail(threadId: string): Promise<ThreadDetail | null> {
  const { data: thread, error: threadError } = await supabase
    .from('message_threads')
    .select('id, subject, thread_type, updated_at, created_at')
    .eq('id', threadId)
    .maybeSingle();

  if (threadError) {
    throw threadError;
  }
  if (!thread) {
    return null;
  }

  const { data: participantRows, error: participantsError } = await supabase
    .from('message_thread_participants')
    .select('user_id')
    .eq('thread_id', threadId);

  if (participantsError) {
    throw participantsError;
  }

  const userIds = (participantRows ?? []).map((row) => row.user_id);
  let participants: ThreadParticipantProfile[] = [];

  if (userIds.length > 0) {
    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .in('id', userIds);

    if (profilesError) {
      throw profilesError;
    }

    participants = (profiles ?? []).map((profile) => ({
      userId: profile.id,
      fullName: profile.full_name?.trim() || profile.email,
      email: profile.email,
    }));
  }

  return {
    id: thread.id,
    subject: thread.subject,
    threadType: toThreadType(thread.thread_type),
    updatedAt: thread.updated_at,
    createdAt: thread.created_at,
    participants,
  };
}

export async function listThreadMessages(threadId: string): Promise<StaffMessage[]> {
  const { data, error } = await supabase
    .from('messages')
    .select('id, thread_id, sender_id, body, created_at')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: true });

  if (error) {
    throw error;
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    threadId: row.thread_id,
    senderId: row.sender_id,
    body: row.body,
    createdAt: row.created_at,
  }));
}

export async function listEligibleStaff(organizationId: string): Promise<StaffMember[]> {
  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id, full_name, email, organization_id, is_active')
    .eq('organization_id', organizationId)
    .eq('is_active', true);

  if (profilesError) {
    throw profilesError;
  }

  const profileRows = profiles ?? [];
  if (profileRows.length === 0) {
    return [];
  }

  const userIds = profileRows.map((profile) => profile.id);
  const { data: roleRows, error: rolesError } = await supabase
    .from('user_roles')
    .select('user_id, is_active, expires_at, roles!inner(name)')
    .in('user_id', userIds);

  if (rolesError) {
    throw rolesError;
  }

  const staffUserIds = new Set<string>();
  for (const row of roleRows ?? []) {
    const roleName = row.roles?.name;
    if (!roleName || !isStaffRoleName(roleName)) {
      continue;
    }
    if (!roleRowIsActive(row.is_active, row.expires_at)) {
      continue;
    }
    staffUserIds.add(row.user_id);
  }

  return profileRows
    .filter((profile) => staffUserIds.has(profile.id))
    .map((profile) => ({
      id: profile.id,
      fullName: profile.full_name?.trim() || profile.email,
      email: profile.email,
    }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
}
