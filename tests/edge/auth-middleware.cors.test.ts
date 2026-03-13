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
});
