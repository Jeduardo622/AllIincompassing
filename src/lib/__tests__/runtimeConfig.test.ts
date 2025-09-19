import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ensureRuntimeSupabaseConfig,
  getRuntimeSupabaseConfig,
  resetRuntimeSupabaseConfigForTests,
  setRuntimeSupabaseConfig,
} from '../runtimeConfig';

const mockConfig = {
  supabaseUrl: 'https://project.supabase.co',
  supabaseAnonKey: 'anon-key',
};

describe('runtimeConfig', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    resetRuntimeSupabaseConfigForTests();
  });

  afterEach(() => {
    resetRuntimeSupabaseConfigForTests();
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('returns config once set manually', () => {
    setRuntimeSupabaseConfig(mockConfig);
    expect(getRuntimeSupabaseConfig()).toMatchObject(mockConfig);
  });

  it('fetches config when not initialised', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockConfig),
    } satisfies Partial<Response>);

    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const config = await ensureRuntimeSupabaseConfig();
    expect(config).toMatchObject(mockConfig);
    expect(getRuntimeSupabaseConfig()).toMatchObject(mockConfig);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('fails fast when runtime endpoint returns an error', async () => {
    const failureResponse = {
      ok: false,
      statusText: 'Not Found',
      json: () => Promise.resolve({ error: 'Not configured' }),
    } satisfies Partial<Response>;

    globalThis.fetch = vi.fn().mockResolvedValue(failureResponse) as unknown as typeof fetch;

    await expect(ensureRuntimeSupabaseConfig()).rejects.toThrow(/Failed to load Supabase runtime config/i);
    await expect(async () => getRuntimeSupabaseConfig()).rejects.toThrow(/has not been initialised/i);
  });
});

