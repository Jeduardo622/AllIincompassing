import React from 'react';
import { formatDistanceToNow } from 'date-fns';
import type { ThreadListItem } from '../../lib/messages/types';

interface ThreadRowProps {
  thread: ThreadListItem;
  isActive?: boolean;
  onSelect: (threadId: string) => void;
}

export function ThreadRow({ thread, isActive = false, onSelect }: ThreadRowProps) {
  const label = thread.subject?.trim() || (thread.threadType === 'group' ? 'Group conversation' : 'Direct message');
  const preview = thread.latestMessageBody?.trim() || 'No messages yet';

  return (
    <button
      type="button"
      onClick={() => onSelect(thread.threadId)}
      className={`w-full rounded-lg border px-4 py-3 text-left transition ${
        isActive
          ? 'border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-950/30'
          : 'border-gray-200 bg-white hover:border-gray-300 dark:border-gray-700 dark:bg-dark-lighter dark:hover:border-gray-600'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-gray-900 dark:text-gray-100">{label}</p>
          <p className="mt-1 truncate text-sm text-gray-500 dark:text-gray-400">{preview}</p>
        </div>
        <span className="shrink-0 text-xs text-gray-400 dark:text-gray-500">
          {formatDistanceToNow(new Date(thread.updatedAt), { addSuffix: true })}
        </span>
      </div>
    </button>
  );
}
