const PACKET_VERSION = 'agent-work-replay.v1' as const;
const SAFE_TOKEN_PATTERN = /^[a-z0-9][a-z0-9._:/-]{0,127}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
const MAX_PACKET_ROWS = 500;

export type ReplayPacketSelector = {
  correlationId?: string;
  requestId?: string;
  agentOperationId?: string;
};

export type AuthoritativeReplayPacket = {
  schemaVersion: typeof PACKET_VERSION;
  executionAllowed: false;
  workItemId: string;
  workflow: { key: string; version: number; status: string };
  steps: Array<{ stepId: string; stepKey: string; status: string }>;
  stateTransitions: Array<{
    eventId: string;
    stepId: string | null;
    attemptId: string | null;
    toStatus: string;
    reasonCode: string;
    occurredAt: string;
  }>;
  evidence: Array<{
    evidenceId: string;
    stepId: string | null;
    sourceKind: string;
    sourceId: string;
    sha256: string;
    capturedAt: string;
  }>;
  approvals: Array<{
    approvalId: string;
    stepId: string | null;
    status: string;
    approvalHash: string | null;
    requestedAt: string;
    decidedAt: string | null;
    expiresAt: string | null;
    revokedAt: string | null;
  }>;
  attempts: Array<{
    attemptId: string;
    stepId: string;
    status: string;
    provider: string;
    model: string;
    promptVersion: string;
    toolVersion: string;
    workflowVersion: number | null;
    modelRequestSchemaVersion: string;
    guardrailOutcome: string;
    errorCode: string | null;
    startedAt: string;
    finishedAt: string | null;
  }>;
  effects: Array<{
    effectId: string;
    stepId: string;
    attemptId: string | null;
    effectKind: string;
    targetKind: string;
    targetId: string | null;
    payloadHash: string;
    uniqueEffectKey: string;
    status: string;
    verified: boolean;
    verifiedAt: string | null;
  }>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const record = (value: unknown, label: string): Record<string, unknown> => {
  if (!isRecord(value)) throw new Error(`Expected ${label} to be an object`);
  return value;
};

const exact = (value: Record<string, unknown>, keys: readonly string[], label: string): void => {
  const allowed = new Set(keys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`Unexpected key "${key}" on ${label}`);
  }
  for (const key of keys) {
    if (!(key in value)) throw new Error(`Missing ${label}.${key}`);
  }
};

const token = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !SAFE_TOKEN_PATTERN.test(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
};

const uuid = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) throw new Error(`Invalid ${label}`);
  return value;
};

const nullableUuid = (value: unknown, label: string): string | null =>
  value === null ? null : uuid(value, label);

const sha256 = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) throw new Error(`Invalid ${label}`);
  return value;
};

const nullableSha256 = (value: unknown, label: string): string | null =>
  value === null ? null : sha256(value, label);

const timestamp = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !ISO_TIMESTAMP_PATTERN.test(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
};

const nullableTimestamp = (value: unknown, label: string): string | null =>
  value === null ? null : timestamp(value, label);

const integer = (value: unknown, label: string, allowNull = false): number | null => {
  if (allowNull && value === null) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
};

const rows = (value: unknown, label: string): unknown[] => {
  if (!Array.isArray(value) || value.length > MAX_PACKET_ROWS) throw new Error(`Invalid ${label}`);
  return value;
};

export const validateReplayPacketSelector = (selector: ReplayPacketSelector): ReplayPacketSelector => {
  const normalized: ReplayPacketSelector = {};
  if (selector.correlationId) normalized.correlationId = token(selector.correlationId, 'correlationId');
  if (selector.requestId) normalized.requestId = token(selector.requestId, 'requestId');
  if (selector.agentOperationId) normalized.agentOperationId = token(selector.agentOperationId, 'agentOperationId');
  if (!normalized.correlationId && !normalized.requestId && !normalized.agentOperationId) {
    throw new Error('Provide correlationId, requestId, or agentOperationId');
  }
  return normalized;
};

