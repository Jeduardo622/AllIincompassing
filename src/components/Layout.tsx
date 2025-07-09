import React from 'react';
import { Outlet } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { cn, layout, typography } from '../lib/design-system';
import { landmarkRoles, useSkipLink, ScreenReaderOnly } from '../lib/accessibility';
import Sidebar from './Sidebar';
import { Card, CardContent } from './ui/Card';

export default function Layout() {
  const { user, roles } = useAuth();
  const { skipToContent } = useSkipLink('main-content');

  return (
    <div className="flex min-h-screen bg-gray-50 dark:bg-dark">
      {/* Skip to content link for keyboard navigation */}
      <button
        onClick={skipToContent}
        className={cn(
          'absolute top-4 left-4 z-50 px-4 py-2 bg-primary-600 text-white rounded-md',
          'transform -translate-y-full opacity-0 focus:translate-y-0 focus:opacity-100',
          'transition-all duration-200 ease-in-out',
          'focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2'
        )}
        aria-label="Skip to main content"
      >
        <ScreenReaderOnly>
          Skip to main content
        </ScreenReaderOnly>
        Skip to content
      </button>

      {/* Sidebar Navigation */}
      <nav role={landmarkRoles.navigation} aria-label="Main navigation">
        <Sidebar />
      </nav>

      {/* Main Content Area */}
      <main 
        id="main-content"
        role={landmarkRoles.main}
        className={cn(
          layout['main-content'],
          'focus:outline-none'
        )}
        tabIndex={-1}
      >
        {/* User status indicator */}
        {user && (
          <Card 
            variant="soft" 
            className="mb-6 bg-primary-50 dark:bg-primary-900/20 border-primary-200 dark:border-primary-800/30"
          >
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className="w-2 h-2 bg-success-500 rounded-full animate-pulse" />
                  <div>
                    <p className={cn(typography.label, 'text-primary-900 dark:text-primary-100')}>
                      Active Session
                    </p>
                    <p className={cn(typography.body, 'text-primary-700 dark:text-primary-300')}>
                      {user.email}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className={cn(typography.label, 'text-primary-900 dark:text-primary-100')}>
                    User Role{roles.length > 1 ? 's' : ''}
                  </p>
                  <p className={cn(typography.body, 'text-primary-700 dark:text-primary-300')}>
                    {roles.length > 0 ? roles.join(', ') : 'No roles assigned'}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Page Content */}
        <div className="min-h-[calc(100vh-12rem)]">
          <Outlet />
        </div>

        {/* Footer */}
        <footer 
          role={landmarkRoles.contentinfo}
          className="mt-auto pt-8 border-t border-gray-200 dark:border-gray-700"
        >
          <div className="text-center">
            <p className={cn(typography.caption, 'text-gray-500 dark:text-gray-400')}>
              © 2024 AllIncompassing Therapy Management System
            </p>
            <p className={cn(typography.caption, 'text-gray-500 dark:text-gray-400 mt-1')}>
              Built with accessibility and user experience in mind
            </p>
          </div>
        </footer>
      </main>
    </div>
  );
}