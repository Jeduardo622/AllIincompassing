import { beforeEach, describe, expect, it, vi } from 'vitest';

const logApiAccess = vi.fn();
const createSupabaseClientForRequest = vi.fn();
const corsHeadersForRequest = vi.fn(() => ({
  'Access-Control-Allow-Origin': 'https://app.example.com',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Client-Info, x-client-info, apikey',
  'Access-Control-Max-Age': '86400',
  Vary: 'Origin',
}));

const rateLimitMock = vi.fn();

async function loadHandler() {
  vi.resetModules();
  vi.doMock('../../supabase/functions/_shared/auth-middleware.ts', () => ({
    createPublicRoute: (handler: (req: Request) => Promise<Response>) => (req: Request) => handler(req),
    corsHeadersForRequest,
    createSupabaseClientForRequest,
    logApiAccess,
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

  const module = await import('../../supabase/functions/auth-signup/index.ts');
  return module.default as (req: Request) => Promise<Response>;
}

describe('auth-signup IP throttle contract', () => {
  beforeEach(() => {
    logApiAccess.mockReset();
    corsHeadersForRequest.mockClear();
    createSupabaseClientForRequest.mockReset();
    rateLimitMock.mockReset();
    rateLimitMock.mockImplementation((key: string) => {
      if (key.startsWith('auth-signup:ip:')) {
        return { allowed: false, retryAfter: 41 };
      }
      return { allowed: true, retryAfter: null };
    });
  });

  it('returns the current 429 signup envelope with Retry-After when the IP throttle trips', async () => {
    const handler = await loadHandler();

    const response = await handler(
      new Request('https://edge.example.com/auth/signup', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-forwarded-for': '203.0.113.10',
          origin: 'https://preview.example.com',
        },
        body: JSON.stringify({ email: 'user@example.com', password: 'password123' }),
      }),
    );

    expect(rateLimitMock).toHaveBeenCalledTimes(1);
    expect(rateLimitMock).toHaveBeenCalledWith('auth-signup:ip:203.0.113.10', 10, 60_000);
    expect(createSupabaseClientForRequest).not.toHaveBeenCalled();
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('41');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example.com');
    expect(response.headers.get('Content-Type')).toContain('application/json');

    await expect(response.json()).resolves.toMatchObject({
      code: 'rate_limited',
      message: 'Too many signup attempts from this network. Please try again shortly.',
    });
  });
});
