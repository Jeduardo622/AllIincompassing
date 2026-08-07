// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  assertNonAiSessionsEnvContract,
  resolveNonAiSessionCredentialCandidates,
} from '../../scripts/lib/playwright-nonai-sessions-contract';
import { resolveLifecycleCredentialCandidates } from '../../scripts/playwright-session-lifecycle';

const CONTRACT_ENV_KEYS = [
  'PW_BASE_URL',
  'PW_SUPERADMIN_EMAIL',
  'PW_SUPERADMIN_PASSWORD',
  'PW_SCHEDULE_EMAIL',
  'PW_SCHEDULE_PASSWORD',
  'PW_ADMIN_EMAIL',
  'PW_ADMIN_PASSWORD',
  'PLAYWRIGHT_ADMIN_EMAIL',
  'PLAYWRIGHT_ADMIN_PASSWORD',
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
] as const;

const originalEnv = new Map<string, string | undefined>();

beforeEach(() => {
  for (const key of CONTRACT_ENV_KEYS) {
    originalEnv.set(key, process.env[key]);
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of CONTRACT_ENV_KEYS) {
    const value = originalEnv.get(key);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  originalEnv.clear();
});

describe('non-AI sessions Playwright credential contract', () => {
  it('keeps schedule and admin ahead of the provisioned superadmin fallback', () => {
    process.env.PW_SUPERADMIN_EMAIL = 'provisioned@example.test';
    process.env.PW_SUPERADMIN_PASSWORD = 'super-secret';
    process.env.PW_SCHEDULE_EMAIL = 'schedule@example.test';
    process.env.PW_SCHEDULE_PASSWORD = 'schedule-secret';
    process.env.PW_ADMIN_EMAIL = 'admin@example.test';
    process.env.PW_ADMIN_PASSWORD = 'admin-secret';

    expect(resolveNonAiSessionCredentialCandidates()).toEqual([
      {
        email: 'schedule@example.test',
        password: 'schedule-secret',
        label: 'PW_SCHEDULE_EMAIL + PW_SCHEDULE_PASSWORD',
      },
      {
        email: 'admin@example.test',
        password: 'admin-secret',
        label: 'PW_ADMIN_EMAIL + PW_ADMIN_PASSWORD',
      },
      {
        email: 'provisioned@example.test',
        password: 'super-secret',
        label: 'PW_SUPERADMIN_EMAIL + PW_SUPERADMIN_PASSWORD',
      },
    ]);
  });

  it('names every accepted credential family when none is configured', () => {
    process.env.PW_BASE_URL = 'https://preview.example.test';
    process.env.VITE_SUPABASE_URL = 'https://supabase.example.test';
    process.env.VITE_SUPABASE_ANON_KEY = 'synthetic-anon-key';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'synthetic-service-role';

    expect(() => assertNonAiSessionsEnvContract('Synthetic browser flow'))
      .toThrow(/PW_SUPERADMIN_EMAIL\/PW_SUPERADMIN_PASSWORD/);
  });

  it('fails closed on a partial provisioned superadmin pair instead of using a fallback', () => {
    process.env.PW_BASE_URL = 'https://preview.example.test';
    process.env.VITE_SUPABASE_URL = 'https://supabase.example.test';
    process.env.VITE_SUPABASE_ANON_KEY = 'synthetic-anon-key';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'synthetic-service-role';
    process.env.PW_SUPERADMIN_EMAIL = 'provisioned@example.test';
    process.env.PW_SCHEDULE_EMAIL = 'schedule@example.test';
    process.env.PW_SCHEDULE_PASSWORD = 'schedule-secret';

    expect(() => assertNonAiSessionsEnvContract('Synthetic browser flow'))
      .toThrow(/PW_SUPERADMIN_PASSWORD is missing/);
  });

  it('uses the canonical resolver order for lifecycle credential attempts', () => {
    process.env.PW_BASE_URL = 'https://preview.example.test';
    process.env.VITE_SUPABASE_URL = 'https://supabase.example.test';
    process.env.VITE_SUPABASE_ANON_KEY = 'synthetic-anon-key';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'synthetic-service-role';
    process.env.PW_SUPERADMIN_EMAIL = 'provisioned@example.test';
    process.env.PW_SUPERADMIN_PASSWORD = 'super-secret';
    process.env.PW_SCHEDULE_EMAIL = 'schedule@example.test';
    process.env.PW_SCHEDULE_PASSWORD = 'schedule-secret';
    process.env.PW_ADMIN_EMAIL = 'admin@example.test';
    process.env.PW_ADMIN_PASSWORD = 'admin-secret';

    expect(resolveLifecycleCredentialCandidates().map(({ label }) => label)).toEqual([
      'PW_ADMIN_EMAIL + PW_ADMIN_PASSWORD',
      'PW_SUPERADMIN_EMAIL + PW_SUPERADMIN_PASSWORD',
      'PW_SCHEDULE_EMAIL + PW_SCHEDULE_PASSWORD',
    ]);
  });
});
