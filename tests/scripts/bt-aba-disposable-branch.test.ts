/**
 * @vitest-environment node
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  assertDisposableBranch,
  classifyApiKeys,
  cleanupDisposableBranch,
  useManagedPreviewBranch,
  createDisposableBranch,
  parseLifecycleMode,
  type SupabaseCommandRunner,
} from '../../scripts/lib/bt-aba-disposable-branch';

const PRODUCTION_REF = 'wnnjeqheqxxyrgsjmygy';
const BRANCH_REF = 'btproofbranch1234567';
const BRANCH_ID = 'branch-id-123';
const BRANCH_NAME = 'bt-aba-proof-123';
const MANAGED_BRANCH_NAME = 'codex/win-221-bt-aba-session-note';
const MANAGED_BRANCH_ID = '03d01a74-2ac3-4047-a983-c77b73a4ff6a';
const MANAGED_BRANCH_REF = 'zutoyqdrpddtgkgooijx';

describe('BT ABA disposable branch lifecycle guard', () => {
  it('refuses the production project and incomplete or unhealthy branch details', () => {
    expect(() => assertDisposableBranch(PRODUCTION_REF, { project_ref: PRODUCTION_REF })).toThrow(/production/i);
    expect(() => assertDisposableBranch(PRODUCTION_REF, { project_ref: '' })).toThrow(/production/i);
    expect(() => assertDisposableBranch(PRODUCTION_REF, {
      project_ref: BRANCH_REF,
      parent_project_ref: 'unexpected-parent',
      status: 'ACTIVE_HEALTHY',
    })).toThrow(/parent mismatch/i);
    expect(() => assertDisposableBranch(PRODUCTION_REF, {
      project_ref: BRANCH_REF,
      parent_project_ref: PRODUCTION_REF,
      status: 'COMING_UP',
    })).toThrow(/not healthy/i);
  });

  it('accepts only a healthy child whose project ref differs from production', () => {
    expect(() => assertDisposableBranch(PRODUCTION_REF, {
      id: BRANCH_ID,
      name: BRANCH_NAME,
      project_ref: BRANCH_REF,
      parent_project_ref: PRODUCTION_REF,
      status: 'ACTIVE_HEALTHY',
    })).not.toThrow();
  });

  it('classifies exactly one publishable key and one secret key', () => {
    expect(classifyApiKeys([
      { type: 'publishable', api_key: 'sb_publishable_x' },
      { type: 'secret', api_key: 'sb_secret_x' },
    ])).toEqual({ publishableKey: 'sb_publishable_x', secretKey: 'sb_secret_x' });

    expect(() => classifyApiKeys([{ type: 'publishable', api_key: 'sb_publishable_x' }])).toThrow(/secret/i);
    expect(() => classifyApiKeys([
      { type: 'publishable', api_key: 'sb_publishable_x' },
      { type: 'publishable', api_key: 'sb_publishable_y' },
      { type: 'secret', api_key: 'sb_secret_x' },
    ])).toThrow(/exactly one publishable/i);
  });

  it('creates without production data, polls healthy, masks keys, and exports branch values', async () => {
    const calls: string[][] = [];
    let listCalls = 0;
    const runner: SupabaseCommandRunner = vi.fn(async (args) => {
      calls.push(args);
      if (args[0] === 'branches' && args[1] === 'create') {
        return `Creating disposable branch...\n${JSON.stringify({ data: { branch: {
          id: BRANCH_ID,
          name: BRANCH_NAME,
          project_ref: BRANCH_REF,
          parent_project_ref: PRODUCTION_REF,
          status: 'COMING_UP',
        } } })}\nDisposable branch created.`;
      }
      if (args[0] === 'branches' && args[1] === 'list') {
        listCalls += 1;
        return JSON.stringify({ result: [{
          id: BRANCH_ID,
          name: BRANCH_NAME,
          project_ref: BRANCH_REF,
          parent_project_ref: PRODUCTION_REF,
          status: listCalls === 1 ? 'COMING_UP' : 'ACTIVE_HEALTHY',
        }] });
      }
      if (args[0] === 'projects' && args[1] === 'api-keys') {
        return JSON.stringify([
          { type: 'publishable', api_key: 'sb_publishable_x' },
          { type: 'secret', api_key: 'sb_secret_x' },
        ]);
      }
      throw new Error(`Unexpected command: ${args.join(' ')}`);
    });
    const masks: string[] = [];
    const tmp = mkdtempSync(path.join(tmpdir(), 'bt-branch-env-'));
    const githubEnvPath = path.join(tmp, 'github-env');

    try {
      const result = await createDisposableBranch({
        parentRef: PRODUCTION_REF,
        branchName: BRANCH_NAME,
        githubEnvPath,
        runner,
        mask: (value) => masks.push(value),
        sleep: async () => undefined,
        maxPollAttempts: 3,
      });

      expect(result.project_ref).toBe(BRANCH_REF);
      const createArgs = calls.find((args) => args[0] === 'branches' && args[1] === 'create');
      expect(createArgs).toEqual([
        'branches', 'create', BRANCH_NAME,
        '--project-ref', PRODUCTION_REF,
        '--output', 'json',
        '--yes',
      ]);
      expect(createArgs).not.toContain('--with-data');
      expect(masks).toEqual(['sb_publishable_x', 'sb_secret_x']);

      const exported = readFileSync(githubEnvPath, 'utf8');
      expect(exported).toContain(`SUPABASE_BRANCH_ID=${BRANCH_ID}\n`);
      expect(exported).toContain(`SUPABASE_BRANCH_NAME=${BRANCH_NAME}\n`);
      expect(exported).toContain(`SUPABASE_BRANCH_PROJECT_REF=${BRANCH_REF}\n`);
      expect(exported).toContain(`SUPABASE_URL=https://${BRANCH_REF}.supabase.co\n`);
      expect(exported).toContain('SUPABASE_PUBLISHABLE_KEY=sb_publishable_x\n');
      expect(exported).toContain('SUPABASE_SECRET_KEY=sb_secret_x\n');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('fails closed when a wrapped create response contains multiple matching children', async () => {
    const branch = {
        id: BRANCH_ID,
        name: BRANCH_NAME,
        project_ref: BRANCH_REF,
        parent_project_ref: PRODUCTION_REF,
        status: 'COMING_UP',
    };
    const runner: SupabaseCommandRunner = vi.fn(async () => JSON.stringify({ first: branch, second: { ...branch } }));

    await expect(createDisposableBranch({
      parentRef: PRODUCTION_REF,
      branchName: BRANCH_NAME,
      runner,
      sleep: async () => undefined,
    })).rejects.toThrow(/exactly one requested child branch/i);
  });

  it('fails closed when a matching branch contains another matching branch', async () => {
    const nested = {
      id: BRANCH_ID,
      name: BRANCH_NAME,
      project_ref: BRANCH_REF,
      parent_project_ref: PRODUCTION_REF,
      status: 'COMING_UP',
    };
    const runner: SupabaseCommandRunner = vi.fn(async () => JSON.stringify({
      ...nested,
      branch: { ...nested, status: 'ACTIVE_HEALTHY' },
    }));

    await expect(createDisposableBranch({
      parentRef: PRODUCTION_REF,
      branchName: BRANCH_NAME,
      runner,
      sleep: async () => undefined,
    })).rejects.toThrow(/exactly one requested child branch/i);
  });

  it.each([undefined, 'wrong-branch'])('rejects a wrapped create response with no matching branch name %s', async (name) => {
    const calls: string[][] = [];
    const runner: SupabaseCommandRunner = vi.fn(async (args) => {
      calls.push(args);
      return JSON.stringify({ data: {
        id: BRANCH_ID,
        name,
        project_ref: BRANCH_REF,
        parent_project_ref: PRODUCTION_REF,
        status: 'COMING_UP',
      } });
    });
    const tmp = mkdtempSync(path.join(tmpdir(), 'bt-branch-partial-env-'));
    const githubEnvPath = path.join(tmp, 'github-env');

    try {
      await expect(createDisposableBranch({
        parentRef: PRODUCTION_REF,
        branchName: BRANCH_NAME,
        githubEnvPath,
        runner,
        sleep: async () => undefined,
      })).rejects.toThrow(/exactly one requested child branch/i);

      expect(calls).toHaveLength(1);
      expect(calls.some((args) => args[0] === 'projects' && args[1] === 'api-keys')).toBe(false);
      expect(readFileSync(githubEnvPath, 'utf8')).not.toContain('SUPABASE_BRANCH_ID=');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('rejects a wrapped poll-list response with no exact identity match before key export', async () => {
    const calls: string[][] = [];
    const runner: SupabaseCommandRunner = vi.fn(async (args) => {
      calls.push(args);
      if (args[0] === 'branches' && args[1] === 'create') {
        return JSON.stringify({ branch: {
          id: BRANCH_ID,
          name: BRANCH_NAME,
          project_ref: BRANCH_REF,
          parent_project_ref: PRODUCTION_REF,
          status: 'COMING_UP',
        } });
      }
      if (args[0] === 'branches' && args[1] === 'list') {
        return JSON.stringify({ data: [{
          id: 'changed-branch-id',
          name: BRANCH_NAME,
          project_ref: BRANCH_REF,
          parent_project_ref: PRODUCTION_REF,
          status: 'ACTIVE_HEALTHY',
        }] });
      }
      throw new Error(`Unexpected command: ${args.join(' ')}`);
    });

    await expect(createDisposableBranch({
      parentRef: PRODUCTION_REF,
      branchName: BRANCH_NAME,
      runner,
      sleep: async () => undefined,
      maxPollAttempts: 1,
    })).rejects.toThrow(/exactly one requested child branch/i);

    expect(calls.some((args) => args[0] === 'projects' && args[1] === 'api-keys')).toBe(false);
    expect(calls.some((args) => args[0] === 'branches' && args[1] === 'get')).toBe(false);
  });

  it('deletes only the matching child branch and verifies it is absent', async () => {
    const calls: string[][] = [];
    let listCalls = 0;
    const runner: SupabaseCommandRunner = vi.fn(async (args) => {
      calls.push(args);
      if (args[0] === 'branches' && args[1] === 'list') {
        listCalls += 1;
        return JSON.stringify(listCalls === 1 ? [{
          id: BRANCH_ID,
          name: BRANCH_NAME,
          project_ref: BRANCH_REF,
          parent_project_ref: PRODUCTION_REF,
          status: 'ACTIVE_HEALTHY',
        }] : []);
      }
      if (args[0] === 'branches' && args[1] === 'delete') {
        return JSON.stringify({ id: BRANCH_ID });
      }
      throw new Error(`Unexpected command: ${args.join(' ')}`);
    });

    await cleanupDisposableBranch({
      parentRef: PRODUCTION_REF,
      branchName: BRANCH_NAME,
      branchId: BRANCH_ID,
      runner,
      sleep: async () => undefined,
      maxPollAttempts: 2,
    });

    expect(calls).toContainEqual([
      'branches', 'delete', BRANCH_ID,
      '--project-ref', PRODUCTION_REF,
      '--output', 'json',
      '--yes',
    ]);
    expect(listCalls).toBe(2);
  });

  it('fails closed instead of deleting when the listed branch identity is unsafe', async () => {
    const runner: SupabaseCommandRunner = vi.fn(async () => JSON.stringify([{
      id: BRANCH_ID,
      name: BRANCH_NAME,
      project_ref: PRODUCTION_REF,
      parent_project_ref: PRODUCTION_REF,
      status: 'ACTIVE_HEALTHY',
    }]));

    await expect(cleanupDisposableBranch({
      parentRef: PRODUCTION_REF,
      branchName: BRANCH_NAME,
      branchId: BRANCH_ID,
      runner,
      sleep: async () => undefined,
      maxPollAttempts: 1,
    })).rejects.toThrow(/production/i);

    expect(runner).toHaveBeenCalledTimes(1);
  });

  it('cleans up a partially-created child by exported ID even when its name is missing', async () => {
    const calls: string[][] = [];
    let listCalls = 0;
    const runner: SupabaseCommandRunner = vi.fn(async (args) => {
      calls.push(args);
      if (args[0] === 'branches' && args[1] === 'list') {
        listCalls += 1;
        return JSON.stringify(listCalls === 1 ? [{
          id: BRANCH_ID,
          project_ref: BRANCH_REF,
          parent_project_ref: PRODUCTION_REF,
          status: 'CREATING_PROJECT',
        }] : []);
      }
      if (args[0] === 'branches' && args[1] === 'delete') {
        return JSON.stringify({ id: BRANCH_ID });
      }
      throw new Error(`Unexpected command: ${args.join(' ')}`);
    });

    await cleanupDisposableBranch({
      parentRef: PRODUCTION_REF,
      branchName: BRANCH_NAME,
      branchId: BRANCH_ID,
      runner,
      sleep: async () => undefined,
      maxPollAttempts: 2,
    });

    expect(calls).toContainEqual([
      'branches', 'delete', BRANCH_ID,
      '--project-ref', PRODUCTION_REF,
      '--output', 'json',
      '--yes',
    ]);
  });

  it('uses only the exact healthy platform-managed PR preview and masks its keys', async () => {
    const githubEnv = path.join(mkdtempSync(path.join(tmpdir(), 'bt-managed-')), 'env');
    const mask = vi.fn();
    const runner: SupabaseCommandRunner = vi.fn(async (args) => {
      if (args[0] === 'branches' && args[1] === 'list') return JSON.stringify([{
        id: MANAGED_BRANCH_ID,
        name: MANAGED_BRANCH_NAME,
        git_branch: MANAGED_BRANCH_NAME,
        pr_number: 813,
        project_ref: MANAGED_BRANCH_REF,
        parent_project_ref: PRODUCTION_REF,
        status: 'FUNCTIONS_DEPLOYED',
        preview_project_status: 'ACTIVE_HEALTHY',
      }]);
      if (args[0] === 'projects' && args[1] === 'api-keys') return JSON.stringify([
        { type: 'publishable', api_key: 'sb_publishable_managed' },
        { type: 'secret', api_key: 'sb_secret_managed' },
      ]);
      throw new Error(`Unexpected command: ${args.join(' ')}`);
    });

    await expect(useManagedPreviewBranch({
      parentRef: PRODUCTION_REF,
      branchName: MANAGED_BRANCH_NAME,
      branchId: MANAGED_BRANCH_ID,
      branchRef: MANAGED_BRANCH_REF,
      pullRequestNumber: 813,
      runner,
      githubEnvPath: githubEnv,
      mask,
    })).resolves.toMatchObject({ project_ref: MANAGED_BRANCH_REF });

    expect(readFileSync(githubEnv, 'utf8')).toContain(`SUPABASE_BRANCH_PROJECT_REF=${MANAGED_BRANCH_REF}`);
    expect(mask).toHaveBeenCalledWith('sb_secret_managed');
  });

  it('fails closed for an ambiguous or mismatched managed preview identity', async () => {
    const exact = {
      id: MANAGED_BRANCH_ID,
      name: MANAGED_BRANCH_NAME,
      git_branch: MANAGED_BRANCH_NAME,
      pr_number: 813,
      project_ref: MANAGED_BRANCH_REF,
      parent_project_ref: PRODUCTION_REF,
      status: 'FUNCTIONS_DEPLOYED',
      preview_project_status: 'ACTIVE_HEALTHY',
    };
    const runner: SupabaseCommandRunner = vi.fn(async () => JSON.stringify([exact, { ...exact }]));
    await expect(useManagedPreviewBranch({
      parentRef: PRODUCTION_REF,
      branchName: MANAGED_BRANCH_NAME,
      branchId: MANAGED_BRANCH_ID,
      branchRef: MANAGED_BRANCH_REF,
      pullRequestNumber: 813,
      runner,
    })).rejects.toThrow(/exactly one/i);

    const unhealthy: SupabaseCommandRunner = vi.fn(async () => JSON.stringify([{
      ...exact,
      preview_project_status: 'INACTIVE',
    }]));
    await expect(useManagedPreviewBranch({
      parentRef: PRODUCTION_REF,
      branchName: MANAGED_BRANCH_NAME,
      branchId: MANAGED_BRANCH_ID,
      branchRef: MANAGED_BRANCH_REF,
      pullRequestNumber: 813,
      runner: unhealthy,
    })).rejects.toThrow(/not healthy/i);
  });

  it('accepts only one explicit lifecycle mode', () => {
    expect(parseLifecycleMode(['--create'])).toBe('create');
    expect(parseLifecycleMode(['--cleanup'])).toBe('cleanup');
    expect(parseLifecycleMode(['--managed-preview'])).toBe('managed-preview');
    expect(parseLifecycleMode(['--verify-managed-preview'])).toBe('verify-managed-preview');

    expect(() => parseLifecycleMode([])).toThrow(/exactly one.*--create.*--cleanup/i);
    expect(() => parseLifecycleMode(['--cretae'])).toThrow(/exactly one.*--create.*--cleanup/i);
    expect(() => parseLifecycleMode(['--create', '--cleanup'])).toThrow(/exactly one.*--create.*--cleanup/i);
    expect(() => parseLifecycleMode(['--create', '--unknown'])).toThrow(/exactly one.*--create.*--cleanup/i);
  });
});
