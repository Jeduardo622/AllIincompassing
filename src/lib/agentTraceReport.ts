import { callEdge } from './supabase';

export type AgentTraceSelector = {
  correlationId?: string;
  requestId?: string;
  agentOperationId?: string;
};

export type AgentTraceTimelineEvent = {
  source: 'agent_execution_traces' | 'scheduling_orchestration_runs' | 'function_idempotency_keys' | 'session_audit_logs';
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
    idempotencyRows: number;
    sessionAuditRows: number;
    timelineEvents: number;
    requestIds: string[];
    correlationIds: string[];
    agentOperationIds: string[];
  };
  timeline: AgentTraceTimelineEvent[];
  traces: Array<Record<string, unknown>>;
  orchestrationRuns: Array<Record<string, unknown>>;
  idempotency: Array<Record<string, unknown>>;
  sessionAudit: Array<Record<string, unknown>>;
};

type AgentTraceReportEnvelope = {
  success: boolean;
  error?: string;
  data?: AgentTraceReportData;
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
