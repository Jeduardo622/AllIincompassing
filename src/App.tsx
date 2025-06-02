import React, { useEffect, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import { supabase } from './lib/supabase';
import { useAuth } from './lib/auth';
import { useTheme } from './lib/theme';
import ErrorBoundary from './components/ErrorBoundary';
import PrivateRoute from './components/PrivateRoute';
import { showError } from './lib/toast';

// Lazy load components
const Login = React.lazy(() => import('./pages/Login'));
const Signup = React.lazy(() => import('./pages/Signup'));
const Layout = React.lazy(() => import('./components/Layout'));
const Dashboard = React.lazy(() => import('./pages/Dashboard'));
const Schedule = React.lazy(() => import('./pages/Schedule'));
const Clients = React.lazy(() => import('./pages/Clients'));
const ClientDetails = React.lazy(() => import('./pages/ClientDetails'));
const ClientOnboardingPage = React.lazy(() => import('./pages/ClientOnboardingPage'));
const Therapists = React.lazy(() => import('./pages/Therapists'));
const TherapistOnboardingPage = React.lazy(() => import('./pages/TherapistOnboardingPage'));
const TherapistDetails = React.lazy(() => import('./pages/TherapistDetails'));
const Documentation = React.lazy(() => import('./pages/Documentation'));
const Billing = React.lazy(() => import('./pages/Billing'));
const Settings = React.lazy(() => import('./pages/Settings'));
const Unauthorized = React.lazy(() => import('./pages/Unauthorized'));
const Authorizations = React.lazy(() => import('./pages/Authorizations'));
const Reports = React.lazy(() => import('./pages/Reports'));

// Loading component
const LoadingSpinner = () => (
  <div className="h-full flex items-center justify-center">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
  </div>
);

// Session refresh interval (15 minutes)
const SESSION_REFRESH_INTERVAL = 15 * 60 * 1000;
// Maximum consecutive session refresh failures before notifying user
const MAX_REFRESH_FAILURES = 3;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error: unknown) => {
        // Don't retry on 4xx errors
        const errorWithStatus = error as { status?: number };
        if (errorWithStatus?.status && errorWithStatus.status >= 400 && errorWithStatus.status < 500) {
          return false;
        }
        return failureCount < 2;
      },
      refetchOnWindowFocus: false,
      refetchOnReconnect: 'always',
      staleTime: 5 * 60 * 1000, // 5 minutes
      gcTime: 30 * 60 * 1000, // 30 minutes (renamed from cacheTime)
      networkMode: 'online',
    },
    mutations: {
      retry: 1,
      networkMode: 'online',
    },
  },
});

