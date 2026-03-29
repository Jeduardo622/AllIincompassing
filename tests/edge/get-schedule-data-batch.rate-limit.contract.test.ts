// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stubDenoEnv } from '../utils/stubDeno';

const envValues = new Map<string, string>([
  ['CORS_ALLOWED_ORIGINS', 'https://app.example.com,https://preview.example.com'],
  ['SUPABASE_URL', 'https://example.supabase.co'],
  ['SUPABASE_ANON_KEY', 'anon-key'],
]);

const createRequestClientMock = vi.fn();
const getUserOrThrowMock = vi.fn();
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
  }));
  vi.doMock('../../supabase/functions/_shared/auth.ts', () => ({
    getUserOrThrow: getUserOrThrowMock,
  }));
  vi.doMock('../../supabase/functions/lib/http/error.ts', async () => {
    const actual = await vi.importActual<typeof import('../../supabase/functions/lib/http/error.ts')>(
      '../../supabase/functions/lib/http/error.ts',
    );
    return {
      ...actual,
      rateLimit: rateLimitMock,
    };
  });

  await import('../../supabase/functions/get-schedule-data-batch/index.ts');

  if (!serveHandler) {
    throw new Error('Expected get-schedule-data-batch to register a Deno.serve handler');
  }

  return serveHandler;
}

describe('get-schedule-data-batch rate-limit contract', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllGlobals();

    createRequestClientMock.mockReturnValue({
      rpc: vi.fn(async (fn: string) => {
        if (fn !== 'current_user_organization_id') {
          throw new Error(`Unexpected rpc call: ${fn}`);
        }
        return { data: 'org-1', error: null };
      }),
    });
    getUserOrThrowMock.mockResolvedValue({ id: 'user-1' });
    rateLimitMock.mockReturnValue({ allowed: false, retryAfter: 17 });
  });

  it('returns the current 429 envelope with Retry-After when the schedule batch route is rate limited', async () => {
    const handler = await loadHandler();

    const response = await handler(
      new Request('https://edge.example.com/functions/v1/get-schedule-data-batch?start_date=2026-03-01&end_date=2026-03-08', {
        method: 'GET',
        headers: {
          Origin: 'https://preview.example.com',
          Authorization: 'Bearer token',
          'x-forwarded-for': '203.0.113.9',
          'x-request-id': 'req-rate-limit',
        },
      }),
    );

    expect(createRequestClientMock).toHaveBeenCalledTimes(1);
    expect(getUserOrThrowMock).toHaveBeenCalledTimes(1);
    expect(rateLimitMock).toHaveBeenCalledWith('schedule:203.0.113.9', 60, 60_000);

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('17');
    expect(response.headers.get('Content-Type')).toContain('application/json');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();

    await expect(response.json()).resolves.toMatchObject({
      requestId: 'req-rate-limit',
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
