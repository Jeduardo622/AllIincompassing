export type MessageThreadType = 'direct' | 'group';

export type MessageThread = {
  id: string;
  organization_id: string;
  created_by: string;
  subject: string | null;
  thread_type: MessageThreadType;
  created_at: string;
  updated_at: string;
};

export type MessageThreadParticipant = {
  thread_id: string;
  user_id: string;
  organization_id: string;
  joined_at: string;
  last_read_at: string | null;
  archived_at: string | null;
  muted_at: string | null;
};

export type Message = {
  id: string;
  thread_id: string;
  sender_id: string;
  body: string;
  created_at: string;
};

export type MessageThreadListItem = MessageThread & {
  participant?: MessageThreadParticipant;
  last_message_preview?: string | null;
  last_message_at?: string | null;
};

export type StaffRecipient = {
  id: string;
  full_name: string;
  email: string;
  role: string;
};

export type CreateThreadInput = {
  subject?: string;
  threadType: MessageThreadType;
  participantUserIds: string[];
};
