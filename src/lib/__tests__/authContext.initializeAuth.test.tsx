import React from 'react';
import { describe, beforeEach, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from '../authContext';

const {
  mockGetSession,
  mockSignOut,
  mockProfilesMaybeSingle,
  mockChannel,
} = vi.hoisted(() => {
  return {
    mockGetSession: vi.fn(),
    mockSignOut: vi.fn(),
    mockProfilesMaybeSingle: vi.fn(),
    mockChannel: {
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnValue({}),
    },
  };
});

vi.mock('../supabaseClient', () => {
  const removeChannel = vi.fn();
  const onAuthStateChange = vi.fn(() => ({
    data: {
      subscription: {
        unsubscribe: vi.fn(),
      },
    },
  }));

  return {
    supabase: {
      auth: {
        getSession: mockGetSession,
        signOut: mockSignOut,
        onAuthStateChange,
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
  const { user, loading } = useAuth();
  return (
    <>
      <div data-testid="loading">{loading ? 'yes' : 'no'}</div>
      <div data-testid="user">{user?.id ?? 'none'}</div>
    </>
  );
};

describe('AuthProvider initializeAuth resilience', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});