function App() {
  const { setUser, setRoles, refreshSession } = useAuth();
  const { isDark } = useTheme();
  const [refreshFailures, setRefreshFailures] = React.useState(0);

  useEffect(() => {
    let isSubscribed = true;
    let refreshIntervalId: number | undefined;

    // Set up auth state listener
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!isSubscribed) return;
      
      console.log('Auth state changed:', _event, session?.user?.email);
      setUser(session?.user ?? null);
      
      if (session?.user) {
        // Fetch user roles
        try {
          const { data: rolesData, error: rolesError } = await supabase.rpc('get_user_roles');
          if (rolesError) {
            console.error('Error fetching roles on auth change:', rolesError);
            setRoles([]);
          } else {
            const userRoles = rolesData?.[0]?.roles || [];
            console.log('User roles from auth change:', userRoles);
            setRoles(userRoles);
            
            // If user has no roles, try to assign admin role via RPC
            // Only try once to avoid multiple calls
            if (userRoles.length === 0) {
              console.log('No roles found, attempting to assign via RPC...');
              try {
                // Only use one method to reduce API calls
                const { error: assignError } = await supabase.rpc('assign_admin_role', {
                  user_email: session.user.email
                });
                
                if (assignError) {
                  console.error('Error using assign_admin_role:', assignError);
                } else {
                  console.log('Admin role assigned successfully via assign_admin_role');
                  // Refresh session to get updated roles
                  if (isSubscribed) {
                    await refreshSession();
                  }
                }
              } catch (error) {
                console.error('Error in admin role assignment:', error);
              }
            }
          }
        } catch (error) {
          console.error('Error handling auth state change:', error);
          setRoles([]);
        }
      } else {
        setRoles([]);
      }
    });

    // Initial session check with logging
    const initialSessionCheck = async () => {
      console.log('Performing initial session check...');
      try {
        await refreshSession();
        console.log('Initial session check completed successfully');
        setRefreshFailures(0); // Reset failure counter on success
      } catch (error) {
        console.error('Error during initial session refresh:', error);
        setRefreshFailures(prev => prev + 1);
        
        // Notify user if we've had multiple failures
        if (refreshFailures >= MAX_REFRESH_FAILURES) {
          showError('Session refresh is failing. You may need to sign out and back in.');
        }
      }
    };

    initialSessionCheck();

    // Set up periodic session refresh with improved logging and error handling
    refreshIntervalId = window.setInterval(() => {
      console.log('Scheduled session refresh starting...');
      refreshSession()
        .then(() => {
          console.log('Scheduled session refresh completed successfully');
          setRefreshFailures(0); // Reset failure counter on success
        })
        .catch(error => {
          console.error('Error during scheduled session refresh:', error);
          setRefreshFailures(prev => {
            const newCount = prev + 1;
            
            // Notify user if we've had multiple consecutive failures
            if (newCount >= MAX_REFRESH_FAILURES) {
              showError('Session refresh is failing. You may need to sign out and back in.');
            }
            
            return newCount;
          });
        });
    }, SESSION_REFRESH_INTERVAL);

    return () => {
      isSubscribed = false;
      subscription.unsubscribe();
      if (refreshIntervalId) {
        clearInterval(refreshIntervalId);
      }
    };
  }, [setUser, setRoles, refreshSession, refreshFailures]);

  useEffect(() => {
    // Update dark mode class on document
    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDark]);

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <div className="min-h-screen bg-gray-50 dark:bg-dark text-gray-900 dark:text-gray-100 transition-colors">
          <Router>
            <Suspense fallback={<LoadingSpinner />}>
            <Routes>
              {/* Public Routes */}
              <Route path="/login" element={<Login />} />
              <Route path="/signup" element={<Signup />} />
              <Route path="/unauthorized" element={<Unauthorized />} />

              {/* Protected Routes */}
              <Route path="/" element={
                <PrivateRoute>
                  <Layout />
                </PrivateRoute>
              }>
                {/* Dashboard - accessible to all authenticated users */}
                <Route index element={<Dashboard />} />

                {/* Schedule - accessible to all authenticated users */}
                <Route path="schedule" element={<Schedule />} />

                {/* Clients - accessible to admins and assigned therapists */}
                <Route path="clients" element={
                  <PrivateRoute>
                    <Clients />
                  </PrivateRoute>
                } />
                
                {/* Client Details - accessible to admins and assigned therapists */}
                <Route path="clients/:clientId" element={
                  <PrivateRoute>
                    <ClientDetails />
                  </PrivateRoute>
                } />

                {/* Client Onboarding - accessible to admins and therapists */}
                <Route path="clients/new" element={
                  <PrivateRoute>
                    <ClientOnboardingPage />
                  </PrivateRoute>
                } />

                {/* Therapists - admin only */}
                <Route path="therapists" element={
                  <PrivateRoute>
                    <Therapists />
                  </PrivateRoute>
                } />

                {/* Therapist Details - accessible to admins and the therapist themselves */}
                <Route path="therapists/:therapistId" element={
                  <PrivateRoute>
                    <TherapistDetails />
                  </PrivateRoute>
                } />

                {/* Therapist Onboarding - admin only */}
                <Route path="therapists/new" element={
                  <PrivateRoute>
                    <TherapistOnboardingPage />
                  </PrivateRoute>
                } />

                {/* Documentation - accessible to all authenticated users */}
                <Route path="documentation" element={<Documentation />} />

                {/* Authorizations - accessible to admins and therapists */}
                <Route path="authorizations" element={
                  <PrivateRoute>
                    <Authorizations />
                  </PrivateRoute>
                } />

                {/* Billing - admin only */}
                <Route path="billing" element={
                  <PrivateRoute>
                    <Billing />
                  </PrivateRoute>
                } />

                {/* Reports - admin only */}
                <Route path="reports" element={
                  <PrivateRoute>
                    <Reports />
                  </PrivateRoute>
                } />

                {/* Settings - admin only */}
                <Route path="settings" element={
                  <PrivateRoute>
                    <Settings />
                  </PrivateRoute>
                } />

                {/* Catch all - redirect to dashboard */}
                  <Route path="*" element={<Navigate to="/\" replace />} />
              </Route>
            </Routes>
            </Suspense>
          </Router>
        </div>
        <Toaster />
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;