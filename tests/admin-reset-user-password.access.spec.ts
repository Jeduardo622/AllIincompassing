import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stubDenoEnv } from './utils/stubDeno';

const envValues = new Map<string, string>([
  ['SUPABASE_URL', 'http://localhost'],
  ['SUPABASE_SERVICE_ROLE_KEY', 'service-role-key'],
  ['SUPABASE_ANON_KEY', 'anon-key'],
]);

stubDenoEnv((key) => envValues.get(key) ?? '');

type TestRole = 'client' | 'therapist' | 'admin' | 'super_admin';

type TestUserContext = {
  user: { id: string; email: string };
  profile: { id: string; email: string; role: TestRole; is_active: boolean };
};

const logApiAccess = vi.fn();
const userContexts = new Map<string, TestUserContext>();
const getUserByIdSpy = vi.fn();
const updateUserByIdSpy = vi.fn();
const requestRpcSpy = vi.fn();

vi.mock('../supabase/functions/_shared/auth-middleware.ts', () => ({
  corsHeaders: {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Client-Info, apikey',
    'Access-Control-Max-Age': '86400',
  },
  RouteOptions: {
    admin: { requireAuth: true, allowedRoles: ['admin', 'super_admin'] },
  },
  logApiAccess,
  createProtectedRoute: (
    handler: (req: Request, userContext: TestUserContext) => Promise<Response>,
    options: { allowedRoles?: TestRole[] } = {},
  ) => {
    return async (req: Request) => {
      const contextKey = req.headers.get('x-test-user') ?? 'default';
      const context = userContexts.get(contextKey);

      if (!context) {
        return new Response(JSON.stringify({ error: 'Authentication required' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (options.allowedRoles && !options.allowedRoles.includes(context.profile.role)) {
        return new Response(JSON.stringify({ error: 'Insufficient permissions' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return handler(req, context);
    };
  },
}));

vi.mock('../supabase/functions/_shared/database.ts', () => ({
  supabaseAdmin: {
    auth: {
      admin: {
        getUserById: getUserByIdSpy,
        updateUserById: updateUserByIdSpy,
      },
    },
  },
  createRequestClient: () => ({
    rpc: requestRpcSpy,
  }),
}));

describe('admin-reset-user-password access control', () => {
  beforeEach(() => {
    userContexts.clear();
    logApiAccess.mockClear();
    getUserByIdSpy.mockReset();
    updateUserByIdSpy.mockReset();
    requestRpcSpy.mockReset();

    updateUserByIdSpy.mockResolvedValue({ error: null });
  });

  it('allows a super_admin to reset an admin password through the protected function', async () => {
    userContexts.set('super', {
      user: { id: 'super-user-id', email: 'super@example.com' },
      profile: {
        id: 'super-profile-id',
        email: 'super@example.com',
        role: 'super_admin',
        is_active: true,
      },
    });
    requestRpcSpy.mockResolvedValue({
      data: [{
        user_id: '22222222-2222-2222-2222-222222222222',
        email: 'target.admin@example.com',
        raw_user_meta_data: { organization_id: 'org-2' },
      }],
      error: null,
    });

    const { default: handler } = await import('../supabase/functions/admin-reset-user-password/index.ts');

    const response = await handler(new Request('http://localhost/functions/v1/admin-reset-user-password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-token',
        'x-test-user': 'super',
      },
      body: JSON.stringify({
        email: 'target.admin@example.com',
        new_password: 'UpdatedPass123!',
      }),
    }));

    expect(response.status).toBe(200);
    expect(requestRpcSpy).toHaveBeenCalledWith('get_admin_users_paged', {
      organization_id: null,
      p_limit: 500,
      p_offset: 0,
    });
    expect(updateUserByIdSpy).toHaveBeenCalledWith('22222222-2222-2222-2222-222222222222', {
      password: 'UpdatedPass123!',
    });
  });

  it('denies a regular admin from resetting an admin outside the caller organization', async () => {
    userContexts.set('admin', {
      user: { id: 'admin-user-id', email: 'admin@example.com' },
      profile: {
        id: 'admin-profile-id',
        email: 'admin@example.com',
        role: 'admin',
        is_active: true,
      },
    });
    getUserByIdSpy.mockResolvedValue({
      data: {
        user: {
          id: 'admin-user-id',
          user_metadata: { organization_id: '11111111-1111-1111-1111-111111111111' },
        },
      },
      error: null,
    });
    requestRpcSpy.mockResolvedValue({
      data: [],
      error: null,
    });

    const { default: handler } = await import('../supabase/functions/admin-reset-user-password/index.ts');

    const response = await handler(new Request('http://localhost/functions/v1/admin-reset-user-password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-token',
        'x-test-user': 'admin',
      },
      body: JSON.stringify({
        email: 'cross.org.admin@example.com',
        new_password: 'UpdatedPass123!',
      }),
    }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: 'Target admin is outside the caller organization.',
    });
    expect(updateUserByIdSpy).not.toHaveBeenCalled();
  });

  it('allows a regular admin to reset a same-organization admin password', async () => {
    userContexts.set('admin-success', {
      user: { id: 'admin-user-id', email: 'admin@example.com' },
      profile: {
        id: 'admin-profile-id',
        email: 'admin@example.com',
        role: 'admin',
        is_active: true,
      },
    });
    getUserByIdSpy.mockResolvedValue({
      data: {
        user: {
          id: 'admin-user-id',
          user_metadata: { organization_id: '11111111-1111-1111-1111-111111111111' },
        },
      },
      error: null,
    });
    requestRpcSpy.mockResolvedValue({
      data: [{
        user_id: '33333333-3333-3333-3333-333333333333',
        email: 'same.org.admin@example.com',
        raw_user_meta_data: { organization_id: '11111111-1111-1111-1111-111111111111' },
      }],
      error: null,
    });

    const { default: handler } = await import('../supabase/functions/admin-reset-user-password/index.ts');

    const response = await handler(new Request('http://localhost/functions/v1/admin-reset-user-password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-token',
        'x-test-user': 'admin-success',
      },
      body: JSON.stringify({
        email: 'same.org.admin@example.com',
        new_password: 'UpdatedPass123!',
      }),
    }));

    expect(response.status).toBe(200);
    expect(requestRpcSpy).toHaveBeenCalledWith('get_admin_users_paged', {
      organization_id: '11111111-1111-1111-1111-111111111111',
      p_limit: 500,
      p_offset: 0,
    });
    expect(updateUserByIdSpy).toHaveBeenCalledWith('33333333-3333-3333-3333-333333333333', {
      password: 'UpdatedPass123!',
    });
  });

  it('returns a server error without resetting when the scoped target row is missing user_id', async () => {
    userContexts.set('super-missing-id', {
      user: { id: 'super-user-id', email: 'super@example.com' },
      profile: {
        id: 'super-profile-id',
        email: 'super@example.com',
        role: 'super_admin',
        is_active: true,
      },
    });
    requestRpcSpy.mockResolvedValue({
      data: [{ email: 'target.admin@example.com', raw_user_meta_data: { organization_id: 'org-2' } }],
      error: null,
    });

    const { default: handler } = await import('../supabase/functions/admin-reset-user-password/index.ts');

    const response = await handler(new Request('http://localhost/functions/v1/admin-reset-user-password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-token',
        'x-test-user': 'super-missing-id',
      },
      body: JSON.stringify({
        email: 'target.admin@example.com',
        new_password: 'UpdatedPass123!',
      }),
    }));

    expect(response.status).toBe(500);
    expect(updateUserByIdSpy).not.toHaveBeenCalled();
  });
});
