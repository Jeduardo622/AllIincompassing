import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runtimeConfigHandler } from '../api/runtime-config';
import { resetEnvCacheForTests } from '../env';
import { RUNTIME_CONFIG_FALLBACK_ORGANIZATION_ID } from '../runtimeConfig';

const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('../../lib/logger/logger', () => ({
  logger: loggerMock,
}));

const originalEnv = { ...process.env };

describe('runtimeConfigHandler', () => {
  beforeEach(() => {
    process.env = { ...originalEnv } as NodeJS.ProcessEnv;
    resetEnvCacheForTests();
    loggerMock.info.mockReset();
    loggerMock.warn.mockReset();
    loggerMock.error.mockReset();
    loggerMock.debug.mockReset();
  });

  afterAll(() => {
    process.env = { ...originalEnv } as NodeJS.ProcessEnv;
  });

  it('returns runtime config when env vars are present', async () => {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_ANON_KEY = 'anon-key';
    process.env.DEFAULT_ORGANIZATION_ID = '5238e88b-6198-4862-80a2-dbe15bbeabdd';

    const response = await runtimeConfigHandler(new Request('http://localhost/api/runtime-config'));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.supabaseUrl).toBe('https://example.supabase.co');
    expect(payload.supabaseAnonKey).toBe('anon-key');
    expect(payload.defaultOrganizationId).toBe('5238e88b-6198-4862-80a2-dbe15bbeabdd');
  });

  it('falls back to baked-in org id when DEFAULT_ORGANIZATION_ID is missing', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'runtime-config-fallback-'));
    const envPath = join(tempDir, '.env.codex');
    writeFileSync(envPath, ['SUPABASE_URL=https://example.supabase.co', 'SUPABASE_ANON_KEY=anon-key'].join('\n'));

    delete process.env.DEFAULT_ORGANIZATION_ID;
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_ANON_KEY = 'anon-key';
    process.env.CODEX_ENV_PATH = envPath;
    resetEnvCacheForTests();

    try {
      const response = await runtimeConfigHandler(new Request('http://localhost/api/runtime-config'));
      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload.defaultOrganizationId).toBe(RUNTIME_CONFIG_FALLBACK_ORGANIZATION_ID);
      expect(loggerMock.warn).toHaveBeenCalledWith(
        'DEFAULT_ORGANIZATION_ID missing; falling back to baked-in runtime config default',
        expect.objectContaining({
          fallbackOrganizationId: RUNTIME_CONFIG_FALLBACK_ORGANIZATION_ID,
        }),
      );
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
      delete process.env.CODEX_ENV_PATH;
    }
  });

  it('loads config values from .env.codex when process env is unset', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'runtime-config-tests-'));
    const envPath = join(tempDir, '.env.codex');
    writeFileSync(envPath, [
      'SUPABASE_URL=https://file.supabase.co',
      'SUPABASE_ANON_KEY=file-anon',
      'DEFAULT_ORGANIZATION_ID=org-default-file',
    ].join('\n'));

    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_ANON_KEY;
    delete process.env.DEFAULT_ORGANIZATION_ID;
    process.env.CODEX_ENV_PATH = envPath;
    resetEnvCacheForTests();

    try {
      const response = await runtimeConfigHandler(new Request('http://localhost/api/runtime-config'));
      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload.supabaseUrl).toBe('https://file.supabase.co');
      expect(payload.supabaseAnonKey).toBe('file-anon');
      expect(payload.defaultOrganizationId).toBe('org-default-file');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
      delete process.env.CODEX_ENV_PATH;
    }
  });

  it('fails with 500 when env vars are missing', async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_ANON_KEY;

    const response = await runtimeConfigHandler(new Request('http://localhost/api/runtime-config'));
    expect(response.status).toBe(500);
    const payload = await response.json();
    expect(payload.error).toMatch(/Missing required environment variable SUPABASE_URL/);
  });

  it('rejects unsupported methods', async () => {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_ANON_KEY = 'anon-key';
    process.env.DEFAULT_ORGANIZATION_ID = '5238e88b-6198-4862-80a2-dbe15bbeabdd';

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

