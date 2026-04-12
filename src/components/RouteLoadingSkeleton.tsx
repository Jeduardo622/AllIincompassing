import React from 'react';

/** Shared loading skeleton for route transitions and dashboard landing (matches Layout outlet fallback). */
export const RouteLoadingSkeleton: React.FC<{ label?: string }> = ({ label }) => (
  <div
    className="rounded-2xl border border-gray-200/80 bg-white/70 p-6 shadow-sm backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/40"
    role="status"
    aria-live="polite"
    aria-label={label ?? 'Loading page content'}
  >
    <div className="animate-pulse space-y-4">
      <div className="h-6 w-40 rounded-full bg-gray-200 dark:bg-slate-800" />
      <div className="grid gap-3 md:grid-cols-2">
        <div className="h-28 rounded-xl bg-gray-200/80 dark:bg-slate-800/80" />
        <div className="h-28 rounded-xl bg-gray-200/80 dark:bg-slate-800/80" />
      </div>
      <div className="h-56 rounded-2xl bg-gray-200/80 dark:bg-slate-800/80" />
    </div>
  </div>
);
