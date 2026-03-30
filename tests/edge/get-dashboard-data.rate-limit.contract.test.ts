// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stubDenoEnv } from '../utils/stubDeno';

const envValues = new Map<string, string>([
  ['CORS_ALLOWED_ORIGINS', 'https://app.example.com,https://preview.example.com'],
  ['DEFAULT_ORGANIZATION_ID', 'org-default'],
]);

const createRequestClientMock = vi.fn();
const resolveOrgIdMock = vi.fn();
const rateLimitMock = vi.fn();

stubDenoEnv((key) => envValues.get(key) ?? '');

async function loadHandler() {
  vi.doMock('../../supabase/functions/_shared/database.ts', () => ({
    createRequestClient: createRequestClientMock,
  }));
  vi.doMock('../../supabase/functions/_shared/auth-middleware.ts', async () => {
    const actual = await vi.importActual<typeof import('../../supabase/functions/_shared/auth-middleware.ts')>(
      '../../supabase/functions/_shared/auth-middleware.ts',
    );
    return {
      ...actual,
      createProtectedRoute: (handler: (req: Request) => Promise<Response>) => handler,
    };
  });
  vi.doMock('../../supabase/functions/_shared/org.ts', async () => {
    const actual = await vi.importActual<typeof import('../../supabase/functions/_shared/org.ts')>(
      '../../supabase/functions/_shared/org.ts',
    );
    return {
      ...actual,
      resolveOrgId: resolveOrgIdMock,
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

  return import('../../supabase/functions/get-dashboard-data/index.ts');
}

describe('get-dashboard-data rate-limit contract', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    createRequestClientMock.mockReturnValue({
      rpc: vi.fn(),
    });
    resolveOrgIdMock.mockResolvedValue('org-1');
    rateLimitMock.mockReturnValue({ allowed: false, retryAfter: 41 });
  });

  it('returns the current 429 envelope with Retry-After when the dashboard route is rate limited', async () => {
    const module = await loadHandler();

    const response = await module.default(
      new Request('https://edge.example.com/functions/v1/get-dashboard-data', {
        method: 'GET',
        headers: {
          Origin: 'https://preview.example.com',
          Authorization: 'Bearer token',
          'x-forwarded-for': '203.0.113.27',
          'x-request-id': 'req-dashboard-rate-limit',
        },
      }),
    );

    expect(createRequestClientMock).toHaveBeenCalledTimes(1);
    expect(resolveOrgIdMock).toHaveBeenCalledTimes(1);
    expect(rateLimitMock).toHaveBeenCalledWith('dashboard:203.0.113.27', 60, 60_000);

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('41');
    expect(response.headers.get('Content-Type')).toContain('application/json');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example.com');

    await expect(response.json()).resolves.toMatchObject({
      requestId: 'req-dashboard-rate-limit',
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
