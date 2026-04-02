import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildSupabaseEdgeUrl,
  ensureRuntimeSupabaseConfig,
  getRuntimeSupabaseConfig,
  resetRuntimeSupabaseConfigForTests,
  setRuntimeSupabaseConfig,
} from '../runtimeConfig';

const mockConfig = {
  supabaseUrl: 'https://project.supabase.co',
  supabaseAnonKey: 'anon-key',
  defaultOrganizationId: '5238e88b-6198-4862-80a2-dbe15bbeabdd',
};

describe('runtimeConfig', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    resetRuntimeSupabaseConfigForTests();
    vi.useRealTimers();
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

  it('builds edge URLs correctly when supabaseEdgeUrl omits trailing slash', () => {
    setRuntimeSupabaseConfig({
      ...mockConfig,
      supabaseEdgeUrl: 'https://project.supabase.co/functions/v1',
    });

    expect(buildSupabaseEdgeUrl('programs?client_id=client-1')).toBe(
      'https://project.supabase.co/functions/v1/programs?client_id=client-1',
    );
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

  it('retries transient runtime endpoint failures before succeeding', async () => {
    vi.useFakeTimers();
    const fetchSpy = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('temporary network failure'))
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockConfig),
      } satisfies Partial<Response>);

    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const configPromise = ensureRuntimeSupabaseConfig();
    await vi.runAllTimersAsync();

    await expect(configPromise).resolves.toMatchObject(mockConfig);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(getRuntimeSupabaseConfig()).toMatchObject(mockConfig);
  });

  it('retries retryable runtime endpoint errors three times before failing', async () => {
    vi.useFakeTimers();
    const failureResponse = {
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      json: () => Promise.resolve({ error: 'Temporary outage' }),
    } satisfies Partial<Response>;

    const fetchSpy = vi.fn().mockResolvedValue(failureResponse);
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const configPromise = ensureRuntimeSupabaseConfig();
    const rejectionExpectation = expect(configPromise).rejects.toThrow(
      'Failed to load Supabase runtime config: Temporary outage',
    );
    await vi.runAllTimersAsync();

    await rejectionExpectation;
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    await expect(async () => getRuntimeSupabaseConfig()).rejects.toThrow(/has not been initialised/i);
  });

  it('does not retry non-retryable runtime endpoint errors', async () => {
    const failureResponse = {
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: () => Promise.resolve({ error: 'Not configured' }),
    } satisfies Partial<Response>;

    const fetchSpy = vi.fn().mockResolvedValue(failureResponse);
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    await expect(ensureRuntimeSupabaseConfig()).rejects.toThrow('Failed to load Supabase runtime config: Not configured');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    await expect(async () => getRuntimeSupabaseConfig()).rejects.toThrow(/has not been initialised/i);
  });

  it('does not retry placeholder runtime config values from API', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          ...mockConfig,
          supabaseAnonKey: '****',
        }),
    } satisfies Partial<Response>);
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    await expect(ensureRuntimeSupabaseConfig()).rejects.toThrow(/placeholder/i);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    await expect(async () => getRuntimeSupabaseConfig()).rejects.toThrow(/has not been initialised/i);
  });

  it('shares a single retry loop across concurrent callers', async () => {
    vi.useFakeTimers();
    const fetchSpy = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('temporary network failure'))
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockConfig),
      } satisfies Partial<Response>);

    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const firstCall = ensureRuntimeSupabaseConfig();
    const secondCall = ensureRuntimeSupabaseConfig();

    await vi.runAllTimersAsync();

    await expect(Promise.all([firstCall, secondCall])).resolves.toEqual([mockConfig, mockConfig]);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(getRuntimeSupabaseConfig()).toMatchObject(mockConfig);
  });
});

