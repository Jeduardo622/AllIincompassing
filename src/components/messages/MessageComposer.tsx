import React, { useState } from 'react';
import { Send } from 'lucide-react';
import { PHI_COMPOSER_PLACEHOLDER } from '../../lib/messages/constants';

type MessageComposerProps = {
  onSend: (body: string) => Promise<void>;
  disabled?: boolean;
};

export function MessageComposer({ onSend, disabled = false }: MessageComposerProps) {
  const [body, setBody] = useState('');
  const [isSending, setIsSending] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (disabled || isSending || !body.trim()) {
      return;
    }

    setIsSending(true);
    try {
      await onSend(body);
      setBody('');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="mt-4 border-t border-gray-200 pt-4 dark:border-gray-700">
      <label htmlFor="message-composer" className="sr-only">
        Message body
      </label>
      <textarea
        id="message-composer"
        value={body}
        onChange={(event) => setBody(event.target.value)}
        placeholder={PHI_COMPOSER_PLACEHOLDER}
        rows={3}
        disabled={disabled || isSending}
        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-dark-lighter dark:text-gray-100"
        data-testid="message-composer-input"
      />
      <div className="mt-2 flex justify-end">
        <button
          type="submit"
          disabled={disabled || isSending || !body.trim()}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          data-testid="message-composer-send"
        >
          <Send aria-hidden="true" className="h-4 w-4" />
          {isSending ? 'Sending...' : 'Send'}
        </button>
      </div>
    </form>
  );
}
