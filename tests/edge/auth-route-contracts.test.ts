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

const tokenResponseCacheHeaders = {
  'Cache-Control': 'no-store, no-cache, max-age=0',
  Pragma: 'no-cache',
  Expires: '0',
};

function buildLoginSupabase() {
  return {
    auth: {
      signInWithPassword: vi.fn(async () => ({
        data: {
          user: { id: 'user-1', email: 'user@example.com' },
          session: { access_token: 'token', refresh_token: 'refresh', expires_at: 111 },
        },
        error: null,
      })),
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(async () => ({
            data: {
              id: 'user-1',
              email: 'user@example.com',
              role: 'client',
              first_name: 'First',
              last_name: 'Last',
              is_active: true,
            },
            error: null,
          })),
        })),
      })),
      update: vi.fn(() => ({
        eq: vi.fn(async () => ({ data: null, error: null })),
      })),
    })),
  };
}

async function loadLoginHandler() {
  vi.resetModules();
  vi.doMock('../../supabase/functions/_shared/auth-middleware.ts', () => ({
    createPublicRoute: (handler: (req: Request) => Promise<Response>) => (req: Request) => handler(req),
    corsHeadersForRequest,
    createSupabaseClientForRequest,
    logApiAccess,
    tokenResponseCacheHeaders,
  }));
  const module = await import('../../supabase/functions/auth-login/index.ts');
  return module.default as (req: Request) => Promise<Response>;
}

async function loadSignupHandler() {
  vi.resetModules();
  vi.doMock('../../supabase/functions/_shared/auth-middleware.ts', () => ({
    createPublicRoute: (handler: (req: Request) => Promise<Response>) => (req: Request) => handler(req),
    corsHeadersForRequest,
    createSupabaseClientForRequest,
    logApiAccess,
  }));
  const module = await import('../../supabase/functions/auth-signup/index.ts');
  return module.default as (req: Request) => Promise<Response>;
}

describe('auth route contracts', () => {
  beforeEach(() => {
    logApiAccess.mockReset();
    corsHeadersForRequest.mockClear();
    createSupabaseClientForRequest.mockReset();
  });

  it('returns validation_error on invalid login JSON', async () => {
    const handler = await loadLoginHandler();
    const response = await handler(new Request('https://edge.example.com/auth/login', {
      method: 'POST',
      body: '{bad-json',
    }));

    expect(response.status).toBe(400);
    const body = await response.json() as Record<string, unknown>;
    expect(body.code).toBe('validation_error');
    expect(body.message).toBe('Invalid JSON body');
    expect(createSupabaseClientForRequest).not.toHaveBeenCalled();
  });

  it('adds strict no-store headers on successful login token response', async () => {
    createSupabaseClientForRequest.mockResolvedValue({
      supabase: buildLoginSupabase(),
      token: null,
    });
    const handler = await loadLoginHandler();
    const response = await handler(new Request('https://edge.example.com/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'user@example.com', password: 'password123' }),
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe(tokenResponseCacheHeaders['Cache-Control']);
    expect(response.headers.get('Pragma')).toBe(tokenResponseCacheHeaders.Pragma);
    expect(response.headers.get('Expires')).toBe(tokenResponseCacheHeaders.Expires);
  });

  it('returns generic signup failure message for provider errors', async () => {
    createSupabaseClientForRequest.mockResolvedValue({
      supabase: {
        auth: {
          signUp: vi.fn(async () => ({
            data: { user: null, session: null },
            error: { message: 'User already registered' },
          })),
        },
      },
      token: null,
    });
    const handler = await loadSignupHandler();
    const response = await handler(new Request('https://edge.example.com/auth/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'user@example.com', password: 'password123' }),
    }));

    expect(response.status).toBe(400);
    const body = await response.json() as Record<string, unknown>;
    expect(body.code).toBe('validation_error');
    expect(body.message).toBe('Unable to complete signup');
  });
});
