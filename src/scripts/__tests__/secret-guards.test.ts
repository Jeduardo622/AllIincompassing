import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

describe('resolveSupabaseServiceKey', () => {
  const originalServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  beforeEach(() => {
    vi.resetModules();
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  afterAll(() => {
    if (originalServiceKey === undefined) {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    } else {
      process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceKey;
    }
  });

  it('returns the configured service role key when present', async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
    const module = await import('../../../scripts/admin-password-reset.js');

    expect(module.resolveSupabaseServiceKey()).toBe('test-service-role-key');
  });

  it('throws a descriptive error when the key is missing', async () => {
    const module = await import('../../../scripts/admin-password-reset.js');

    expect(() => module.resolveSupabaseServiceKey()).toThrowError(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it('throws when the key is only whitespace', async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = '   ';
    const module = await import('../../../scripts/admin-password-reset.js');

    expect(() => module.resolveSupabaseServiceKey()).toThrowError(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it('trims surrounding whitespace from the configured key', async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = '  padded-key  ';
    const module = await import('../../../scripts/admin-password-reset.js');

    expect(module.resolveSupabaseServiceKey()).toBe('padded-key');
  });

  it('supports supplying an explicit environment map', async () => {
    const module = await import('../../../scripts/admin-password-reset.js');

    expect(
      module.resolveSupabaseServiceKey({ SUPABASE_SERVICE_ROLE_KEY: 'inline-service-role-key' })
    ).toBe('inline-service-role-key');
  });
});

describe('resolveSupabaseAnonKey and resolveSupabaseUrl', () => {
  const originalAnonKey = process.env.SUPABASE_ANON_KEY;
  const originalUrl = process.env.SUPABASE_URL;

  beforeEach(() => {
    vi.resetModules();
    delete process.env.SUPABASE_ANON_KEY;
    delete process.env.SUPABASE_URL;
  });

  afterAll(() => {
    if (originalAnonKey === undefined) {
      delete process.env.SUPABASE_ANON_KEY;
    } else {
      process.env.SUPABASE_ANON_KEY = originalAnonKey;
    }

    if (originalUrl === undefined) {
      delete process.env.SUPABASE_URL;
    } else {
      process.env.SUPABASE_URL = originalUrl;
    }
  });

  it('reads the anon key from the environment when present', async () => {
    process.env.SUPABASE_ANON_KEY = 'test-anon-key';
    const module = await import('../../../scripts/test-transcription.js');

    expect(module.resolveSupabaseAnonKey()).toBe('test-anon-key');
  });

  it('throws an error when no anon key is provided', async () => {
    const module = await import('../../../scripts/test-transcription.js');

    expect(() => module.resolveSupabaseAnonKey()).toThrowError(/SUPABASE_ANON_KEY/);
  });

  it('prefers a provided URL while falling back to the default project when unset', async () => {
    const module = await import('../../../scripts/test-transcription.js');

    expect(module.resolveSupabaseUrl({ SUPABASE_URL: 'https://custom.supabase.co' })).toBe(
      'https://custom.supabase.co'
    );
    expect(module.resolveSupabaseUrl({})).toBe('https://wnnjeqheqxxyrgsjmygy.supabase.co');
  });
});
