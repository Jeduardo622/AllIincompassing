import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../authContext';
import { useActiveOrganizationId } from '../organization';
import { STAFF_MESSAGING_REFETCH_MS } from './constants';
import { createThread, markThreadRead, sendMessage } from './mutations';
import { getThreadDetail, listEligibleStaff, listInboxThreads, listThreadMessages } from './fetchers';
import { staffMessagesQueryKeys } from './queryKeys';
import type { CreateThreadInput, MessageThreadType, SendMessageInput } from './types';

export function useInboxThreads() {
  const { user } = useAuth();
  const userId = user?.id;

  return useQuery({
    queryKey: staffMessagesQueryKeys.threads(userId ?? 'anonymous'),
    queryFn: () => {
      if (!userId) {
        throw new Error('User is required to load inbox threads');
      }
      return listInboxThreads(userId);
    },
    enabled: Boolean(userId),
    refetchInterval: STAFF_MESSAGING_REFETCH_MS,
  });
}

export function useThreadDetail(threadId: string | undefined) {
  return useQuery({
    queryKey: staffMessagesQueryKeys.thread(threadId ?? 'unknown'),
    queryFn: () => {
      if (!threadId) {
        throw new Error('Thread id is required');
      }
      return getThreadDetail(threadId);
    },
    enabled: Boolean(threadId),
  });
}

export function useThreadMessages(threadId: string | undefined) {
  return useQuery({
    queryKey: staffMessagesQueryKeys.messages(threadId ?? 'unknown'),
    queryFn: () => {
      if (!threadId) {
        throw new Error('Thread id is required');
      }
      return listThreadMessages(threadId);
    },
    enabled: Boolean(threadId),
    refetchInterval: STAFF_MESSAGING_REFETCH_MS,
  });
}

export function useEligibleStaff() {
  const organizationId = useActiveOrganizationId();

  return useQuery({
    queryKey: staffMessagesQueryKeys.eligibleStaff(organizationId ?? 'none'),
    queryFn: () => {
      if (!organizationId) {
        throw new Error('Organization is required to load staff recipients');
      }
      return listEligibleStaff(organizationId);
    },
    enabled: Boolean(organizationId),
  });
}

export function useCreateThreadMutation() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: (input: CreateThreadInput) => createThread(input),
    onSuccess: async () => {
      if (user?.id) {
        await queryClient.invalidateQueries({ queryKey: staffMessagesQueryKeys.threads(user.id) });
      }
    },
  });
}

export function useSendMessageMutation(threadId: string | undefined) {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: (input: Omit<SendMessageInput, 'threadId' | 'senderId'> & { body: string }) => {
      if (!threadId || !user?.id) {
        throw new Error('Thread and user are required to send a message');
      }
      return sendMessage({
        threadId,
        senderId: user.id,
        body: input.body,
      });
    },
    onSuccess: async () => {
      if (!threadId) {
        return;
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: staffMessagesQueryKeys.messages(threadId) }),
        queryClient.invalidateQueries({ queryKey: staffMessagesQueryKeys.thread(threadId) }),
        user?.id
          ? queryClient.invalidateQueries({ queryKey: staffMessagesQueryKeys.threads(user.id) })
          : Promise.resolve(),
      ]);
    },
  });
}

export function useMarkThreadReadMutation(threadId: string | undefined) {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: () => {
      if (!threadId || !user?.id) {
        throw new Error('Thread and user are required to mark read');
      }
      return markThreadRead(threadId, user.id);
    },
    onSuccess: async () => {
      if (!user?.id) {
        return;
      }
      await queryClient.invalidateQueries({ queryKey: staffMessagesQueryKeys.threads(user.id) });
    },
  });
}

export function canCreateGroupThread(effectiveRole: string | null | undefined): boolean {
  return effectiveRole === 'admin' || effectiveRole === 'super_admin';
}

export function buildParticipantIdsForCreate(
  currentUserId: string,
  selectedRecipientIds: string[],
  threadType: MessageThreadType,
): string[] {
  const unique = new Set<string>([currentUserId, ...selectedRecipientIds]);
  const ids = Array.from(unique);
  if (threadType === 'direct' && ids.length !== 2) {
    throw new Error('Direct threads require exactly one other participant');
  }
  if (threadType === 'group' && ids.length < 2) {
    throw new Error('Group threads require at least one other participant');
  }
  return ids;
}
