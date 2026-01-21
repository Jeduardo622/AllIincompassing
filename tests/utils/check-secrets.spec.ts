import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkSecretsAndReport, collectMissingEnvVars, formatMissingMessage, REQUIRED_ENV_GROUPS } from '../../scripts/check-secrets';

describe('check-secrets script', () => {
  const allKeys = REQUIRED_ENV_GROUPS.flatMap((group) => group.keys);
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.CI_REQUIRED_SECRET_GROUPS;
    process.env.CI = 'false';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('identifies when all secrets are present', () => {
    const env: NodeJS.ProcessEnv = Object.fromEntries(
      allKeys.map((key) => [key, 'value']),
    );

    const missing = collectMissingEnvVars(env);

    expect(missing).toEqual([]);
    expect(formatMissingMessage(missing)).toContain('All required secrets');
  });

  it('lists missing secrets and exits with failure code', () => {
    process.env.REQUIRE_EXTENDED_SECRETS = '1';
    const env: NodeJS.ProcessEnv = { ...Object.fromEntries(allKeys.map((key) => [key, 'value'])) };
    delete env.SUPABASE_URL;
    env.OPENAI_API_KEY = '   ';

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { missing, exitCode } = checkSecretsAndReport(env);

    expect(exitCode).toBe(1);
    expect(missing).toContain('SUPABASE_URL');
    expect(missing).toContain('OPENAI_API_KEY');
    expect(formatMissingMessage(missing)).toMatch(/Missing required secrets/);

    consoleError.mockRestore();
  });

  it('allows missing service role when access token can hydrate', () => {
    const env: NodeJS.ProcessEnv = { ...Object.fromEntries(allKeys.map((key) => [key, 'value'])) };
    env.SUPABASE_URL = 'https://example.supabase.co';
    env.SUPABASE_ACCESS_TOKEN = 'access-token';
    delete env.SUPABASE_SERVICE_ROLE_KEY;

    const missing = collectMissingEnvVars(env);

    expect(missing).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
  });
});
