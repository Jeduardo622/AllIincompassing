import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAuth, validateAuth } from '../auth';

// Mock Supabase
vi.mock('../supabase', () => ({
  supabase: {
    auth: {
      signOut: vi.fn().mockResolvedValue({ error: null }),
      signInWithPassword: vi.fn().mockResolvedValue({
        data: { user: { id: '123', email: 'test@example.com' }, session: {} },
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
            data: { id: '123', email: 'test@example.com', is_active: true },
            error: null,
          }),
        }),
      }),
    }),
    rpc: vi.fn().mockResolvedValue({ 
      data: [{ role_name: 'therapist', permissions: ['view_clients', 'manage_sessions'] }], 
      error: null 
    }),
  },
}));

describe('useAuth', () => {
  beforeEach(() => {
    // Reset all mocks before each test
    vi.clearAllMocks();
  });

  it('initializes with null user and loading false', () => {
    const { result } = renderHook(() => useAuth());

    expect(result.current.user).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('has proper role checking methods', () => {
    const { result } = renderHook(() => useAuth());

    expect(typeof result.current.hasRole).toBe('function');
    expect(typeof result.current.hasAnyRole).toBe('function');
    expect(typeof result.current.hasPermission).toBe('function');
  });

  it('handles sign in', async () => {
    const { result } = renderHook(() => useAuth());
    
    await act(async () => {
      const response = await result.current.signIn('test@example.com', 'password');
      expect(response.error).toBeNull();
    });

    expect(result.current.loading).toBe(false);
  });

  it('handles sign out', async () => {
    const { result } = renderHook(() => useAuth());
    
    await act(async () => {
      await result.current.signOut();
    });

    expect(result.current.user).toBeNull();
    expect(result.current.roles).toEqual([]);
    expect(result.current.permissions).toEqual([]);
  });

  it('refreshes user data correctly', async () => {
    const { result } = renderHook(() => useAuth());
    
    await act(async () => {
      await result.current.refreshUserData();
    });

    // Should handle the refresh without errors
    expect(result.current.loading).toBe(false);
  });
});

describe('validateAuth', () => {
  it('returns invalid when no user is found', async () => {
    const { supabase } = await import('../supabase');
    vi.mocked(supabase.auth.getUser).mockResolvedValueOnce({
      data: { user: null },
      error: null,
    } as any);

    const result = await validateAuth();
    expect(result.isValid).toBe(false);
    expect(result.error).toBe('No user found');
  });

  it('returns valid when user and profile exist', async () => {
    const { supabase } = await import('../supabase');
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