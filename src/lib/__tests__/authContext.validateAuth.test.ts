import { beforeEach, describe, expect, it, vi } from 'vitest';
import { validateAuth } from '../authContext';

const { mockGetUser, mockProfileMaybeSingle } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockProfileMaybeSingle: vi.fn(),
}));

vi.mock('../supabaseClient', () => ({
  supabase: {
    auth: {
      getUser: mockGetUser,
      getSession: vi.fn(),
      signOut: vi.fn(),
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: mockProfileMaybeSingle,
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

describe('validateAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns invalid when profile is missing without throwing', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-1', email: 'user@example.com' } },
      error: null,
    });
    mockProfileMaybeSingle.mockResolvedValue({
      data: null,
      error: null,
    });

    const result = await validateAuth();

    expect(result.isValid).toBe(false);
    expect(result.error).toBe('User profile not found');
    expect(mockProfileMaybeSingle).toHaveBeenCalledTimes(1);
  });

  it('returns valid when active profile exists', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-2', email: 'user2@example.com' } },
      error: null,
    });
    mockProfileMaybeSingle.mockResolvedValue({
      data: {
        id: 'user-2',
        email: 'user2@example.com',
        role: 'admin',
        is_active: true,
      },
      error: null,
    });

    const result = await validateAuth();

    expect(result.isValid).toBe(true);
    expect(result.error).toBeNull();
  });
});
