import React from 'react';
import { describe, beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from '../authContext';

const {
  mockGetSession,
  mockSignOut,
  mockProfilesMaybeSingle,
  mockRoleRowsEq,
  mockChannel,
  mockOnAuthStateChange,
  mockQueryClientClear,
  authStateChangeListenerRef,
} = vi.hoisted(() => {
  const authStateChangeListenerRef: { current: null | ((event: string, session: unknown) => Promise<void>) } = {
    current: null,
  };

  return {
    mockGetSession: vi.fn(),
    mockSignOut: vi.fn(),
    mockProfilesMaybeSingle: vi.fn(),
    mockRoleRowsEq: vi.fn(),
    mockOnAuthStateChange: vi.fn((callback: (event: string, session: unknown) => Promise<void>) => {
      authStateChangeListenerRef.current = callback;
      return {
        data: {
          subscription: {
            unsubscribe: vi.fn(),
          },
        },
      };
    }),
    mockQueryClientClear: vi.fn(),
    authStateChangeListenerRef,
    mockChannel: {
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnValue({}),
    },
  };
});

vi.mock('../queryClient', () => ({
  appQueryClient: {
    clear: mockQueryClientClear,
  },
}));

vi.mock('../supabaseClient', () => {
  const removeChannel = vi.fn();

  return {
    clearSupabaseAuthStorage: vi.fn(),
    supabase: {
      auth: {
        getSession: mockGetSession,
        signOut: mockSignOut,
        onAuthStateChange: mockOnAuthStateChange,
      },
      from: vi.fn((table: string) => ({
        select: vi.fn(() => ({
          eq: table === 'user_roles'
            ? mockRoleRowsEq
            : vi.fn(() => ({ maybeSingle: mockProfilesMaybeSingle })),
        })),
      })),
      channel: vi.fn(() => mockChannel),
      removeChannel,
    },
  };
});

const TestConsumer = () => {
  const { user, loading, profile, authFlow, effectiveRole, isExactBt, signOut } = useAuth();
  return (
    <>
      <div data-testid="loading">{loading ? 'yes' : 'no'}</div>
      <div data-testid="user">{user?.id ?? 'none'}</div>
      <div data-testid="role">{profile?.role ?? 'none'}</div>
      <div data-testid="effective-role">{effectiveRole}</div>
      <div data-testid="exact-bt">{isExactBt ? 'yes' : 'no'}</div>
      <div data-testid="auth-flow">{authFlow}</div>
      <button type="button" data-testid="signout" onClick={() => void signOut()}>
        Sign out
      </button>
    </>
  );
};

describe('AuthProvider initializeAuth resilience', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authStateChangeListenerRef.current = null;
    mockSignOut.mockResolvedValue({ error: null });
    mockRoleRowsEq.mockResolvedValue({ data: [], error: null, status: 200 });
    mockProfilesMaybeSingle.mockResolvedValue({
      data: {
        id: 'user-1',
        email: 'user@example.com',
        role: 'admin',
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      error: null,
    });
  });

  it('forces sign-out when initial profile is inactive', async () => {
    mockGetSession.mockResolvedValueOnce({
      data: {
        session: {
          user: {
            id: 'user-1',
            email: 'user@example.com',
          },
        },
      },
      error: null,
    });

    mockProfilesMaybeSingle.mockResolvedValueOnce({
      data: {
        id: 'user-1',
        email: 'user@example.com',
        role: 'admin',
        is_active: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      error: null,
    });

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('none'));
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  it('clears an initial session when the profile query confirms unauthorized', async () => {
    mockGetSession.mockResolvedValueOnce({
      data: {
        session: {
          user: {
            id: 'user-1',
            email: 'user@example.com',
          },
        },
      },
      error: null,
    });
    mockProfilesMaybeSingle.mockResolvedValueOnce({
      data: null,
      error: { message: 'JWT expired', code: 'PGRST301' },
      status: 401,
    });

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );

    await waitFor(() => expect(mockSignOut).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('user')).toHaveTextContent('none');
    expect(screen.getByTestId('role')).toHaveTextContent('none');
    expect(screen.getByTestId('effective-role')).toHaveTextContent('client');
    expect(mockQueryClientClear).toHaveBeenCalled();
  });

  it('retries initialization after signing out when the first session fetch fails', async () => {
    mockGetSession
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({
        data: {
          session: {
            user: {
              id: 'user-1',
              email: 'user@example.com',
            },
          },
        },
        error: null,
      });

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('user-1'));
    expect(mockGetSession).toHaveBeenCalledTimes(2);
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  it('normalizes legacy therapist profiles to BT effective role', async () => {
    mockGetSession.mockResolvedValueOnce({
      data: {
        session: {
          user: {
            id: 'user-1',
            email: 'user@example.com',
          },
        },
      },
      error: null,
    });

    mockProfilesMaybeSingle.mockResolvedValueOnce({
      data: {
        id: 'user-1',
        email: 'user@example.com',
        role: 'therapist',
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      error: null,
    });

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('effective-role')).toHaveTextContent('bt'));
    expect(screen.getByTestId('exact-bt')).toHaveTextContent('no');
  });

  it('preserves an exact BT role assignment separately from normalized role aliases', async () => {
    mockGetSession.mockResolvedValueOnce({
      data: {
        session: {
          user: {
            id: 'user-1',
            email: 'user@example.com',
          },
        },
      },
      error: null,
    });
    mockProfilesMaybeSingle.mockResolvedValueOnce({
      data: {
        id: 'user-1',
        email: 'user@example.com',
        role: 'therapist',
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      error: null,
    });
    mockRoleRowsEq.mockResolvedValueOnce({
      data: [{ is_active: true, expires_at: null, roles: { name: 'bt' } }],
      error: null,
      status: 200,
    });

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('effective-role')).toHaveTextContent('bt'));
    expect(screen.getByTestId('exact-bt')).toHaveTextContent('yes');
  });

  it('does not fall back to a stale BT profile after an authoritative empty role assignment read', async () => {
    mockGetSession.mockResolvedValueOnce({
      data: {
        session: {
          user: {
            id: 'user-1',
            email: 'user@example.com',
          },
        },
      },
      error: null,
    });
    mockProfilesMaybeSingle.mockResolvedValueOnce({
      data: {
        id: 'user-1',
        email: 'user@example.com',
        role: 'bt',
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      error: null,
    });
    mockRoleRowsEq.mockResolvedValueOnce({ data: [], error: null, status: 200 });

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('effective-role')).toHaveTextContent('bt'));
    expect(screen.getByTestId('exact-bt')).toHaveTextContent('no');
  });

  it('keeps the existing profile when refresh-time profile fetch fails for same user', async () => {
    mockGetSession.mockResolvedValueOnce({
      data: {
        session: {
          user: {
            id: 'user-1',
            email: 'user@example.com',
          },
        },
      },
      error: null,
    });

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('role')).toHaveTextContent('admin'));
    expect(authStateChangeListenerRef.current).toBeTypeOf('function');

    mockProfilesMaybeSingle.mockResolvedValueOnce({
      data: null,
      error: { message: 'temporary profile fetch failure' },
      status: 503,
    });

    await authStateChangeListenerRef.current?.('TOKEN_REFRESHED', {
      user: {
        id: 'user-1',
        email: 'user@example.com',
      },
    });

    await waitFor(() => expect(screen.getByTestId('role')).toHaveTextContent('admin'));
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it('ignores a delayed unauthorized response from an older auth generation', async () => {
    mockGetSession.mockResolvedValueOnce({
      data: {
        session: {
          user: {
            id: 'user-1',
            email: 'one@example.com',
          },
        },
      },
      error: null,
    });

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('user-1'));

    let resolveOldProfile!: (value: unknown) => void;
    const oldProfileResult = new Promise((resolve) => {
      resolveOldProfile = resolve;
    });
    mockProfilesMaybeSingle
      .mockImplementationOnce(() => oldProfileResult)
      .mockResolvedValueOnce({
        data: {
          id: 'user-2',
          email: 'two@example.com',
          role: 'bcba',
          is_active: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        error: null,
        status: 200,
      });

    authStateChangeListenerRef.current?.('TOKEN_REFRESHED', {
      user: {
        id: 'user-1',
        email: 'one@example.com',
      },
    });
    await waitFor(() => expect(mockProfilesMaybeSingle).toHaveBeenCalledTimes(2));

    authStateChangeListenerRef.current?.('SIGNED_IN', {
      user: {
        id: 'user-2',
        email: 'two@example.com',
      },
    });
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('user-2'));

    resolveOldProfile({
      data: null,
      error: { message: 'JWT expired', code: 'PGRST301' },
      status: 401,
    });

    await waitFor(() => expect(screen.getByTestId('role')).toHaveTextContent('bcba'));
    expect(screen.getByTestId('user')).toHaveTextContent('user-2');
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it('ignores token refresh events while sign-out is in progress', async () => {
    mockGetSession.mockResolvedValueOnce({
      data: {
        session: {
          user: {
            id: 'user-1',
            email: 'user@example.com',
          },
        },
      },
      error: null,
    });

    mockSignOut.mockImplementation(async () => {
      await authStateChangeListenerRef.current?.('TOKEN_REFRESHED', {
        user: {
          id: 'user-1',
          email: 'user@example.com',
        },
      });
      await authStateChangeListenerRef.current?.('SIGNED_OUT', null);
      return { error: null };
    });

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('user-1'));
    fireEvent.click(screen.getByTestId('signout'));

    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('none'));
    expect(mockProfilesMaybeSingle).toHaveBeenCalledTimes(1);
    expect(mockQueryClientClear).toHaveBeenCalled();
  });

  it('maps recovery and non-recovery auth events to expected authFlow', async () => {
    mockGetSession.mockResolvedValueOnce({
      data: {
        session: {
          user: {
            id: 'user-1',
            email: 'user@example.com',
          },
        },
      },
      error: null,
    });

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('auth-flow')).toHaveTextContent('normal'));
    expect(authStateChangeListenerRef.current).toBeTypeOf('function');

    await authStateChangeListenerRef.current?.('PASSWORD_RECOVERY', {
      user: {
        id: 'user-1',
        email: 'user@example.com',
      },
    });
    await waitFor(() => expect(screen.getByTestId('auth-flow')).toHaveTextContent('password_recovery'));

    await authStateChangeListenerRef.current?.('INITIAL_SESSION', {
      user: {
        id: 'user-1',
        email: 'user@example.com',
      },
    });
    await waitFor(() => expect(screen.getByTestId('auth-flow')).toHaveTextContent('normal'));
  });
});

