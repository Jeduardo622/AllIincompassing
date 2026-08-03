import { callEdge } from './supabase';

export type AgentTraceSelector = {
  correlationId?: string;
  requestId?: string;
  agentOperationId?: string;
};

export type AgentTraceTimelineEvent = {
  source: 'agent_execution_traces' | 'scheduling_orchestration_runs' | 'session_audit_logs';
  occurredAt: string;
  requestId: string | null;
  correlationId: string | null;
  agentOperationId: string | null;
  detail: Record<string, unknown>;
};

export type AgentTraceReportData = {
  selector: AgentTraceSelector;
  summary: {
    traces: number;
    orchestrationRuns: number;
    sessionAuditRows: number;
    timelineEvents: number;
    requestIds: string[];
    correlationIds: string[];
    agentOperationIds: string[];
  };
  timeline: AgentTraceTimelineEvent[];
  traces: Array<Record<string, unknown>>;
  orchestrationRuns: Array<Record<string, unknown>>;
  sessionAudit: Array<Record<string, unknown>>;
};

type UnavailableMetric = {
  value: null;
  availability: 'unavailable';
  reasonCode: string;
};

export type AgentWorkOperationsData = {
  schemaVersion: 'agent-work-operations.v1';
  generatedAt: string;
  sample: {
    limit: number;
    truncated: boolean;
    releaseGateStatus: 'evaluable' | 'blocked_incomplete_sample';
  };
  summary: {
    totalWorkItems: number;
    blockedWorkItems: number;
    waitingSteps: number;
    staleLeases: number;
    retryExhaustedSteps: number;
    parityMismatches: number;
    duplicateEffectsPrevented: number;
    pendingApprovals: number;
    oldestWaitingAgeSeconds: number | null;
    oldestApprovalAgeSeconds: number | null;
  };
  rates: {
    retryExhaustionPercent: number;
    abortPercent: number;
  };
  releaseSignals: {
    crossTenantAccess: number | null;
    falseCompletion: number | null;
    unverifiedMutationEffects: number | null;
    phiPayloadViolations: number | null;
    approvalBypassOrStaleAcceptance: number | null;
    unknownStateTransitions: number | null;
    staleRunningBeyondSlo: number | null;
    readinessEvidenceCoveragePercent: number | null;
  };
  aggregations: {
    workflows: Array<{
      workflowKey: string;
      workflowVersion: number;
      count: number;
      completed: number;
      blocked: number;
    }>;
    models: Array<{
      provider: string;
      model: string;
      promptVersion: string;
      toolVersion: string;
      workflowVersion: number;
      modelRequestSchemaVersion: string;
      count: number;
      failures: number;
    }>;
  };
  drilldown: {
    blocked: Array<{ workItemId: string; reasonCode: string }>;
    waiting: Array<{ workItemId: string; stepId: string; reasonCode: string }>;
    staleLeases: Array<{ workItemId: string; stepId: string; reasonCode: string }>;
    retryExhausted: Array<{ workItemId: string; stepId: string; reasonCode: string }>;
    parityMismatches: Array<{ workItemId: string; stepId: string | null; reasonCode: string }>;
  };
  nonBlocking: {
    medianTimeToNeedsReviewSeconds: number | null;
    retryAbortRatePercent: number;
    humanOverrideRatePercent: number;
    duplicateEffectsPrevented: number;
    tokensPerCompletedObjective: number | null;
    costPerCompletedObjective: number | null;
    timeInEachStateSeconds: Record<string, number>;
    blockerResolutionTimeSeconds: UnavailableMetric;
    clinicianAdministrativeTimeSeconds: UnavailableMetric;
  };
};

type AgentTraceReportEnvelope = {
  success: boolean;
  error?: string;
  data?: AgentTraceReportData;
};

type AgentWorkOperationsEnvelope = {
  success: boolean;
  error?: string;
  data?: { operations?: AgentWorkOperationsData };
};

const normalizeSelectorValue = (value?: string): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export const hasTraceSelector = (selector: AgentTraceSelector): boolean => {
  return Boolean(
    normalizeSelectorValue(selector.correlationId) ||
      normalizeSelectorValue(selector.requestId) ||
      normalizeSelectorValue(selector.agentOperationId),
  );
};

export const fetchAgentTraceReport = async (
  selector: AgentTraceSelector,
  options: { accessToken?: string } = {},
): Promise<AgentTraceReportData> => {
  const normalized: AgentTraceSelector = {
    correlationId: normalizeSelectorValue(selector.correlationId),
    requestId: normalizeSelectorValue(selector.requestId),
    agentOperationId: normalizeSelectorValue(selector.agentOperationId),
  };

  if (!hasTraceSelector(normalized)) {
    throw new Error('Provide correlationId, requestId, or agentOperationId');
  }

  const response = await callEdge(
    'agent-trace-report',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(normalized),
    },
    {
      accessToken: options.accessToken,
    },
  );

  const payload = (await response.json()) as AgentTraceReportEnvelope;

  if (!response.ok || !payload.success || !payload.data) {
    const message = payload.error?.trim() || `Failed to load trace report (${response.status})`;
    throw new Error(message);
  }

  return payload.data;
};

export const fetchAgentWorkOperations = async (
  options: { accessToken?: string } = {},
): Promise<AgentWorkOperationsData> => {
  const response = await callEdge(
    'agent-trace-report',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'operations' }),
    },
    { accessToken: options.accessToken },
  );

  const payload = (await response.json()) as AgentWorkOperationsEnvelope;
  const operations = payload.data?.operations;
  if (!response.ok || !payload.success || !operations) {
    const message = payload.error?.trim() || `Failed to load operations report (${response.status})`;
    throw new Error(message);
  }
  if (operations.schemaVersion !== 'agent-work-operations.v1') {
    throw new Error('Unsupported agent work operations schema');
  }

  return operations;
};
