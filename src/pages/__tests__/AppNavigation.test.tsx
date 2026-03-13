import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { Outlet } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from '../../App';

let authRole: 'client' | 'therapist' | 'admin' | 'super_admin' = 'client';
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
  return {
    useAuth: () => ({
      profile: { role: authRole, is_active: true },
      user: { id: 'user-1', email: 'user@example.com' },
      loading: false,
      profileLoading: false,
      isGuardian: authIsGuardian,
      hasRole: (role: 'client' | 'therapist' | 'admin' | 'super_admin') => authRole === role,
      hasAnyRole: (roles: ('client' | 'therapist' | 'admin' | 'super_admin')[]) => roles.includes(authRole),
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

vi.mock('../../pages/ClientOnboardingPage', () => ({
  ClientOnboardingPage: () => <div>ClientOnboardingPage</div>,
}));

vi.mock('../../pages/TherapistOnboardingPage', () => ({
  TherapistOnboardingPage: () => <div>TherapistOnboardingPage</div>,
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

  it('keeps plain clients on the dashboard', async () => {
    window.history.pushState({}, '', '/');
    renderApp();

    expect(await screen.findByText('DashboardPage')).toBeInTheDocument();
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

  it('keeps therapists on the dashboard', async () => {
    authRole = 'therapist';
    window.history.pushState({}, '', '/');
    renderApp();

    expect(await screen.findByText('DashboardPage')).toBeInTheDocument();
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

  it('allows therapist access to client onboarding route', async () => {
    authRole = 'therapist';
    window.history.pushState({}, '', '/clients/new');
    renderApp();

    expect(await screen.findByText('ClientOnboardingPage')).toBeInTheDocument();
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
});
