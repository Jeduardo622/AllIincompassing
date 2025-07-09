import React, { useState } from 'react';
import { NavLink, useNavigate, Link } from 'react-router-dom';
import { 
  Calendar, Users, FileText, CreditCard, LayoutDashboard, 
  UserCog, LogOut, Settings, MessageSquare, Sun, Moon, 
  FileCheck, Menu, X, RefreshCw, User, BarChart, Activity,
  ChevronDown, ChevronUp
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useTheme } from '../lib/theme';
import { cn, layout, patterns, animations, focusStates } from '../lib/design-system';
import ChatBot from './ChatBot';
import ThemeToggle from './ThemeToggle';
import Button from './ui/Button';

export default function Sidebar() {
  const { signOut, hasRole, user, roles, refreshSession } = useAuth();
  const { isDark } = useTheme();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
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
      roles: [], // accessible to all authenticated users
      badge: null,
    },
    { 
      icon: Calendar, 
      label: 'Schedule', 
      path: '/schedule',
      roles: [], // accessible to all authenticated users
      badge: null,
    },
    { 
      icon: Users, 
      label: 'Clients', 
      path: '/clients',
      roles: ['admin', 'therapist'],
      badge: null,
    },
    { 
      icon: UserCog, 
      label: 'Therapists', 
      path: '/therapists', 
      roles: ['admin'],
      badge: null,
    },
    { 
      icon: FileCheck, 
      label: 'Authorizations', 
      path: '/authorizations',
      roles: ['admin', 'therapist'],
      badge: null,
    },
    { 
      icon: FileText, 
      label: 'Documentation', 
      path: '/documentation',
      roles: [], // accessible to all authenticated users
      badge: null,
    },
    { 
      icon: CreditCard, 
      label: 'Billing', 
      path: '/billing', 
      roles: ['admin'],
      badge: null,
    },
    { 
      icon: BarChart, 
      label: 'Reports', 
      path: '/reports', 
      roles: ['admin'],
      badge: null,
    },
    { 
      icon: Activity, 
      label: 'Monitoring', 
      path: '/monitoring', 
      roles: ['admin'],
      badge: null,
    },
    { 
      icon: Settings, 
      label: 'Settings', 
      path: '/settings', 
      roles: ['admin'],
      badge: null,
    },
  ];

  // Mobile menu button
  const MobileMenuButton = () => (
    <button
      onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
      className={cn(
        'lg:hidden fixed top-4 left-4 z-50 p-3 rounded-lg',
        'bg-white dark:bg-dark-lighter shadow-lg',
        'border border-gray-200 dark:border-gray-700',
        'transition-all duration-200 ease-in-out',
        'hover:shadow-xl hover:scale-105',
        focusStates.ring,
        animations['transition-all']
      )}
      aria-label={isMobileMenuOpen ? 'Close menu' : 'Open menu'}
    >
      {isMobileMenuOpen ? (
        <X className="h-6 w-6 text-gray-600 dark:text-gray-300" />
      ) : (
        <Menu className="h-6 w-6 text-gray-600 dark:text-gray-300" />
      )}
    </button>
  );

  // User menu component
  const UserMenu = () => (
    <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
      <button
        onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
        className={cn(
          'w-full flex items-center justify-between p-3 rounded-lg',
          'hover:bg-gray-50 dark:hover:bg-gray-800',
          'transition-colors duration-200',
          focusStates.ring
        )}
        aria-expanded={isUserMenuOpen}
        aria-label="User menu"
      >
        <div className="flex items-center min-w-0">
          <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary-100 dark:bg-primary-900 flex items-center justify-center">
            <User className="h-4 w-4 text-primary-600 dark:text-primary-400" />
          </div>
          <div className="ml-3 text-left min-w-0">
            <div className="text-sm font-medium text-gray-700 dark:text-gray-300 truncate">
              {user?.email}
            </div>
            {isTherapist && therapistId && (
              <div className="text-xs text-primary-600 dark:text-primary-400">
                Therapist Account
              </div>
            )}
          </div>
        </div>
        {isUserMenuOpen ? (
          <ChevronUp className="h-4 w-4 text-gray-500 dark:text-gray-400" />
        ) : (
          <ChevronDown className="h-4 w-4 text-gray-500 dark:text-gray-400" />
        )}
      </button>
      
      {isUserMenuOpen && (
        <div className={cn(
          'mt-2 space-y-1',
          animations['fade-in']
        )}>
          <div className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800 rounded-md">
            Roles: {roles.length > 0 ? roles.join(', ') : 'No roles assigned'}
          </div>
          
          <button 
            onClick={handleRefreshSession}
            disabled={isRefreshing}
            className={cn(
              'w-full flex items-center px-3 py-2 text-sm text-gray-600 dark:text-gray-300',
              'hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md',
              'transition-colors duration-200',
              focusStates.ring,
              isRefreshing && 'opacity-50 cursor-not-allowed'
            )}
          >
            <RefreshCw className={cn('h-4 w-4 mr-2', isRefreshing && 'animate-spin')} />
            {isRefreshing ? 'Refreshing...' : 'Refresh Session'}
          </button>
          
          {isTherapist && therapistId && (
            <Link
              to={`/therapists/${therapistId}`}
              className={cn(
                'w-full flex items-center px-3 py-2 text-sm text-gray-600 dark:text-gray-300',
                'hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md',
                'transition-colors duration-200',
                focusStates.ring
              )}
              onClick={() => setIsMobileMenuOpen(false)}
            >
              <User className="h-4 w-4 mr-2" />
              My Profile
            </Link>
          )}
        </div>
      )}
    </div>
  );

  return (
    <>
      <MobileMenuButton />
      
      <aside className={cn(
        layout.sidebar,
        'bg-white dark:bg-dark-lighter',
        'border-r border-gray-200 dark:border-gray-700',
        'flex flex-col h-screen',
        'shadow-lg lg:shadow-none',
        isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
        animations['transition-transform']
      )}>
        {/* Logo */}
        <div className="flex items-center p-6 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center">
            <div className="w-10 h-10 bg-primary-600 rounded-lg flex items-center justify-center">
              <Calendar className="h-6 w-6 text-white" />
            </div>
            <div className="ml-3">
              <h1 className="text-xl font-bold text-gray-900 dark:text-white">
                AllIncompassing
              </h1>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Therapy Management
              </p>
            </div>
          </div>
        </div>
        
        {/* User info */}
        <UserMenu />
        
        {/* Navigation */}
        <nav className="flex-1 px-4 py-6 overflow-y-auto">
          <div className="space-y-2">
            {navItems.map(({ icon: Icon, label, path, roles, badge }) => {
              // Skip if roles are specified and user doesn't have any of them
              if (roles.length > 0 && !roles.some(role => hasRole(role))) {
                return null;
              }

              return (
                <NavLink
                  key={path}
                  to={path}
                  onClick={() => setIsMobileMenuOpen(false)}
                                     className={({ isActive }: { isActive: boolean }) => cn(
                     patterns['nav-link'],
                     'group relative',
                     isActive 
                       ? cn(patterns['nav-link-active'], 'font-semibold')
                       : patterns['nav-link-inactive']
                   )}
                >
                  <Icon className="h-5 w-5 mr-3 flex-shrink-0" />
                  <span className="flex-1">{label}</span>
                  {badge && (
                    <span className="ml-auto flex-shrink-0 bg-primary-100 text-primary-800 dark:bg-primary-900 dark:text-primary-200 text-xs px-2 py-1 rounded-full">
                      {badge}
                    </span>
                  )}
                </NavLink>
              );
            })}
          </div>
        </nav>

        {/* Footer actions */}
        <div className="mt-auto p-4 border-t border-gray-200 dark:border-gray-700">
          <div className="space-y-2">
            <button
              onClick={() => {
                document.getElementById('chat-trigger')?.click();
                setIsMobileMenuOpen(false);
              }}
              className={cn(
                'w-full flex items-center px-3 py-2 text-sm text-gray-600 dark:text-gray-300',
                'hover:bg-gray-50 dark:hover:bg-gray-800 rounded-md',
                'transition-colors duration-200',
                focusStates.ring
              )}
            >
              <MessageSquare className="h-4 w-4 mr-3" />
              Chat Assistant
            </button>
            
            <button
              onClick={() => {
                document.getElementById('theme-toggle')?.click();
                setIsMobileMenuOpen(false);
              }}
              className={cn(
                'w-full flex items-center px-3 py-2 text-sm text-gray-600 dark:text-gray-300',
                'hover:bg-gray-50 dark:hover:bg-gray-800 rounded-md',
                'transition-colors duration-200',
                focusStates.ring
              )}
            >
              <Sun className="h-4 w-4 mr-3 dark:hidden" />
              <Moon className="h-4 w-4 mr-3 hidden dark:block" />
              <span className="flex-1 text-left">
                {isDark ? 'Light Mode' : 'Dark Mode'}
              </span>
            </button>
            
            <Button
              onClick={handleSignOut}
              disabled={isSigningOut}
              variant="danger"
              size="sm"
              fullWidth
              isLoading={isSigningOut}
              loadingText="Signing out..."
              leftIcon={<LogOut className="h-4 w-4" />}
            >
              Sign Out
            </Button>
          </div>
        </div>
        
        <ChatBot />
        <ThemeToggle />
      </aside>

      {/* Mobile overlay */}
      {isMobileMenuOpen && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 z-30 lg:hidden backdrop-blur-sm"
          onClick={() => setIsMobileMenuOpen(false)}
          aria-hidden="true"
        />
      )}
    </>
  );
}