import React, { useState } from 'react';
import { NavLink, useNavigate, Link } from 'react-router-dom';
import { 
  Calendar, Users, FileText, CreditCard, LayoutDashboard, 
  UserCog, LogOut, Settings, MessageSquare, Sun, Moon, 
  FileCheck, Menu, X, RefreshCw, User, BarChart, Activity
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useTheme } from '../lib/theme';
import ChatBot from './ChatBot';
import ThemeToggle from './ThemeToggle';

export default function Sidebar() {
  const { signOut, hasRole, user, roles, refreshSession } = useAuth();
  const { isDark } = useTheme();
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
      // The signOut function now handles redirection
    } catch (error) {
      console.error('Error signing out:', error);
      setIsSigningOut(false);
      // Force navigation to login page even if there's an error
      navigate('/login');
    }
  };

  const handleRefreshSession = async () => {
    if (isRefreshing) return;
    
    console.log('Manual session refresh requested');
    try {
      setIsRefreshing(true);
      await refreshSession();
      console.log('Session refreshed, current roles:', roles);
      console.log('Manual session refresh completed');
      setIsRefreshing(false);
    } catch (error) {
      console.error('Error refreshing session:', error);
      setIsRefreshing(false);
    }
  };

  const navItems = [
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
      roles: ['admin', 'therapist']
    },
    { 
      icon: UserCog, 
      label: 'Therapists', 
      path: '/therapists', 
      roles: ['admin']
    },
    { 
      icon: FileCheck, 
      label: 'Authorizations', 
      path: '/authorizations',
      roles: ['admin', 'therapist']
    },
    { 
      icon: FileText, 
      label: 'Documentation', 
      path: '/documentation',
      roles: [] // accessible to all authenticated users
    },
    { 
      icon: CreditCard, 
      label: 'Billing', 
      path: '/billing', 
      roles: ['admin']
    },
    { 
      icon: BarChart, 
      label: 'Reports', 
      path: '/reports', 
      roles: ['admin']
    },
    { 
      icon: Activity, 
      label: 'Monitoring', 
      path: '/monitoring', 
      roles: ['admin']
    },
    { 
      icon: Settings, 
      label: 'Settings', 
      path: '/settings', 
      roles: ['admin']
    },
  ];

  // Mobile menu button
  const MobileMenuButton = () => (
    <button
      onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
      className="lg:hidden fixed top-4 left-4 z-50 p-2 rounded-lg bg-white dark:bg-dark-lighter shadow-lg border border-gray-200 dark:border-gray-700"
    >
      {isMobileMenuOpen ? (
        <X className="h-6 w-6 text-gray-600 dark:text-gray-300" />
      ) : (
        <Menu className="h-6 w-6 text-gray-600 dark:text-gray-300" />
      )}
    </button>
  );

  return (
    <>
      <MobileMenuButton />
      
      <aside className={`
        fixed lg:static inset-y-0 left-0 z-40
        w-64 bg-white dark:bg-dark-lighter border-r border-gray-200 dark:border-dark-border
        transform lg:transform-none transition-transform duration-200 ease-in-out
        ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        flex flex-col h-screen
      `}>
        <div className="flex items-center p-6">
          <Calendar className="h-8 w-8 text-blue-600" />
          <h1 className="ml-2 text-xl font-bold text-gray-900 dark:text-white">AllIncompassing</h1>
        </div>
        
        {/* User info */}
        <div className="px-6 py-2 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center mb-2">
            <User className="h-5 w-5 text-gray-500 dark:text-gray-400 mr-2" />
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
              Roles: {roles.length > 0 ? roles.join(', ') : 'No roles assigned'}
            </div>
            <button 
              onClick={handleRefreshSession}
              className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 flex items-center"
              disabled={isRefreshing}
            >
              <RefreshCw className={`h-3 w-3 mr-1 ${isRefreshing ? 'animate-spin' : ''}`} />
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
              <User className="h-5 w-5 mr-3 text-blue-600 dark:text-blue-400" />
              My Profile
            </Link>
          </div>
        )}
        
        <nav className="flex-1 space-y-1 px-4 py-4">
          {navItems.map(({ icon: Icon, label, path, roles }) => {
            // Skip if roles are specified and user doesn't have any of them
            if (roles.length > 0 && !roles.some(role => hasRole(role))) {
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
                <Icon className={`
                  -ml-1 mr-2 h-5 w-5
                  ${
                    path === location.pathname
                      ? 'text-blue-500 dark:text-blue-400'
                      : 'text-gray-400 group-hover:text-gray-500 dark:text-gray-500 dark:group-hover:text-gray-400'
                  }
                `} />
                {label}
              </NavLink>
            );
          })}
        </nav>

        <div className="mt-auto space-y-1 p-4">
          <button
            onClick={() => {
              document.getElementById('chat-trigger')?.click();
              setIsMobileMenuOpen(false);
            }}
            className="flex items-center w-full px-4 py-2 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg transition-colors"
          >
            <MessageSquare className="h-5 w-5 mr-3" />
            Chat Assistant
          </button>
          
          <button
            onClick={() => {
              document.getElementById('theme-toggle')?.click();
              setIsMobileMenuOpen(false);
            }}
            className="flex items-center w-full px-4 py-2 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg transition-colors"
          >
            <Sun className="h-5 w-5 mr-3 dark:hidden" />
            <Moon className="h-5 w-5 mr-3 hidden dark:block" />
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
            <LogOut className={`h-5 w-5 mr-3 ${isSigningOut ? 'animate-pulse' : ''}`} />
            {isSigningOut ? 'Signing out...' : 'Sign Out'}
          </button>
        </div>
        
        <ChatBot />
        <ThemeToggle />
      </aside>

      {/* Overlay for mobile menu */}
      {isMobileMenuOpen && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 z-30 lg:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}
    </>
  );
}