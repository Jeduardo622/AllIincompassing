import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stubDenoEnv } from './utils/stubDeno';

const envValues = new Map<string, string>([
  ['SUPABASE_URL', 'http://localhost'],
  ['SUPABASE_SERVICE_ROLE_KEY', 'service-role-key'],
  ['SUPABASE_ANON_KEY', 'anon-key'],
]);

const CANONICAL_TEST_ROLES = [
  { id: 'rid-super', name: 'super_admin' },
  { id: 'rid-bcba', name: 'bcba' },
  { id: 'rid-admin', name: 'admin' },
  { id: 'rid-admin-schedule', name: 'admin_schedule' },
  { id: 'rid-midtier', name: 'midtier' },
  { id: 'rid-therapist', name: 'therapist' },
  { id: 'rid-bt', name: 'bt' },
  { id: 'rid-client', name: 'client' },
] as const;

type TestRole = 'client' | 'bt' | 'therapist' | 'midtier' | 'admin_schedule' | 'admin' | 'bcba' | 'super_admin';

type TestUser = {
  id: string;
  email: string;
};

type TestProfile = TestUser & {
  role: TestRole;
  is_active: boolean;
};

type TestUserContext = {
  user: TestUser;
  profile: TestProfile;
};

stubDenoEnv((key) => envValues.get(key) ?? '');

const logApiAccess = vi.fn();
const userContexts = new Map<string, TestUserContext>();

let rpcRoles: string[] = [];
let fetchedUserId: string | null = null;
let latestUpdatePayload: Record<string, unknown> | null = null;
let existingProfile: TestProfile & {
  first_name: string;
  last_name: string;
  full_name: string;
  updated_at: string;
};
let adminActionInserts: Array<Record<string, unknown>> = [];
let userRolesUpsertPayload: Record<string, unknown> | null = null;
let deletedUserRoleFilters: Array<{ userId: string; roleIds: string[] }> = [];
let stallAuditUserLookup = false;
let failLegacyRoleRpc = false;
let priorJunctionRole: TestRole = 'admin';
let priorJunctionRoleError = false;
let priorJunctionRoleData: unknown | undefined;
let roleMutationEvents: string[] = [];

type AdminUserRecord = {
  id: string;
  email: string;
  user_metadata?: Record<string, unknown>;
};

const adminUsers = new Map<string, AdminUserRecord>();

