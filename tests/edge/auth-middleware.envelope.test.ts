import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stubDenoEnv } from '../utils/stubDeno';

const envValues = new Map<string, string>([
  ['CORS_ALLOWED_ORIGINS', 'https://app.example.com'],
  ['APP_ENV', 'production'],
]);

stubDenoEnv((key) => envValues.get(key) ?? '');

describe('auth middleware envelope responses', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('returns forbidden envelope for inactive users', async () => {
    const module = await import('../../supabase/functions/_shared/auth-middleware.ts');
    vi.spyOn(module, 'getUserContext').mockResolvedValue({
      user: { id: 'user-1', email: 'user@example.com' },
      profile: { id: 'user-1', email: 'user@example.com', role: 'client', is_active: false },
    });

    const { error } = await module.withAuth(
      new Request('https://edge.example.com/profiles/me', {
        headers: {
          Authorization: 'Bearer token',
          'x-request-id': 'req-inactive',
          Origin: 'https://app.example.com',
        },
      }),
      { requireAuth: true, requireActiveUser: true },
    );

    expect(error).toBeTruthy();
    expect(error?.status).toBe(403);
    const payload = await error!.json() as Record<string, unknown>;
    expect(payload.requestId).toBe('req-inactive');
    expect(payload.code).toBe('forbidden');
    expect(payload.message).toBe('User account is inactive');
    expect(payload.classification).toMatchObject({
      category: 'auth',
      severity: 'medium',
      retryable: false,
      httpStatus: 403,
    });
  });

  it('returns forbidden envelope for insufficient role', async () => {
    const module = await import('../../supabase/functions/_shared/auth-middleware.ts');
    vi.spyOn(module, 'getUserContext').mockResolvedValue({
      user: { id: 'user-1', email: 'user@example.com' },
      profile: { id: 'user-1', email: 'user@example.com', role: 'client', is_active: true },
    });

    const { error } = await module.withAuth(
      new Request('https://edge.example.com/admin/users', {
        headers: {
          Authorization: 'Bearer token',
          'x-request-id': 'req-role',
          Origin: 'https://app.example.com',
        },
      }),
      { requireAuth: true, requireActiveUser: false, allowedRoles: ['admin'] },
    );

    expect(error).toBeTruthy();
    expect(error?.status).toBe(403);
    const payload = await error!.json() as Record<string, unknown>;
    expect(payload.requestId).toBe('req-role');
    expect(payload.code).toBe('forbidden');
    expect(payload.message).toBe('Insufficient permissions');
    expect(payload.classification).toMatchObject({
      category: 'auth',
      severity: 'medium',
      retryable: false,
      httpStatus: 403,
    });
  });

  it('returns forbidden envelope when protected handlers throw AuthorizationError', async () => {
    const module = await import('../../supabase/functions/_shared/auth-middleware.ts');
    vi.spyOn(module, 'getUserContext').mockResolvedValue({
      user: { id: 'user-1', email: 'user@example.com' },
      profile: { id: 'user-1', email: 'user@example.com', role: 'client', is_active: true },
    });

    const protectedHandler = module.createProtectedRoute(
      async () => {
        throw new module.AuthorizationError('Denied by policy');
      },
      { requireActiveUser: false },
    );

    const response = await protectedHandler(
      new Request('https://edge.example.com/protected', {
        headers: {
          Authorization: 'Bearer token',
          'x-request-id': 'req-authz',
          Origin: 'https://app.example.com',
        },
      }),
    );

    expect(response.status).toBe(403);
    const payload = await response.json() as Record<string, unknown>;
    expect(payload.requestId).toBe('req-authz');
    expect(payload.code).toBe('forbidden');
    expect(payload.message).toBe('Denied by policy');
    expect(payload.classification).toMatchObject({
      category: 'auth',
      severity: 'medium',
      retryable: false,
      httpStatus: 403,
    });
  });
});
