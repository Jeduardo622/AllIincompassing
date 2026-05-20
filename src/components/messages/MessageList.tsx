import React, { useEffect, useRef } from 'react';
import type { StaffMessage, ThreadParticipantProfile } from '../../lib/messages/types';
import { MessageBubble } from './MessageBubble';
import { MessagesEmptyState } from './MessagesEmptyState';

interface MessageListProps {
  messages: StaffMessage[];
  participants: ThreadParticipantProfile[];
  currentUserId: string;
}

export function MessageList({ messages, participants, currentUserId }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView?.({ behavior: 'smooth' });
  }, [messages.length]);

  const labelByUserId = new Map(
    participants.map((participant) => [participant.userId, participant.fullName]),
  );

  if (messages.length === 0) {
    return <MessagesEmptyState title="No messages yet" description="Send the first message below." />;
  }

  return (
    <div className="flex max-h-[28rem] flex-col gap-3 overflow-y-auto pr-1">
      {messages.map((message) => (
        <MessageBubble
          key={message.id}
          message={message}
          isOwnMessage={message.senderId === currentUserId}
          senderLabel={labelByUserId.get(message.senderId) ?? 'Staff member'}
        />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
