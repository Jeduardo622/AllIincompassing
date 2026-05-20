export const staffMessagesQueryKeys = {
  all: ['staff-messages'] as const,
  threads: (userId: string) => [...staffMessagesQueryKeys.all, 'threads', userId] as const,
  thread: (threadId: string) => [...staffMessagesQueryKeys.all, 'thread', threadId] as const,
  messages: (threadId: string) => [...staffMessagesQueryKeys.all, 'messages', threadId] as const,
  eligibleStaff: (organizationId: string) =>
    [...staffMessagesQueryKeys.all, 'eligible-staff', organizationId] as const,
};
