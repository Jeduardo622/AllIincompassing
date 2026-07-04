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
const createUserSpy = vi.fn();
const assignAdminRoleSpy = vi.fn();
const getUserByIdSpy = vi.fn();
const profilesSelectSpy = vi.fn();
const profilesEqSpy = vi.fn();
const profilesMaybeSingleSpy = vi.fn();

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
        createUser: createUserSpy,
        getUserById: getUserByIdSpy,
      },
    },
    rpc: assignAdminRoleSpy,
    from: (table: string) => {
      if (table !== 'profiles') {
        throw new Error(`Unexpected table ${table}`);
      }
      return {
        select: profilesSelectSpy,
      };
    },
  },
}));

describe('admin-create-user access control', () => {
  beforeEach(() => {
    userContexts.clear();
    logApiAccess.mockClear();
    createUserSpy.mockReset();
    assignAdminRoleSpy.mockReset();
    getUserByIdSpy.mockReset();
    profilesSelectSpy.mockReset();
    profilesEqSpy.mockReset();
    profilesMaybeSingleSpy.mockReset();

    createUserSpy.mockResolvedValue({
      data: { user: { id: 'new-admin-user-id' } },
      error: null,
    });
    assignAdminRoleSpy.mockResolvedValue({ error: null });
    profilesSelectSpy.mockReturnValue({ eq: profilesEqSpy });
    profilesEqSpy.mockReturnValue({ maybeSingle: profilesMaybeSingleSpy });
    profilesMaybeSingleSpy.mockResolvedValue({
      data: {
        id: 'new-admin-user-id',
        organization_id: '22222222-2222-2222-2222-222222222222',
      },
      error: null,
    });
  });

  it('allows a super_admin to create an admin in the requested organization', async () => {
    userContexts.set('super', {
      user: { id: 'super-user-id', email: 'super@example.com' },
      profile: {
        id: 'super-profile-id',
        email: 'super@example.com',
        role: 'super_admin',
        is_active: true,
      },
    });

    const { default: handler } = await import('../supabase/functions/admin-create-user/index.ts');

    const response = await handler(new Request('http://localhost/functions/v1/admin-create-user', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-token',
        'x-test-user': 'super',
      },
      body: JSON.stringify({
        email: 'new.admin@example.com',
        password: 'StrongPass123!',
        first_name: 'New',
        last_name: 'Admin',
        organization_id: '22222222-2222-2222-2222-222222222222',
        reason: 'Coverage for the selected organization.',
      }),
    }));

    expect(response.status).toBe(200);
    expect(createUserSpy).toHaveBeenCalledWith(expect.objectContaining({
      email: 'new.admin@example.com',
      user_metadata: expect.objectContaining({
        organization_id: '22222222-2222-2222-2222-222222222222',
        organizationId: '22222222-2222-2222-2222-222222222222',
      }),
    }));
    expect(assignAdminRoleSpy).toHaveBeenCalledWith('assign_admin_role', {
      user_email: 'new.admin@example.com',
      organization_id: '22222222-2222-2222-2222-222222222222',
      reason: 'Coverage for the selected organization.',
    });
    expect(profilesSelectSpy).toHaveBeenCalledWith('id, organization_id');
    expect(profilesEqSpy).toHaveBeenCalledWith('id', 'new-admin-user-id');
    expect(profilesMaybeSingleSpy).toHaveBeenCalled();
  }, 20_000);

  it('denies a regular admin from creating an admin in a different organization', async () => {
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

    const { default: handler } = await import('../supabase/functions/admin-create-user/index.ts');

    const response = await handler(new Request('http://localhost/functions/v1/admin-create-user', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-token',
        'x-test-user': 'admin',
      },
      body: JSON.stringify({
        email: 'cross.org.admin@example.com',
        password: 'StrongPass123!',
        first_name: 'Cross',
        last_name: 'Org',
        organization_id: '22222222-2222-2222-2222-222222222222',
        reason: 'Attempted cross organization admin grant.',
      }),
    }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: 'Caller organization mismatch.' });
    expect(createUserSpy).not.toHaveBeenCalled();
    expect(assignAdminRoleSpy).not.toHaveBeenCalled();
    expect(profilesSelectSpy).not.toHaveBeenCalled();
  });

  it('denies non-admin roles from creating admins', async () => {
    userContexts.set('therapist', {
      user: { id: 'therapist-user-id', email: 'therapist@example.com' },
      profile: {
        id: 'therapist-profile-id',
        email: 'therapist@example.com',
        role: 'therapist',
        is_active: true,
      },
    });

    const { default: handler } = await import('../supabase/functions/admin-create-user/index.ts');

    const response = await handler(new Request('http://localhost/functions/v1/admin-create-user', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-token',
        'x-test-user': 'therapist',
      },
      body: JSON.stringify({
        email: 'unauthorized@example.com',
        password: 'StrongPass123!',
        first_name: 'Unauthorized',
        last_name: 'User',
        organization_id: '11111111-1111-1111-1111-111111111111',
        reason: 'This should be denied by route protection.',
      }),
    }));

    expect(response.status).toBe(403);
    expect(createUserSpy).not.toHaveBeenCalled();
    expect(assignAdminRoleSpy).not.toHaveBeenCalled();
    expect(profilesSelectSpy).not.toHaveBeenCalled();
  });

  it('fails when the created admin profile organization is still unavailable', async () => {
    userContexts.set('super-profile-org-missing', {
      user: { id: 'super-user-id', email: 'super@example.com' },
      profile: {
        id: 'super-profile-id',
        email: 'super@example.com',
        role: 'super_admin',
        is_active: true,
      },
    });
    profilesMaybeSingleSpy.mockResolvedValue({
      data: null,
      error: null,
    });

    const { default: handler } = await import('../supabase/functions/admin-create-user/index.ts');

    const response = await handler(new Request('http://localhost/functions/v1/admin-create-user', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-token',
        'x-test-user': 'super-profile-org-missing',
      },
      body: JSON.stringify({
        email: 'new.admin@example.com',
        password: 'StrongPass123!',
        first_name: 'New',
        last_name: 'Admin',
        organization_id: '22222222-2222-2222-2222-222222222222',
        reason: 'Coverage for missing profile organization context.',
      }),
    }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: 'User created, but organization context is unavailable.',
    });
  });

  it('fails when the created admin profile organization resolves to the wrong organization', async () => {
    userContexts.set('super-profile-org-mismatch', {
      user: { id: 'super-user-id', email: 'super@example.com' },
      profile: {
        id: 'super-profile-id',
        email: 'super@example.com',
        role: 'super_admin',
        is_active: true,
      },
    });
    profilesMaybeSingleSpy.mockResolvedValue({
      data: {
        id: 'new-admin-user-id',
        organization_id: '33333333-3333-3333-3333-333333333333',
      },
      error: null,
    });

    const { default: handler } = await import('../supabase/functions/admin-create-user/index.ts');

    const response = await handler(new Request('http://localhost/functions/v1/admin-create-user', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-token',
        'x-test-user': 'super-profile-org-mismatch',
      },
      body: JSON.stringify({
        email: 'new.admin@example.com',
        password: 'StrongPass123!',
        first_name: 'New',
        last_name: 'Admin',
        organization_id: '22222222-2222-2222-2222-222222222222',
        reason: 'Coverage for mismatched profile organization context.',
      }),
    }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: 'User created, but organization context is unavailable.',
    });
  });

  it('fails closed when created admin profile verification has a non-immutability database error', async () => {
    userContexts.set('super-profile-db-error', {
      user: { id: 'super-user-id', email: 'super@example.com' },
      profile: {
        id: 'super-profile-id',
        email: 'super@example.com',
        role: 'super_admin',
        is_active: true,
      },
    });
    profilesMaybeSingleSpy.mockResolvedValue({
      data: null,
      error: { code: 'PGRST202', message: 'profile lookup failed' },
    });

    const { default: handler } = await import('../supabase/functions/admin-create-user/index.ts');

    const response = await handler(new Request('http://localhost/functions/v1/admin-create-user', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-token',
        'x-test-user': 'super-profile-db-error',
      },
      body: JSON.stringify({
        email: 'new.admin@example.com',
        password: 'StrongPass123!',
        first_name: 'New',
        last_name: 'Admin',
        organization_id: '22222222-2222-2222-2222-222222222222',
        reason: 'Coverage for profile verification database errors.',
      }),
    }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: 'User created, but organization context is unavailable.',
    });
    expect(logApiAccess).toHaveBeenCalledWith('POST', '/admin/create-user', expect.anything(), 500);
  });
});
