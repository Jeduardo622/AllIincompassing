import React, { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { PhiNoticeBanner } from '../../components/messages/PhiNoticeBanner';
import { StaffRecipientPicker } from '../../components/messages/StaffRecipientPicker';
import { useAuth } from '../../lib/authContext';
import { MESSAGES_QUERY_KEY } from '../../lib/messages/constants';
import { fetchStaffRecipients } from '../../lib/messages/fetchStaffRecipients';
import { createMessageThread } from '../../lib/messages/mutations';
import type { MessageThreadType } from '../../lib/messages/types';
import { useActiveOrganizationId } from '../../lib/organization';
import { showError, showSuccess } from '../../lib/toast';

export function MessagesNew() {
  const navigate = useNavigate();
  const { profile, effectiveRole } = useAuth();
  const organizationId = useActiveOrganizationId();
  const canCreateGroup = effectiveRole === 'admin' || effectiveRole === 'super_admin';
  const [subject, setSubject] = useState('');
  const [threadType, setThreadType] = useState<MessageThreadType>('direct');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const { data: recipients = [], isLoading } = useQuery({
    queryKey: [MESSAGES_QUERY_KEY, 'recipients', organizationId, profile?.id],
    queryFn: () => fetchStaffRecipients(organizationId!, profile!.id),
    enabled: Boolean(organizationId && profile?.id),
  });

  const createMutation = useMutation({
    mutationFn: createMessageThread,
    onSuccess: (threadId) => {
      showSuccess('Conversation created');
      navigate(`/messages/${threadId}`);
    },
    onError: (error: Error) => {
      showError(error.message || 'Unable to create conversation');
    },
  });

  const effectiveThreadType = canCreateGroup ? threadType : 'direct';

  const validationMessage = useMemo(() => {
    if (selectedIds.length === 0) {
      return 'Select at least one recipient.';
    }
    if (effectiveThreadType === 'direct' && selectedIds.length !== 1) {
      return 'Direct conversations require exactly one recipient.';
    }
    if (effectiveThreadType === 'group' && selectedIds.length < 2) {
      return 'Group conversations require at least two recipients.';
    }
    return null;
  }, [effectiveThreadType, selectedIds]);

  const handleToggleRecipient = (userId: string) => {
    if (effectiveThreadType === 'direct') {
      setSelectedIds([userId]);
      return;
    }
    setSelectedIds((current) =>
      current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId],
    );
  };

  const handleCreate = () => {
    if (validationMessage) {
      showError(validationMessage);
      return;
    }
    createMutation.mutate({
      subject,
      threadType: effectiveThreadType,
      participantUserIds: selectedIds,
    });
  };

  return (
    <div className="mx-auto max-w-2xl p-4 md:p-6" data-testid="messages-new-page">
      <Link
        to="/messages"
        className="mb-4 inline-flex items-center gap-2 text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400"
      >
        <ArrowLeft aria-hidden="true" className="h-4 w-4" />
        Back to inbox
      </Link>

      <h1 className="mb-4 text-2xl font-bold text-gray-900 dark:text-white">New message</h1>
      <PhiNoticeBanner />

      <label className="mb-4 block text-sm font-medium text-gray-700 dark:text-gray-300" htmlFor="message-subject">
        Subject (optional)
      </label>
      <input
        id="message-subject"
        type="text"
        value={subject}
        onChange={(event) => setSubject(event.target.value)}
        className="mb-6 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-dark-lighter dark:text-gray-100"
        placeholder="Team sync, coverage handoff, etc."
        data-testid="messages-new-subject"
      />

      {isLoading ? (
        <p className="text-sm text-gray-500">Loading staff...</p>
      ) : (
        <StaffRecipientPicker
          recipients={recipients}
          selectedIds={selectedIds}
          onToggle={handleToggleRecipient}
          threadType={effectiveThreadType}
          onThreadTypeChange={setThreadType}
          canCreateGroup={canCreateGroup}
          disabled={createMutation.isPending}
        />
      )}

      <button
        type="button"
        onClick={handleCreate}
        disabled={createMutation.isPending || Boolean(validationMessage)}
        className="mt-6 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        data-testid="messages-create-thread"
      >
        {createMutation.isPending ? 'Creating...' : 'Start conversation'}
      </button>
    </div>
  );
}
