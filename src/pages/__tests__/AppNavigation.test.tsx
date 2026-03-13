import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { Outlet } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from '../../App';

let authRole: 'client' | 'therapist' | 'admin' | 'super_admin' = 'client';
let authIsGuardian = false;

vi.mock('../../lib/authContext', () => {
  const signOut = vi.fn();
  return {
    useAuth: () => ({
      profile: { role: authRole },
      user: { id: 'user-1', email: 'user@example.com' },
      loading: false,
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
});
