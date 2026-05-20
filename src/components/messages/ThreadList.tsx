import React from 'react';
import type { ThreadListItem } from '../../lib/messages/types';
import { ThreadRow } from './ThreadRow';
import { MessagesEmptyState } from './MessagesEmptyState';

interface ThreadListProps {
  threads: ThreadListItem[];
  activeThreadId?: string;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  onSelectThread: (threadId: string) => void;
}

export function ThreadList({
  threads,
  activeThreadId,
  searchQuery,
  onSearchQueryChange,
  onSelectThread,
}: ThreadListProps) {
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filtered = normalizedQuery
    ? threads.filter((thread) => {
        const subject = thread.subject?.toLowerCase() ?? '';
        const preview = thread.latestMessageBody?.toLowerCase() ?? '';
        return subject.includes(normalizedQuery) || preview.includes(normalizedQuery);
      })
    : threads;

  return (
    <div className="space-y-4">
      <input
        type="search"
        value={searchQuery}
        onChange={(event) => onSearchQueryChange(event.target.value)}
        placeholder="Search conversations"
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-dark-lighter"
        aria-label="Search conversations"
      />
      {filtered.length === 0 ? (
        <MessagesEmptyState
          title={threads.length === 0 ? 'No conversations yet' : 'No matching conversations'}
          description={
            threads.length === 0
              ? 'Start a new message to coordinate with staff in your organization.'
              : 'Try a different search term.'
          }
        />
      ) : (
        <div className="space-y-2">
          {filtered.map((thread) => (
            <ThreadRow
              key={thread.threadId}
              thread={thread}
              isActive={thread.threadId === activeThreadId}
              onSelect={onSelectThread}
            />
          ))}
        </div>
      )}
    </div>
  );
}
