import { describe, expect, it } from 'vitest';

import {
  assertLoopbackUrl,
  extractAuthoritativeReplayPacket,
  formatAuthoritativeReplayPacket,
  validateAuthoritativeReplayPacket,
} from '../agentReplay';

const validPacket = {
  schemaVersion: 'agent-work-replay.v1',
  executionAllowed: false,
  workItemId: '11111111-1111-4111-8111-111111111111',
  workflow: {
    key: 'assessment.iehp.prepare_for_clinical_review',
    version: 3,
    status: 'needs_review',
  },
  steps: [{
    stepId: '21111111-1111-4111-8111-111111111111',
    stepKey: 'project_review_snapshot',
    status: 'completed',
  }],
  stateTransitions: [{
    eventId: '31111111-1111-4111-8111-111111111111',
    stepId: '21111111-1111-4111-8111-111111111111',
    attemptId: '41111111-1111-4111-8111-111111111111',
    toStatus: 'completed',
    reasonCode: 'postcondition_verified',
    occurredAt: '2026-08-03T00:00:00.000Z',
  }],
  evidence: [{
    evidenceId: '51111111-1111-4111-8111-111111111111',
    stepId: '21111111-1111-4111-8111-111111111111',
    sourceKind: 'assessment_review_event',
    sourceId: '61111111-1111-4111-8111-111111111111',
    sha256: 'a'.repeat(64),
    capturedAt: '2026-08-03T00:01:00.000Z',
  }],
  approvals: [{
    approvalId: '71111111-1111-4111-8111-111111111111',
    stepId: '21111111-1111-4111-8111-111111111111',
    status: 'approved',
    approvalHash: 'b'.repeat(64),
    requestedAt: '2026-08-03T00:01:00.000Z',
    decidedAt: '2026-08-03T00:02:00.000Z',
    expiresAt: '2026-08-04T00:01:00.000Z',
    revokedAt: null,
  }],
  attempts: [{
    attemptId: '41111111-1111-4111-8111-111111111111',
    stepId: '21111111-1111-4111-8111-111111111111',
    status: 'completed',
    provider: 'local_stub',
    model: 'deterministic_fixture',
    promptVersion: 'prompt_v1',
    toolVersion: 'tool_v1',
    workflowVersion: 3,
    modelRequestSchemaVersion: 'schema_v1',
    guardrailOutcome: 'allowed',
    errorCode: null,
    startedAt: '2026-08-03T00:00:00.000Z',
    finishedAt: '2026-08-03T00:02:00.000Z',
  }],
  effects: [{
    effectId: '81111111-1111-4111-8111-111111111111',
    stepId: '21111111-1111-4111-8111-111111111111',
    attemptId: '41111111-1111-4111-8111-111111111111',
    effectKind: 'review_snapshot',
    targetKind: 'agent_work_step',
    targetId: '21111111-1111-4111-8111-111111111111',
    payloadHash: 'c'.repeat(64),
    uniqueEffectKey: 'd'.repeat(64),
    status: 'verified',
    verified: true,
    verifiedAt: '2026-08-03T00:02:00.000Z',
  }],
} as const;

describe('agent replay helpers', () => {
  it('validates an authoritative inert replay packet', () => {
    expect(validateAuthoritativeReplayPacket(validPacket)).toEqual(validPacket);
  });

  it('extracts a packet from the tenant-scoped trace report envelope', () => {
    expect(
      extractAuthoritativeReplayPacket({
        success: true,
        data: { replayPackets: [validPacket] },
      }),
    ).toEqual(validPacket);
  });

  it('fails closed on execution flags, unsafe keys, and malformed hashes', () => {
    expect(() => validateAuthoritativeReplayPacket({ ...validPacket, executionAllowed: true }))
      .toThrowError('Replay execution must be disabled');
    expect(() => validateAuthoritativeReplayPacket({ ...validPacket, replay_payload: { message: 'secret' } }))
      .toThrowError('Unexpected key "replay_payload"');
    expect(() => validateAuthoritativeReplayPacket({
      ...validPacket,
      evidence: [{ ...validPacket.evidence[0], sha256: 'not-a-hash' }],
    })).toThrowError('Invalid evidence.sha256');
  });

  it('formats only the validated packet', () => {
    const formatted = formatAuthoritativeReplayPacket(validPacket);
    expect(JSON.parse(formatted)).toEqual(validPacket);
    expect(formatted).not.toContain('replay_payload');
    expect(formatted).not.toContain('message');
    expect(formatted).not.toContain('context');
  });

  it('accepts only loopback packet URLs without credentials', () => {
    expect(assertLoopbackUrl('http://127.0.0.1:54321/functions/v1/agent-trace-report').host).toBe(
      '127.0.0.1:54321',
    );
    expect(() => assertLoopbackUrl('https://example.com/functions/v1/agent-trace-report')).toThrowError(
      'Replay packet URL must use a loopback host',
    );
    expect(() => assertLoopbackUrl('http://user:secret@localhost:54321/packet')).toThrowError(
      'Replay packet URL must not include credentials',
    );
  });
});
