import React, { useEffect, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation, useNavigationType } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import { AuthProvider } from './lib/authContext';
import { appQueryClient } from './lib/queryClient';
import { useTheme } from './lib/theme';
import { useAuth } from './lib/authContext';
import { canAccessStaffDashboard } from './lib/dashboardAccess';
import { ErrorBoundary } from './components/ErrorBoundary';
import { PrivateRoute } from './components/PrivateRoute';
import { RoleGuard } from './components/RoleGuard';
import { RouteLoadingSkeleton } from './components/RouteLoadingSkeleton';
import { logger } from './lib/logger/logger';

// Lazy load components
const Login = React.lazy(() => import('./pages/Login').then(module => ({ default: module.Login })));
const Signup = React.lazy(() => import('./pages/Signup').then(module => ({ default: module.Signup })));
const PasswordRecovery = React.lazy(() =>
  import('./pages/PasswordRecovery').then(module => ({ default: module.PasswordRecovery })),
);
const Layout = React.lazy(() => import('./components/Layout').then(module => ({ default: module.Layout })));
const Dashboard = React.lazy(() => import('./pages/Dashboard').then(module => ({ default: module.Dashboard })));
const Schedule = React.lazy(() => import('./pages/Schedule').then(module => ({ default: module.Schedule })));
const Clients = React.lazy(() => import('./pages/Clients').then(module => ({ default: module.Clients })));
const ClientDetails = React.lazy(() => import('./pages/ClientDetails').then(module => ({ default: module.ClientDetails })));
const ClientOnboardingPage = React.lazy(() =>
  import('./pages/ClientOnboardingPage').then(module => ({ default: module.ClientOnboardingPage })),
);
const Therapists = React.lazy(() => import('./pages/Therapists').then(module => ({ default: module.Therapists })));
const TherapistOnboardingPage = React.lazy(() =>
  import('./pages/TherapistOnboardingPage').then(module => ({ default: module.TherapistOnboardingPage })),
);
const TherapistDetails = React.lazy(() =>
  import('./pages/TherapistDetails').then(module => ({ default: module.TherapistDetails })),
);
const MonitoringDashboard = React.lazy(() =>
  import('./pages/MonitoringDashboard').then(module => ({ default: module.MonitoringDashboard })),
);
const Documentation = React.lazy(() =>
  import('./pages/Documentation').then(module => ({ default: module.Documentation })),
);
const FillDocs = React.lazy(() => import('./pages/FillDocs').then(module => ({ default: module.FillDocs })));
const Billing = React.lazy(() => import('./pages/Billing').then(module => ({ default: module.Billing })));
const Settings = React.lazy(() => import('./pages/Settings').then(module => ({ default: module.Settings })));
const SuperAdminFeatureFlags = React.lazy(() =>
  import('./pages/SuperAdminFeatureFlags').then(module => ({ default: module.SuperAdminFeatureFlags })),
);
const SuperAdminImpersonation = React.lazy(() =>
  import('./pages/SuperAdminImpersonation').then(module => ({ default: module.SuperAdminImpersonation })),
);
const SuperAdminPrompts = React.lazy(() =>
  import('./pages/SuperAdminPrompts').then(module => ({ default: module.SuperAdminPrompts })),
);
const Unauthorized = React.lazy(() =>
  import('./pages/Unauthorized').then(module => ({ default: module.Unauthorized })),
);
const Authorizations = React.lazy(() =>
  import('./pages/Authorizations').then(module => ({ default: module.Authorizations })),
);
const Reports = React.lazy(() => import('./pages/Reports').then(module => ({ default: module.Reports })));
const FamilyDashboard = React.lazy(() =>
  import('./pages/FamilyDashboard').then(module => ({ default: module.FamilyDashboard })),
);

// Loading component
const LoadingSpinner = () => (
  <div className="h-full flex items-center justify-center">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
  </div>
);

const DashboardLanding: React.FC = () => {
  const { user, profile, loading, profileLoading, isGuardian, effectiveRole } = useAuth();

  if (loading || (user && profileLoading && !profile)) {
    return (
      <div className="flex min-h-[16rem] w-full items-center justify-center p-4">
        <div className="w-full max-w-2xl">
          <RouteLoadingSkeleton label="Loading your workspace" />
        </div>
      </div>
    );
  }

  if (isGuardian) {
    return <Navigate to="/family" replace />;
  }

  if (canAccessStaffDashboard(effectiveRole)) {
    return <Dashboard />;
  }

  if (effectiveRole === 'therapist') {
    return <Navigate to="/schedule" replace />;
  }

  // Plain clients should land on family-safe docs, not the admin dashboard shell.
  return <Navigate to="/documentation" replace />;
};

