import React from 'react';
import { MessageSquare } from 'lucide-react';

interface MessagesEmptyStateProps {
  title: string;
  description?: string;
}

export function MessagesEmptyState({ title, description }: MessagesEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-gray-300 px-6 py-12 text-center dark:border-gray-600">
      <MessageSquare className="mb-3 h-10 w-10 text-gray-400" aria-hidden="true" />
      <h3 className="text-base font-medium text-gray-900 dark:text-gray-100">{title}</h3>
      {description ? (
        <p className="mt-2 max-w-md text-sm text-gray-500 dark:text-gray-400">{description}</p>
      ) : null}
    </div>
  );
}