export const assertLoopbackUrl = (value: string): URL => {
  const url = new URL(value);
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !LOOPBACK_HOSTS.has(url.hostname)) {
    throw new Error('Replay packet URL must use a loopback host');
  }
  if (url.username || url.password) throw new Error('Replay packet URL must not include credentials');
  return url;
};

export const validateAuthoritativeReplayPacket = (value: unknown): AuthoritativeReplayPacket => {
  const packet = record(value, 'packet');
  exact(
    packet,
    ['schemaVersion', 'executionAllowed', 'workItemId', 'workflow', 'steps', 'stateTransitions', 'evidence', 'approvals', 'attempts', 'effects'],
    'packet',
  );
  if (packet.schemaVersion !== PACKET_VERSION) throw new Error('Invalid schemaVersion');
  if (packet.executionAllowed !== false) throw new Error('Replay execution must be disabled');

  const workflow = record(packet.workflow, 'workflow');
  exact(workflow, ['key', 'version', 'status'], 'workflow');

  const steps = rows(packet.steps, 'steps').map((entry, index) => {
    const item = record(entry, `steps[${index}]`);
    exact(item, ['stepId', 'stepKey', 'status'], `steps[${index}]`);
    return { stepId: uuid(item.stepId, 'step.stepId'), stepKey: token(item.stepKey, 'step.stepKey'), status: token(item.status, 'step.status') };
  });

  const stateTransitions = rows(packet.stateTransitions, 'stateTransitions').map((entry, index) => {
    const item = record(entry, `stateTransitions[${index}]`);
    exact(item, ['eventId', 'stepId', 'attemptId', 'toStatus', 'reasonCode', 'occurredAt'], `stateTransitions[${index}]`);
    return {
      eventId: uuid(item.eventId, 'transition.eventId'),
      stepId: nullableUuid(item.stepId, 'transition.stepId'),
      attemptId: nullableUuid(item.attemptId, 'transition.attemptId'),
      toStatus: token(item.toStatus, 'transition.toStatus'),
      reasonCode: token(item.reasonCode, 'transition.reasonCode'),
      occurredAt: timestamp(item.occurredAt, 'transition.occurredAt'),
    };
  });

  const evidence = rows(packet.evidence, 'evidence').map((entry, index) => {
    const item = record(entry, `evidence[${index}]`);
    exact(item, ['evidenceId', 'stepId', 'sourceKind', 'sourceId', 'sha256', 'capturedAt'], `evidence[${index}]`);
    return {
      evidenceId: uuid(item.evidenceId, 'evidence.evidenceId'),
      stepId: nullableUuid(item.stepId, 'evidence.stepId'),
      sourceKind: token(item.sourceKind, 'evidence.sourceKind'),
      sourceId: uuid(item.sourceId, 'evidence.sourceId'),
      sha256: sha256(item.sha256, 'evidence.sha256'),
      capturedAt: timestamp(item.capturedAt, 'evidence.capturedAt'),
    };
  });

  const approvals = rows(packet.approvals, 'approvals').map((entry, index) => {
    const item = record(entry, `approvals[${index}]`);
    exact(item, ['approvalId', 'stepId', 'status', 'approvalHash', 'requestedAt', 'decidedAt', 'expiresAt', 'revokedAt'], `approvals[${index}]`);
    return {
      approvalId: uuid(item.approvalId, 'approval.approvalId'),
      stepId: nullableUuid(item.stepId, 'approval.stepId'),
      status: token(item.status, 'approval.status'),
      approvalHash: nullableSha256(item.approvalHash, 'approval.approvalHash'),
      requestedAt: timestamp(item.requestedAt, 'approval.requestedAt'),
      decidedAt: nullableTimestamp(item.decidedAt, 'approval.decidedAt'),
      expiresAt: nullableTimestamp(item.expiresAt, 'approval.expiresAt'),
      revokedAt: nullableTimestamp(item.revokedAt, 'approval.revokedAt'),
    };
  });

  const attempts = rows(packet.attempts, 'attempts').map((entry, index) => {
    const item = record(entry, `attempts[${index}]`);
    exact(item, ['attemptId', 'stepId', 'status', 'provider', 'model', 'promptVersion', 'toolVersion', 'workflowVersion', 'modelRequestSchemaVersion', 'guardrailOutcome', 'errorCode', 'startedAt', 'finishedAt'], `attempts[${index}]`);
    return {
      attemptId: uuid(item.attemptId, 'attempt.attemptId'),
      stepId: uuid(item.stepId, 'attempt.stepId'),
      status: token(item.status, 'attempt.status'),
      provider: token(item.provider, 'attempt.provider'),
      model: token(item.model, 'attempt.model'),
      promptVersion: token(item.promptVersion, 'attempt.promptVersion'),
      toolVersion: token(item.toolVersion, 'attempt.toolVersion'),
      workflowVersion: integer(item.workflowVersion, 'attempt.workflowVersion', true),
      modelRequestSchemaVersion: token(item.modelRequestSchemaVersion, 'attempt.modelRequestSchemaVersion'),
      guardrailOutcome: token(item.guardrailOutcome, 'attempt.guardrailOutcome'),
      errorCode: item.errorCode === null ? null : token(item.errorCode, 'attempt.errorCode'),
      startedAt: timestamp(item.startedAt, 'attempt.startedAt'),
      finishedAt: nullableTimestamp(item.finishedAt, 'attempt.finishedAt'),
    };
  });

  const effects = rows(packet.effects, 'effects').map((entry, index) => {
    const item = record(entry, `effects[${index}]`);
    exact(item, ['effectId', 'stepId', 'attemptId', 'effectKind', 'targetKind', 'targetId', 'payloadHash', 'uniqueEffectKey', 'status', 'verified', 'verifiedAt'], `effects[${index}]`);
    if (typeof item.verified !== 'boolean') throw new Error('Invalid effect.verified');
    if (item.verified && (item.status !== 'verified' || item.verifiedAt === null)) {
      throw new Error('Invalid effect verification');
    }
    return {
      effectId: uuid(item.effectId, 'effect.effectId'),
      stepId: uuid(item.stepId, 'effect.stepId'),
      attemptId: nullableUuid(item.attemptId, 'effect.attemptId'),
      effectKind: token(item.effectKind, 'effect.effectKind'),
      targetKind: token(item.targetKind, 'effect.targetKind'),
      targetId: nullableUuid(item.targetId, 'effect.targetId'),
      payloadHash: sha256(item.payloadHash, 'effect.payloadHash'),
      uniqueEffectKey: sha256(item.uniqueEffectKey, 'effect.uniqueEffectKey'),
      status: token(item.status, 'effect.status'),
      verified: item.verified,
      verifiedAt: nullableTimestamp(item.verifiedAt, 'effect.verifiedAt'),
    };
  });

  return {
    schemaVersion: PACKET_VERSION,
    executionAllowed: false,
    workItemId: uuid(packet.workItemId, 'workItemId'),
    workflow: {
      key: token(workflow.key, 'workflow.key'),
      version: integer(workflow.version, 'workflow.version') as number,
      status: token(workflow.status, 'workflow.status'),
    },
    steps,
    stateTransitions,
    evidence,
    approvals,
    attempts,
    effects,
  };
};

export const extractAuthoritativeReplayPacket = (value: unknown): AuthoritativeReplayPacket => {
  if (isRecord(value)) {
    if ('packet' in value) return validateAuthoritativeReplayPacket(value.packet);
    if ('data' in value && isRecord(value.data)) {
      if ('packet' in value.data) return validateAuthoritativeReplayPacket(value.data.packet);
      if (
        Array.isArray(value.data.replayPackets) && value.data.replayPackets.length === 1
      ) {
        return validateAuthoritativeReplayPacket(value.data.replayPackets[0]);
      }
    }
    if ('schemaVersion' in value) return validateAuthoritativeReplayPacket(value);
  }
  throw new Error('Missing single authoritative replay packet');
};

export const formatAuthoritativeReplayPacket = (value: unknown): string =>
  JSON.stringify(validateAuthoritativeReplayPacket(value), null, 2);
