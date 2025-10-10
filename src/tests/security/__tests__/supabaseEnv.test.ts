import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  computeEnvironmentGuidance,
  parseSupabaseProjectRef,
  resolveSupabaseTestEnv,
} from '../supabaseEnv';

describe('supabaseEnv', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('returns existing environment variables without invoking fetch', async () => {
    process.env.SUPABASE_URL = 'https://project.supabase.co';
    process.env.SUPABASE_ANON_KEY = 'anon-key';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';

    const result = await resolveSupabaseTestEnv({
      isCiEnvironment: true,
      runDatabaseIntegrationTests: true,
    });

    expect(result.supabaseUrl).toBe('https://project.supabase.co');
    expect(result.supabaseServiceRoleKey).toBe('service-role');
    expect(result.missing).toHaveLength(0);
    expect(result.shouldRun).toBe(true);
  });

  it('hydrates the service role key from Supabase management API when missing', async () => {
    process.env.SUPABASE_URL = 'https://project.supabase.co';
    process.env.SUPABASE_ANON_KEY = 'anon-key';
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.SUPABASE_ACCESS_TOKEN = 'access-token';

    const mockFetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        api_keys: [
          { type: 'anon', api_key: 'anon-key' },
          { type: 'service_role', api_key: 'service-role-key' },
        ],
      }),
    })) as unknown as typeof fetch;

    const result = await resolveSupabaseTestEnv({
      isCiEnvironment: true,
      runDatabaseIntegrationTests: true,
      fetchImpl: mockFetch,
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.supabase.com/v1/projects/project/api-keys',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer access-token' }),
      }),
    );
    expect(result.supabaseServiceRoleKey).toBe('service-role-key');
    expect(process.env.SUPABASE_SERVICE_ROLE_KEY).toBe('service-role-key');
    expect(result.missing).toHaveLength(0);
    expect(result.shouldRun).toBe(true);
  });

  it('records blockers when the project reference cannot be derived', async () => {
    process.env.SUPABASE_URL = 'not-a-url';
    process.env.SUPABASE_ANON_KEY = 'anon-key';
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.SUPABASE_ACCESS_TOKEN = 'access-token';

    const result = await resolveSupabaseTestEnv({
      isCiEnvironment: true,
      runDatabaseIntegrationTests: true,
      fetchImpl: vi.fn(),
    });

    expect(result.missing).toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(result.blockers).toContain(
      'Unable to derive Supabase project reference from SUPABASE_URL to hydrate service role key automatically.',
    );
    expect(result.shouldRun).toBe(false);
  });

  it('records blockers when fetch fails to return a service role key', async () => {
    process.env.SUPABASE_URL = 'https://project.supabase.co';
    process.env.SUPABASE_ANON_KEY = 'anon-key';
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.SUPABASE_ACCESS_TOKEN = 'access-token';

    const mockFetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ api_keys: [{ type: 'anon', api_key: 'anon-key' }] }),
    })) as unknown as typeof fetch;

    const result = await resolveSupabaseTestEnv({
      isCiEnvironment: true,
      runDatabaseIntegrationTests: true,
      fetchImpl: mockFetch,
    });

    expect(result.missing).toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(
      result.blockers.some((message) =>
        message.includes('Supabase service role key could not be hydrated automatically'),
      ),
    ).toBe(true);
    expect(result.shouldRun).toBe(false);
  });

  it('parses Supabase project references from URLs', () => {
    expect(parseSupabaseProjectRef('https://example.supabase.co')).toBe('example');
    expect(parseSupabaseProjectRef('invalid')).toBeNull();
  });

  it('omits environment guidance when nothing is missing', () => {
    const guidance = computeEnvironmentGuidance([]);
    expect(guidance).toBeUndefined();
  });

  it('returns environment guidance when variables are missing', () => {
    const guidance = computeEnvironmentGuidance(['SUPABASE_URL']);
    expect(typeof guidance).toBe('string');
    expect(guidance).toContain('SUPABASE_URL');
  });
});
