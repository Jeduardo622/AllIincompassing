import { describe, expect, it } from 'vitest';

import {
  assertLoopbackUrl,
  classifySchedulerResponse,
  FIXED_SECRET_NAMES,
  getCronInvocationTargets,
  getSmokeInvocationTargets,
  rewriteSchedulerTargetsForContainer,
  setupScheduler,
  teardownScheduler,
  waitForFunction,
  waitForSchedulerFunctions,
} from '../scripts/agent-work-ledger-local-scheduler.mjs';

const createQueryRecorder = ({ cronEnabled = true } = {}) => {
  const calls: Array<{ text: string; params: unknown[] }> = [];
  const client = {
    query: async (text: string, params: unknown[] = []) => {
      calls.push({ text, params });
      if (text.includes('select id from vault.secrets')) return { rows: [] };
      if (text.includes('enable_local_agent_work_queue_scheduler')) {
        return { rows: [{ result: { runnerJobId: 1, sweeperJobId: 2 } }] };
      }
      if (text.includes('update cron.job')) return { rows: [], rowCount: 1 };
      if (text.includes("extname = 'pg_cron'")) return { rows: [{ enabled: cronEnabled }] };
      return { rows: [], rowCount: 0 };
    },
  };
  return { calls, client };
};

describe('local Agent Work Ledger scheduler guard', () => {
  it.each([
    'http://127.0.0.1:54321',
    'http://localhost:54321',
    ['postgresql', '://', 'postgres', ':', 'postgres', '@127.0.0.1:54322/postgres'].join(''),
  ])('accepts a loopback URL: %s', (value) => {
    expect(() => assertLoopbackUrl(value, 'LOCAL_URL')).not.toThrow();
  });

  it.each([
    'https://project.supabase.co',
    ['postgresql', '://', 'postgres', ':', 'synthetic', '@db.project.supabase.co:5432/postgres'].join(''),
    'http://host.docker.internal:54321',
  ])('rejects a non-loopback URL: %s', (value) => {
    expect(() => assertLoopbackUrl(value, 'LOCAL_URL')).toThrow(/loopback/i);
  });

  it('uses only fixed local Vault secret names', () => {
    expect(FIXED_SECRET_NAMES).toEqual([
      'agent_work_local_service_role_key',
      'agent_work_local_runner_invocation_secret',
      'agent_work_local_sweeper_invocation_secret',
    ]);
  });

  it('classifies the sanitized runner and sweeper success envelopes', () => {
    expect(classifySchedulerResponse(200, {
      success: true,
      data: { outcome: 'no_work' },
    })).toBe('runner');
    expect(classifySchedulerResponse(200, {
      success: true,
      data: { outcome: 'completed' },
    })).toBe('runner');
    expect(classifySchedulerResponse(200, {
      success: true,
      data: { processedActionCount: 4 },
    })).toBe('sweeper');
  });

  it('rejects non-success and unknown scheduler responses', () => {
    expect(classifySchedulerResponse(500, { success: false })).toBeNull();
    expect(classifySchedulerResponse(200, { success: true, data: {} })).toBeNull();
  });

  it('keeps host-mode scheduler targets unchanged', () => {
    expect(getSmokeInvocationTargets()).toEqual({
      runner: 'http://127.0.0.1:8000/agent-work-runner',
      sweeper: 'http://127.0.0.1:8001/agent-work-sweeper',
    });
    expect(getCronInvocationTargets()).toEqual({
      runner: 'http://host.docker.internal:8000/agent-work-runner',
      sweeper: 'http://host.docker.internal:8001/agent-work-sweeper',
    });
  });

  it('switches to exact phase2 service DNS targets in container mode only', () => {
    expect(getSmokeInvocationTargets({ AGENT_WORK_PHASE2_CONTAINER: '1' })).toEqual({
      runner: 'http://agent-work-runner:8000/agent-work-runner',
      sweeper: 'http://agent-work-sweeper:8001/agent-work-sweeper',
    });
    expect(getCronInvocationTargets({ AGENT_WORK_PHASE2_CONTAINER: '1' })).toEqual({
      runner: 'http://agent-work-runner:8000/agent-work-runner',
      sweeper: 'http://agent-work-sweeper:8001/agent-work-sweeper',
    });
  });

  it('polls already-running container services through the bounded startup wait', async () => {
    const targets = getSmokeInvocationTargets({ AGENT_WORK_PHASE2_CONTAINER: '1' });
    const calls: Array<[string, unknown]> = [];

    await waitForSchedulerFunctions(targets, { runner: null, sweeper: null }, async (url, state) => {
      calls.push([url, state]);
    });

    expect(calls).toEqual([
      ['http://agent-work-runner:8000/agent-work-runner', null],
      ['http://agent-work-sweeper:8001/agent-work-sweeper', null],
    ]);
  });

  it('limits readiness polling to 30 seconds when no child process exists', async () => {
    let now = 0;
    let attempts = 0;

    await expect(waitForFunction(
      'http://agent-work-runner:8000/agent-work-runner',
      null,
      {
        now: () => now,
        fetchImpl: async () => {
          attempts += 1;
          throw new Error('not ready');
        },
        sleep: async (milliseconds: number) => {
          now += milliseconds;
        },
      },
    )).rejects.toThrow(/timed out/i);

    expect(now).toBe(30_000);
    expect(attempts).toBe(120);
  });

  it('rewrites fixed cron targets only in container mode', async () => {
    const host = createQueryRecorder();
    await rewriteSchedulerTargetsForContainer(host.client, {});
    expect(host.calls).toEqual([]);

    const container = createQueryRecorder();
    await rewriteSchedulerTargetsForContainer(container.client, {
      AGENT_WORK_PHASE2_CONTAINER: '1',
    });
    expect(container.calls.map(({ params }) => params)).toEqual([
      [
        'agent-work-runner-local',
        'http://host.docker.internal:8000/agent-work-runner',
        'http://agent-work-runner:8000/agent-work-runner',
      ],
      [
        'agent-work-sweeper-local',
        'http://host.docker.internal:8001/agent-work-sweeper',
        'http://agent-work-sweeper:8001/agent-work-sweeper',
      ],
    ]);
  });

  it('commits container target rewrites inside the scheduler setup transaction', async () => {
    const { calls, client } = createQueryRecorder();
    await setupScheduler(
      client,
      { serviceRoleKey: 'service', runnerSecret: 'runner', sweeperSecret: 'sweeper' },
      { AGENT_WORK_PHASE2_CONTAINER: '1' },
    );

    const statements = calls.map(({ text }) => text.trim());
    const beginIndex = statements.indexOf('begin');
    const commitIndex = statements.indexOf('commit');
    const rewriteIndexes = statements
      .map((text, index) => text.includes('update cron.job') ? index : -1)
      .filter((index) => index >= 0);
    expect(beginIndex).toBeGreaterThanOrEqual(0);
    expect(rewriteIndexes).toHaveLength(2);
    expect(rewriteIndexes.every((index) => index > beginIndex && index < commitIndex)).toBe(true);
  });

  it('tears down the fixed cron jobs and Vault secrets through an in-memory client', async () => {
    const { calls, client } = createQueryRecorder();
    await teardownScheduler(client);

    expect(calls.some(({ text }) => text.includes('disable_local_agent_work_queue_scheduler'))).toBe(true);
    const vaultDelete = calls.find(({ text }) => text.includes('delete from vault.secrets'));
    expect(vaultDelete?.params).toEqual([FIXED_SECRET_NAMES]);
  });
});
