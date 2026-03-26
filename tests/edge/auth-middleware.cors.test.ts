import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stubDenoEnv } from '../utils/stubDeno';

const envValues = new Map<string, string>([
  ['CORS_ALLOWED_ORIGINS', 'https://app.example.com,https://preview.example.com'],
  ['APP_ENV', 'production'],
]);

stubDenoEnv((key) => envValues.get(key) ?? '');

describe('auth middleware cors headers', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('uses request origin when origin is allowlisted and sets Vary header', async () => {
    const module = await import('../../supabase/functions/_shared/auth-middleware.ts');
    const headers = module.corsHeadersForRequest(
      new Request('https://edge.example.com/foo', {
        method: 'GET',
        headers: { Origin: 'https://preview.example.com' },
      }),
    );

    expect(headers['Access-Control-Allow-Origin']).toBe('https://preview.example.com');
    expect(headers.Vary).toBe('Origin');
  });

  it('falls back to first allowlisted origin for untrusted origins', async () => {
    const module = await import('../../supabase/functions/_shared/auth-middleware.ts');
    const headers = module.corsHeadersForRequest(
      new Request('https://edge.example.com/foo', {
        method: 'GET',
        headers: { Origin: 'https://evil.example.com' },
      }),
    );

    expect(headers['Access-Control-Allow-Origin']).toBe('https://app.example.com');
    expect(headers.Vary).toBe('Origin');
  });

  it('programs-like protected route OPTIONS bypasses auth and handler', async () => {
    const module = await import('../../supabase/functions/_shared/auth-middleware.ts');
    const getUserContextSpy = vi.spyOn(module.authMiddlewareDeps, 'getUserContext');
    const handlerSpy = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const protectedHandler = module.createProtectedRoute(handlerSpy, module.RouteOptions.therapist);

    const response = await protectedHandler(
      new Request('https://edge.example.com/functions/v1/programs?client_id=client-1', {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://preview.example.com',
          'Access-Control-Request-Method': 'GET',
          'Access-Control-Request-Headers': 'authorization,content-type',
        },
      }),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://preview.example.com');
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('OPTIONS');
    expect(response.headers.get('Access-Control-Allow-Headers')).toContain('Authorization');
    expect(response.headers.get('Vary')).toBe('Origin');
    expect(handlerSpy).not.toHaveBeenCalled();
    expect(getUserContextSpy).not.toHaveBeenCalled();
  });

  it('programs-like protected route OPTIONS for disallowed origin uses current fallback-origin contract', async () => {
    const module = await import('../../supabase/functions/_shared/auth-middleware.ts');
    const getUserContextSpy = vi.spyOn(module.authMiddlewareDeps, 'getUserContext');
    const handlerSpy = vi.fn(async () => new Response('ok'));
    const protectedHandler = module.createProtectedRoute(handlerSpy, module.RouteOptions.therapist);

    const response = await protectedHandler(
      new Request('https://edge.example.com/functions/v1/programs?client_id=client-1', {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://evil.example.com',
          'Access-Control-Request-Method': 'GET',
        },
      }),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example.com');
    expect(response.headers.get('Vary')).toBe('Origin');
    expect(handlerSpy).not.toHaveBeenCalled();
    expect(getUserContextSpy).not.toHaveBeenCalled();
  });

  it('programs-like protected route non-OPTIONS still uses auth path', async () => {
    const module = await import('../../supabase/functions/_shared/auth-middleware.ts');
    const getUserContextSpy = vi.spyOn(module.authMiddlewareDeps, 'getUserContext');
    const handlerSpy = vi.fn(async () => new Response('ok'));
    const protectedHandler = module.createProtectedRoute(handlerSpy, module.RouteOptions.therapist);

    const response = await protectedHandler(
      new Request('https://edge.example.com/functions/v1/programs?client_id=client-1', {
        method: 'GET',
        headers: {
          Origin: 'https://preview.example.com',
        },
      }),
    );

    expect(response.status).toBe(401);
    expect(getUserContextSpy).toHaveBeenCalledTimes(1);
    expect(handlerSpy).not.toHaveBeenCalled();
  });

  it('programs-like protected route non-OPTIONS success response preserves handler headers (evidence for CORS-header gap follow-up)', async () => {
    const module = await import('../../supabase/functions/_shared/auth-middleware.ts');
    vi.spyOn(module.authMiddlewareDeps, 'getUserContext').mockResolvedValue({
      user: { id: 'therapist-1', email: 'therapist@example.com' },
      profile: { id: 'therapist-1', email: 'therapist@example.com', role: 'therapist', is_active: true },
    });
    const protectedHandler = module.createProtectedRoute(
      async () => new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      module.RouteOptions.therapist,
    );

    const response = await protectedHandler(
      new Request('https://edge.example.com/functions/v1/programs?client_id=client-1', {
        method: 'GET',
        headers: {
          Origin: 'https://preview.example.com',
          Authorization: 'Bearer token',
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/json');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});
