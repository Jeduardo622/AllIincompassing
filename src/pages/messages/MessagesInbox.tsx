import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus, RefreshCw, Search } from 'lucide-react';
import { PhiNoticeBanner } from '../../components/messages/PhiNoticeBanner';
import { ThreadList } from '../../components/messages/ThreadList';
import { useAuth } from '../../lib/authContext';
import { MESSAGES_QUERY_KEY } from '../../lib/messages/constants';
import { fetchMessageThreads } from '../../lib/messages/fetchers';
import { useActiveOrganizationId } from '../../lib/organization';

export function MessagesInbox() {
  const { profile } = useAuth();
  const organizationId = useActiveOrganizationId();
  const [searchQuery, setSearchQuery] = useState('');
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);

  const { data, isLoading, isFetching, refetch, error } = useQuery({
    queryKey: [MESSAGES_QUERY_KEY, 'inbox', organizationId, profile?.id],
    queryFn: () => fetchMessageThreads(organizationId!, profile!.id),
    enabled: Boolean(organizationId && profile?.id),
    refetchInterval: 30_000,
  });

  const filteredThreads = useMemo(() => {
    const threads = data?.threads ?? [];
    const query = searchQuery.trim().toLowerCase();
    return threads.filter((thread) => {
      if (showUnreadOnly && !thread.isUnread) {
        return false;
      }

      if (!query) {
        return true;
      }

      const subject = (thread.subject ?? '').toLowerCase();
      const preview = (thread.last_message_preview ?? '').toLowerCase();
      const participantNames = (thread.participant_names ?? []).join(' ').toLowerCase();
      return (
        subject.includes(query)
        || preview.includes(query)
        || participantNames.includes(query)
      );
    });
  }, [data?.threads, searchQuery, showUnreadOnly]);

  return (
    <div className="mx-auto max-w-4xl p-4 md:p-6" data-testid="messages-inbox-page">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Messages</h1>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => refetch()}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800"
            data-testid="messages-refresh"
          >
            <RefreshCw aria-hidden="true" className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <Link
            to="/messages/new"
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            data-testid="messages-new-link"
          >
            <Plus aria-hidden="true" className="h-4 w-4" />
            New message
          </Link>
        </div>
      </div>

      <PhiNoticeBanner />

      {data?.schemaUnavailable && (
        <p
          className="mb-4 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
          data-testid="messages-schema-unavailable"
        >
          Staff messaging tables are not available in this environment yet. Apply the staff messaging
          database migration to enable inbox features.
        </p>
      )}

      {error && !data?.schemaUnavailable && (
        <p className="mb-4 text-sm text-red-600 dark:text-red-400" role="alert">
          Unable to load conversations. Try refreshing.
        </p>
      )}

      <div className="relative mb-4">
        <Search aria-hidden="true" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          type="search"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="Search by subject or preview"
          className="w-full rounded-lg border border-gray-300 py-2 pl-10 pr-3 text-sm dark:border-gray-600 dark:bg-dark-lighter dark:text-gray-100"
          data-testid="messages-inbox-search"
        />
      </div>

      <div className="mb-4 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setShowUnreadOnly((current) => !current)}
          className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
            showUnreadOnly
              ? 'border-blue-600 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-950/40 dark:text-blue-200'
              : 'border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800'
          }`}
          data-testid="messages-unread-filter"
        >
          Unread only
          {typeof data?.unreadThreadCount === 'number' ? ` (${data.unreadThreadCount})` : ''}
        </button>

        {showUnreadOnly && filteredThreads.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400" data-testid="messages-unread-empty-state">
            No unread threads right now.
          </p>
        ) : null}
      </div>

      <ThreadList threads={filteredThreads} isLoading={isLoading} />
    </div>
  );
}
