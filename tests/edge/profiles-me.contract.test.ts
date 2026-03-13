import { beforeEach, describe, expect, it, vi } from 'vitest';

const logApiAccess = vi.fn();
const extractBearerToken = vi.fn((req: Request) => {
  const header = req.headers.get('Authorization');
  return header?.startsWith('Bearer ') ? header.slice(7) : null;
});
const createSupabaseClientForRequest = vi.fn();
const corsHeadersForRequest = vi.fn(() => ({
  'Access-Control-Allow-Origin': 'https://app.example.com',
  Vary: 'Origin',
}));

const userContext = {
  user: { id: 'user-1', email: 'user@example.com' },
  profile: { id: 'user-1', email: 'user@example.com', role: 'client', is_active: true },
};

function buildProfilesSupabase() {
  return {
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
              full_name: 'First Last',
              phone: null,
              avatar_url: null,
              time_zone: 'UTC',
              preferences: {},
              is_active: true,
              last_login_at: null,
              created_at: '2026-01-01T00:00:00.000Z',
              updated_at: '2026-01-01T00:00:00.000Z',
            },
            error: null,
          })),
        })),
      })),
      update: vi.fn(() => ({
        eq: vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn(async () => ({
              data: {
                id: 'user-1',
                email: 'user@example.com',
                role: 'client',
                first_name: 'Updated',
                last_name: 'Last',
                full_name: 'Updated Last',
                phone: null,
                avatar_url: null,
                time_zone: 'UTC',
                preferences: {},
                is_active: true,
                last_login_at: null,
                created_at: '2026-01-01T00:00:00.000Z',
                updated_at: '2026-01-01T00:00:00.000Z',
              },
              error: null,
            })),
          })),
        })),
      })),
    })),
  };
}

async function loadHandler() {
  vi.resetModules();
  vi.doMock('../../supabase/functions/_shared/auth-middleware.ts', () => ({
    createProtectedRoute: (handler: (req: Request, context: typeof userContext) => Promise<Response>) => {
      return (req: Request) => handler(req, userContext);
    },
    corsHeadersForRequest,
    createSupabaseClientForRequest,
    extractBearerToken,
    logApiAccess,
    RouteOptions: { authenticated: {} },
  }));
  const module = await import('../../supabase/functions/profiles-me/index.ts');
  return module.default as (req: Request) => Promise<Response>;
}

describe('profiles-me route contracts', () => {
  beforeEach(() => {
    createSupabaseClientForRequest.mockReset();
    extractBearerToken.mockClear();
    logApiAccess.mockReset();
  });

  it('returns unauthorized when bearer token is missing', async () => {
    const handler = await loadHandler();
    const response = await handler(new Request('https://edge.example.com/profiles/me', { method: 'GET' }));
    const body = await response.json() as Record<string, unknown>;
    expect(response.status).toBe(401);
    expect(body.code).toBe('unauthorized');
  });

  it('returns validation_error when PUT body is invalid JSON', async () => {
    createSupabaseClientForRequest.mockResolvedValue({ supabase: buildProfilesSupabase(), token: 'token' });
    const handler = await loadHandler();
    const response = await handler(new Request('https://edge.example.com/profiles/me', {
      method: 'PUT',
      headers: { Authorization: 'Bearer token' },
      body: '{not-json',
    }));
    const body = await response.json() as Record<string, unknown>;
    expect(response.status).toBe(400);
    expect(body.code).toBe('validation_error');
    expect(body.message).toBe('Invalid JSON body');
  });

  it('returns validation_error for invalid timezone', async () => {
    createSupabaseClientForRequest.mockResolvedValue({ supabase: buildProfilesSupabase(), token: 'token' });
    const handler = await loadHandler();
    const response = await handler(new Request('https://edge.example.com/profiles/me', {
      method: 'PUT',
      headers: {
        Authorization: 'Bearer token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ time_zone: 'Invalid/Timezone' }),
    }));
    const body = await response.json() as Record<string, unknown>;
    expect(response.status).toBe(400);
    expect(body.code).toBe('validation_error');
    expect(body.message).toBe('Invalid time zone');
  });
});
