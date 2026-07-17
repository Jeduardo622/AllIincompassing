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
  createDisposableBranch,
  parseLifecycleMode,
  type SupabaseCommandRunner,
} from '../../scripts/lib/bt-aba-disposable-branch';

const PRODUCTION_REF = 'wnnjeqheqxxyrgsjmygy';
const BRANCH_REF = 'btproofbranch1234567';
const BRANCH_ID = 'branch-id-123';
const BRANCH_NAME = 'bt-aba-proof-123';

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
    let getCalls = 0;
    const runner: SupabaseCommandRunner = vi.fn(async (args) => {
      calls.push(args);
      if (args[0] === 'branches' && args[1] === 'create') {
        return JSON.stringify({
          id: BRANCH_ID,
          name: BRANCH_NAME,
          project_ref: BRANCH_REF,
          parent_project_ref: PRODUCTION_REF,
          status: 'COMING_UP',
        });
      }
      if (args[0] === 'branches' && args[1] === 'get') {
        getCalls += 1;
        return JSON.stringify({
          id: BRANCH_ID,
          name: BRANCH_NAME,
          project_ref: BRANCH_REF,
          parent_project_ref: PRODUCTION_REF,
          status: getCalls === 1 ? 'COMING_UP' : 'ACTIVE_HEALTHY',
        });
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

  it.each([undefined, 'wrong-branch'])('rejects an unsafe created branch name %s before polling or key export', async (name) => {
    const calls: string[][] = [];
    const runner: SupabaseCommandRunner = vi.fn(async (args) => {
      calls.push(args);
      return JSON.stringify({
        id: BRANCH_ID,
        name,
        project_ref: BRANCH_REF,
        parent_project_ref: PRODUCTION_REF,
        status: 'COMING_UP',
      });
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
      })).rejects.toThrow(/branch name mismatch/i);

      expect(calls).toHaveLength(1);
      expect(calls.some((args) => args[0] === 'projects' && args[1] === 'api-keys')).toBe(false);
      expect(readFileSync(githubEnvPath, 'utf8')).toContain(`SUPABASE_BRANCH_ID=${BRANCH_ID}\n`);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it.each([undefined, 'wrong-branch'])('rejects an unsafe polled branch name %s before key export', async (name) => {
    const calls: string[][] = [];
    const runner: SupabaseCommandRunner = vi.fn(async (args) => {
      calls.push(args);
      if (args[0] === 'branches' && args[1] === 'create') {
        return JSON.stringify({
          id: BRANCH_ID,
          name: BRANCH_NAME,
          project_ref: BRANCH_REF,
          parent_project_ref: PRODUCTION_REF,
          status: 'COMING_UP',
        });
      }
      if (args[0] === 'branches' && args[1] === 'get') {
        return JSON.stringify({
          id: BRANCH_ID,
          name,
          project_ref: BRANCH_REF,
          parent_project_ref: PRODUCTION_REF,
          status: 'ACTIVE_HEALTHY',
        });
      }
      throw new Error(`Unexpected command: ${args.join(' ')}`);
    });

    await expect(createDisposableBranch({
      parentRef: PRODUCTION_REF,
      branchName: BRANCH_NAME,
      runner,
      sleep: async () => undefined,
      maxPollAttempts: 1,
    })).rejects.toThrow(/branch name mismatch/i);

    expect(calls.some((args) => args[0] === 'projects' && args[1] === 'api-keys')).toBe(false);
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

  it('accepts only one explicit lifecycle mode', () => {
    expect(parseLifecycleMode(['--create'])).toBe('create');
    expect(parseLifecycleMode(['--cleanup'])).toBe('cleanup');

    expect(() => parseLifecycleMode([])).toThrow(/exactly one.*--create.*--cleanup/i);
    expect(() => parseLifecycleMode(['--cretae'])).toThrow(/exactly one.*--create.*--cleanup/i);
    expect(() => parseLifecycleMode(['--create', '--cleanup'])).toThrow(/exactly one.*--create.*--cleanup/i);
    expect(() => parseLifecycleMode(['--create', '--unknown'])).toThrow(/exactly one.*--create.*--cleanup/i);
  });
});
