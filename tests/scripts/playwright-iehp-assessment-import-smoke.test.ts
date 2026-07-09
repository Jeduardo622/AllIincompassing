/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { selectConfiguredSmokeClient } from '../../scripts/playwright-iehp-assessment-import-smoke';

const sliceWorkflowJob = (workflow: string, jobName: string): string => {
  const start = workflow.indexOf(`  ${jobName}:`);
  expect(start).toBeGreaterThanOrEqual(0);

  const afterJobName = start + `  ${jobName}:`.length;
  const rest = workflow.slice(afterJobName);
  const nextJob = rest.search(/\n  [A-Za-z0-9_]+:\r?\n/);

  return nextJob === -1 ? workflow.slice(start) : workflow.slice(start, afterJobName + nextJob);
};

describe('selectConfiguredSmokeClient', () => {
  it('falls back to the next configured credential when the first seed password drifted', async () => {
    const signInWithPassword = vi
      .fn()
      .mockResolvedValueOnce({
        data: { session: null, user: null },
        error: { code: 'invalid_credentials', status: 400 },
      })
      .mockResolvedValueOnce({
        data: {
          session: { access_token: 'admin-token' },
          user: { id: 'admin-user' },
        },
        error: null,
      });
    const maybeSingle = vi.fn().mockResolvedValue({ data: { id: 'client-123' }, error: null });
    const anonClient = {
      auth: { signInWithPassword },
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({ maybeSingle })),
        })),
      })),
    };
    const clientFactory = vi.fn(() => anonClient);

    const result = await selectConfiguredSmokeClient(
      'https://example.supabase.co',
      'anon-key',
      [
        {
          email: 'superadmin@test.com',
          password: 'drifted-secret',
          label: 'PW_SUPERADMIN_EMAIL + PW_SUPERADMIN_PASSWORD',
        },
        {
          email: 'admin@test.com',
          password: 'valid-secret',
          label: 'PW_ADMIN_EMAIL + PW_ADMIN_PASSWORD',
        },
      ],
      {
        clientFactory: clientFactory as never,
        env: {
          PW_ASSESSMENT_CLIENT_ID: 'client-123',
        } as NodeJS.ProcessEnv,
      },
    );

    expect(result).toEqual({
      accessToken: 'admin-token',
      clientId: 'client-123',
      credentials: {
        email: 'admin@test.com',
        password: 'valid-secret',
        label: 'PW_ADMIN_EMAIL + PW_ADMIN_PASSWORD',
      },
    });
    expect(signInWithPassword).toHaveBeenNthCalledWith(1, {
      email: 'superadmin@test.com',
      password: 'drifted-secret',
    });
    expect(signInWithPassword).toHaveBeenNthCalledWith(2, {
      email: 'admin@test.com',
      password: 'valid-secret',
    });
  });

  it('does not try the next credential for generic auth 400 errors', async () => {
    const signInWithPassword = vi.fn().mockResolvedValue({
      data: { session: null, user: null },
      error: { code: 'bad_request', status: 400 },
    });
    const anonClient = {
      auth: { signInWithPassword },
      from: vi.fn(),
    };
    const clientFactory = vi.fn(() => anonClient);

    await expect(
      selectConfiguredSmokeClient(
        'https://example.supabase.co',
        'anon-key',
        [
          {
            email: 'superadmin@test.com',
            password: 'bad-request-secret',
            label: 'PW_SUPERADMIN_EMAIL + PW_SUPERADMIN_PASSWORD',
          },
          {
            email: 'admin@test.com',
            password: 'valid-secret',
            label: 'PW_ADMIN_EMAIL + PW_ADMIN_PASSWORD',
          },
        ],
        {
          clientFactory: clientFactory as never,
          env: {
            PW_ASSESSMENT_CLIENT_ID: 'client-123',
          } as NodeJS.ProcessEnv,
        },
      ),
    ).rejects.toMatchObject({ code: 'bad_request' });

    expect(signInWithPassword).toHaveBeenCalledTimes(1);
    expect(anonClient.from).not.toHaveBeenCalled();
  });

  it('fails immediately when an authenticated credential cannot access the configured client', async () => {
    const signInWithPassword = vi.fn().mockResolvedValue({
      data: {
        session: { access_token: 'super-admin-token' },
        user: { id: 'super-admin-user' },
      },
      error: null,
    });
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const anonClient = {
      auth: { signInWithPassword },
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({ maybeSingle })),
        })),
      })),
    };
    const clientFactory = vi.fn(() => anonClient);

    await expect(
      selectConfiguredSmokeClient(
        'https://example.supabase.co',
        'anon-key',
        [
          {
            email: 'superadmin@test.com',
            password: 'valid-but-wrong-client',
            label: 'PW_SUPERADMIN_EMAIL + PW_SUPERADMIN_PASSWORD',
          },
          {
            email: 'admin@test.com',
            password: 'valid-secret',
            label: 'PW_ADMIN_EMAIL + PW_ADMIN_PASSWORD',
          },
        ],
        {
          clientFactory: clientFactory as never,
          env: {
            PW_ASSESSMENT_CLIENT_ID: 'client-123',
          } as NodeJS.ProcessEnv,
        },
      ),
    ).rejects.toThrow(
      'Configured PW_ASSESSMENT_CLIENT_ID is not accessible for authenticated credential: PW_SUPERADMIN_EMAIL + PW_SUPERADMIN_PASSWORD.',
    );

    expect(signInWithPassword).toHaveBeenCalledTimes(1);
  });

  it('keeps the CI IEHP smoke path dedicated to the generated super-admin account', () => {
    const root = process.cwd();
    const workflow = readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8');
    const script = readFileSync(path.join(root, 'scripts/playwright-iehp-assessment-import-smoke.ts'), 'utf8');
    const iehpJob = sliceWorkflowJob(workflow, 'iehp_assessment_import_smoke');
    const candidateBlock = script.slice(
      script.indexOf('const credentialCandidates = ['),
      script.indexOf('preflightCredentials(credentialCandidates);'),
    );

    expect(iehpJob).toContain('PW_SUPERADMIN_EMAIL');
    expect(iehpJob).toContain('PW_SUPERADMIN_PASSWORD');
    expect(iehpJob).not.toMatch(/^\s+PW_ADMIN_EMAIL/m);
    expect(iehpJob).not.toMatch(/^\s+PW_ADMIN_PASSWORD/m);
    expect(candidateBlock).toContain('PW_SUPERADMIN_EMAIL');
    expect(candidateBlock).not.toContain('PW_ADMIN_EMAIL');
    expect(candidateBlock).not.toContain('PLAYWRIGHT_ADMIN_EMAIL');
  });
});
