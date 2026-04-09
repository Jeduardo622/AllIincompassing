import React from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { useAuth } from '../lib/authContext';
import { useRouteQueryRefetch } from '../lib/useRouteQueryRefetch';

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
        <Outlet />
      </main>
    </div>
  );
}