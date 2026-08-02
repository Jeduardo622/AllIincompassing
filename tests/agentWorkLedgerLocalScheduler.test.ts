import { describe, expect, it } from 'vitest';

import {
  assertLoopbackUrl,
  classifySchedulerResponse,
  FIXED_SECRET_NAMES,
} from '../scripts/agent-work-ledger-local-scheduler.mjs';

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
});
