import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAuth } from '../auth';

vi.mock('../supabase', () => ({
  supabase: {
    auth: {
      signOut: vi.fn().mockResolvedValue({ error: null }),
      signInWithPassword: vi.fn().mockResolvedValue({
        data: { user: { id: '123', email: 'test@example.com' }, session: {} },
        error: null,
      }),
    },
    rpc: vi.fn().mockResolvedValue({ data: [{ roles: ['user'] }], error: null }),
  },
}));

describe('useAuth', () => {
  beforeEach(() => {
    // Clear the store before each test
    const { result } = renderHook(() => useAuth());
    act(() => {
      result.current.setUser(null);
    });
  });

  it('initializes with null user and loading false after reset', () => {
    const { result } = renderHook(() => useAuth());

    expect(result.current.user).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('updates user state when setUser is called', () => {
    const { result } = renderHook(() => useAuth());
    const mockUser = { id: '123', email: 'test@example.com' };

    act(() => {
      result.current.setUser(mockUser);
    });

    expect(result.current.user).toEqual(mockUser);
    expect(result.current.loading).toBe(false);
  });

  it('handles sign in', async () => {
    const { result } = renderHook(() => useAuth());
    
    await act(async () => {
      await result.current.signIn('test@example.com', 'password');
    });

    expect(result.current.user?.email).toBe('test@example.com');
    expect(result.current.loading).toBe(false);
  });

  it('handles sign out', async () => {
    const { result } = renderHook(() => useAuth());
    
    await act(async () => {
      await result.current.signOut();
    });

    expect(result.current.user).toBeNull();
  });
});