import React from 'react';

interface ProtectedShellPendingProps {
  label?: string;
}

export const ProtectedShellPending: React.FC<ProtectedShellPendingProps> = ({
  label = 'Restoring your secure session...',
}) => {
  return (
    <div className="flex min-h-dvh bg-gray-50 dark:bg-dark" data-testid="protected-shell-pending">
      <aside
        className="hidden w-64 shrink-0 border-r border-gray-200 bg-white/90 px-6 py-6 shadow-sm dark:border-dark-border dark:bg-dark-lighter/90 lg:block"
        aria-hidden="true"
      >
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-2xl bg-blue-100 dark:bg-blue-900/40" />
          <div className="h-5 w-36 rounded-full bg-gray-200 dark:bg-gray-700" />
        </div>
        <div className="mt-8 space-y-3">
          <div className="h-11 rounded-xl bg-gray-200/80 dark:bg-gray-700/80" />
          <div className="h-11 rounded-xl bg-gray-200/70 dark:bg-gray-800/70" />
          <div className="h-11 rounded-xl bg-gray-200/70 dark:bg-gray-800/70" />
          <div className="h-11 rounded-xl bg-gray-200/70 dark:bg-gray-800/70" />
        </div>
      </aside>
      <main className="flex-1 px-4 pt-14 pb-6 lg:px-8 lg:pt-8">
        <div
          className="rounded-2xl border border-gray-200/80 bg-white/90 p-6 shadow-sm dark:border-gray-700 dark:bg-gray-900/80"
          role="status"
          aria-live="polite"
          aria-label={label}
        >
          <div className="flex items-center gap-3">
            <div
              className="h-8 w-8 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600 dark:border-blue-900 dark:border-t-blue-400"
              aria-hidden="true"
            />
            <div>
              <p className="text-sm font-medium text-gray-900 dark:text-white">{label}</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Loading the protected workspace without rendering account-specific content.
              </p>
            </div>
          </div>
          <div className="mt-6 animate-pulse space-y-4">
            <div className="h-5 w-48 rounded-full bg-gray-200 dark:bg-gray-700" />
            <div className="grid gap-4 md:grid-cols-2">
              <div className="h-28 rounded-2xl bg-gray-200/80 dark:bg-gray-800/80" />
              <div className="h-28 rounded-2xl bg-gray-200/80 dark:bg-gray-800/80" />
            </div>
            <div className="h-64 rounded-3xl bg-gray-200/80 dark:bg-gray-800/80" />
          </div>
        </div>
      </main>
    </div>
  );
};
