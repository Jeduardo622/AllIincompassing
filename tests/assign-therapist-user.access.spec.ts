import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stubDenoEnv } from './utils/stubDeno';

stubDenoEnv(() => 'test-value');

const mocks = vi.hoisted(() => ({
  requestRpc: vi.fn(),
  profilesIn: vi.fn(),
  logApiAccess: vi.fn(),
}));

const CALLER_ID = '11111111-1111-4111-8111-111111111111';
const TARGET_ID = '22222222-2222-4222-8222-222222222222';
const jwtFor = (sub: string): string => {
  const payload = btoa(JSON.stringify({ sub })).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `test.${payload}.signature`;
};

vi.mock('../supabase/functions/_shared/auth-middleware.ts', () => ({
  corsHeadersForRequest: () => ({ 'Access-Control-Allow-Origin': '*' }),
  handleCors: () => null,
  logApiAccess: mocks.logApiAccess,
  extractBearerToken: (req: Request) => req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? null,
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
    mocks.requestRpc.mockReset();
    mocks.profilesIn.mockReset();
    mocks.logApiAccess.mockReset();

    mocks.profilesIn.mockResolvedValue({
      data: [
        {
          id: CALLER_ID,
          email: 'caller@example.com',
          organization_id: 'org-a',
          is_active: true,
        },
        {
          id: TARGET_ID,
          email: 'target@example.com',
          organization_id: 'org-a',
          is_active: true,
        },
      ],
      error: null,
    });
    mocks.requestRpc.mockResolvedValue({ data: false, error: null });
  });

  it('extracts only a UUID subject from a gateway-verified JWT payload', async () => {
    const { getGatewayVerifiedCallerId } = await import('../supabase/functions/assign-therapist-user/index.ts');
    const request = new Request('http://localhost/functions/v1/assign-therapist-user', {
      headers: { Authorization: `Bearer ${jwtFor(CALLER_ID)}` },
    });

    expect(getGatewayVerifiedCallerId(request)).toBe(CALLER_ID);
  });

  it.each([
    ['missing token', undefined],
    ['wrong segment count', 'one.two'],
    ['invalid payload encoding', 'one.%.three'],
    ['missing subject', `one.${btoa('{}')}.three`],
    ['non-UUID subject', jwtFor('caller-id')],
  ])('rejects a %s before profile or role access', async (_label, token) => {
    const { getGatewayVerifiedCallerId } = await import('../supabase/functions/assign-therapist-user/index.ts');
    const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
    const request = new Request('http://localhost/functions/v1/assign-therapist-user', { headers });

    expect(() => getGatewayVerifiedCallerId(request)).toThrow(Response);
    expect(mocks.profilesIn).not.toHaveBeenCalled();
    expect(mocks.requestRpc).not.toHaveBeenCalled();
  });

  it('denies a caller without an active role for the profile organization', async () => {
    const { default: handler } = await import('../supabase/functions/assign-therapist-user/index.ts');
    const response = await handler(new Request('http://localhost/functions/v1/assign-therapist-user', {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwtFor(CALLER_ID)}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: TARGET_ID, therapistId: 'therapist-id' }),
    }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'Insufficient permissions' });
    expect(mocks.profilesIn).toHaveBeenCalledWith('id', [CALLER_ID, TARGET_ID]);
    expect(mocks.requestRpc).toHaveBeenCalledTimes(5);
    for (const roleName of ['bcba', 'org_super_admin', 'org_admin', 'admin']) {
      expect(mocks.requestRpc).toHaveBeenCalledWith('user_has_role_for_org', {
        role_name: roleName,
        target_organization_id: 'org-a',
      });
    }
  });

  it('preserves a JSON error envelope when JWT authentication fails', async () => {
    const { default: handler } = await import('../supabase/functions/assign-therapist-user/index.ts');
    const response = await handler(new Request('http://localhost/functions/v1/assign-therapist-user', {
      method: 'POST',
      headers: { Authorization: 'Bearer bad-token', 'x-request-id': 'request-123', 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: TARGET_ID, therapistId: 'therapist-id' }),
    }));

    expect(response.status).toBe(401);
    expect(response.headers.get('content-type')).toContain('application/json');
    await expect(response.json()).resolves.toMatchObject({
      requestId: 'request-123',
      code: 'unauthorized',
      message: 'Unauthorized',
    });
    expect(mocks.profilesIn).not.toHaveBeenCalled();
    expect(mocks.requestRpc).not.toHaveBeenCalled();
  });

  it('fails closed with a JSON envelope when an organization role check errors', async () => {
    mocks.requestRpc.mockResolvedValueOnce({ data: null, error: { message: 'rpc unavailable' } });
    const { default: handler } = await import('../supabase/functions/assign-therapist-user/index.ts');
    const response = await handler(new Request('http://localhost/functions/v1/assign-therapist-user', {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwtFor(CALLER_ID)}`, 'x-request-id': 'request-500', 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: TARGET_ID, therapistId: 'therapist-id' }),
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
