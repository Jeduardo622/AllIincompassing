import React, { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { StaffMessagingPolicyBanner } from '../../components/messages/StaffMessagingPolicyBanner';
import { MessageComposer } from '../../components/messages/MessageComposer';
import { MessageList } from '../../components/messages/MessageList';
import { RouteLoadingSkeleton } from '../../components/RouteLoadingSkeleton';
import { MESSAGES_ROUTES } from '../../lib/messages/constants';
import {
  useMarkThreadReadMutation,
  useSendMessageMutation,
  useThreadDetail,
  useThreadMessages,
} from '../../lib/messages/hooks';
import { useAuth } from '../../lib/authContext';
import { showError } from '../../lib/toast';

export function ThreadDetailPage() {
  const navigate = useNavigate();
  const { threadId } = useParams<{ threadId: string }>();
  const { user } = useAuth();
  const { data: thread, isLoading: isThreadLoading, isError: isThreadError } = useThreadDetail(threadId);
  const { data: messages = [], isLoading: isMessagesLoading } = useThreadMessages(threadId);
  const sendMessageMutation = useSendMessageMutation(threadId);
  const markReadMutation = useMarkThreadReadMutation(threadId);

  useEffect(() => {
    if (!threadId || !thread) {
      return;
    }
    markReadMutation.mutate();
  }, [threadId, thread?.id]);

  if (isThreadLoading || isMessagesLoading) {
    return <RouteLoadingSkeleton />;
  }

  if (isThreadError || !thread) {
    return (
      <div className="p-6">
        <StaffMessagingPolicyBanner />
        <p className="text-sm text-red-600">Conversation not found or access denied.</p>
        <button
          type="button"
          onClick={() => navigate(MESSAGES_ROUTES.inbox)}
          className="mt-4 text-sm text-blue-600 hover:underline"
        >
          Back to inbox
        </button>
      </div>
    );
  }

  const title = thread.subject?.trim() || (thread.threadType === 'group' ? 'Group conversation' : 'Direct message');

  return (
    <div className="mx-auto max-w-3xl p-6">
      <button
        type="button"
        onClick={() => navigate(MESSAGES_ROUTES.inbox)}
        className="mb-4 text-sm text-blue-600 hover:underline"
      >
        Back to inbox
      </button>

      <h1 className="mb-2 text-2xl font-semibold text-gray-900 dark:text-gray-100">{title}</h1>
      <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
        {thread.threadType === 'group' ? 'Group' : 'Direct'} · {thread.participants.length} participants
      </p>

      <StaffMessagingPolicyBanner />

      <MessageList
        messages={messages}
        participants={thread.participants}
        currentUserId={user?.id ?? ''}
      />

      <MessageComposer
        isSending={sendMessageMutation.isPending}
        onSend={async (body) => {
          try {
            await sendMessageMutation.mutateAsync({ body });
          } catch (sendError) {
            showError(sendError instanceof Error ? sendError.message : 'Failed to send message');
            throw sendError;
          }
        }}
      />
    </div>
  );
}
