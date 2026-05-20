import React, { useState } from 'react';
import { Send } from 'lucide-react';
import { MESSAGE_BODY_MAX_LENGTH, PHI_POLICY_COMPOSER_HINT } from '../../lib/messages/constants';

interface MessageComposerProps {
  onSend: (body: string) => Promise<void>;
  isSending?: boolean;
  disabled?: boolean;
}

export function MessageComposer({ onSend, isSending = false, disabled = false }: MessageComposerProps) {
  const [body, setBody] = useState('');

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!body.trim() || isSending || disabled) {
      return;
    }
    await onSend(body);
    setBody('');
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-2 border-t border-gray-200 pt-4 dark:border-gray-700">
      <p className="text-xs text-gray-500 dark:text-gray-400">{PHI_POLICY_COMPOSER_HINT}</p>
      <textarea
        value={body}
        onChange={(event) => setBody(event.target.value)}
        maxLength={MESSAGE_BODY_MAX_LENGTH}
        rows={3}
        disabled={disabled || isSending}
        placeholder="Write a staff-only message"
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-dark-lighter"
        aria-label="Message body"
      />
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-400">
          {body.length}/{MESSAGE_BODY_MAX_LENGTH}
        </span>
        <button
          type="submit"
          disabled={disabled || isSending || !body.trim()}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Send className="h-4 w-4" aria-hidden="true" />
          {isSending ? 'Sending…' : 'Send'}
        </button>
      </div>
    </form>
  );
}
