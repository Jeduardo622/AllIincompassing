import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stubDenoEnv } from './utils/stubDeno';

const envValues = new Map<string, string>([
  ['SUPABASE_URL', 'http://localhost'],
  ['SUPABASE_SERVICE_ROLE_KEY', 'service-role-key'],
  ['SUPABASE_ANON_KEY', 'anon-key'],
]);

const CANONICAL_TEST_ROLES = [
  { id: 'rid-super', name: 'super_admin' },
  { id: 'rid-admin', name: 'admin' },
  { id: 'rid-therapist', name: 'therapist' },
  { id: 'rid-client', name: 'client' },
] as const;

type TestRole = 'client' | 'therapist' | 'admin' | 'super_admin';

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
    superAdmin: {},
  },
  logApiAccess,
  createProtectedRoute: (handler: (req: Request, userContext: TestUserContext) => Promise<Response>) => {
    return async (req: Request) => {
      const contextKey = req.headers.get('x-test-user') ?? 'default';
      const context = userContexts.get(contextKey);
      if (!context) {
        return new Response(
          JSON.stringify({ error: 'Authentication required' }),
          { status: 401, headers: { 'Content-Type': 'application/json' } },
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
          getUserById: vi.fn(async (userId: string) => ({
            data: { user: adminUsers.get(userId) ?? null },
            error: null,
          })),
        },
      },
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
              eq: vi.fn(() => ({
                in: vi.fn(async () => ({ error: null })),
              })),
            })),
            upsert: vi.fn((payload: Record<string, unknown>) => {
              userRolesUpsertPayload = payload;
              return Promise.resolve({ error: null });
            }),
          };
        }
        throw new Error(`Unexpected supabaseAdmin table: ${table}`);
      }),
    },
    createRequestClient: () => ({
      rpc: vi.fn(async (functionName: string) => {
        if (functionName === 'get_user_roles') {
          return { data: [{ roles: rpcRoles }], error: null };
        }
        return { data: null, error: { message: `Unexpected RPC ${functionName}` } };
      }),
      from: vi.fn((table: string) => {
        if (table !== 'profiles') {
          if (table === 'admin_actions') {
            return {
              insert: vi.fn(async (payload: Record<string, unknown>) => {
                adminActionInserts.push(payload);
                return { error: null };
              }),
            };
          }
          throw new Error(`Unexpected table: ${table}`);
        }
        return createProfilesQuery();
      }),
    }),
  };
});

describe('admin-users-roles access control', () => {
  beforeEach(() => {
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
    expect(latestUpdatePayload).toEqual({ role: 'therapist' });
    expect(logApiAccess).toHaveBeenCalledWith('PATCH', '/admin/users/11111111-1111-1111-1111-111111111111/roles', superAdminContext, 200);
    expect(adminActionInserts).toEqual([
      {
        admin_user_id: 'super-admin-1',
        target_user_id: '11111111-1111-1111-1111-111111111111',
        organization_id: 'org-999',
        action_type: 'role_update',
        action_details: {
          new_role: 'therapist',
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
});
