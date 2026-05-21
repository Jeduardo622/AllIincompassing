import React from 'react';
import type { MessageThreadListItem } from '../../lib/messages/types';
import { ThreadRow } from './ThreadRow';

type ThreadListProps = {
  threads: MessageThreadListItem[];
  isLoading: boolean;
};

export function ThreadList({ threads, isLoading }: ThreadListProps) {
  if (isLoading) {
    return (
      <p className="text-sm text-gray-500 dark:text-gray-400" data-testid="messages-thread-list-loading">
        Loading conversations...
      </p>
    );
  }

  if (threads.length === 0) {
    return (
      <p className="text-sm text-gray-500 dark:text-gray-400" data-testid="messages-thread-list-empty">
        No conversations yet. Start a new message to reach staff in your organization.
      </p>
    );
  }

  return (
    <div className="space-y-2" data-testid="messages-thread-list">
      {threads.map((thread) => (
        <ThreadRow key={thread.id} thread={thread} />
      ))}
    </div>
  );
}
