import React, { useMemo, useRef } from 'react';
import { render, RenderOptions } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, type MemoryRouterProps } from 'react-router-dom';
import { vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import * as authContext from '../lib/authContext';
import type { UserProfile } from '../lib/authContext';
import { STUB_AUTH_STORAGE_KEY } from '../lib/authStubSession';
import { getDefaultOrganizationId } from '../lib/runtimeConfig';

type AuthRole = UserProfile['role'];

export interface AuthStubConfig {
  role?: AuthRole;
  organizationId?: string | null;
  userId?: string;
  email?: string;
  fullName?: string;
  accessToken?: string;
  refreshToken?: string;
}

export interface RenderWithProvidersOptions extends Omit<RenderOptions, 'wrapper'> {
  auth?: AuthStubConfig | false;
  router?: Pick<MemoryRouterProps, 'initialEntries' | 'initialIndex'>;
}

const resolveDefaultOrganizationId = (): string => {
  try {
    return getDefaultOrganizationId();
  } catch {
    return 'org-default-123';
  }
};

const seedStubAuthState = (config?: AuthStubConfig | false) => {
  if (typeof window === 'undefined') {
    return;
  }

  if (config === false) {
    window.localStorage.removeItem(STUB_AUTH_STORAGE_KEY);
    return;
  }

  const role: AuthRole = config?.role ?? 'admin';
  const organizationIdCandidate = config?.organizationId ?? resolveDefaultOrganizationId();
  const organizationId =
    organizationIdCandidate === null ? null : organizationIdCandidate ?? resolveDefaultOrganizationId();
  const now = new Date();
  const nowIso = now.toISOString();
  const userId = config?.userId ?? `${role}-user-id`;
  const email = config?.email ?? `${role}@example.com`;
  const fullName = config?.fullName ?? 'Test User';
  const accessToken = config?.accessToken ?? 'test-access-token';
  const refreshToken = config?.refreshToken ?? 'test-refresh-token';

  window.localStorage.setItem(
    STUB_AUTH_STORAGE_KEY,
    JSON.stringify({
      user: {
        id: userId,
        email,
        role,
        full_name: fullName,
        first_name: fullName.split(' ')[0] ?? 'Test',
        last_name: fullName.split(' ').slice(1).join(' ') || 'User',
      },
      role,
      accessToken,
      refreshToken,
      expiresAt: now.getTime() + 60 * 60 * 1000,
      profile: {
        id: userId,
        email,
        role,
        organization_id: organizationId ?? undefined,
        full_name: fullName,
        is_active: true,
        created_at: nowIso,
        updated_at: nowIso,
      },
    }),
  );
};

// Create a test query client
const createTestQueryClient = () => {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
        staleTime: 0,
      },
      mutations: {
        retry: false,
      },
    },
  });
};

// Wrapper component that provides all necessary context
const TestProviders = ({
  children,
  router,
}: {
  children: React.ReactNode;
  router?: RenderWithProvidersOptions['router'];
}) => {
  const queryClientRef = useRef<QueryClient>();
  if (!queryClientRef.current) {
    queryClientRef.current = createTestQueryClient();
  }

  const AuthWrapper = useMemo(() => {
    let candidate: unknown;
    try {
      candidate = Reflect.get(authContext as object, 'AuthProvider');
    } catch {
      candidate = undefined;
    }

    if (typeof candidate === 'function') {
      return candidate as typeof authContext.AuthProvider;
    }

    return ({ children: providerChildren }: { children: React.ReactNode }) => <>{providerChildren}</>;
  }, []);

  return (
    <QueryClientProvider client={queryClientRef.current}>
      <MemoryRouter initialEntries={router?.initialEntries} initialIndex={router?.initialIndex}>
        <AuthWrapper>{children}</AuthWrapper>
      </MemoryRouter>
    </QueryClientProvider>
  );
};

// Custom render function that includes providers
const renderWithProviders = (
  ui: React.ReactElement,
  options?: RenderWithProvidersOptions,
) => {
  seedStubAuthState(options?.auth);

  const { auth: _auth, router, ...renderOptions } = options ?? {};
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <TestProviders router={router}>{children}</TestProviders>
  );

  return render(ui, { wrapper: Wrapper, ...renderOptions });
};

// Mock Supabase client
export const mockSupabaseClient = {
  from: vi.fn(() => ({
    select: vi.fn(() => ({
      data: [],
      error: null,
    })),
    insert: vi.fn(() => ({
      data: [],
      error: null,
    })),
    update: vi.fn(() => ({
      data: [],
      error: null,
    })),
    delete: vi.fn(() => ({
      data: [],
      error: null,
    })),
    eq: vi.fn(() => ({
      data: [],
      error: null,
    })),
  })),
  auth: {
    getUser: vi.fn(() => Promise.resolve({
      data: { user: { id: 'test-user', email: 'test@example.com' } },
      error: null,
    })),
  },
};

// Re-export testing library utilities
export * from '@testing-library/react';
export { userEvent };
export { renderWithProviders }; 