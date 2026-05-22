import React, { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { MessageComposer } from '../../components/messages/MessageComposer';
import { MessageList } from '../../components/messages/MessageList';
import { PhiNoticeBanner } from '../../components/messages/PhiNoticeBanner';
import { useAuth } from '../../lib/authContext';
import { MESSAGES_QUERY_KEY } from '../../lib/messages/constants';
import { fetchMessageThread, fetchThreadMessages } from '../../lib/messages/fetchers';
import { markThreadRead, sendThreadMessage } from '../../lib/messages/mutations';
import { showError } from '../../lib/toast';

export function MessageThread() {
  const { threadId } = useParams<{ threadId: string }>();
  const { profile } = useAuth();
  const queryClient = useQueryClient();

  const { data: thread, isLoading: threadLoading } = useQuery({
    queryKey: [MESSAGES_QUERY_KEY, 'thread', threadId],
    queryFn: () => fetchMessageThread(threadId!, profile!.id),
    enabled: Boolean(threadId && profile?.id),
  });

  const { data: messages = [], isLoading: messagesLoading, refetch } = useQuery({
    queryKey: [MESSAGES_QUERY_KEY, 'thread-messages', threadId],
    queryFn: () => fetchThreadMessages(threadId!),
    enabled: Boolean(threadId),
    refetchInterval: 15_000,
  });

  useEffect(() => {
    if (!threadId || !profile?.id) {
      return;
    }
    void markThreadRead(threadId, profile.id);
  }, [threadId, profile?.id, messages.length]);

  const sendMutation = useMutation({
    mutationFn: (body: string) => sendThreadMessage(threadId!, body, profile!.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: [MESSAGES_QUERY_KEY] });
      await refetch();
    },
    onError: (error: Error) => {
      showError(error.message || 'Unable to send message');
    },
  });

  if (!threadId) {
    return null;
  }

  const participantLabel = thread?.participant_names?.join(', ').trim();
  const title = thread?.subject?.trim()
    || (thread?.thread_type === 'direct' && participantLabel
      ? participantLabel
      : thread?.thread_type === 'group'
        ? 'Group conversation'
        : 'Conversation');

  return (
    <div className="mx-auto flex max-w-3xl flex-col p-4 md:p-6" data-testid="messages-thread-page">
      <Link
        to="/messages"
        className="mb-4 inline-flex items-center gap-2 text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400"
      >
        <ArrowLeft aria-hidden="true" className="h-4 w-4" />
        Back to inbox
      </Link>

      <h1 className="mb-4 text-2xl font-bold text-gray-900 dark:text-white">{threadLoading ? 'Loading...' : title}</h1>
      <PhiNoticeBanner />

      {messagesLoading ? (
        <p className="text-sm text-gray-500">Loading messages...</p>
      ) : (
        <MessageList messages={messages} currentUserId={profile?.id ?? ''} />
      )}

      <MessageComposer
        onSend={async (body) => {
          await sendMutation.mutateAsync(body);
        }}
        disabled={!profile?.id || sendMutation.isPending}
      />
    </div>
  );
}
