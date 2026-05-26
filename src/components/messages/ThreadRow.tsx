import React from 'react';
import { format, parseISO } from 'date-fns';
import { Link } from 'react-router-dom';
import type { MessageThreadListItem } from '../../lib/messages/types';

type ThreadRowProps = {
  thread: MessageThreadListItem;
};

export function ThreadRow({ thread }: ThreadRowProps) {
  const participantLabel = thread.participant_names?.join(', ').trim();
  const label = thread.subject?.trim()
    || (thread.thread_type === 'direct' && participantLabel
      ? participantLabel
      : thread.thread_type === 'group'
        ? 'Group conversation'
        : 'Direct message');
  const preview = thread.last_message_preview?.trim() || 'No messages yet';
  const timestamp = thread.last_message_at ?? thread.updated_at;

  return (
    <Link
      to={`/messages/${thread.id}`}
      className={`block rounded-lg border px-4 py-3 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800 ${
        thread.isUnread
          ? 'border-blue-200 bg-blue-50/70 dark:border-blue-900 dark:bg-blue-950/30'
          : 'border-gray-200 dark:border-gray-700'
      }`}
      data-testid={`message-thread-row-${thread.id}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {thread.isUnread ? (
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full bg-blue-600 dark:bg-blue-400"
                data-testid={`message-thread-unread-${thread.id}`}
              />
            ) : null}
            <p
              className={`truncate font-medium ${
                thread.isUnread ? 'text-gray-950 dark:text-white' : 'text-gray-900 dark:text-gray-100'
              }`}
            >
              {label}
            </p>
          </div>
          <p
            className={`mt-1 truncate text-sm ${
              thread.isUnread ? 'text-gray-700 dark:text-gray-200' : 'text-gray-500 dark:text-gray-400'
            }`}
          >
            {preview}
          </p>
        </div>
        <span
          className={`shrink-0 text-xs ${
            thread.isUnread ? 'text-blue-700 dark:text-blue-300' : 'text-gray-400 dark:text-gray-500'
          }`}
        >
          {format(parseISO(timestamp), 'MMM d, h:mm a')}
        </span>
      </div>
    </Link>
  );
}
