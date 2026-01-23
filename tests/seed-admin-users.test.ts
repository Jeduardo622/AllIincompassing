import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { findUserByEmail } from '../scripts/seed-admin-users';

const buildUser = (overrides: Partial<User>): User =>
  ({
    id: 'user-id',
    aud: 'authenticated',
    role: 'authenticated',
    email: 'admin@test.com',
    email_confirmed_at: null,
    phone: null,
    confirmation_sent_at: null,
    confirmed_at: null,
    last_sign_in_at: null,
    app_metadata: {},
    user_metadata: {},
    identities: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    is_anonymous: false,
    ...overrides,
  }) as User;

describe('findUserByEmail', () => {
  it('uses getUserByEmail when available', async () => {
    const user = buildUser({ email: 'admin@test.com' });
    const getUserByEmail = vi.fn().mockResolvedValue({ data: { user }, error: null });

    const client = {
      auth: {
        admin: {
          getUserByEmail,
        },
      },
    } as unknown as SupabaseClient;

    const result = await findUserByEmail(client, 'admin@test.com');

    expect(result).toEqual(user);
    expect(getUserByEmail).toHaveBeenCalledWith('admin@test.com');
  });

  it('falls back to listUsers pagination', async () => {
    const user = buildUser({ email: 'superadmin@test.com' });
    const pageOneUsers = Array.from({ length: 200 }, (_, index) =>
      buildUser({ email: `user-${index}@test.com`, id: `user-${index}` }),
    );
    const listUsers = vi
      .fn()
      .mockResolvedValueOnce({ data: { users: pageOneUsers }, error: null })
      .mockResolvedValueOnce({ data: { users: [user] }, error: null });

    const client = {
      auth: {
        admin: {
          listUsers,
        },
      },
    } as unknown as SupabaseClient;

    const result = await findUserByEmail(client, 'superadmin@test.com');

    expect(result).toEqual(user);
    expect(listUsers).toHaveBeenCalledTimes(2);
    expect(listUsers).toHaveBeenNthCalledWith(1, { page: 1, perPage: 200 });
    expect(listUsers).toHaveBeenNthCalledWith(2, { page: 2, perPage: 200 });
  });

  it('returns null when no user is found', async () => {
    const listUsers = vi.fn().mockResolvedValue({
      data: { users: [buildUser({ email: 'someone@test.com' })] },
      error: null,
    });

    const client = {
      auth: {
        admin: {
          listUsers,
        },
      },
    } as unknown as SupabaseClient;

    const result = await findUserByEmail(client, 'missing@test.com');

    expect(result).toBeNull();
    expect(listUsers).toHaveBeenCalledTimes(1);
  });
});
