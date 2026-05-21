import React from 'react';
import { format, parseISO } from 'date-fns';
import { Link } from 'react-router-dom';
import type { MessageThreadListItem } from '../../lib/messages/types';

type ThreadRowProps = {
  thread: MessageThreadListItem;
};

export function ThreadRow({ thread }: ThreadRowProps) {
  const label = thread.subject?.trim() || (thread.thread_type === 'group' ? 'Group conversation' : 'Direct message');
  const preview = thread.last_message_preview?.trim() || 'No messages yet';
  const timestamp = thread.last_message_at ?? thread.updated_at;

  return (
    <Link
      to={`/messages/${thread.id}`}
      className="block rounded-lg border border-gray-200 px-4 py-3 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
      data-testid={`message-thread-row-${thread.id}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-gray-900 dark:text-gray-100">{label}</p>
          <p className="mt-1 truncate text-sm text-gray-500 dark:text-gray-400">{preview}</p>
        </div>
        <span className="shrink-0 text-xs text-gray-400 dark:text-gray-500">
          {format(parseISO(timestamp), 'MMM d, h:mm a')}
        </span>
      </div>
    </Link>
  );
}
