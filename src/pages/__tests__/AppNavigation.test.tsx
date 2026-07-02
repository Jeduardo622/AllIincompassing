import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { Outlet } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from '../../App';

type TestRole = 'client' | 'bt' | 'therapist' | 'midtier' | 'admin_schedule' | 'admin' | 'bcba' | 'super_admin';
type TestCapability = 'staffDashboard' | 'viewSchedule';

let authRole: TestRole = 'client';
let authIsGuardian = false;
const { mockLoggerInfo } = vi.hoisted(() => ({
  mockLoggerInfo: vi.fn(),
}));

vi.mock('../../lib/logger/logger', () => ({
  logger: {
    info: mockLoggerInfo,
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../lib/authContext', () => {
  const signOut = vi.fn();
  const capabilityRoles: Record<TestCapability, TestRole[]> = {
    staffDashboard: ['admin_schedule', 'admin', 'bcba', 'super_admin'],
    viewSchedule: ['therapist', 'midtier', 'admin_schedule', 'admin', 'bcba', 'super_admin'],
  };
  return {
    useAuth: () => ({
      profile: { role: authRole, is_active: true },
      user: { id: 'user-1', email: 'user@example.com' },
      loading: false,
      profileLoading: false,
      isGuardian: authIsGuardian,
      effectiveRole: authRole,
      hasRole: (role: TestRole) => authRole === role,
      hasAnyRole: (roles: TestRole[]) => roles.includes(authRole),
      hasCapability: (capability: TestCapability) => capabilityRoles[capability]?.includes(authRole) ?? false,
      hasAnyCapability: (capabilities: TestCapability[]) => capabilities.some((capability) => capabilityRoles[capability]?.includes(authRole)),
      signOut,
      signIn: vi.fn(),
      signUp: vi.fn(),
      resetPassword: vi.fn(),
      updateProfile: vi.fn(),
      session: null,
    }),
    AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

const MockLayout: React.FC = () => (
  <div data-testid="layout">
    <Outlet />
  </div>
);

vi.mock('../../components/Layout', () => ({
  Layout: MockLayout,
}));

vi.mock('../../pages/Dashboard', () => ({
  Dashboard: () => <div>DashboardPage</div>,
}));

vi.mock('../../pages/FamilyDashboard', () => ({
  FamilyDashboard: () => <div>FamilyDashboardPage</div>,
}));

vi.mock('../../pages/Login', () => ({
  Login: () => <div>LoginPage</div>,
}));

vi.mock('../../pages/Signup', () => ({
  Signup: () => <div>SignupPage</div>,
}));

vi.mock('../../pages/PasswordRecovery', () => ({
  PasswordRecovery: () => <div>PasswordRecoveryPage</div>,
}));

vi.mock('../../pages/ClientOnboardingPage', () => ({
  ClientOnboardingPage: () => <div>ClientOnboardingPage</div>,
}));

vi.mock('../../pages/ClientDetails', () => ({
  ClientDetails: () => <div>ClientDetailsPage</div>,
}));

vi.mock('../../pages/TherapistOnboardingPage', () => ({
  TherapistOnboardingPage: () => <div>TherapistOnboardingPage</div>,
}));

vi.mock('../../pages/Settings', () => ({
  Settings: () => <div>SettingsPage</div>,
}));

vi.mock('../../pages/SuperAdminFeatureFlags', () => ({
  SuperAdminFeatureFlags: () => <div>SuperAdminFeatureFlagsPage</div>,
}));

vi.mock('../../pages/SuperAdminImpersonation', () => ({
  SuperAdminImpersonation: () => <div>SuperAdminImpersonationPage</div>,
}));

vi.mock('../../pages/SuperAdminPrompts', () => ({
  SuperAdminPrompts: () => <div>SuperAdminPromptsPage</div>,
}));

const renderApp = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  );
};

describe('App navigation landing', () => {
  beforeEach(() => {
    authRole = 'client';
    authIsGuardian = false;
    mockLoggerInfo.mockReset();
  });

  it('redirects plain clients to documentation', async () => {
    window.history.pushState({}, '', '/');
    renderApp();

    await waitFor(() => {
      expect(window.location.pathname).toBe('/documentation');
    });
  });

  it('redirects guardians to the family dashboard', async () => {
    authIsGuardian = true;
    window.history.pushState({}, '', '/');
    renderApp();

    await waitFor(() => {
      expect(window.location.pathname).toBe('/family');
    });
    expect(await screen.findByText('FamilyDashboardPage')).toBeInTheDocument();
  });

  it('blocks non-guardian clients from family route', async () => {
    authIsGuardian = false;
    window.history.pushState({}, '', '/family');
    renderApp();

    await waitFor(() => {
      expect(window.location.pathname).toBe('/unauthorized');
    });
  });

  it('redirects therapists to schedule from dashboard landing', async () => {
    authRole = 'therapist';
    window.history.pushState({}, '', '/');
    renderApp();

    await waitFor(() => {
      expect(window.location.pathname).toBe('/schedule');
    });
  });

  it('keeps admins on the dashboard', async () => {
    authRole = 'admin';
    window.history.pushState({}, '', '/');
    renderApp();

    expect(await screen.findByText('DashboardPage')).toBeInTheDocument();
  });

  it('does not log raw search/hash in route telemetry', async () => {
    window.history.pushState({}, '', '/?access_token=sensitive#refresh_token=secret');
    renderApp();

    await waitFor(() => {
      expect(mockLoggerInfo).toHaveBeenCalled();
    });

    const telemetryCall = mockLoggerInfo.mock.calls.find(([message]) => message === 'Route navigation event');
    expect(telemetryCall).toBeTruthy();
    const payload = telemetryCall?.[1] as { metadata?: Record<string, unknown> };
    expect(payload.metadata?.route).toBe('/');
    expect(payload.metadata).not.toHaveProperty('search');
    expect(payload.metadata).not.toHaveProperty('hash');
  });

  it('blocks therapists from client onboarding route', async () => {
    authRole = 'therapist';
    window.history.pushState({}, '', '/clients/new');
    renderApp();

    await waitFor(() => {
      expect(window.location.pathname).toBe('/unauthorized');
    });
  });

  it('blocks clients from client onboarding route', async () => {
    authRole = 'client';
    window.history.pushState({}, '', '/clients/new');
    renderApp();

    await waitFor(() => {
      expect(window.location.pathname).toBe('/unauthorized');
    });
  });

  it('allows admin access to therapist onboarding route', async () => {
    authRole = 'admin';
    window.history.pushState({}, '', '/therapists/new');
    renderApp();

    expect(await screen.findByText('TherapistOnboardingPage')).toBeInTheDocument();
  });

  it('blocks therapists from therapist onboarding route', async () => {
    authRole = 'therapist';
    window.history.pushState({}, '', '/therapists/new');
    renderApp();

    await waitFor(() => {
      expect(window.location.pathname).toBe('/unauthorized');
    });
  });

  it('blocks therapists from authorizations route', async () => {
    authRole = 'therapist';
    window.history.pushState({}, '', '/authorizations');
    renderApp();

    await waitFor(() => {
      expect(window.location.pathname).toBe('/unauthorized');
    });
  });

  it('renders password recovery as a public route outside the protected layout', async () => {
    authRole = 'client';
    window.history.pushState({}, '', '/auth/recovery?type=recovery#access_token=secret');
    renderApp();

    expect(await screen.findByText('PasswordRecoveryPage')).toBeInTheDocument();
    expect(screen.queryByTestId('layout')).not.toBeInTheDocument();
    expect(window.location.pathname).toBe('/auth/recovery');
  });

  it('allows admins and super admins to open settings tabs', async () => {
    for (const role of ['admin', 'super_admin'] as const) {
      authRole = role;
      window.history.pushState({}, '', '/settings/organization');
      const view = renderApp();

      expect(await screen.findByText('SettingsPage')).toBeInTheDocument();
      expect(window.location.pathname).toBe('/settings/organization');

      view.unmount();
    }
  });

  it('blocks non-admin roles from settings tabs', async () => {
    for (const role of ['client', 'therapist'] as const) {
      authRole = role;
      window.history.pushState({}, '', '/settings/admin');
      const view = renderApp();

      await waitFor(() => {
        expect(window.location.pathname).toBe('/unauthorized');
      });

      view.unmount();
    }
  });

  it.each([
    ['/super-admin/feature-flags', 'SuperAdminFeatureFlagsPage'],
    ['/super-admin/impersonation', 'SuperAdminImpersonationPage'],
    ['/super-admin/prompts', 'SuperAdminPromptsPage'],
  ])('allows only super admins to render %s', async (path, pageText) => {
    authRole = 'super_admin';
    window.history.pushState({}, '', path);
    const allowedView = renderApp();

    expect(await screen.findByText(pageText)).toBeInTheDocument();
    expect(window.location.pathname).toBe(path);
    allowedView.unmount();

    for (const blockedRole of ['client', 'therapist', 'admin'] as const) {
      authRole = blockedRole;
      window.history.pushState({}, '', path);
      const blockedView = renderApp();

      await waitFor(() => {
        expect(window.location.pathname).toBe('/unauthorized');
      });

      blockedView.unmount();
    }
  });

  it.each([
    ['/monitoringdashboard', '/monitoring'],
    ['/superadminfeatureflags', '/settings'],
    ['/superadminimpersonation', '/settings'],
  ])('keeps legacy alias %s inside the protected shell and redirects to %s', async (aliasPath, expectedPath) => {
    authRole = 'admin';
    window.history.pushState({}, '', aliasPath);
    renderApp();

    await waitFor(() => {
      expect(window.location.pathname).toBe(expectedPath);
    });
  });
});
