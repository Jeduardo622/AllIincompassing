import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import { runtimeConfigHandler } from '../api/runtime-config';

const originalEnv = { ...process.env };

describe('runtimeConfigHandler', () => {
  beforeEach(() => {
    process.env = { ...originalEnv } as NodeJS.ProcessEnv;
  });

  afterAll(() => {
    process.env = originalEnv as NodeJS.ProcessEnv;
  });

  it('returns runtime config when env vars are present', async () => {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_ANON_KEY = 'anon-key';

    const response = await runtimeConfigHandler(new Request('http://localhost/api/runtime-config'));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.supabaseUrl).toBe('https://example.supabase.co');
    expect(payload.supabaseAnonKey).toBe('anon-key');
  });

  it('fails with 500 when env vars are missing', async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_ANON_KEY;

    const response = await runtimeConfigHandler(new Request('http://localhost/api/runtime-config'));
    expect(response.status).toBe(500);
    const payload = await response.json();
    expect(payload.error).toMatch(/Missing required Supabase environment variable/);
  });

  it('rejects unsupported methods', async () => {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_ANON_KEY = 'anon-key';

    const response = await runtimeConfigHandler(new Request('http://localhost/api/runtime-config', { method: 'POST' }));
    expect(response.status).toBe(405);
    const payload = await response.json();
    expect(payload.error).toBe('Method not allowed');
  });

  it('responds to OPTIONS preflight', async () => {
    const response = await runtimeConfigHandler(new Request('http://localhost/api/runtime-config', { method: 'OPTIONS' }));
    expect(response.status).toBe(200);
  });
});

