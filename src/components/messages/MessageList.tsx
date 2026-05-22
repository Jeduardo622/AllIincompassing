import React from 'react';
import { format, parseISO } from 'date-fns';
import type { Message } from '../../lib/messages/types';

type MessageListProps = {
  messages: Message[];
  currentUserId: string;
};

export function MessageList({ messages, currentUserId }: MessageListProps) {
  if (messages.length === 0) {
    return (
      <p className="text-sm text-gray-500 dark:text-gray-400" data-testid="messages-list-empty">
        No messages in this thread yet.
      </p>
    );
  }

  return (
    <ul className="space-y-3" data-testid="messages-list">
      {messages.map((message) => {
        const isOwn = message.sender_id === currentUserId;
        const senderLabel = message.sender_name ?? 'Staff member';
        return (
          <li
            key={message.id}
            className={`flex flex-col ${isOwn ? 'items-end' : 'items-start'}`}
            data-testid={`message-item-${message.id}`}
          >
            <p
              className={`mb-1 px-1 text-xs font-semibold ${
                isOwn ? 'text-blue-700 dark:text-blue-300' : 'text-gray-600 dark:text-gray-300'
              }`}
              data-testid={`message-sender-${message.id}`}
            >
              {senderLabel}
            </p>
            <div
              className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                isOwn
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-100'
              }`}
            >
              <p className="whitespace-pre-wrap break-words">{message.body}</p>
              <p className={`mt-1 text-xs ${isOwn ? 'text-blue-100' : 'text-gray-500 dark:text-gray-400'}`}>
                {format(parseISO(message.created_at), 'MMM d, h:mm a')}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
