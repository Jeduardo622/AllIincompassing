import React from 'react';
import { describe, beforeEach, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from '../authContext';

const {
  mockGetSession,
  mockSignOut,
  mockProfilesMaybeSingle,
  mockChannel,
  mockOnAuthStateChange,
  authStateChangeListenerRef,
} = vi.hoisted(() => {
  const authStateChangeListenerRef: { current: null | ((event: string, session: unknown) => Promise<void>) } = {
    current: null,
  };

  return {
    mockGetSession: vi.fn(),
    mockSignOut: vi.fn(),
    mockProfilesMaybeSingle: vi.fn(),
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
    authStateChangeListenerRef,
    mockChannel: {
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnValue({}),
    },
  };
});

vi.mock('../supabaseClient', () => {
  const removeChannel = vi.fn();

  return {
    supabase: {
      auth: {
        getSession: mockGetSession,
        signOut: mockSignOut,
        onAuthStateChange: mockOnAuthStateChange,
      },
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: mockProfilesMaybeSingle,
          })),
        })),
      })),
      channel: vi.fn(() => mockChannel),
      removeChannel,
    },
  };
});

const TestConsumer = () => {
  const { user, loading, profile } = useAuth();
  return (
    <>
      <div data-testid="loading">{loading ? 'yes' : 'no'}</div>
      <div data-testid="user">{user?.id ?? 'none'}</div>
      <div data-testid="role">{profile?.role ?? 'none'}</div>
    </>
  );
};

describe('AuthProvider initializeAuth resilience', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authStateChangeListenerRef.current = null;
    mockSignOut.mockResolvedValue(undefined);
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
    });

    await authStateChangeListenerRef.current?.('TOKEN_REFRESHED', {
      user: {
        id: 'user-1',
        email: 'user@example.com',
      },
    });

    await waitFor(() => expect(screen.getByTestId('role')).toHaveTextContent('admin'));
  });
});

