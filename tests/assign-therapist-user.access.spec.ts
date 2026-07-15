import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stubDenoEnv } from './utils/stubDeno';

stubDenoEnv(() => 'test-value');

const mocks = vi.hoisted(() => ({
  getUserOrThrow: vi.fn(),
  requestRpc: vi.fn(),
  profilesIn: vi.fn(),
  logApiAccess: vi.fn(),
}));

vi.mock('../supabase/functions/_shared/auth-middleware.ts', () => ({
  corsHeadersForRequest: () => ({ 'Access-Control-Allow-Origin': '*' }),
  handleCors: () => null,
  logApiAccess: mocks.logApiAccess,
}));

vi.mock('../supabase/functions/_shared/auth.ts', () => ({
  getUserOrThrow: mocks.getUserOrThrow,
}));

vi.mock('../supabase/functions/_shared/database.ts', () => ({
  createRequestClient: () => ({ rpc: mocks.requestRpc }),
  supabaseAdmin: {
    auth: { admin: { getUserById: vi.fn() } },
    from: (table: string) => {
      if (table !== 'profiles') throw new Error(`Unexpected table ${table}`);
      return {
        select: () => ({ in: mocks.profilesIn }),
      };
    },
  },
}));

describe('assign-therapist-user access control', () => {
  beforeEach(() => {
    mocks.getUserOrThrow.mockReset();
    mocks.requestRpc.mockReset();
    mocks.profilesIn.mockReset();
    mocks.logApiAccess.mockReset();

    mocks.getUserOrThrow.mockResolvedValue({
      id: 'caller-id',
      email: 'caller@example.com',
    });
    mocks.profilesIn.mockResolvedValue({
      data: [
        {
          id: 'caller-id',
          email: 'caller@example.com',
          organization_id: 'org-a',
          is_active: true,
        },
        {
          id: 'target-id',
          email: 'target@example.com',
          organization_id: 'org-a',
          is_active: true,
        },
      ],
      error: null,
    });
    mocks.requestRpc.mockResolvedValue({ data: false, error: null });
  });

  it('denies a caller without an active role for the profile organization', async () => {
    const { default: handler } = await import('../supabase/functions/assign-therapist-user/index.ts');
    const response = await handler(new Request('http://localhost/functions/v1/assign-therapist-user', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'target-id', therapistId: 'therapist-id' }),
    }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'Insufficient permissions' });
    expect(mocks.requestRpc).toHaveBeenCalledTimes(5);
    expect(mocks.requestRpc).toHaveBeenCalledWith('user_has_role_for_org', {
      role_name: 'admin',
      target_organization_id: 'org-a',
    });
  });

  it('preserves a JSON error envelope when JWT authentication fails', async () => {
    mocks.getUserOrThrow.mockRejectedValueOnce(new Response('Unauthorized', { status: 401 }));
    const { default: handler } = await import('../supabase/functions/assign-therapist-user/index.ts');
    const response = await handler(new Request('http://localhost/functions/v1/assign-therapist-user', {
      method: 'POST',
      headers: { Authorization: 'Bearer bad-token', 'x-request-id': 'request-123', 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'target-id', therapistId: 'therapist-id' }),
    }));

    expect(response.status).toBe(401);
    expect(response.headers.get('content-type')).toContain('application/json');
    await expect(response.json()).resolves.toMatchObject({
      requestId: 'request-123',
      code: 'unauthorized',
      message: 'Unauthorized',
    });
  });

  it('fails closed with a JSON envelope when an organization role check errors', async () => {
    mocks.requestRpc.mockResolvedValueOnce({ data: null, error: { message: 'rpc unavailable' } });
    const { default: handler } = await import('../supabase/functions/assign-therapist-user/index.ts');
    const response = await handler(new Request('http://localhost/functions/v1/assign-therapist-user', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-token', 'x-request-id': 'request-500', 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'target-id', therapistId: 'therapist-id' }),
    }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      requestId: 'request-500',
      code: 'internal_error',
      message: 'Role check failed',
    });
  });

  it.each([
    ['super admin', 'current_user_is_super_admin', undefined, 'super_admin'],
    ['BCBA', 'user_has_role_for_org', 'bcba', 'bcba'],
    ['organization admin', 'user_has_role_for_org', 'org_admin', 'admin'],
  ])('resolves an active organization-scoped %s grant', async (_label, rpcName, roleName, expectedRole) => {
    mocks.requestRpc.mockImplementation(async (calledName: string, payload?: { role_name?: string }) => ({
      data: calledName === rpcName && (roleName === undefined || payload?.role_name === roleName),
      error: null,
    }));
    const { resolveAssignmentAdminRole } = await import('../supabase/functions/assign-therapist-user/index.ts');

    await expect(resolveAssignmentAdminRole(
      { rpc: mocks.requestRpc } as never,
      'org-a',
    )).resolves.toBe(expectedRole);
  });
});
