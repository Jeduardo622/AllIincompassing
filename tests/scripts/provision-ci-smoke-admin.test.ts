/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  assertDedicatedSmokeEmail,
  assertSmokeAdminOwnership,
  buildSmokeAdminOwnershipMetadata,
  buildSmokeAdminCleanupSteps,
  buildDefaultSmokeAdminEmail,
  cleanupSmokeAdminRows,
  discoverSmokeAdminCleanupTargets,
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

  it('removes only synthetic actor-owned session artifacts before identity mappings', () => {
    const userId = 'd4c6b27f-f11c-42c9-b8ff-58b906f3f395';
    const sessionIds = ['63a0e4ae-0b24-4e8b-8c22-ea6c79ad7fe0'];
    const noteIds = ['c9e1fbca-220a-4c66-ab63-eecff7a31f6e'];

    expect(buildSmokeAdminCleanupSteps(userId, { sessionIds, noteIds })).toEqual([
      {
        table: 'bt_session_note_amendments',
        filter: { kind: 'in', column: 'original_bt_note_id', values: noteIds },
      },
      {
        table: 'goal_target_phase_evaluations',
        filter: { kind: 'in', column: 'note_id', values: noteIds },
      },
      {
        table: 'goal_target_transitions',
        filter: { kind: 'in', column: 'note_id', values: noteIds },
      },
      {
        table: 'goal_target_phase_evaluations',
        filter: { kind: 'in', column: 'session_id', values: sessionIds },
      },
      {
        table: 'goal_target_transitions',
        filter: { kind: 'in', column: 'session_id', values: sessionIds },
      },
      {
        table: 'client_session_notes',
        filter: { kind: 'in', column: 'id', values: noteIds },
      },
      {
        table: 'session_goals',
        filter: { kind: 'in', column: 'session_id', values: sessionIds },
      },
      {
        table: 'sessions',
        filter: { kind: 'in', column: 'id', values: sessionIds },
      },
      {
        table: 'user_roles',
        filter: { kind: 'eq', column: 'user_id', value: userId },
      },
      {
        table: 'profiles',
        filter: { kind: 'eq', column: 'id', value: userId },
      },
    ]);
    expect(JSON.stringify(buildSmokeAdminCleanupSteps(userId, { sessionIds, noteIds }))).not.toContain('updated_by');
  });

  it('discovers exact actor-created session and note ids without treating updates as ownership', async () => {
    const calls: string[] = [];
    const userId = 'd4c6b27f-f11c-42c9-b8ff-58b906f3f395';
    const client = {
      from: (table: string) => ({
        select: (columns: string) => ({
          eq: async (column: string, value: string) => {
            calls.push(`${table}:select:${columns}:eq:${column}:${value}`);
            return table === 'sessions'
              ? { data: [{ id: '63a0e4ae-0b24-4e8b-8c22-ea6c79ad7fe0' }], error: null }
              : { data: [{ id: 'c9e1fbca-220a-4c66-ab63-eecff7a31f6e' }], error: null };
          },
        }),
      }),
    };

    await expect(discoverSmokeAdminCleanupTargets(client as never, userId)).resolves.toEqual({
      sessionIds: ['63a0e4ae-0b24-4e8b-8c22-ea6c79ad7fe0'],
      noteIds: ['c9e1fbca-220a-4c66-ab63-eecff7a31f6e'],
    });
    expect(calls).toEqual([
      `sessions:select:id:eq:created_by:${userId}`,
      `client_session_notes:select:id:eq:created_by:${userId}`,
    ]);
  });

  it('binds cleanup authority to the exact run-owned auth user', () => {
    const email = 'playwright.ci.auth_browser_smoke.31142226959.2@example.com';
    const metadata = buildSmokeAdminOwnershipMetadata(email, {
      GITHUB_RUN_ID: '31142226959',
      GITHUB_RUN_ATTEMPT: '2',
      GITHUB_JOB: 'auth_browser_smoke',
    });

    expect(metadata).toEqual({
      smoke_actor: 'ci_super_admin',
      smoke_email: email,
      smoke_run_id: '31142226959',
      smoke_run_attempt: '2',
      smoke_job: 'auth_browser_smoke',
    });
    expect(() => assertSmokeAdminOwnership({ email, app_metadata: metadata }, email)).not.toThrow();
    expect(() => assertSmokeAdminOwnership({ email, app_metadata: {} }, email)).toThrow(
      'Refusing to delete an auth user without matching CI smoke ownership metadata.',
    );
    expect(() => assertSmokeAdminOwnership({ email: 'other@example.com', app_metadata: metadata }, email)).toThrow(
      'Refusing to delete an auth user whose email does not match the cleanup target.',
    );
  });

  it('executes and verifies every cleanup step in fail-closed order', async () => {
    const calls: string[] = [];
    const query = (mode: 'delete' | 'verify', table: string) => ({
      eq: async (column: string, value: string) => {
        calls.push(`${mode}:${table}:eq:${column}:${value}`);
        return mode === 'delete' ? { error: null } : { error: null, count: 0 };
      },
      in: async (column: string, values: string[]) => {
        calls.push(`${mode}:${table}:in:${column}:${values.join(',')}`);
        return mode === 'delete' ? { error: null } : { error: null, count: 0 };
      },
    });
    const client = {
      from: (table: string) => ({
        delete: () => query('delete', table),
        select: () => query('verify', table),
      }),
    };
    const userId = 'd4c6b27f-f11c-42c9-b8ff-58b906f3f395';
    const sessionId = '63a0e4ae-0b24-4e8b-8c22-ea6c79ad7fe0';
    const noteId = 'c9e1fbca-220a-4c66-ab63-eecff7a31f6e';

    await cleanupSmokeAdminRows(client as never, userId, { sessionIds: [sessionId], noteIds: [noteId] });

    expect(calls).toEqual([
      `verify:bt_session_note_amendments:in:original_bt_note_id:${noteId}`,
      `delete:goal_target_phase_evaluations:in:note_id:${noteId}`,
      `verify:goal_target_phase_evaluations:in:note_id:${noteId}`,
      `delete:goal_target_transitions:in:note_id:${noteId}`,
      `verify:goal_target_transitions:in:note_id:${noteId}`,
      `delete:goal_target_phase_evaluations:in:session_id:${sessionId}`,
      `verify:goal_target_phase_evaluations:in:session_id:${sessionId}`,
      `delete:goal_target_transitions:in:session_id:${sessionId}`,
      `verify:goal_target_transitions:in:session_id:${sessionId}`,
      `delete:client_session_notes:in:id:${noteId}`,
      `verify:client_session_notes:in:id:${noteId}`,
      `delete:session_goals:in:session_id:${sessionId}`,
      `verify:session_goals:in:session_id:${sessionId}`,
      `delete:sessions:in:id:${sessionId}`,
      `verify:sessions:in:id:${sessionId}`,
      `delete:user_roles:eq:user_id:${userId}`,
      `verify:user_roles:eq:user_id:${userId}`,
      `delete:profiles:eq:id:${userId}`,
      `verify:profiles:eq:id:${userId}`,
    ]);
  });

  it('stops before identity deletion when synthetic artifact cleanup fails', async () => {
    const tables: string[] = [];
    const client = {
      from: (table: string) => {
        tables.push(table);
        return {
          delete: () => ({
            eq: async () => ({ error: { code: '23503', message: 'still referenced' } }),
            in: async () => ({ error: { code: '23503', message: 'still referenced' } }),
          }),
          select: () => ({
            eq: async () => ({ error: null, count: 0 }),
            in: async () => ({ error: null, count: 0 }),
          }),
        };
      },
    };

    await expect(
      cleanupSmokeAdminRows(
        client as never,
        'd4c6b27f-f11c-42c9-b8ff-58b906f3f395',
        {
          sessionIds: ['63a0e4ae-0b24-4e8b-8c22-ea6c79ad7fe0'],
          noteIds: ['c9e1fbca-220a-4c66-ab63-eecff7a31f6e'],
        },
      ),
    ).rejects.toThrow('goal_target_phase_evaluations cleanup failed');
    expect(tables).toEqual(['bt_session_note_amendments', 'goal_target_phase_evaluations']);
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
      writeGitHubEnv(
        'playwright.ci.auth.1.1@example.com',
        'C1-generated-secret!Aa',
        'd4c6b27f-f11c-42c9-b8ff-58b906f3f395',
      );
      expect(writes.join('')).toContain('::add-mask::C1-generated-secret!Aa');
      expect(readFileSync(envPath, 'utf8')).toContain('PW_SUPERADMIN_EMAIL=playwright.ci.auth.1.1@example.com');
      expect(readFileSync(envPath, 'utf8')).toContain('PW_SUPERADMIN_PASSWORD=C1-generated-secret!Aa');
      expect(readFileSync(envPath, 'utf8')).toContain(
        'PW_SUPERADMIN_USER_ID=d4c6b27f-f11c-42c9-b8ff-58b906f3f395',
      );
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
