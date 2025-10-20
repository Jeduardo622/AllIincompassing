import React, { useEffect, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import { AuthProvider } from './lib/authContext';
import { useTheme } from './lib/theme';
import { useAuth } from './lib/authContext';
import ErrorBoundary from './components/ErrorBoundary';
import PrivateRoute from './components/PrivateRoute';
import RoleGuard from './components/RoleGuard';

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
const FamilyDashboard = React.lazy(() => import('./pages/FamilyDashboard'));

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
      networkMode: 'online',
    },
  },
});

const DashboardLanding: React.FC = () => {
  const { hasRole, hasAnyRole } = useAuth();

  const isGuardian = hasRole('client') && !hasAnyRole(['therapist', 'admin', 'super_admin']);

  if (isGuardian) {
    return <Navigate to="/family" replace />;
  }

  return <Dashboard />;
};

function App() {
  const { isDark } = useTheme();

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
        <AuthProvider>
          <div className="min-h-screen bg-gray-50 dark:bg-dark text-gray-900 dark:text-gray-100 transition-colors">
            <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
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
                    <Route index element={<DashboardLanding />} />

                    {/* Schedule - accessible to all authenticated users */}
                    <Route path="schedule" element={<Schedule />} />

                    {/* Clients - accessible to therapists and above */}
                    <Route path="clients" element={
                      <RoleGuard roles={['therapist', 'admin', 'super_admin']}>
                        <Clients />
                      </RoleGuard>
                    } />
                    
                    {/* Client Details - accessible to therapists and above */}
                    <Route path="clients/:clientId" element={
                      <RoleGuard roles={['therapist', 'admin', 'super_admin']}>
                        <ClientDetails />
                      </RoleGuard>
                    } />

                    {/* Client Onboarding - accessible to therapists and above */}
                    <Route path="clients/new" element={
                      <RoleGuard roles={['therapist', 'admin', 'super_admin']}>
                        <ClientOnboardingPage />
                      </RoleGuard>
                    } />

                    {/* Therapists - admin and super_admin only */}
                    <Route path="therapists" element={
                      <RoleGuard roles={['admin', 'super_admin']}>
                        <Therapists />
                      </RoleGuard>
                    } />

                    {/* Therapist Details - accessible to admins and the therapist themselves */}
                    <Route path="therapists/:therapistId" element={
                      <RoleGuard roles={['therapist', 'admin', 'super_admin']}>
                        <TherapistDetails />
                      </RoleGuard>
                    } />

                    {/* Therapist Onboarding - admin and super_admin only */}
                    <Route path="therapists/new" element={
                      <RoleGuard roles={['admin', 'super_admin']}>
                        <TherapistOnboardingPage />
                      </RoleGuard>
                    } />

                    {/* Documentation - accessible to all authenticated users */}
                    <Route path="documentation" element={<Documentation />} />

                    {/* Authorizations - accessible to therapists and above */}
                    <Route path="authorizations" element={
                      <RoleGuard roles={['therapist', 'admin', 'super_admin']}>
                        <Authorizations />
                      </RoleGuard>
                    } />

                    {/* Billing - admin and super_admin only */}
                    <Route path="billing" element={
                      <RoleGuard roles={['admin', 'super_admin']}>
                        <Billing />
                      </RoleGuard>
                    } />

                    {/* Monitoring Dashboard - admin and super_admin only */}
                    <Route path="monitoring" element={
                      <RoleGuard roles={['admin', 'super_admin']}>
                        <MonitoringDashboard />
                      </RoleGuard>
                    } />
                    
                    {/* Reports - admin and super_admin only */}
                    <Route path="reports" element={
                      <RoleGuard roles={['admin', 'super_admin']}>
                        <Reports />
                      </RoleGuard>
                    } />

                    {/* Family Dashboard - guardian only */}
                    <Route
                      path="family"
                      element={
                        <RoleGuard roles={['client']}>
                          <FamilyDashboard />
                        </RoleGuard>
                      }
                    />

                    {/* Settings - admin and super_admin only */}
                    <Route path="settings" element={
                      <RoleGuard roles={['admin', 'super_admin']}>
                        <Settings />
                      </RoleGuard>
                    } />

                    {/* Catch all - redirect to dashboard */}
                    <Route path="*" element={<Navigate to="/" replace />} />
                  </Route>
                </Routes>
              </Suspense>
            </Router>
          </div>
          <Toaster />
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
