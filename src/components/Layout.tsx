import React, { Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { useAuth } from '../lib/authContext';
import { useRouteQueryRefetch } from '../lib/useRouteQueryRefetch';

const RouteContentFallback: React.FC = () => (
  <div
    className="rounded-2xl border border-gray-200/80 bg-white/70 p-6 shadow-sm backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/40"
    role="status"
    aria-live="polite"
    aria-label="Loading page content"
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

export function Layout() {
  const { user, effectiveRole } = useAuth();
  useRouteQueryRefetch();

  return (
    <div className="flex min-h-dvh bg-gray-50 dark:bg-dark">
      <Sidebar />
      <main className="flex-1 min-w-0 w-full lg:ml-64 p-4 pt-14 pb-[max(1rem,env(safe-area-inset-bottom))] lg:p-8 lg:pt-8">
        {/* User role indicator */}
        {user && (
          <div className="mb-4 p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg text-sm">
            <span className="font-medium">Logged in as:</span> {user.email}
            <span className="ml-2 font-medium">Role:</span> {effectiveRole}
          </div>
        )}
        <Suspense fallback={<RouteContentFallback />}>
          <div className="min-h-[24rem]">
            <Outlet />
          </div>
        </Suspense>
      </main>
    </div>
  );
}
