import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/logger/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

import { logger } from '../lib/logger/logger';
import {
  DEFAULT_SERVICE_ACCOUNT_PROBE_TIMEOUT_MS,
  resolveServiceAccountProbeConfig,
  runServiceAccountSmokeProbe,
  type ServiceAccountProbeResult,
} from '../lib/smoke/serviceAccountProbe';

const loggerMock = vi.mocked(logger);

describe('week-2 remediation verification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('verifies service account smoke probe succeeds when admin listUsers resolves without error', async () => {
    const listUsers = vi.fn().mockResolvedValue({ data: { users: [] }, error: null });
    const createClient = vi.fn(() => ({
      auth: { admin: { listUsers } },
    }));
    const now = vi.fn().mockReturnValueOnce(1_000).mockReturnValueOnce(1_350);

    const result = await runServiceAccountSmokeProbe(
      { supabaseUrl: 'https://test.supabase.co', serviceRoleKey: 'service-role-key' },
      { createClient, now },
    );

    expect(createClient).toHaveBeenCalledWith('https://test.supabase.co', 'service-role-key', {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    expect(listUsers).toHaveBeenCalledWith({ perPage: 1 });
    expect(result).toEqual<ServiceAccountProbeResult>({ ok: true, durationMs: 350, timedOut: false });

    const infoCalls = loggerMock.info.mock.calls;
    expect(infoCalls[0]?.[0]).toContain('Service account probe starting');
    expect(infoCalls[0]?.[1]).toMatchObject({
      metadata: expect.objectContaining({
        supabaseUrl: 'https://test.supabase.co',
        serviceRoleKey: '****',
      }),
    });
    expect(infoCalls[1]?.[0]).toContain('Service account probe succeeded');
    expect(infoCalls[1]?.[1]).toMatchObject({
      metadata: expect.objectContaining({
        durationMs: 350,
        supabaseUrl: 'https://test.supabase.co',
      }),
    });
  });

  it('reports failure with masked secrets when admin API returns an error payload', async () => {
    const listUsers = vi.fn().mockResolvedValue({ data: null, error: new Error('Access denied: invalid credential 12345') });
    const createClient = vi.fn(() => ({
      auth: { admin: { listUsers } },
    }));
    const now = vi.fn().mockReturnValueOnce(10).mockReturnValueOnce(35);

    const result = await runServiceAccountSmokeProbe(
      { supabaseUrl: 'https://secure.supabase.co', serviceRoleKey: 'another-secret' },
      { createClient, now },
    );

    expect(result.ok).toBe(false);
    expect(result.error).toBeInstanceOf(Error);
    expect(result.durationMs).toBe(25);
    expect(result.timedOut).toBe(false);

    expect(loggerMock.error).toHaveBeenCalledWith(
      expect.stringContaining('Service account probe failed'),
      expect.objectContaining({
        metadata: expect.objectContaining({
          supabaseUrl: 'https://secure.supabase.co',
          serviceRoleKey: '****',
          durationMs: 25,
          timedOut: false,
        }),
      }),
    );
  });

  it('normalizes whitespace in config before executing the probe', async () => {
    const listUsers = vi.fn().mockResolvedValue({ data: null, error: null });
    const createClient = vi.fn(() => ({
      auth: { admin: { listUsers } },
    }));
    const now = vi.fn().mockReturnValueOnce(5).mockReturnValueOnce(10);

    const result = await runServiceAccountSmokeProbe(
      { supabaseUrl: '  https://trim.supabase.co  ', serviceRoleKey: '  spaced-key  ' },
      { createClient, now },
    );

    expect(createClient).toHaveBeenCalledWith('https://trim.supabase.co', 'spaced-key', {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    expect(result.ok).toBe(true);
    expect(loggerMock.info).toHaveBeenCalledWith(
      expect.stringContaining('Service account probe succeeded'),
      expect.objectContaining({
        metadata: expect.objectContaining({ supabaseUrl: 'https://trim.supabase.co' }),
      }),
    );
  });

  it('fails fast and marks timeout when admin API stalls', async () => {
    vi.useFakeTimers();

    const listUsers = vi.fn(() => new Promise(() => undefined));
    const createClient = vi.fn(() => ({
      auth: { admin: { listUsers } },
    }));
    const now = vi.fn().mockReturnValueOnce(5).mockReturnValueOnce(60);

    const probePromise = runServiceAccountSmokeProbe(
      { supabaseUrl: 'https://timeout.supabase.co', serviceRoleKey: 'stalled-key', timeoutMs: 20 },
      { createClient, now },
    );

    await vi.advanceTimersByTimeAsync(25);
    const result = await probePromise;

    expect(result.ok).toBe(false);
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error?.message).toContain('timed out');
    expect(result.timedOut).toBe(true);

    expect(loggerMock.error).toHaveBeenCalledWith(
      expect.stringContaining('Service account probe failed'),
      expect.objectContaining({
        metadata: expect.objectContaining({
          supabaseUrl: 'https://timeout.supabase.co',
          serviceRoleKey: '****',
          timedOut: true,
        }),
      }),
    );
  });

  it('derives service account config from environment variables when available', () => {
    const config = resolveServiceAccountProbeConfig({
      SUPABASE_URL: 'https://env.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'env-key',
    });

    expect(config).toEqual({
      supabaseUrl: 'https://env.supabase.co',
      serviceRoleKey: 'env-key',
      timeoutMs: DEFAULT_SERVICE_ACCOUNT_PROBE_TIMEOUT_MS,
    });
  });

  it('returns null when environment variables are missing', () => {
    expect(
      resolveServiceAccountProbeConfig({
        SUPABASE_URL: 'https://env.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: '',
      }),
    ).toBeNull();

    expect(
      resolveServiceAccountProbeConfig({
        SUPABASE_URL: undefined,
        SUPABASE_SERVICE_ROLE_KEY: 'env-key',
      }),
    ).toBeNull();
  });

  it('trims whitespace around service account environment variables', () => {
    const config = resolveServiceAccountProbeConfig({
      SUPABASE_URL: '  https://trimmed.supabase.co  ',
      SUPABASE_SERVICE_ROLE_KEY: '  env-key  ',
    });

    expect(config).toEqual({
      supabaseUrl: 'https://trimmed.supabase.co',
      serviceRoleKey: 'env-key',
      timeoutMs: DEFAULT_SERVICE_ACCOUNT_PROBE_TIMEOUT_MS,
    });
  });

  it('allows overriding the Supabase URL and timeout when deriving config', () => {
    const config = resolveServiceAccountProbeConfig(
      {
        SUPABASE_URL: '',
        VITE_SUPABASE_URL: undefined,
        SUPABASE_SERVICE_ROLE_KEY: 'env-key',
      },
      { supabaseUrlOverride: 'https://override.supabase.co', timeoutMs: 1234 },
    );

    expect(config).toEqual({
      supabaseUrl: 'https://override.supabase.co',
      serviceRoleKey: 'env-key',
      timeoutMs: 1234,
    });
  });
});
