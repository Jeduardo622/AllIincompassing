/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  assertDedicatedSmokeEmail,
  buildDefaultSmokeAdminEmail,
  getMissingProvisionSecrets,
  resolveCleanupSmokeAdminEmail,
  serializeError,
  shouldSkipForSecretlessPullRequest,
  writeGitHubEnv,
} from '../../scripts/provision-ci-smoke-admin';

describe('provision-ci-smoke-admin safeguards', () => {
  it('accepts only dedicated CI smoke account addresses', () => {
    expect(() => assertDedicatedSmokeEmail('playwright.ci.auth_browser_smoke.123.1@example.com')).not.toThrow();
    expect(() => assertDedicatedSmokeEmail('playwright.ci.iehp-assessment-import-smoke.123.1@example.com')).not.toThrow();
  });

  it('refuses to mutate configured human or shared diagnostic accounts', () => {
    expect(() => assertDedicatedSmokeEmail('superadmin@test.com')).toThrow(
      'Refusing to mutate non-dedicated CI smoke account email.',
    );
    expect(() => assertDedicatedSmokeEmail('admin@example.com')).toThrow(
      'Refusing to mutate non-dedicated CI smoke account email.',
    );
    expect(() => assertDedicatedSmokeEmail('playwright.ci.admin@allincompassing.ai')).toThrow(
      'Refusing to mutate non-dedicated CI smoke account email.',
    );
  });

  it('builds a deterministic dedicated address from GitHub job identity', () => {
    const originalRunId = process.env.GITHUB_RUN_ID;
    const originalRunAttempt = process.env.GITHUB_RUN_ATTEMPT;
    const originalJob = process.env.GITHUB_JOB;
    process.env.GITHUB_RUN_ID = '28720453572';
    process.env.GITHUB_RUN_ATTEMPT = '2';
    process.env.GITHUB_JOB = 'iehp_assessment_import_smoke';

    try {
      expect(buildDefaultSmokeAdminEmail()).toBe(
        'playwright.ci.iehp_assessment_import_smoke.28720453572.2@example.com',
      );
    } finally {
      if (originalRunId === undefined) {
        delete process.env.GITHUB_RUN_ID;
      } else {
        process.env.GITHUB_RUN_ID = originalRunId;
      }
      if (originalRunAttempt === undefined) {
        delete process.env.GITHUB_RUN_ATTEMPT;
      } else {
        process.env.GITHUB_RUN_ATTEMPT = originalRunAttempt;
      }
      if (originalJob === undefined) {
        delete process.env.GITHUB_JOB;
      } else {
        process.env.GITHUB_JOB = originalJob;
      }
    }
  });

  it('uses the deterministic smoke address for cleanup when env export did not happen', () => {
    const originalCiEmail = process.env.CI_SMOKE_ADMIN_EMAIL;
    const originalSuperEmail = process.env.PW_SUPERADMIN_EMAIL;
    const originalRunId = process.env.GITHUB_RUN_ID;
    const originalRunAttempt = process.env.GITHUB_RUN_ATTEMPT;
    const originalJob = process.env.GITHUB_JOB;
    delete process.env.CI_SMOKE_ADMIN_EMAIL;
    delete process.env.PW_SUPERADMIN_EMAIL;
    process.env.GITHUB_RUN_ID = '28720453572';
    process.env.GITHUB_RUN_ATTEMPT = '3';
    process.env.GITHUB_JOB = 'auth_browser_smoke';

    try {
      expect(resolveCleanupSmokeAdminEmail()).toBe('playwright.ci.auth_browser_smoke.28720453572.3@example.com');
    } finally {
      if (originalCiEmail === undefined) {
        delete process.env.CI_SMOKE_ADMIN_EMAIL;
      } else {
        process.env.CI_SMOKE_ADMIN_EMAIL = originalCiEmail;
      }
      if (originalSuperEmail === undefined) {
        delete process.env.PW_SUPERADMIN_EMAIL;
      } else {
        process.env.PW_SUPERADMIN_EMAIL = originalSuperEmail;
      }
      if (originalRunId === undefined) {
        delete process.env.GITHUB_RUN_ID;
      } else {
        process.env.GITHUB_RUN_ID = originalRunId;
      }
      if (originalRunAttempt === undefined) {
        delete process.env.GITHUB_RUN_ATTEMPT;
      } else {
        process.env.GITHUB_RUN_ATTEMPT = originalRunAttempt;
      }
      if (originalJob === undefined) {
        delete process.env.GITHUB_JOB;
      } else {
        process.env.GITHUB_JOB = originalJob;
      }
    }
  });

  it('masks the generated password before exporting it to GitHub env', () => {
    const originalGitHubEnv = process.env.GITHUB_ENV;
    const tmp = mkdtempSync(path.join(tmpdir(), 'smoke-admin-env-'));
    const envPath = path.join(tmp, 'github-env');
    process.env.GITHUB_ENV = envPath;
    const writes: string[] = [];
    const originalWrite = process.stdout.write;
    process.stdout.write = ((chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;

    try {
      writeGitHubEnv('playwright.ci.auth.1.1@example.com', 'C1-generated-secret!Aa');
      expect(writes.join('')).toContain('::add-mask::C1-generated-secret!Aa');
      expect(readFileSync(envPath, 'utf8')).toContain('PW_SUPERADMIN_EMAIL=playwright.ci.auth.1.1@example.com');
      expect(readFileSync(envPath, 'utf8')).toContain('PW_SUPERADMIN_PASSWORD=C1-generated-secret!Aa');
    } finally {
      process.stdout.write = originalWrite;
      if (originalGitHubEnv === undefined) {
        delete process.env.GITHUB_ENV;
      } else {
        process.env.GITHUB_ENV = originalGitHubEnv;
      }
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('keeps service-role credentials out of the auth login smoke step', () => {
    const workflow = readFileSync(path.join(process.cwd(), '.github/workflows/ci.yml'), 'utf8');
    const packageJson = JSON.parse(readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    const authStep = workflow.slice(
      workflow.indexOf('- name: Auth browser smoke gate'),
      workflow.indexOf('- name: Session browser smoke gate'),
    );
    const sessionStep = workflow.slice(
      workflow.indexOf('- name: Session browser smoke gate'),
      workflow.indexOf('- name: Cleanup auth smoke admin'),
    );

    expect(authStep).toContain('npm run playwright:auth');
    expect(authStep).not.toContain('npm run playwright:preflight');
    expect(authStep).not.toContain('SUPABASE_SECRET_KEY');
    expect(authStep).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(sessionStep).toContain('npm run ci:playwright:session-smoke');
    expect(packageJson.scripts?.['ci:playwright:session-smoke']).toContain('playwright:preflight');
    expect(sessionStep).toContain('SUPABASE_SERVICE_ROLE_KEY');
  });

  it('preserves the secretless pull_request skip path for provisioning and cleanup', () => {
    const pullRequestEnv = {
      GITHUB_EVENT_NAME: 'pull_request',
      SUPABASE_URL: '',
      SUPABASE_SERVICE_ROLE_KEY: '',
    } as NodeJS.ProcessEnv;
    const pushEnv = {
      GITHUB_EVENT_NAME: 'push',
      SUPABASE_URL: '',
      SUPABASE_SERVICE_ROLE_KEY: '',
    } as NodeJS.ProcessEnv;

    expect(getMissingProvisionSecrets(pullRequestEnv)).toEqual(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']);
    expect(shouldSkipForSecretlessPullRequest(pullRequestEnv)).toBe(true);
    expect(shouldSkipForSecretlessPullRequest(pushEnv)).toBe(false);
  });

  it('serializes Supabase error objects for CI diagnostics', () => {
    expect(serializeError({ code: '23505', message: 'duplicate key value violates unique constraint' })).toBe(
      '{"code":"23505","message":"duplicate key value violates unique constraint"}',
    );
  });

  it('does not write hosted generated profile columns', () => {
    const script = readFileSync(path.join(process.cwd(), 'scripts/provision-ci-smoke-admin.ts'), 'utf8');
    const profilePayload = script.slice(
      script.indexOf("const { error: profileError } = await client.from('profiles').upsert("),
      script.indexOf("const { error: userRoleError } = await client.from('user_roles').upsert("),
    );

    expect(profilePayload).not.toContain('full_name');
  });
});