vi.mock('../supabase/functions/_shared/auth-middleware.ts', () => ({
  corsHeaders: {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Client-Info, apikey',
    'Access-Control-Max-Age': '86400',
  },
  RouteOptions: {
    superAdmin: { allowedRoles: ['super_admin'] },
  },
  logApiAccess,
  createProtectedRoute: (
    handler: (req: Request, userContext: TestUserContext) => Promise<Response>,
    options?: { allowedRoles?: TestRole[] },
  ) => {
    return async (req: Request) => {
      const contextKey = req.headers.get('x-test-user') ?? 'default';
      const context = userContexts.get(contextKey);
      if (!context) {
        return new Response(
          JSON.stringify({ error: 'Authentication required' }),
          { status: 401, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (options?.allowedRoles?.length && !options.allowedRoles.includes(context.profile.role)) {
        return new Response(
          JSON.stringify({ error: 'Insufficient permissions' }),
          { status: 403, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return handler(req, context);
    };
  },
}));

vi.mock('../supabase/functions/_shared/database.ts', () => {
  const createProfilesQuery = () => {
    const builder = {
      select: vi.fn(() => builder),
      eq: vi.fn((column: string, value: string) => {
        if (column === 'id') {
          fetchedUserId = value;
        }
        return builder;
      }),
      single: vi.fn(async () => {
        if (fetchedUserId === existingProfile.id) {
          return { data: { ...existingProfile }, error: null };
        }
        return { data: null, error: { message: 'User not found' } };
      }),
      update: vi.fn((values: Record<string, unknown>) => {
        roleMutationEvents.push('update-profile');
        latestUpdatePayload = values;
        const updatedUser = {
          ...existingProfile,
          ...values,
          updated_at: '2025-07-01T00:00:00Z',
        };
        return {
          eq: vi.fn(() => ({
            select: vi.fn(() => ({
              single: vi.fn(async () => ({ data: updatedUser, error: null })),
            })),
          })),
        };
      }),
    };
    return builder;
  };

  return {
    supabaseAdmin: {
      auth: {
        admin: {
          getUserById: vi.fn(async (userId: string) => {
            if (stallAuditUserLookup) {
              return await new Promise(() => {});
            }
            return {
              data: { user: adminUsers.get(userId) ?? null },
              error: null,
            };
          }),
        },
      },
      rpc: vi.fn(async (functionName: string, payload?: Record<string, unknown>) => {
        if (functionName === 'get_user_role_from_junction') {
          roleMutationEvents.push('resolve-prior-role');
          expect(payload).toEqual({ p_user_id: existingProfile.id });
          if (priorJunctionRoleError) {
            return { data: null, error: { message: 'junction role unavailable' } };
          }
          return { data: priorJunctionRoleData ?? priorJunctionRole, error: null };
        }
        return { data: null, error: { message: `Unexpected admin RPC ${functionName}` } };
      }),
      from: vi.fn((table: string) => {
        if (table === 'roles') {
          return {
            select: vi.fn(() => ({
              in: vi.fn(async () => ({
                data: CANONICAL_TEST_ROLES,
                error: null,
              })),
            })),
          };
        }
        if (table === 'user_roles') {
          return {
            delete: vi.fn(() => ({
              eq: vi.fn((column: string, value: string) => ({
                in: vi.fn(async (...args: unknown[]) => {
                  const roleIds = args.length === 2 ? args[1] : args[0];
                  if (column === 'user_id' && Array.isArray(roleIds)) {
                    deletedUserRoleFilters.push({ userId: value, roleIds });
                  }
                  roleMutationEvents.push('delete-user-roles');
                  return { error: null };
                }),
              })),
            })),
            upsert: vi.fn((payload: Record<string, unknown>) => {
              roleMutationEvents.push('upsert-user-role');
              userRolesUpsertPayload = payload;
              return Promise.resolve({ error: null });
            }),
          };
        }
        if (table === 'profiles') {
          return createProfilesQuery();
        }
        throw new Error(`Unexpected supabaseAdmin table: ${table}`);
      }),
    },
    createRequestClient: () => ({
      rpc: vi.fn(async (functionName: string) => {
        if (functionName === 'get_user_roles') {
          if (failLegacyRoleRpc) {
            return { data: null, error: { message: 'hosted RPC shape mismatch' } };
          }
          return { data: [{ roles: rpcRoles }], error: null };
        }
        return { data: null, error: { message: `Unexpected RPC ${functionName}` } };
      }),
      from: vi.fn((table: string) => {
        if (table === 'admin_actions') {
          return {
            insert: vi.fn(async (payload: Record<string, unknown>) => {
              adminActionInserts.push(payload);
              return { error: null };
            }),
          };
        }
        throw new Error(`Unexpected request-scoped table access: ${table}`);
      }),
    }),
  };
});

describe('admin-users-roles access control', () => {
  beforeEach(() => {
    envValues.delete('CORS_ALLOWED_ORIGINS');
    envValues.delete('API_ALLOWED_ORIGINS');
    userContexts.clear();
    logApiAccess.mockClear();
    rpcRoles = [];
    fetchedUserId = null;
    latestUpdatePayload = null;
    existingProfile = {
      id: '11111111-1111-1111-1111-111111111111',
      email: 'target@example.com',
      role: 'admin',
      is_active: true,
      first_name: 'Target',
      last_name: 'User',
      full_name: 'Target User',
      updated_at: '2025-06-01T00:00:00Z',
    };
    adminActionInserts = [];
    adminUsers.clear();
    userRolesUpsertPayload = null;
    deletedUserRoleFilters = [];
    stallAuditUserLookup = false;
    failLegacyRoleRpc = false;
    priorJunctionRole = 'admin';
    priorJunctionRoleError = false;
    priorJunctionRoleData = undefined;
    roleMutationEvents = [];
  });

  it('allows a super admin to demote another admin user', async () => {
    rpcRoles = ['super_admin'];

    const superAdminContext: TestUserContext = {
      user: { id: 'super-admin-1', email: 'super@example.com' },
      profile: {
        id: 'super-admin-profile-1',
        email: 'super@example.com',
        role: 'super_admin',
        is_active: true,
      },
    };

    userContexts.set('super', superAdminContext);
    adminUsers.set('super-admin-1', {
      id: 'super-admin-1',
      email: 'super@example.com',
      user_metadata: { organization_id: 'org-123' },
    });
    adminUsers.set(existingProfile.id, {
      id: existingProfile.id,
      email: existingProfile.email,
      user_metadata: { organization_id: 'org-999' },
    });

    const { default: handler } = await import('../supabase/functions/admin-users-roles/index.ts');

    const response = await handler(
      new Request('http://localhost/functions/v1/admin/users/11111111-1111-1111-1111-111111111111/roles', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-token',
          'x-test-user': 'super',
        },
        body: JSON.stringify({ role: 'therapist' }),
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.user.role).toBe('therapist');
    expect(userRolesUpsertPayload).toMatchObject({
      user_id: existingProfile.id,
      role_id: 'rid-therapist',
      granted_by: 'super-admin-1',
      is_active: true,
    });
    expect(deletedUserRoleFilters).toEqual([
      {
        userId: existingProfile.id,
        roleIds: ['rid-super', 'rid-bcba', 'rid-admin', 'rid-admin-schedule', 'rid-midtier'],
      },
    ]);
    expect(latestUpdatePayload).toEqual({ role: 'therapist' });
    expect(logApiAccess).toHaveBeenCalledWith('PATCH', '/admin/users/11111111-1111-1111-1111-111111111111/roles', superAdminContext, 200);
    expect(adminActionInserts).toEqual([
      {
        admin_user_id: 'super-admin-1',
        target_user_id: '11111111-1111-1111-1111-111111111111',
        organization_id: 'org-999',
        action_type: 'role_update',
        action_details: {
          old_role: 'admin',
          new_role: 'therapist',
          old_is_active: true,
          is_active: true,
        },
      },
    ]);
  });

  it('syncs user_roles when promoting a user to super_admin', async () => {
    rpcRoles = ['super_admin'];

    const superAdminContext: TestUserContext = {
      user: { id: 'super-admin-2', email: 'super2@example.com' },
      profile: {
        id: 'super-admin-profile-2',
        email: 'super2@example.com',
        role: 'super_admin',
        is_active: true,
      },
    };

    userContexts.set('super2', superAdminContext);
    adminUsers.set('super-admin-2', {
      id: 'super-admin-2',
      email: 'super2@example.com',
      user_metadata: { organization_id: 'org-123' },
    });
    adminUsers.set(existingProfile.id, {
      id: existingProfile.id,
      email: existingProfile.email,
      user_metadata: { organization_id: 'org-999' },
    });

    const { default: handler } = await import('../supabase/functions/admin-users-roles/index.ts');

    const response = await handler(
      new Request('http://localhost/functions/v1/admin/users/11111111-1111-1111-1111-111111111111/roles', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-token',
          'x-test-user': 'super2',
        },
        body: JSON.stringify({ role: 'super_admin' }),
      }),
    );

    expect(response.status).toBe(200);
    expect(userRolesUpsertPayload).toMatchObject({
      user_id: existingProfile.id,
      role_id: 'rid-super',
      granted_by: 'super-admin-2',
      is_active: true,
    });
  });

  it('syncs user_roles and revokes stale super_admin when downgrading to bcba', async () => {
    rpcRoles = ['super_admin'];
    existingProfile.role = 'super_admin';
    priorJunctionRole = 'super_admin';

    const superAdminContext: TestUserContext = {
      user: { id: 'super-admin-3', email: 'super3@example.com' },
      profile: {
        id: 'super-admin-profile-3',
        email: 'super3@example.com',
        role: 'super_admin',
        is_active: true,
      },
    };

    userContexts.set('super3', superAdminContext);
    adminUsers.set('super-admin-3', {
      id: 'super-admin-3',
      email: 'super3@example.com',
      user_metadata: { organization_id: 'org-123' },
    });
    adminUsers.set(existingProfile.id, {
      id: existingProfile.id,
      email: existingProfile.email,
      user_metadata: { organization_id: 'org-999' },
    });

    const { default: handler } = await import('../supabase/functions/admin-users-roles/index.ts');

    const response = await handler(
      new Request('http://localhost/functions/v1/admin/users/11111111-1111-1111-1111-111111111111/roles', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-token',
          'x-test-user': 'super3',
        },
        body: JSON.stringify({ role: 'bcba' }),
      }),
    );

    expect(response.status).toBe(200);
    expect(userRolesUpsertPayload).toMatchObject({
      user_id: existingProfile.id,
      role_id: 'rid-bcba',
      granted_by: 'super-admin-3',
      is_active: true,
    });
    expect(deletedUserRoleFilters).toEqual([
      {
        userId: existingProfile.id,
        roleIds: ['rid-super'],
      },
    ]);
    expect(latestUpdatePayload).toEqual({ role: 'bcba' });
  });

  it('accepts a target user id in the request body for direct edge invokes', async () => {
    rpcRoles = ['super_admin'];

    const superAdminContext: TestUserContext = {
      user: { id: 'super-admin-4', email: 'super4@example.com' },
      profile: {
        id: 'super-admin-profile-4',
        email: 'super4@example.com',
        role: 'super_admin',
        is_active: true,
      },
    };

    userContexts.set('super4', superAdminContext);
    adminUsers.set('super-admin-4', {
      id: 'super-admin-4',
      email: 'super4@example.com',
      user_metadata: { organization_id: 'org-123' },
    });
    adminUsers.set(existingProfile.id, {
      id: existingProfile.id,
      email: existingProfile.email,
      user_metadata: { organization_id: 'org-999' },
    });

    const { default: handler } = await import('../supabase/functions/admin-users-roles/index.ts');

    const response = await handler(
      new Request('http://localhost/functions/v1/admin-users-roles', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-token',
          'x-test-user': 'super4',
        },
        body: JSON.stringify({
          target_user_id: '11111111-1111-1111-1111-111111111111',
          role: 'admin_schedule',
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(userRolesUpsertPayload).toMatchObject({
      user_id: existingProfile.id,
      role_id: 'rid-admin-schedule',
      granted_by: 'super-admin-4',
      is_active: true,
    });
    expect(latestUpdatePayload).toEqual({ role: 'admin_schedule' });
  });

  it('uses the protected-route super-admin context instead of the legacy role RPC', async () => {
    failLegacyRoleRpc = true;

    const superAdminContext: TestUserContext = {
      user: { id: 'super-admin-rpc-drift', email: 'super-rpc@example.com' },
      profile: {
        id: 'super-admin-rpc-drift-profile',
        email: 'super-rpc@example.com',
        role: 'super_admin',
        is_active: true,
      },
    };

    userContexts.set('super-rpc', superAdminContext);
    adminUsers.set('super-admin-rpc-drift', {
      id: 'super-admin-rpc-drift',
      email: 'super-rpc@example.com',
      user_metadata: { organization_id: 'org-123' },
    });
    adminUsers.set(existingProfile.id, {
      id: existingProfile.id,
      email: existingProfile.email,
      user_metadata: { organization_id: 'org-999' },
    });

    const { default: handler } = await import('../supabase/functions/admin-users-roles/index.ts');

    const response = await handler(
      new Request('http://localhost/functions/v1/admin-users-roles', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-token',
          'x-test-user': 'super-rpc',
        },
        body: JSON.stringify({
          target_user_id: '11111111-1111-1111-1111-111111111111',
          role: 'therapist',
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(userRolesUpsertPayload).toMatchObject({
      user_id: existingProfile.id,
      role_id: 'rid-therapist',
      granted_by: 'super-admin-rpc-drift',
      is_active: true,
    });
    expect(latestUpdatePayload).toEqual({ role: 'therapist' });
  });

  it('records the authoritative prior junction role when profiles.role has drifted', async () => {
    existingProfile.role = 'client';
    priorJunctionRole = 'admin';

    const superAdminContext: TestUserContext = {
      user: { id: 'super-admin-profile-drift', email: 'super-drift@example.com' },
      profile: {
        id: 'super-admin-profile-drift-profile',
        email: 'super-drift@example.com',
        role: 'super_admin',
        is_active: true,
      },
    };

    userContexts.set('super-drift', superAdminContext);
    adminUsers.set('super-admin-profile-drift', {
      id: 'super-admin-profile-drift',
      email: 'super-drift@example.com',
      user_metadata: { organization_id: 'org-123' },
    });
    adminUsers.set(existingProfile.id, {
      id: existingProfile.id,
      email: existingProfile.email,
      user_metadata: { organization_id: 'org-999' },
    });

    const { default: handler } = await import('../supabase/functions/admin-users-roles/index.ts');

    const response = await handler(
      new Request('http://localhost/functions/v1/admin-users-roles', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-token',
          'x-test-user': 'super-drift',
        },
        body: JSON.stringify({
          target_user_id: existingProfile.id,
          role: 'therapist',
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(adminActionInserts).toEqual([
      expect.objectContaining({
        action_details: expect.objectContaining({
          old_role: 'admin',
          new_role: 'therapist',
        }),
      }),
    ]);
    expect(adminActionInserts[0]).not.toEqual(
      expect.objectContaining({
        action_details: expect.objectContaining({ old_role: 'client' }),
      }),
    );
    expect(roleMutationEvents.indexOf('resolve-prior-role')).toBeLessThan(
      roleMutationEvents.indexOf('delete-user-roles'),
    );
    expect(roleMutationEvents.indexOf('resolve-prior-role')).toBeLessThan(
      roleMutationEvents.indexOf('upsert-user-role'),
    );
    expect(roleMutationEvents.indexOf('resolve-prior-role')).toBeLessThan(
      roleMutationEvents.indexOf('update-profile'),
    );
  });

  it('fails closed before mutating roles when the prior junction role cannot be resolved', async () => {
    priorJunctionRoleError = true;

    const superAdminContext: TestUserContext = {
      user: { id: 'super-admin-prior-role-error', email: 'super-prior-error@example.com' },
      profile: {
        id: 'super-admin-prior-role-error-profile',
        email: 'super-prior-error@example.com',
        role: 'super_admin',
        is_active: true,
      },
    };

    userContexts.set('super-prior-error', superAdminContext);

    const { default: handler } = await import('../supabase/functions/admin-users-roles/index.ts');

    const response = await handler(
      new Request('http://localhost/functions/v1/admin-users-roles', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-token',
          'x-test-user': 'super-prior-error',
        },
        body: JSON.stringify({
          target_user_id: existingProfile.id,
          role: 'therapist',
        }),
      }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'Failed to resolve current role assignment',
    });
    expect(roleMutationEvents).toEqual(['resolve-prior-role']);
    expect(latestUpdatePayload).toBeNull();
    expect(userRolesUpsertPayload).toBeNull();
    expect(adminActionInserts).toEqual([]);
  });

  it('fails closed before mutating roles when the prior junction role payload is invalid', async () => {
    priorJunctionRoleData = '';

    const superAdminContext: TestUserContext = {
      user: { id: 'super-admin-prior-role-invalid', email: 'super-prior-invalid@example.com' },
      profile: {
        id: 'super-admin-prior-role-invalid-profile',
        email: 'super-prior-invalid@example.com',
        role: 'super_admin',
        is_active: true,
      },
    };

    userContexts.set('super-prior-invalid', superAdminContext);

    const { default: handler } = await import('../supabase/functions/admin-users-roles/index.ts');

    const response = await handler(
      new Request('http://localhost/functions/v1/admin-users-roles', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-token',
          'x-test-user': 'super-prior-invalid',
        },
        body: JSON.stringify({
          target_user_id: existingProfile.id,
          role: 'therapist',
        }),
      }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'Failed to resolve current role assignment',
    });
    expect(roleMutationEvents).toEqual(['resolve-prior-role']);
    expect(latestUpdatePayload).toBeNull();
    expect(userRolesUpsertPayload).toBeNull();
    expect(adminActionInserts).toEqual([]);
  });

  it('uses request CORS headers on protected PATCH responses', async () => {
    const previewOrigin = 'https://deploy-preview-725--velvety-cendol-dae4d6.netlify.app';

    const superAdminContext: TestUserContext = {
      user: { id: 'super-admin-cors', email: 'super-cors@example.com' },
      profile: {
        id: 'super-admin-cors-profile',
        email: 'super-cors@example.com',
        role: 'super_admin',
        is_active: true,
      },
    };

    userContexts.set('super-cors', superAdminContext);
    adminUsers.set('super-admin-cors', {
      id: 'super-admin-cors',
      email: 'super-cors@example.com',
      user_metadata: { organization_id: 'org-123' },
    });
    adminUsers.set(existingProfile.id, {
      id: existingProfile.id,
      email: existingProfile.email,
      user_metadata: { organization_id: 'org-999' },
    });

    const { default: handler } = await import('../supabase/functions/admin-users-roles/index.ts');

    const response = await handler(
      new Request('http://localhost/functions/v1/admin-users-roles', {
        method: 'PATCH',
        headers: {
          Origin: previewOrigin,
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-token',
          'x-test-user': 'super-cors',
        },
        body: JSON.stringify({
          target_user_id: '11111111-1111-1111-1111-111111111111',
          role: 'therapist',
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(previewOrigin);
    expect(response.headers.get('Vary')).toBe('Origin');
    expect(userRolesUpsertPayload).toMatchObject({
      user_id: existingProfile.id,
      role_id: 'rid-therapist',
      granted_by: 'super-admin-cors',
      is_active: true,
    });
  });

  it('preserves middleware error responses while applying request CORS headers', async () => {
    const previewOrigin = 'https://deploy-preview-725--velvety-cendol-dae4d6.netlify.app';
    const { default: handler } = await import('../supabase/functions/admin-users-roles/index.ts');

    const response = await handler(
      new Request('http://localhost/functions/v1/admin-users-roles', {
        method: 'PATCH',
        headers: {
          Origin: previewOrigin,
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-token',
        },
        body: JSON.stringify({
          target_user_id: '11111111-1111-1111-1111-111111111111',
          role: 'therapist',
        }),
      }),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(previewOrigin);
    expect(response.headers.get('Vary')).toBe('Origin');
    expect(response.headers.get('Content-Type')).toBe('application/json');
    await expect(response.json()).resolves.toEqual({ error: 'Authentication required' });
    expect(userRolesUpsertPayload).toBeNull();
    expect(latestUpdatePayload).toBeNull();
    expect(adminActionInserts).toEqual([]);
  });

  it('denies non-super-admin callers before role update side effects', async () => {
    failLegacyRoleRpc = true;
    const previewOrigin = 'https://deploy-preview-725--velvety-cendol-dae4d6.netlify.app';

    const adminContext: TestUserContext = {
      user: { id: 'admin-rpc-drift', email: 'admin-rpc@example.com' },
      profile: {
        id: 'admin-rpc-profile',
        email: 'admin-rpc@example.com',
        role: 'admin',
        is_active: true,
      },
    };

    userContexts.set('admin-rpc', adminContext);

    const { default: handler } = await import('../supabase/functions/admin-users-roles/index.ts');

    const response = await handler(
      new Request('http://localhost/functions/v1/admin-users-roles', {
        method: 'PATCH',
        headers: {
          Origin: previewOrigin,
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-token',
          'x-test-user': 'admin-rpc',
        },
        body: JSON.stringify({
          target_user_id: '11111111-1111-1111-1111-111111111111',
          role: 'therapist',
        }),
      }),
    );

    expect(response.status).toBe(403);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(previewOrigin);
    expect(userRolesUpsertPayload).toBeNull();
    expect(latestUpdatePayload).toBeNull();
    expect(adminActionInserts).toEqual([]);
    expect(logApiAccess).not.toHaveBeenCalled();
  });

  it('returns success when audit metadata lookup stalls after the role write', async () => {
    vi.useFakeTimers();
    try {
      rpcRoles = ['super_admin'];
      stallAuditUserLookup = true;

      const superAdminContext: TestUserContext = {
        user: { id: 'super-admin-5', email: 'super5@example.com' },
        profile: {
          id: 'super-admin-profile-5',
          email: 'super5@example.com',
          role: 'super_admin',
          is_active: true,
        },
      };

      userContexts.set('super5', superAdminContext);

      const { default: handler } = await import('../supabase/functions/admin-users-roles/index.ts');
      const responsePromise = handler(
        new Request('http://localhost/functions/v1/admin-users-roles', {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer test-token',
            'x-test-user': 'super5',
          },
          body: JSON.stringify({
            target_user_id: '11111111-1111-1111-1111-111111111111',
            role: 'therapist',
          }),
        }),
      );

      await vi.advanceTimersByTimeAsync(3_000);
      const response = await responsePromise;

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.user.role).toBe('therapist');
      expect(userRolesUpsertPayload).toMatchObject({
        user_id: existingProfile.id,
        role_id: 'rid-therapist',
        granted_by: 'super-admin-5',
        is_active: true,
      });
      expect(latestUpdatePayload).toEqual({ role: 'therapist' });
      expect(adminActionInserts).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('preserves shared CORS origins on browser preflight', async () => {
    envValues.set('CORS_ALLOWED_ORIGINS', 'https://custom-preview.example.com');

    const { default: handler } = await import('../supabase/functions/admin-users-roles/index.ts');

    const deployPreviewResponse = await handler(
      new Request('http://localhost/functions/v1/admin-users-roles', {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://deploy-preview-724--velvety-cendol-dae4d6.netlify.app',
          'Access-Control-Request-Method': 'PATCH',
        },
      }),
    );

    expect(deployPreviewResponse.status).toBe(204);
    expect(deployPreviewResponse.headers.get('Access-Control-Allow-Origin')).toBe(
      'https://deploy-preview-724--velvety-cendol-dae4d6.netlify.app',
    );
    expect(deployPreviewResponse.headers.get('Access-Control-Allow-Methods')).toContain('PATCH');

    const configuredOriginResponse = await handler(
      new Request('http://localhost/functions/v1/admin-users-roles', {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://custom-preview.example.com',
          'Access-Control-Request-Method': 'PATCH',
        },
      }),
    );

    expect(configuredOriginResponse.status).toBe(204);
    expect(configuredOriginResponse.headers.get('Access-Control-Allow-Origin')).toBe(
      'https://custom-preview.example.com',
    );
  });
});
