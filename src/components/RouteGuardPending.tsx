import React from 'react';

interface RouteGuardPendingProps {
  fullScreen?: boolean;
  label?: string;
}

export const RouteGuardPending: React.FC<RouteGuardPendingProps> = ({
  fullScreen = false,
  label = 'Checking access...',
}) => {
  const containerClassName = fullScreen
    ? 'min-h-screen flex items-center justify-center px-6'
    : 'h-full min-h-[16rem] flex items-center justify-center px-6 py-10';

  return (
    <div className={containerClassName} role="status" aria-live="polite" aria-label={label}>
      <div className="w-full max-w-md rounded-2xl border border-gray-200/80 bg-white/90 p-6 shadow-sm dark:border-gray-700 dark:bg-gray-900/80">
        <div className="flex items-center gap-3">
          <div
            className="h-8 w-8 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600 dark:border-blue-900 dark:border-t-blue-400"
            aria-hidden="true"
          />
          <div>
            <p className="text-sm font-medium text-gray-900 dark:text-white">{label}</p>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Loading protected content without exposing unauthorized data.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
