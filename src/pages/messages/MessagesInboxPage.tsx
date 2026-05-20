import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, RefreshCw } from 'lucide-react';
import { StaffMessagingPolicyBanner } from '../../components/messages/StaffMessagingPolicyBanner';
import { ThreadList } from '../../components/messages/ThreadList';
import { RouteLoadingSkeleton } from '../../components/RouteLoadingSkeleton';
import { MESSAGES_ROUTES } from '../../lib/messages/constants';
import { useInboxThreads } from '../../lib/messages/hooks';
import { showError } from '../../lib/toast';

export function MessagesInboxPage() {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const { data: threads = [], isLoading, isError, error, refetch, isFetching } = useInboxThreads();

  useEffect(() => {
    if (isError) {
      showError(error instanceof Error ? error.message : 'Failed to load messages');
    }
  }, [isError, error]);

  if (isLoading) {
    return <RouteLoadingSkeleton />;
  }

  if (isError) {
    return (
      <div className="p-6">
        <StaffMessagingPolicyBanner />
        <p className="text-sm text-red-600">Unable to load conversations.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">Staff messages</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Coordinate with staff in your organization.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => refetch()}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600"
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} aria-hidden="true" />
            Refresh
          </button>
          <button
            type="button"
            onClick={() => navigate(MESSAGES_ROUTES.new)}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            New message
          </button>
        </div>
      </div>

      <StaffMessagingPolicyBanner />

      <ThreadList
        threads={threads}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        onSelectThread={(threadId) => navigate(MESSAGES_ROUTES.thread(threadId))}
      />
    </div>
  );
}
