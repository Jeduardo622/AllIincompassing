import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from '../authContext';

const {
  mockSignUp,
  mockGetSession,
  mockOnAuthStateChange,
} = vi.hoisted(() => ({
  mockSignUp: vi.fn(),
  mockGetSession: vi.fn(),
  mockOnAuthStateChange: vi.fn(() => ({
    data: { subscription: { unsubscribe: vi.fn() } },
  })),
}));

vi.mock('../supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: mockGetSession,
      signUp: mockSignUp,
      onAuthStateChange: mockOnAuthStateChange,
      signOut: vi.fn(),
      signInWithPassword: vi.fn(),
      resetPasswordForEmail: vi.fn(),
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        })),
      })),
    })),
    channel: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnValue({}),
    })),
    removeChannel: vi.fn(),
  },
}));

const SignupProbe: React.FC<{ metadata: Record<string, unknown> }> = ({ metadata }) => {
  const { signUp } = useAuth();

  React.useEffect(() => {
    void signUp('user@example.com', 'password123', metadata);
  }, [signUp, metadata]);

  return null;
};

describe('AuthProvider signUp metadata hardening', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
    mockSignUp.mockResolvedValue({ error: null });
  });

  it('downgrades untrusted privileged signup role metadata to client', async () => {
    render(
      <AuthProvider>
        <SignupProbe metadata={{ role: 'super_admin', signup_role: 'admin' }} />
      </AuthProvider>,
    );

    await waitFor(() => expect(mockSignUp).toHaveBeenCalledTimes(1));

    const signUpPayload = mockSignUp.mock.calls[0]?.[0] as {
      options?: { data?: Record<string, unknown> };
    };
    expect(signUpPayload.options?.data).toMatchObject({
      role: 'client',
      signup_role: 'client',
    });
  });

  it('preserves therapist self-signup intent for allowed role', async () => {
    render(
      <AuthProvider>
        <SignupProbe metadata={{ role: 'therapist', signup_role: 'therapist' }} />
      </AuthProvider>,
    );

    await waitFor(() => expect(mockSignUp).toHaveBeenCalledTimes(1));

    const signUpPayload = mockSignUp.mock.calls[0]?.[0] as {
      options?: { data?: Record<string, unknown> };
    };
    expect(signUpPayload.options?.data).toMatchObject({
      role: 'therapist',
      signup_role: 'therapist',
    });
  });
});
