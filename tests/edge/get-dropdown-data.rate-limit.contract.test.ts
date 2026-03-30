// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stubDenoEnv } from '../utils/stubDeno';

const envValues = new Map<string, string>([
  ['CORS_ALLOWED_ORIGINS', 'https://app.example.com,https://preview.example.com'],
  ['APP_ENV', 'production'],
]);

const createRequestClientMock = vi.fn();
const getUserOrThrowMock = vi.fn();
const requireOrgMock = vi.fn();
const assertUserHasOrgRoleMock = vi.fn();
const rateLimitMock = vi.fn();

stubDenoEnv((key) => envValues.get(key) ?? '');

async function loadHandler() {
  let serveHandler: ((req: Request) => Promise<Response>) | undefined;
  const denoObject = (globalThis as typeof globalThis & { Deno?: Record<string, unknown> }).Deno ?? {};
  vi.stubGlobal('Deno', {
    ...denoObject,
    env: {
      get: (key: string) => envValues.get(key) ?? '',
    },
    serve: vi.fn((handler: (req: Request) => Promise<Response>) => {
      serveHandler = handler;
      return {};
    }),
  });

  vi.doMock('../../supabase/functions/_shared/database.ts', () => ({
    createRequestClient: createRequestClientMock,
    supabaseAdmin: {
      from: vi.fn(() => ({
        insert: vi.fn(),
      })),
    },
  }));
  vi.doMock('../../supabase/functions/_shared/auth-middleware.ts', async () => {
    const actual = await vi.importActual<typeof import('../../supabase/functions/_shared/auth-middleware.ts')>(
      '../../supabase/functions/_shared/auth-middleware.ts',
    );
    return {
      ...actual,
      createProtectedRoute: (
        handler: (req: Request, userContext: { user: { id: string; email: string | null }; profile: { id: string; email: string | null; role: 'therapist'; is_active: boolean } }) => Promise<Response>,
      ) => async (req: Request) =>
        handler(req, {
          user: { id: 'user-1', email: 'therapist@example.com' },
          profile: { id: 'user-1', email: 'therapist@example.com', role: 'therapist', is_active: true },
        }),
      logApiAccess: vi.fn(),
    };
  });
  vi.doMock('../../supabase/functions/_shared/auth.ts', () => ({
    getUserOrThrow: getUserOrThrowMock,
  }));
  vi.doMock('../../supabase/functions/_shared/org.ts', async () => {
    const actual = await vi.importActual<typeof import('../../supabase/functions/_shared/org.ts')>(
      '../../supabase/functions/_shared/org.ts',
    );
    return {
      ...actual,
      requireOrg: requireOrgMock,
      assertUserHasOrgRole: assertUserHasOrgRoleMock,
    };
  });
  vi.doMock('../../supabase/functions/lib/http/error.ts', async () => {
    const actual = await vi.importActual<typeof import('../../supabase/functions/lib/http/error.ts')>(
      '../../supabase/functions/lib/http/error.ts',
    );
    return {
      ...actual,
      rateLimit: rateLimitMock,
    };
  });

  await import('../../supabase/functions/get-dropdown-data/index.ts');

  if (!serveHandler) {
    throw new Error('Expected get-dropdown-data to register a Deno.serve handler');
  }

  return serveHandler;
}

describe('get-dropdown-data rate-limit contract', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllGlobals();

    createRequestClientMock.mockReturnValue({});
    getUserOrThrowMock.mockResolvedValue({ id: 'user-1' });
    requireOrgMock.mockResolvedValue('org-1');
    assertUserHasOrgRoleMock.mockResolvedValue(true);
    rateLimitMock.mockReturnValue({ allowed: false, retryAfter: 29 });
  });

  it('returns the current 429 envelope with Retry-After when the dropdown-data route is rate limited', async () => {
    const handler = await loadHandler();

    const response = await handler(
      new Request('https://edge.example.com/functions/v1/get-dropdown-data?types=clients', {
        method: 'GET',
        headers: {
          Origin: 'https://preview.example.com',
          Authorization: 'Bearer token',
          'x-forwarded-for': '203.0.113.13',
          'x-request-id': 'req-dropdown-rate-limit',
        },
      }),
    );

    expect(createRequestClientMock).toHaveBeenCalledTimes(1);
    expect(getUserOrThrowMock).toHaveBeenCalledTimes(1);
    expect(requireOrgMock).toHaveBeenCalledTimes(1);
    expect(assertUserHasOrgRoleMock).toHaveBeenCalledWith(expect.anything(), 'org-1', 'therapist');
    expect(rateLimitMock).toHaveBeenCalledWith('dropdown:org-1:203.0.113.13', 120, 60_000);

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('29');
    expect(response.headers.get('Content-Type')).toContain('application/json');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();

    await expect(response.json()).resolves.toMatchObject({
      requestId: 'req-dropdown-rate-limit',
      code: 'rate_limited',
      message: 'Too many requests',
      classification: {
        category: 'rate_limit',
        retryable: true,
        httpStatus: 429,
      },
    });
  });
});
