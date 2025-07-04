import React, { useEffect, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import { useAuth } from './lib/auth';
import { useTheme } from './lib/theme';
import ErrorBoundary from './components/ErrorBoundary';
import PrivateRoute from './components/PrivateRoute';

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
const MonitoringDashboard = React.lazy(() => import('./pages/MonitoringDashboard'));
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
  const { initialized, initialize } = useAuth();
  const { isDark } = useTheme();

  useEffect(() => {
    // Initialize auth system on app start
    if (!initialized) {
      initialize().catch(console.error);
    }
  }, [initialized, initialize]);

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

                {/* Clients - accessible to users with view_clients permission */}
                <Route path="clients" element={
                  <PrivateRoute requiredPermission="view_clients">
                    <Clients />
                  </PrivateRoute>
                } />
                
                {/* Client Details - accessible to users with view_clients permission */}
                <Route path="clients/:clientId" element={
                  <PrivateRoute requiredPermission="view_clients">
                    <ClientDetails />
                  </PrivateRoute>
                } />

                {/* Client Onboarding - accessible to therapists and admins */}
                <Route path="clients/new" element={
                  <PrivateRoute requiredRoles={['therapist', 'admin']}>
                    <ClientOnboardingPage />
                  </PrivateRoute>
                } />

                {/* Therapists - admin only */}
                <Route path="therapists" element={
                  <PrivateRoute requiredRole="admin">
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

                {/* Monitoring Dashboard - admin only */}
                <Route path="monitoring" element={
                  <PrivateRoute>
                    <MonitoringDashboard />
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