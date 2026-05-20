import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { StaffMessagingPolicyBanner } from '../../components/messages/StaffMessagingPolicyBanner';
import { StaffRecipientPicker } from '../../components/messages/StaffRecipientPicker';
import { MESSAGES_ROUTES } from '../../lib/messages/constants';
import {
  buildParticipantIdsForCreate,
  canCreateGroupThread,
  useCreateThreadMutation,
  useEligibleStaff,
} from '../../lib/messages/hooks';
import type { MessageThreadType } from '../../lib/messages/types';
import { useAuth } from '../../lib/authContext';
import { showError, showSuccess } from '../../lib/toast';

export function NewMessagePage() {
  const navigate = useNavigate();
  const { user, effectiveRole } = useAuth();
  const [subject, setSubject] = useState('');
  const [threadType, setThreadType] = useState<MessageThreadType>('direct');
  const [selectedRecipientIds, setSelectedRecipientIds] = useState<string[]>([]);
  const { data: staff = [], isLoading: isStaffLoading } = useEligibleStaff();
  const createThreadMutation = useCreateThreadMutation();

  const allowGroup = canCreateGroupThread(effectiveRole);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user?.id) {
      showError('You must be signed in to create a conversation');
      return;
    }

    try {
      const participantUserIds = buildParticipantIdsForCreate(
        user.id,
        selectedRecipientIds,
        threadType,
      );
      const threadId = await createThreadMutation.mutateAsync({
        subject: subject.trim() || null,
        threadType,
        participantUserIds,
      });
      showSuccess('Conversation created');
      navigate(MESSAGES_ROUTES.thread(threadId));
    } catch (submitError) {
      showError(submitError instanceof Error ? submitError.message : 'Failed to create conversation');
    }
  };

  return (
    <div className="mx-auto max-w-3xl p-6">
      <button
        type="button"
        onClick={() => navigate(MESSAGES_ROUTES.inbox)}
        className="mb-4 text-sm text-blue-600 hover:underline"
      >
        Back to inbox
      </button>

      <h1 className="mb-2 text-2xl font-semibold text-gray-900 dark:text-gray-100">New message</h1>
      <StaffMessagingPolicyBanner />

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label htmlFor="message-subject" className="mb-1 block text-sm font-medium">
            Subject (optional)
          </label>
          <input
            id="message-subject"
            type="text"
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-dark-lighter"
            placeholder="e.g. Schedule handoff"
          />
        </div>

        {allowGroup ? (
          <div>
            <span className="mb-2 block text-sm font-medium">Conversation type</span>
            <div className="flex gap-4">
              <label className="inline-flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="thread-type"
                  checked={threadType === 'direct'}
                  onChange={() => setThreadType('direct')}
                />
                Direct (1:1)
              </label>
              <label className="inline-flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="thread-type"
                  checked={threadType === 'group'}
                  onChange={() => setThreadType('group')}
                />
                Group
              </label>
            </div>
          </div>
        ) : (
          <p className="text-sm text-gray-500">Therapists can start direct (1:1) conversations only.</p>
        )}

        <div>
          <span className="mb-2 block text-sm font-medium">Recipients</span>
          <StaffRecipientPicker
            threadType={threadType}
            staff={staff}
            selectedIds={selectedRecipientIds}
            currentUserId={user?.id ?? ''}
            onChange={setSelectedRecipientIds}
            isLoading={isStaffLoading}
          />
        </div>

        <button
          type="submit"
          disabled={createThreadMutation.isPending || selectedRecipientIds.length === 0}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {createThreadMutation.isPending ? 'Creating…' : 'Create conversation'}
        </button>
      </form>
    </div>
  );
}
