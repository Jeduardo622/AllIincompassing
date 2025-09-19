import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ensureServerEnv,
  getOptionalServerEnv,
  getRequiredServerEnv,
  resetEnvCacheForTests,
} from '../env';

const ORIGINAL_ENV = { ...process.env } as NodeJS.ProcessEnv;

describe('server/env', () => {
  let tempDir = '';
  let envPath = '';

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV } as NodeJS.ProcessEnv;
    resetEnvCacheForTests();
    tempDir = mkdtempSync(join(tmpdir(), 'env-tests-'));
    envPath = join(tempDir, '.env.codex');
  });

  afterEach(() => {
    resetEnvCacheForTests();
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  afterAll(() => {
    process.env = { ...ORIGINAL_ENV } as NodeJS.ProcessEnv;
  });

  it('loads missing keys from the configured env file', () => {
    writeFileSync(envPath, 'SUPABASE_URL=https://example.supabase.co\n');

    const value = getRequiredServerEnv('SUPABASE_URL', { envPath });

    expect(value).toBe('https://example.supabase.co');
    expect(process.env.SUPABASE_URL).toBe('https://example.supabase.co');
  });

  it('prefers existing process env values over file entries', () => {
    process.env.SUPABASE_URL = 'https://process.supabase.co';
    writeFileSync(envPath, 'SUPABASE_URL=https://file.supabase.co\n');

    const value = getRequiredServerEnv('SUPABASE_URL', { envPath });

    expect(value).toBe('https://process.supabase.co');
    expect(process.env.SUPABASE_URL).toBe('https://process.supabase.co');
  });

  it('throws when a required key is missing from both process env and the file', () => {
    writeFileSync(envPath, 'SUPABASE_ANON_KEY=anon-key\n');

    expect(() => getRequiredServerEnv('SUPABASE_URL', { envPath })).toThrow(/SUPABASE_URL/);
  });

  it('strips inline comments and surrounding quotes', () => {
    writeFileSync(envPath, 'SUPABASE_ANON_KEY="anon-key" # comment\n');

    const value = getRequiredServerEnv('SUPABASE_ANON_KEY', { envPath });

    expect(value).toBe('anon-key');
  });

  it('supports loading multiple keys at once', () => {
    writeFileSync(
      envPath,
      [
        'SUPABASE_URL=https://batched.supabase.co',
        'SUPABASE_ANON_KEY=anon-key',
        'SUPABASE_SERVICE_ROLE_KEY=service-role',
      ].join('\n'),
    );

    ensureServerEnv(
      ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'],
      { envPath },
    );

    expect(process.env.SUPABASE_URL).toBe('https://batched.supabase.co');
    expect(process.env.SUPABASE_ANON_KEY).toBe('anon-key');
    expect(process.env.SUPABASE_SERVICE_ROLE_KEY).toBe('service-role');
  });

  it('returns undefined for optional keys that remain unset', () => {
    writeFileSync(envPath, 'SUPABASE_URL=https://example.supabase.co\n');

    const value = getOptionalServerEnv('OPENAI_API_KEY', { envPath });

    expect(value).toBeUndefined();
  });
});
