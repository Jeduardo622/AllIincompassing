import React, { useState } from 'react';
import { NavLink, useNavigate, Link } from 'react-router-dom';
import { 
  Calendar, Users, FileText, CreditCard, LayoutDashboard,
  UserCog, LogOut, Settings, MessageSquare, Sun, Moon,
  FileCheck, Menu, X, RefreshCw, User, BarChart, Activity,
  UserCircle2
} from 'lucide-react';
import { useAuth } from '../lib/authContext';
import { useTheme } from '../lib/theme';
import ChatBot from './ChatBot';
// Theme is toggled directly via context; no hidden proxy button
import { logger } from '../lib/logger/logger';

export default function Sidebar() {
  const { signOut, hasRole, hasAnyRole, user, profile } = useAuth();
  const { isDark, toggleTheme } = useTheme();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const navigate = useNavigate();

  // Check if user is a therapist
  const isTherapist = hasRole('therapist') || user?.user_metadata?.therapist_id;
  const therapistId = user?.user_metadata?.therapist_id;

  const handleSignOut = async () => {
    if (isSigningOut) return;
    
    try {
      setIsSigningOut(true);
      await signOut();
      // Explicitly navigate to login after successful sign-out to avoid race conditions with guards
      navigate('/login', { replace: true });
    } catch (error) {
      logger.error('Sidebar sign-out failed', {
        error,
        context: { component: 'Sidebar', operation: 'handleSignOut' },
        metadata: {
          hadUser: Boolean(user),
          hadProfile: Boolean(profile),
          attemptedNavigate: true
        }
      });
      setIsSigningOut(false);
      // Force navigation to login page even if there's an error
      navigate('/login');
    }
  };

  const handleRefreshSession = async () => {
    if (isRefreshing) return;

    logger.info('Manual session refresh requested', {
      context: { component: 'Sidebar', operation: 'refreshSession' },
      metadata: { hasProfile: Boolean(profile) }
    });
    try {
      setIsRefreshing(true);
      // Note: authContext automatically manages session state
      logger.debug('Manual session refresh acknowledged by auth context', {
        context: { component: 'Sidebar', operation: 'refreshSession' },
        metadata: { hasRole: Boolean(profile?.role) }
      });
      logger.info('Manual session refresh completed', {
        context: { component: 'Sidebar', operation: 'refreshSession' },
        metadata: { therapistView: Boolean(therapistId) }
      });
      setIsRefreshing(false);
    } catch (error) {
      logger.error('Sidebar session refresh failed', {
        error,
        context: { component: 'Sidebar', operation: 'refreshSession' },
        metadata: { therapistView: Boolean(therapistId) }
      });
      setIsRefreshing(false);
    }
  };

  const navItems = [
    {
      icon: UserCircle2,
      label: 'Family',
      path: '/family',
      roles: ['client']
    },
    {
      icon: LayoutDashboard,
      label: 'Dashboard',
      path: '/',
      roles: [] // accessible to all authenticated users
    },
    { 
      icon: Calendar, 
      label: 'Schedule', 
      path: '/schedule',
      roles: [] // accessible to all authenticated users
    },
    {
      icon: Users,
      label: 'Clients',
      path: '/clients',
      roles: ['therapist', 'admin', 'super_admin']
    },
    {
      icon: UserCog,
      label: 'Therapists',
      path: '/therapists',
      roles: ['admin', 'super_admin']
    },
    {
      icon: FileCheck,
      label: 'Authorizations',
      path: '/authorizations',
      roles: ['therapist', 'admin', 'super_admin']
    },
    { 
      icon: FileText, 
      label: 'Documentation', 
      path: '/documentation',
      roles: [] // accessible to all authenticated users
    },
    {
      icon: FileText,
      label: 'Fill Docs',
      path: '/fill-docs',
      roles: ['therapist', 'admin', 'super_admin'],
    },
    {
      icon: CreditCard,
      label: 'Billing',
      path: '/billing',
      roles: ['admin', 'super_admin']
    },
    {
      icon: BarChart,
      label: 'Reports',
      path: '/reports',
      roles: ['admin', 'super_admin']
    },
    {
      icon: Activity,
      label: 'Monitoring',
      path: '/monitoring',
      roles: ['admin', 'super_admin']
    },
    {
      icon: Settings,
      label: 'Settings',
      path: '/settings',
      roles: ['admin', 'super_admin']
    },
  ];

  // Mobile menu button
  const MobileMenuButton = () => (
    <button
      type="button"
      onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
      className="lg:hidden fixed top-4 left-4 z-50 p-2 rounded-lg bg-white dark:bg-dark-lighter shadow-lg border border-gray-200 dark:border-gray-700"
      aria-label={isMobileMenuOpen ? 'Close navigation' : 'Open navigation'}
      aria-expanded={isMobileMenuOpen}
      aria-controls="app-sidebar"
    >
      {isMobileMenuOpen ? (
        <X aria-hidden="true" className="h-6 w-6 text-gray-600 dark:text-gray-300" />
      ) : (
        <Menu aria-hidden="true" className="h-6 w-6 text-gray-600 dark:text-gray-300" />
      )}
    </button>
  );

  const canAccessChatAssistant = hasAnyRole([
    'therapist',
    'admin',
    'super_admin'
  ]);

  return (
    <>
      <MobileMenuButton />
      
      <aside id="app-sidebar" className={`
        fixed lg:static inset-y-0 left-0 z-40
        w-64 bg-white dark:bg-dark-lighter border-r border-gray-200 dark:border-dark-border
        transform lg:transform-none transition-transform duration-200 ease-in-out
        ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        flex flex-col h-screen
      `}>
        <div className="flex items-center p-6">
          <Calendar aria-hidden="true" className="h-8 w-8 text-blue-600" />
          <h1 className="ml-2 text-xl font-bold text-gray-900 dark:text-white">AllIncompassing</h1>
        </div>
        
        {/* User info */}
        <div className="px-6 py-2 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center mb-2">
            <User aria-hidden="true" className="h-5 w-5 text-gray-500 dark:text-gray-400 mr-2" />
            <div className="text-sm font-medium text-gray-700 dark:text-gray-300 truncate">
              <div>{user?.email}</div>
              {isTherapist && therapistId && (
                <div className="text-xs text-blue-600 dark:text-blue-400">
                  Therapist Account
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center justify-between">
            <div className="text-xs text-gray-500 dark:text-gray-400">
              Role: {profile?.role || 'No role assigned'}
            </div>
            <button 
              onClick={handleRefreshSession}
              className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 flex items-center"
              disabled={isRefreshing}
            >
              <RefreshCw aria-hidden="true" className={`h-3 w-3 mr-1 ${isRefreshing ? 'animate-spin' : ''}`} />
              {isRefreshing ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
        </div>
        
        {/* Therapist quick link */}
        {isTherapist && therapistId && (
          <div className="border-b dark:border-gray-700 px-4 py-2">
            <Link
              to={`/therapists/${therapistId}`}
              className="flex items-center w-full px-4 py-2 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg transition-colors"
            >
              <User aria-hidden="true" className="h-5 w-5 mr-3 text-blue-600 dark:text-blue-400" />
              My Profile
            </Link>
          </div>
        )}
        
        <nav className="flex-1 space-y-1 px-4 py-4">
          {navItems.map(({ icon: Icon, label, path, roles }) => {
            // Skip if roles are specified and user doesn't have any of them
            if (roles.length > 0 && !roles.some(role => hasRole(role as 'client' | 'therapist' | 'admin' | 'super_admin'))) {
              return null;
            }

            return (
              <NavLink
                key={path}
                to={path}
                onClick={() => setIsMobileMenuOpen(false)}
                className={({ isActive }) =>
                  `group inline-flex items-center px-6 py-4 border-b-2 font-medium text-sm
                  ${
                    isActive
                      ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon
                      aria-hidden="true"
                      className={`
                        -ml-1 mr-2 h-5 w-5
                        ${
                          isActive
                            ? 'text-blue-500 dark:text-blue-400'
                            : 'text-gray-400 group-hover:text-gray-500 dark:text-gray-500 dark:group-hover:text-gray-400'
                        }
                      `}
                    />
                    {label}
                  </>
                )}
              </NavLink>
            );
          })}
        </nav>

        <div className="mt-auto space-y-1 p-4">
          {canAccessChatAssistant && (
            <button
              onClick={() => {
                document.getElementById('chat-trigger')?.click();
                setIsMobileMenuOpen(false);
              }}
              className="flex items-center w-full px-4 py-2 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg transition-colors"
            >
              <MessageSquare aria-hidden="true" className="h-5 w-5 mr-3" />
              Chat Assistant
            </button>
          )}
          
          <button
            onClick={() => {
              toggleTheme();
              setIsMobileMenuOpen(false);
            }}
            className="flex items-center w-full px-4 py-2 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg transition-colors"
          >
            <Sun aria-hidden="true" className="h-5 w-5 mr-3 dark:hidden" />
            <Moon aria-hidden="true" className="h-5 w-5 mr-3 hidden dark:block" />
            {isDark ? 'Light Mode' : 'Dark Mode'}
          </button>
          
          <button
            onClick={handleSignOut}
            disabled={isSigningOut}
            className={`flex items-center w-full px-4 py-2 rounded-lg transition-colors ${
              isSigningOut
                ? 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 cursor-not-allowed'
                : 'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20'
            }`}
          >
            <LogOut aria-hidden="true" className={`h-5 w-5 mr-3 ${isSigningOut ? 'animate-pulse' : ''}`} />
            {isSigningOut ? 'Signing out...' : 'Sign Out'}
          </button>
        </div>
        
        {canAccessChatAssistant && <ChatBot />}
      </aside>

      {/* Overlay for mobile menu */}
      {isMobileMenuOpen && (
        <div className="fixed inset-0 z-30 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation overlay"
            className="w-full h-full bg-black bg-opacity-50"
            onClick={() => setIsMobileMenuOpen(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') setIsMobileMenuOpen(false);
            }}
          />
        </div>
      )}
    </>
  );
}