const RouteTelemetry: React.FC = () => {
  const location = useLocation();
  const navigationType = useNavigationType();
  const { user, effectiveRole } = useAuth();

  useEffect(() => {
    logger.info('Route navigation event', {
      metadata: {
        scope: 'routeTelemetry.navigation',
        route: location.pathname,
        navigationType,
        userId: user?.id ?? null,
        role: effectiveRole,
      },
    });
  }, [
    location.pathname,
    navigationType,
    user?.id,
    effectiveRole,
  ]);

  return null;
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
      <QueryClientProvider client={appQueryClient}>
        <AuthProvider>
          <div className="min-h-dvh bg-gray-50 dark:bg-dark text-gray-900 dark:text-gray-100 transition-colors">
            <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
              <RouteTelemetry />
              <Suspense fallback={<LoadingSpinner />}>
                <Routes>
                  {/* Public Routes */}
                  <Route path="/login" element={<Login />} />
                  <Route path="/signup" element={<Signup />} />
                  <Route path="/auth/recovery" element={<PasswordRecovery />} />
                  <Route path="/unauthorized" element={<Unauthorized />} />

                  {/* Protected Routes */}
                  <Route path="/" element={
                    <PrivateRoute>
                      <Suspense fallback={<RouteLoadingSkeleton label="Loading app layout" />}>
                        <Layout />
                      </Suspense>
                    </PrivateRoute>
                  }>
                    {/* Dashboard - accessible to all authenticated users */}
                    <Route index element={<DashboardLanding />} />

                    {/* Schedule - accessible to therapists and above */}
                    <Route path="schedule" element={
                      <RoleGuard roles={['therapist', 'admin', 'super_admin']}>
                        <Schedule />
                      </RoleGuard>
                    } />

                    {/* Clients - accessible to therapists and above */}
                    <Route path="clients" element={
                      <RoleGuard roles={['therapist', 'admin', 'super_admin']}>
                        <Clients />
                      </RoleGuard>
                    } />
                    
                    {/* Client Onboarding - admin and super_admin only */}
                    <Route path="clients/new" element={
                      <RoleGuard roles={['admin', 'super_admin']}>
                        <ClientOnboardingPage />
                      </RoleGuard>
                    } />

                    {/* Client Details - accessible to therapists and above */}
                    <Route path="clients/:clientId" element={
                      <RoleGuard roles={['therapist', 'admin', 'super_admin']}>
                        <ClientDetails />
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

                    {/* Fill Docs - accessible to therapists and above */}
                    <Route
                      path="fill-docs"
                      element={(
                        <RoleGuard roles={['therapist', 'admin', 'super_admin']}>
                          <FillDocs />
                        </RoleGuard>
                      )}
                    />

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
                    {/* Legacy/alias routes */}
                    <Route path="monitoringdashboard" element={<Navigate to="/monitoring" replace />} />
                    <Route path="superadminfeatureflags" element={<Navigate to="/settings" replace />} />
                    <Route path="superadminimpersonation" element={<Navigate to="/settings" replace />} />
                    
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
                        <RoleGuard roles={['client']} requireGuardian>
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
                    <Route path="settings/:tabId" element={
                      <RoleGuard roles={['admin', 'super_admin']}>
                        <Settings />
                      </RoleGuard>
                    } />

                    {/* Super Admin tools */}
                    <Route
                      path="super-admin/feature-flags"
                      element={
                        <RoleGuard roles={['super_admin']}>
                          <SuperAdminFeatureFlags />
                        </RoleGuard>
                      }
                    />
                    <Route
                      path="super-admin/impersonation"
                      element={
                        <RoleGuard roles={['super_admin']}>
                          <SuperAdminImpersonation />
                        </RoleGuard>
                      }
                    />
                    <Route
                      path="super-admin/prompts"
                      element={
                        <RoleGuard roles={['super_admin']}>
                          <SuperAdminPrompts />
                        </RoleGuard>
                      }
                    />

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

export { App };
