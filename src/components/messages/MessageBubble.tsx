import React from 'react';
import { format } from 'date-fns';
import type { StaffMessage } from '../../lib/messages/types';

interface MessageBubbleProps {
  message: StaffMessage;
  isOwnMessage: boolean;
  senderLabel: string;
}

export function MessageBubble({ message, isOwnMessage, senderLabel }: MessageBubbleProps) {
  return (
    <div className={`flex ${isOwnMessage ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
          isOwnMessage
            ? 'bg-blue-600 text-white'
            : 'bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-100'
        }`}
      >
        {!isOwnMessage ? (
          <p className="mb-1 text-xs font-medium opacity-80">{senderLabel}</p>
        ) : null}
        <p className="whitespace-pre-wrap break-words">{message.body}</p>
        <p className={`mt-1 text-xs ${isOwnMessage ? 'text-blue-100' : 'text-gray-500'}`}>
          {format(new Date(message.createdAt), 'MMM d, h:mm a')}
        </p>
      </div>
    </div>
  );
}
