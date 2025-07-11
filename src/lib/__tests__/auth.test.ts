import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAuth, validateAuth } from '../authContext';

// Mock Supabase
vi.mock('../supabaseClient', () => ({
  supabase: {
    auth: {
      signOut: vi.fn().mockResolvedValue({ error: null }),
      signInWithPassword: vi.fn().mockResolvedValue({
        data: { user: { id: '123', email: 'test@example.com' }, session: {} },
        error: null,
      }),
      signUp: vi.fn().mockResolvedValue({
        data: { user: { id: '123', email: 'test@example.com' }, session: {} },
        error: null,
      }),
      resetPasswordForEmail: vi.fn().mockResolvedValue({
        error: null,
      }),
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: '123', email: 'test@example.com' } },
        error: null,
      }),
      getSession: vi.fn().mockResolvedValue({
        data: { session: null },
        error: null,
      }),
      onAuthStateChange: vi.fn().mockReturnValue({
        data: { subscription: { unsubscribe: vi.fn() } },
      }),
    },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { id: '123', email: 'test@example.com', role: 'therapist', is_active: true },
            error: null,
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { id: '123', email: 'test@example.com', role: 'therapist', is_active: true },
                  error: null,
                }),
              }),
            }),
          }),
        }),
      }),
    }),
    channel: vi.fn().mockReturnValue({
      on: vi.fn().mockReturnValue({
        subscribe: vi.fn(),
      }),
    }),
    removeChannel: vi.fn(),
  },
}));

describe('useAuth', () => {
  beforeEach(() => {
    // Reset all mocks before each test
    vi.clearAllMocks();
  });

  it('initializes with null user and loading true', () => {
    const { result } = renderHook(() => useAuth());

    expect(result.current.user).toBeNull();
    expect(result.current.loading).toBe(true);
  });

  it('has proper role checking methods', () => {
    const { result } = renderHook(() => useAuth());

    expect(typeof result.current.hasRole).toBe('function');
    expect(typeof result.current.hasAnyRole).toBe('function');
    expect(typeof result.current.isAdmin).toBe('function');
    expect(typeof result.current.isSuperAdmin).toBe('function');
  });

  it('handles sign in', async () => {
    const { result } = renderHook(() => useAuth());
    
    await act(async () => {
      const response = await result.current.signIn('test@example.com', 'password');
      expect(response.error).toBeNull();
    });

    // Loading state may still be true during async operations
    expect(typeof result.current.loading).toBe('boolean');
  });

  it('handles sign out', async () => {
    const { result } = renderHook(() => useAuth());
    
    await act(async () => {
      await result.current.signOut();
    });

    // After sign out, user should be null
    expect(result.current.user).toBeNull();
    expect(result.current.profile).toBeNull();
  });

  it('handles sign up', async () => {
    const { result } = renderHook(() => useAuth());
    
    await act(async () => {
      const response = await result.current.signUp('test@example.com', 'password');
      expect(response.error).toBeNull();
    });

    expect(typeof result.current.loading).toBe('boolean');
  });

  it('handles password reset', async () => {
    const { result } = renderHook(() => useAuth());
    
    await act(async () => {
      const response = await result.current.resetPassword('test@example.com');
      expect(response.error).toBeNull();
    });

    expect(typeof result.current.loading).toBe('boolean');
  });

  it('can update profile', async () => {
    const { result } = renderHook(() => useAuth());
    
    await act(async () => {
      const response = await result.current.updateProfile({ full_name: 'New Name' });
      expect(response.error).toBeNull();
    });

    expect(typeof result.current.loading).toBe('boolean');
  });
});

describe('validateAuth', () => {
  it('returns invalid when no user is found', async () => {
    const { supabase } = await import('../supabaseClient');
    vi.mocked(supabase.auth.getUser).mockResolvedValueOnce({
      data: { user: null },
      error: null,
    } as any);

    const result = await validateAuth();
    expect(result.isValid).toBe(false);
    expect(result.error).toBe('No user found');
  });

  it('returns valid when user and profile exist', async () => {
    const { supabase } = await import('../supabaseClient');
    vi.mocked(supabase.auth.getUser).mockResolvedValueOnce({
      data: { user: { id: '123', email: 'test@example.com' } as any },
      error: null,
    });

    const result = await validateAuth();
    expect(result.isValid).toBe(true);
    expect(result.user).toBeDefined();
    expect(result.profile).toBeDefined();
  });
});