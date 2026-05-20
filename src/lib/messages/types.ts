export type MessageThreadType = 'direct' | 'group';

export interface ThreadListItem {
  threadId: string;
  subject: string | null;
  threadType: MessageThreadType;
  updatedAt: string;
  lastReadAt: string | null;
  latestMessageBody: string | null;
  latestMessageAt: string | null;
  latestMessageSenderId: string | null;
}

export interface StaffMessage {
  id: string;
  threadId: string;
  senderId: string;
  body: string;
  createdAt: string;
}

export interface ThreadParticipantProfile {
  userId: string;
  fullName: string;
  email: string;
}

export interface ThreadDetail {
  id: string;
  subject: string | null;
  threadType: MessageThreadType;
  updatedAt: string;
  createdAt: string;
  participants: ThreadParticipantProfile[];
}

export interface StaffMember {
  id: string;
  fullName: string;
  email: string;
}

export interface CreateThreadInput {
  subject?: string | null;
  threadType: MessageThreadType;
  participantUserIds: string[];
}

export interface SendMessageInput {
  threadId: string;
  senderId: string;
  body: string;
}
