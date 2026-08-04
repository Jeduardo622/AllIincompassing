import { createRequestClient, supabaseAdmin } from "../_shared/database.ts";
import { getUserOrThrow } from "../_shared/auth.ts";
import { getLogger } from "../_shared/logging.ts";
import { resolveAllowedOrigin } from "../_shared/cors.ts";
import { assertUserHasOrgRole, resolveOrgId } from "../_shared/org.ts";
import { validateStoredEventMetadata } from "../_shared/agent-work/events.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": resolveAllowedOrigin(),
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id, x-correlation-id, x-agent-operation-id",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

type Selector = {
  correlationId?: string;
  requestId?: string;
  agentOperationId?: string;
};

type TraceRow = {
  id: string;
  request_id: string;
  correlation_id: string;
  conversation_id: string | null;
  user_id: string | null;
  organization_id: string | null;
  work_item_id?: string | null;
  step_id?: string | null;
  attempt_id?: string | null;
  step_name: string;
  step_index: number;
  status: "ok" | "blocked" | "error";
  payload: Record<string, unknown> | null;
  replay_payload: Record<string, unknown> | null;
  created_at: string;
};

type OrchestrationRow = {
  id: string;
  organization_id: string | null;
  request_id: string;
  correlation_id: string;
  workflow: string;
  status: string;
  inputs: Record<string, unknown> | null;
  outputs: Record<string, unknown> | null;
  rollback_plan: Record<string, unknown> | null;
  created_at: string;
};

type SessionAuditRow = {
  id: string;
  session_id: string;
  event_type: string;
  event_payload: Record<string, unknown> | null;
  actor_id: string | null;
  organization_id: string;
  therapist_id: string | null;
  created_at: string;
};

type TimelineEvent = {
  source:
    | "agent_execution_traces"
    | "scheduling_orchestration_runs"
    | "session_audit_logs";
  occurredAt: string;
  requestId: string | null;
  correlationId: string | null;
  agentOperationId: string | null;
  detail: Record<string, unknown>;
};

type SanitizedTraceRow = {
  id: string;
  requestId: string;
  correlationId: string;
  agentOperationId?: string | null;
  workItemId: string | null;
  stepId: string | null;
  attemptId: string | null;
  stepName: string;
  stepIndex: number;
  status: TraceRow["status"];
  createdAt: string;
  diagnostics: Record<string, unknown>;
};

type SanitizedOrchestrationRow = {
  id: string;
  requestId: string;
  correlationId: string;
  workflow: string;
  status: string;
  createdAt: string;
  diagnostics: Record<string, unknown>;
};

type SanitizedSessionAuditRow = {
  id: string;
  sessionId: string;
  eventType: string;
  createdAt: string;
  requestId: string | null;
  correlationId: string | null;
  agentOperationId: string | null;
  diagnostics: Record<string, unknown>;
};

type AgentWorkItemRow = {
  id: string;
  organization_id?: string | null;
  workflow_key: string;
  workflow_version: number;
  status: string;
  created_at?: string;
  updated_at?: string;
  completed_at?: string | null;
  failure_reason_code?: string | null;
};

type AgentWorkStepRow = {
  id: string;
  organization_id?: string | null;
  work_item_id: string;
  step_key: string;
  execution_mode?: string;
  status: string;
  attempt_count?: number;
  max_attempts?: number;
  lease_expires_at?: string | null;
  updated_at?: string;
  completed_at?: string | null;
  last_error_code?: string | null;
};

type AgentWorkApprovalRow = {
  id: string;
  organization_id?: string | null;
  work_item_id: string;
  step_id: string | null;
  status: string;
  approval_hash: string | null;
  requested_at: string;
  decided_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  request_reason_code?: string | null;
};

type AgentWorkAttemptRow = {
  id: string;
  organization_id?: string | null;
  work_item_id: string;
  step_id: string;
  status: string;
  provider: string | null;
  model: string | null;
  prompt_version: string | null;
  tool_version: string | null;
  workflow_version: number | null;
  model_request_schema_version: string | null;
  input_token_count?: number | null;
  output_token_count?: number | null;
  computed_cost?: number | string | null;
  error_code: string | null;
  created_at: string;
  finished_at: string | null;
};

type AgentWorkEffectRow = {
  id: string;
  organization_id?: string | null;
  work_item_id: string;
  step_id: string;
  attempt_id: string | null;
  effect_kind: string;
  target_kind: string;
  target_id: string | null;
  payload_hash: string;
  unique_effect_key: string;
  status: string;
  verified_at: string | null;
};

type AgentWorkEvidenceRow = {
  id: string;
  organization_id?: string | null;
  work_item_id: string;
  step_id: string | null;
  source_kind: string;
  source_id: string;
  sha256: string;
  captured_at: string;
};

type AgentWorkEventRow = {
  id: string;
  organization_id?: string | null;
  work_item_id: string;
  step_id: string | null;
  attempt_id: string | null;
  event_type: string;
  sanitized_metadata: Record<string, unknown>;
  created_at: string;
};

type AgentWorkOperationsInput = {
  now: string;
  limit: number;
  truncated: boolean;
  crossTenantAccess?: number;
  items: AgentWorkItemRow[];
  steps: AgentWorkStepRow[];
  approvals: AgentWorkApprovalRow[];
  attempts: AgentWorkAttemptRow[];
  effects: AgentWorkEffectRow[];
  evidence: AgentWorkEvidenceRow[];
  events: AgentWorkEventRow[];
};

type AgentWorkReplayInput = {
  item: Pick<
    AgentWorkItemRow,
    "id" | "workflow_key" | "workflow_version" | "status"
  >;
  steps: Array<
    Pick<AgentWorkStepRow, "id" | "work_item_id" | "step_key" | "status">
  >;
  evidence: AgentWorkEvidenceRow[];
  approvals: AgentWorkApprovalRow[];
  attempts: AgentWorkAttemptRow[];
  effects: AgentWorkEffectRow[];
  events: AgentWorkEventRow[];
  guardrails: Array<{ attemptId: string; outcome: string }>;
};

const SELECTOR_VALUE_PATTERN = /^[A-Za-z0-9._:/-]{1,200}$/;
const TRACE_REPORT_ROLES = ["admin", "super_admin", "monitoring"] as const;
const SAFE_MACHINE_TOKEN_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,127}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const WORK_STEP_STATUSES = new Set([
  "pending",
  "ready",
  "running",
  "waiting",
  "needs_approval",
  "completed",
  "failed",
  "skipped",
  "cancelled",
]);

const jsonResponse = (
  body: Record<string, unknown>,
  status = 200,
  headers: Record<string, string> = {},
): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
      ...headers,
    },
  });

const normalizeText = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const normalizeSelectorValue = (
  value: unknown,
  fieldName: string,
): string | undefined => {
  const normalized = normalizeText(value);
  if (!normalized) return undefined;
  if (!SELECTOR_VALUE_PATTERN.test(normalized)) {
    throw new Response(`Invalid ${fieldName}`, { status: 400 });
  }
  return normalized;
};

const nonEmptyString = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const numericValue = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
};

const requireReportIdentifier = (value: string, label: string): string => {
  if (!SELECTOR_VALUE_PATTERN.test(value)) {
    throw new Error(`${label} contains a forbidden value`);
  }
  return value;
};

const requireMachineToken = (value: string, label: string): string => {
  if (!SAFE_MACHINE_TOKEN_PATTERN.test(value)) {
    throw new Error(`${label} contains a forbidden value`);
  }
  return value;
};

const requireSha256 = (value: unknown, label: string): string => {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    throw new Error(`Replay packet contains an invalid ${label} hash`);
  }
  return value;
};

const optionalSha256 = (value: unknown, label: string): string | null =>
  value === null ? null : requireSha256(value, label);

const sanitizeTokenUsage = (value: unknown): Record<string, number> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const source = value as Record<string, unknown>;
  const sanitized: Record<string, number> = {};

  for (const key of ["input", "output", "total", "cached", "reasoning"]) {
    const candidate = numericValue(source[key]);
    if (candidate !== null) {
      sanitized[key] = candidate;
    }
  }

  return Object.keys(sanitized).length > 0 ? sanitized : null;
};

const parseSelector = (req: Request, body: unknown): Selector => {
  const url = new URL(req.url);
  const fromBody = typeof body === "object" && body !== null
    ? body as Record<string, unknown>
    : {};

  const correlationId = normalizeSelectorValue(
    fromBody.correlationId ?? url.searchParams.get("correlationId"),
    "correlationId",
  );
  const requestId = normalizeSelectorValue(
    fromBody.requestId ?? url.searchParams.get("requestId"),
    "requestId",
  );
  const agentOperationId = normalizeSelectorValue(
    fromBody.agentOperationId ?? url.searchParams.get("agentOperationId"),
    "agentOperationId",
  );

  if (!correlationId && !requestId && !agentOperationId) {
    throw new Response(
      "Provide correlationId, requestId, or agentOperationId",
      { status: 400 },
    );
  }

  return { correlationId, requestId, agentOperationId };
};

const assertAllowedOperatorForOrg = async (
  requestClient: ReturnType<typeof createRequestClient>,
  organizationId: string,
): Promise<void> => {
  for (const role of TRACE_REPORT_ROLES) {
    if (await assertUserHasOrgRole(requestClient, organizationId, role)) {
      return;
    }
  }

  throw new Response("Forbidden", { status: 403 });
};

const mergeUniqueById = <T extends { id: string }>(...lists: T[][]): T[] => {
  const map = new Map<string, T>();
  for (const list of lists) {
    for (const row of list) {
      map.set(row.id, row);
    }
  }
  return Array.from(map.values());
};

const extractTraceAgentOperationId = (row: TraceRow): string | null => {
  const fromPayload = row.payload?.agentOperationId;
  if (typeof fromPayload === "string" && fromPayload.length > 0) {
    return requireReportIdentifier(fromPayload, "agentOperationId");
  }
  const fromReplay = row.replay_payload?.agentOperationId;
  if (typeof fromReplay === "string" && fromReplay.length > 0) {
    return requireReportIdentifier(fromReplay, "agentOperationId");
  }
  return null;
};

const extractOrchestrationAgentOperationId = (
  row: OrchestrationRow,
): string | null => {
  const candidate = row.inputs?.agentOperationId;
  return typeof candidate === "string" && candidate.length > 0
    ? requireReportIdentifier(candidate, "agentOperationId")
    : null;
};

const extractAuditTrace = (
  row: SessionAuditRow,
): {
  requestId: string | null;
  correlationId: string | null;
  agentOperationId: string | null;
} => {
  const payload = row.event_payload ?? {};
  const trace = (payload.trace ?? {}) as Record<string, unknown>;

  const requestId = typeof trace.requestId === "string"
    ? trace.requestId
    : null;
  const correlationId = typeof trace.correlationId === "string"
    ? trace.correlationId
    : null;
  const topLevelOp = typeof payload.agentOperationId === "string"
    ? payload.agentOperationId
    : null;
  const traceOp = typeof trace.agentOperationId === "string"
    ? trace.agentOperationId
    : null;
  const agentOperationId = topLevelOp ?? traceOp;

  return {
    requestId: requestId
      ? requireReportIdentifier(requestId, "requestId")
      : null,
    correlationId: correlationId
      ? requireReportIdentifier(correlationId, "correlationId")
      : null,
    agentOperationId: agentOperationId
      ? requireReportIdentifier(agentOperationId, "agentOperationId")
      : null,
  };
};

const scopeRowsToOrganization = <T extends { organization_id: string | null }>(
  rows: T[],
  organizationId: string,
): T[] => rows.filter((row) => row.organization_id === organizationId);

const buildTraceDiagnostics = (
  payload: Record<string, unknown> | null,
): Record<string, unknown> => {
  if (!payload) return {};

  const diagnostics: Record<string, unknown> = {};
  const latencyMs = numericValue(payload.latencyMs);
  if (latencyMs !== null) {
    diagnostics.latencyMs = latencyMs;
  }

  for (const key of ["computedCost", "attemptNumber", "retryCount"]) {
    const candidate = numericValue(payload[key]);
    if (candidate !== null) {
      diagnostics[key] = candidate;
    }
  }

  const tokenUsage = sanitizeTokenUsage(payload.tokenUsage);
  if (tokenUsage) {
    diagnostics.tokenUsage = tokenUsage;
  }

  for (
    const key of [
      "outcome",
      "guardrailResult",
      "errorClass",
      "errorCode",
      "provider",
      "model",
      "promptVersion",
      "toolVersion",
      "modelRequestSchemaVersion",
      "pricingVersion",
    ]
  ) {
    const candidate = nonEmptyString(payload[key]);
    if (candidate) {
      if (!SAFE_MACHINE_TOKEN_PATTERN.test(candidate)) {
        throw new Error("Trace diagnostics contain a forbidden value");
      }
      diagnostics[key] = candidate;
    }
  }

  return diagnostics;
};

const sanitizeTraceRow = (row: TraceRow): SanitizedTraceRow => ({
  id: row.id,
  requestId: row.request_id,
  correlationId: row.correlation_id,
  ...(extractTraceAgentOperationId(row)
    ? { agentOperationId: extractTraceAgentOperationId(row) }
    : {}),
  workItemId: nonEmptyString(row.work_item_id ?? null),
  stepId: nonEmptyString(row.step_id ?? null),
  attemptId: nonEmptyString(row.attempt_id ?? null),
  stepName: requireMachineToken(row.step_name, "stepName"),
  stepIndex: row.step_index,
  status: row.status,
  createdAt: row.created_at,
  diagnostics: buildTraceDiagnostics(row.payload),
});

const sanitizeOrchestrationRow = (
  row: OrchestrationRow,
): SanitizedOrchestrationRow => ({
  id: row.id,
  requestId: row.request_id,
  correlationId: row.correlation_id,
  workflow: requireMachineToken(row.workflow, "workflow"),
  status: requireMachineToken(row.status, "orchestration status"),
  createdAt: row.created_at,
  diagnostics: {
    agentOperationId: extractOrchestrationAgentOperationId(row),
    idempotencyKeyPresent: typeof row.inputs?.idempotencyKey === "string" &&
      row.inputs.idempotencyKey.length > 0,
    hasRollbackPlan: Boolean(
      row.rollback_plan && Object.keys(row.rollback_plan).length > 0,
    ),
  },
});

const sanitizeSessionAuditRow = (
  row: SessionAuditRow,
): SanitizedSessionAuditRow => {
  const trace = extractAuditTrace(row);

  return {
    id: row.id,
    sessionId: requireReportIdentifier(row.session_id, "sessionId"),
    eventType: requireMachineToken(row.event_type, "eventType"),
    createdAt: row.created_at,
    requestId: trace.requestId,
    correlationId: trace.correlationId,
    agentOperationId: trace.agentOperationId,
    diagnostics: {
      hasActor: nonEmptyString(row.actor_id) !== null,
      hasTherapist: nonEmptyString(row.therapist_id) !== null,
    },
  };
};

const loadTraceRows = async (
  selector: Selector,
  organizationId: string,
  failOnTruncation = false,
): Promise<TraceRow[]> => {
  const columns =
    "id,request_id,correlation_id,conversation_id,user_id,organization_id,work_item_id,step_id,attempt_id,step_name,step_index,status,payload,replay_payload,created_at";

  if (selector.correlationId || selector.requestId) {
    let query = supabaseAdmin
      .from("agent_execution_traces")
      .select(columns, failOnTruncation ? { count: "exact" } : undefined)
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: true })
      .limit(failOnTruncation ? 501 : 500);

    if (selector.correlationId) {
      query = query.eq("correlation_id", selector.correlationId);
    } else if (selector.requestId) {
      query = query.eq("request_id", selector.requestId);
    }

    const { data, error, count } = await query;
    if (error) throw new Error("agent_trace_query_failed");
    if (
      failOnTruncation &&
      ((typeof count === "number" && count > 500) || (data?.length ?? 0) > 500)
    ) {
      throw new Error("agent_work_replay_trace_incomplete");
    }
    return scopeRowsToOrganization((data ?? []) as TraceRow[], organizationId);
  }

  const agentOperationId = selector.agentOperationId as string;
  const [payloadMatch, replayMatch] = await Promise.all([
    supabaseAdmin
      .from("agent_execution_traces")
      .select(columns, failOnTruncation ? { count: "exact" } : undefined)
      .eq("organization_id", organizationId)
      .contains("payload", { agentOperationId })
      .order("created_at", { ascending: true })
      .limit(failOnTruncation ? 501 : 500),
    supabaseAdmin
      .from("agent_execution_traces")
      .select(columns, failOnTruncation ? { count: "exact" } : undefined)
      .eq("organization_id", organizationId)
      .contains("replay_payload", { agentOperationId })
      .order("created_at", { ascending: true })
      .limit(failOnTruncation ? 501 : 500),
  ]);

  if (payloadMatch.error || replayMatch.error) {
    throw new Error("agent_trace_query_failed");
  }

  if (
    failOnTruncation &&
    [payloadMatch, replayMatch].some((result) =>
      (typeof result.count === "number" && result.count > 500) ||
      (result.data?.length ?? 0) > 500
    )
  ) {
    throw new Error("agent_work_replay_trace_incomplete");
  }

  const merged = mergeUniqueById(
    scopeRowsToOrganization(
      (payloadMatch.data ?? []) as TraceRow[],
      organizationId,
    ),
    scopeRowsToOrganization(
      (replayMatch.data ?? []) as TraceRow[],
      organizationId,
    ),
  ).sort((a, b) => a.created_at.localeCompare(b.created_at));
  if (failOnTruncation && merged.length > 500) {
    throw new Error("agent_work_replay_trace_incomplete");
  }
  return merged;
};

const loadOrchestrationRows = async (
  selector: Selector,
  organizationId: string,
): Promise<OrchestrationRow[]> => {
  const columns =
    "id,organization_id,request_id,correlation_id,workflow,status,inputs,outputs,rollback_plan,created_at";

  if (selector.correlationId || selector.requestId) {
    let query = supabaseAdmin
      .from("scheduling_orchestration_runs")
      .select(columns)
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: true })
      .limit(500);

    if (selector.correlationId) {
      query = query.eq("correlation_id", selector.correlationId);
    } else if (selector.requestId) {
      query = query.eq("request_id", selector.requestId);
    }

    const { data, error } = await query;
    if (error) throw new Error("orchestration_query_failed");
    return scopeRowsToOrganization(
      (data ?? []) as OrchestrationRow[],
      organizationId,
    );
  }

  const { data, error } = await supabaseAdmin
    .from("scheduling_orchestration_runs")
    .select(columns)
    .eq("organization_id", organizationId)
    .contains("inputs", { agentOperationId: selector.agentOperationId })
    .order("created_at", { ascending: true })
    .limit(500);

  if (error) throw new Error("orchestration_query_failed");
  return scopeRowsToOrganization(
    (data ?? []) as OrchestrationRow[],
    organizationId,
  );
};

const loadSessionAuditRows = async (
  selector: Selector,
  organizationId: string,
): Promise<SessionAuditRow[]> => {
  const columns =
    "id,session_id,event_type,event_payload,actor_id,organization_id,therapist_id,created_at";

  if (selector.correlationId) {
    const { data, error } = await supabaseAdmin
      .from("session_audit_logs")
      .select(columns)
      .eq("organization_id", organizationId)
      .contains("event_payload", {
        trace: { correlationId: selector.correlationId },
      })
      .order("created_at", { ascending: true })
      .limit(500);

    if (error) throw new Error("session_audit_query_failed");
    return scopeRowsToOrganization(
      (data ?? []) as SessionAuditRow[],
      organizationId,
    );
  }

  if (selector.requestId) {
    const { data, error } = await supabaseAdmin
      .from("session_audit_logs")
      .select(columns)
      .eq("organization_id", organizationId)
      .contains("event_payload", { trace: { requestId: selector.requestId } })
      .order("created_at", { ascending: true })
      .limit(500);

    if (error) throw new Error("session_audit_query_failed");
    return scopeRowsToOrganization(
      (data ?? []) as SessionAuditRow[],
      organizationId,
    );
  }

  const agentOperationId = selector.agentOperationId as string;
  const [topLevelMatch, nestedTraceMatch] = await Promise.all([
    supabaseAdmin
      .from("session_audit_logs")
      .select(columns)
      .eq("organization_id", organizationId)
      .contains("event_payload", { agentOperationId })
      .order("created_at", { ascending: true })
      .limit(500),
    supabaseAdmin
      .from("session_audit_logs")
      .select(columns)
      .eq("organization_id", organizationId)
      .contains("event_payload", { trace: { agentOperationId } })
      .order("created_at", { ascending: true })
      .limit(500),
  ]);

  if (topLevelMatch.error || nestedTraceMatch.error) {
    throw new Error("session_audit_query_failed");
  }

  return mergeUniqueById(
    scopeRowsToOrganization(
      (topLevelMatch.data ?? []) as SessionAuditRow[],
      organizationId,
    ),
    scopeRowsToOrganization(
      (nestedTraceMatch.data ?? []) as SessionAuditRow[],
      organizationId,
    ),
  ).sort((a, b) => a.created_at.localeCompare(b.created_at));
};

const buildTimeline = (
  traces: SanitizedTraceRow[],
  orchestrations: SanitizedOrchestrationRow[],
  auditRows: SanitizedSessionAuditRow[],
): TimelineEvent[] => {
  const events: TimelineEvent[] = [
    ...traces.map((row) => ({
      source: "agent_execution_traces" as const,
      occurredAt: row.createdAt,
      requestId: row.requestId,
      correlationId: row.correlationId,
      agentOperationId: row.agentOperationId ?? null,
      detail: {
        stepName: row.stepName,
        stepIndex: row.stepIndex,
        status: row.status,
        diagnostics: row.diagnostics,
      },
    })),
    ...orchestrations.map((row) => ({
      source: "scheduling_orchestration_runs" as const,
      occurredAt: row.createdAt,
      requestId: row.requestId,
      correlationId: row.correlationId,
      agentOperationId: nonEmptyString(row.diagnostics.agentOperationId) ??
        null,
      detail: {
        workflow: row.workflow,
        status: row.status,
        diagnostics: row.diagnostics,
      },
    })),
    ...auditRows.map((row) => ({
      source: "session_audit_logs" as const,
      occurredAt: row.createdAt,
      requestId: row.requestId,
      correlationId: row.correlationId,
      agentOperationId: row.agentOperationId,
      detail: {
        sessionId: row.sessionId,
        eventType: row.eventType,
        diagnostics: row.diagnostics,
      },
    })),
  ];

  return events.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
};

const safeSecondsBetween = (
  from: string | undefined,
  to: string,
): number | null => {
  if (!from) return null;
  const start = Date.parse(from);
  const end = Date.parse(to);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return null;
  }
  return Math.floor((end - start) / 1000);
};

const oldestAgeSeconds = (
  timestamps: Array<string | undefined>,
  now: string,
): number | null => {
  const ages = timestamps
    .map((value) => safeSecondsBetween(value, now))
    .filter((value): value is number => value !== null);
  return ages.length === 0 ? null : Math.max(...ages);
};

const median = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
};

const finiteNumber = (value: unknown): number => {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : 0;
};

const sanitizeOperationalMetadata = (
  value: Record<string, unknown>,
): Record<string, string | number> => {
  try {
    return { ...validateStoredEventMetadata(value) } as Record<
      string,
      string | number
    >;
  } catch {
    throw new Error("Operational metadata contains a forbidden value");
  }
};

const safeMachineToken = (value: string | null | undefined): string | null => {
  if (!value || !SAFE_MACHINE_TOKEN_PATTERN.test(value)) return null;
  return value;
};

const buildAgentWorkOperationsReport = (input: AgentWorkOperationsInput) => {
  const nowMs = Date.parse(input.now);
  if (!Number.isFinite(nowMs)) {
    throw new Error("Invalid operations report time");
  }

  const stepsByItem = new Map<string, AgentWorkStepRow[]>();
  for (const step of input.steps) {
    const rows = stepsByItem.get(step.work_item_id) ?? [];
    rows.push(step);
    stepsByItem.set(step.work_item_id, rows);
  }

  const evidenceByItem = new Map<string, number>();
  for (const evidence of input.evidence) {
    evidenceByItem.set(
      evidence.work_item_id,
      (evidenceByItem.get(evidence.work_item_id) ?? 0) + 1,
    );
  }

  const effectsByStep = new Map<string, AgentWorkEffectRow[]>();
  for (const effect of input.effects) {
    const rows = effectsByStep.get(effect.step_id) ?? [];
    rows.push(effect);
    effectsByStep.set(effect.step_id, rows);
  }

  const blocked = input.items.filter((row) => row.status === "blocked");
  const waiting = input.steps.filter((row) => row.status === "waiting");
  const stale = input.steps.filter((row) =>
    row.status === "running" && row.lease_expires_at !== null &&
    typeof row.lease_expires_at === "string" &&
    Date.parse(row.lease_expires_at) <= nowMs
  );
  const retryExhausted = input.steps.filter((row) =>
    (row.last_error_code === "retry_exhausted" || row.status === "failed") &&
    (row.attempt_count ?? 0) >= (row.max_attempts ?? Number.MAX_SAFE_INTEGER)
  );
  const parityEvents = input.events.filter((row) =>
    row.event_type ===
      "assessment.iehp.prepare_for_clinical_review.parity_detected"
  );
  const pendingApprovals = input.approvals.filter((row) =>
    row.status === "pending"
  );
  const verifiedEffects = input.effects.filter((row) =>
    row.status === "verified" && typeof row.verified_at === "string"
  );
  const duplicateEffectsPrevented = input.steps.reduce((total, step) => {
    const hasVerifiedEffect = (effectsByStep.get(step.id) ?? []).some((
      effect,
    ) => effect.status === "verified" && Boolean(effect.verified_at));
    return total +
      (hasVerifiedEffect ? Math.max(0, (step.attempt_count ?? 0) - 1) : 0);
  }, 0);

  const falseCompletion = input.items.filter((item) => {
    if (item.status !== "completed") return false;
    const steps = stepsByItem.get(item.id) ?? [];
    return steps.some((step) =>
      step.status !== "completed" && step.status !== "skipped"
    );
  }).length;
  const unverifiedMutationEffects =
    input.effects.filter((row) => row.status !== "verified" || !row.verified_at)
      .length;
  const approvalBypassOrStaleAcceptance = input.approvals.filter((row) => {
    if (row.status !== "approved") return false;
    const decidedAt = row.decided_at ? Date.parse(row.decided_at) : nowMs;
    return !row.approval_hash || Boolean(row.revoked_at) ||
      (Boolean(row.expires_at) &&
        Date.parse(row.expires_at as string) <= decidedAt);
  }).length;

  let unknownStateTransitions = 0;
  let phiPayloadViolations = 0;
  const validTransitionEvents: AgentWorkEventRow[] = [];
  for (const event of input.events) {
    const toStatus = event.sanitized_metadata.to_status;
    if (
      event.event_type === "step.transitioned" &&
      (typeof toStatus !== "string" || !WORK_STEP_STATUSES.has(toStatus))
    ) {
      unknownStateTransitions += 1;
      continue;
    }
    try {
      sanitizeOperationalMetadata(event.sanitized_metadata);
      if (event.event_type === "step.transitioned") {
        validTransitionEvents.push(event);
      }
    } catch {
      phiPayloadViolations += 1;
    }
  }

  const stepById = new Map(input.steps.map((row) => [row.id, row]));
  const transitionsByStep = new Map<string, AgentWorkEventRow[]>();
  for (const event of validTransitionEvents) {
    if (!event.step_id) continue;
    const rows = transitionsByStep.get(event.step_id) ?? [];
    rows.push(event);
    transitionsByStep.set(event.step_id, rows);
  }
  const timeInEachStateSeconds: Record<string, number> = {};
  for (const [stepId, events] of transitionsByStep.entries()) {
    const ordered = [...events].sort((a, b) =>
      a.created_at.localeCompare(b.created_at)
    );
    const step = stepById.get(stepId);
    for (let index = 0; index < ordered.length; index += 1) {
      const event = ordered[index];
      const state = event.sanitized_metadata.to_status;
      if (typeof state !== "string") continue;
      const end = ordered[index + 1]?.created_at ?? step?.completed_at ??
        step?.updated_at ?? input.now;
      const duration = safeSecondsBetween(event.created_at, end) ?? 0;
      timeInEachStateSeconds[state] = (timeInEachStateSeconds[state] ?? 0) +
        duration;
    }
  }

  const readinessItems = input.items.filter((row) =>
    row.status === "needs_review" || row.status === "completed"
  );
  const readinessWithEvidence =
    readinessItems.filter((row) => (evidenceByItem.get(row.id) ?? 0) > 0)
      .length;
  const readinessEvidenceCoveragePercent = readinessItems.length === 0
    ? 100
    : Math.round(readinessWithEvidence * 10000 / readinessItems.length) / 100;

  const workflowGroups = new Map<string, {
    workflowKey: string;
    workflowVersion: number;
    count: number;
    completed: number;
    blocked: number;
  }>();
  for (const item of input.items) {
    const key = `${item.workflow_key}\u0000${item.workflow_version}`;
    const group = workflowGroups.get(key) ?? {
      workflowKey: item.workflow_key,
      workflowVersion: item.workflow_version,
      count: 0,
      completed: 0,
      blocked: 0,
    };
    group.count += 1;
    if (item.status === "completed") group.completed += 1;
    if (item.status === "blocked") group.blocked += 1;
    workflowGroups.set(key, group);
  }

  const modelGroups = new Map<string, {
    provider: string;
    model: string;
    promptVersion: string;
    toolVersion: string;
    workflowVersion: number;
    modelRequestSchemaVersion: string;
    count: number;
    failures: number;
  }>();
  for (const attempt of input.attempts) {
    const provider = safeMachineToken(attempt.provider) ?? "not_recorded";
    const model = safeMachineToken(attempt.model) ?? "not_recorded";
    const promptVersion = safeMachineToken(attempt.prompt_version) ??
      "not_recorded";
    const toolVersion = safeMachineToken(attempt.tool_version) ??
      "not_recorded";
    const schemaVersion =
      safeMachineToken(attempt.model_request_schema_version) ?? "not_recorded";
    const workflowVersion = attempt.workflow_version ?? 0;
    const key = [
      provider,
      model,
      promptVersion,
      toolVersion,
      workflowVersion,
      schemaVersion,
    ].join("\u0000");
    const group = modelGroups.get(key) ?? {
      provider,
      model,
      promptVersion,
      toolVersion,
      workflowVersion,
      modelRequestSchemaVersion: schemaVersion,
      count: 0,
      failures: 0,
    };
    group.count += 1;
    if (attempt.status === "failed") group.failures += 1;
    modelGroups.set(key, group);
  }

  const completedItems = new Set(
    input.items.filter((row) => row.status === "completed").map((row) =>
      row.id
    ),
  );
  const completedDurations = input.items
    .filter((row) =>
      row.status === "completed" || row.status === "needs_review"
    )
    .map((row) =>
      safeSecondsBetween(
        row.created_at,
        row.completed_at ?? row.updated_at ?? input.now,
      )
    )
    .filter((value): value is number => value !== null);
  const completedAttempts = input.attempts.filter((row) =>
    completedItems.has(row.work_item_id)
  );
  const totalTokens = completedAttempts.reduce(
    (sum, row) =>
      sum + finiteNumber(row.input_token_count) +
      finiteNumber(row.output_token_count),
    0,
  );
  const totalCost = completedAttempts.reduce(
    (sum, row) => sum + finiteNumber(row.computed_cost),
    0,
  );

  return {
    schemaVersion: "agent-work-operations.v1" as const,
    generatedAt: input.now,
    sample: {
      limit: input.limit,
      truncated: input.truncated,
      releaseGateStatus: input.truncated
        ? "blocked_incomplete_sample" as const
        : "evaluable" as const,
    },
    summary: {
      totalWorkItems: input.items.length,
      blockedWorkItems: blocked.length,
      waitingSteps: waiting.length,
      staleLeases: stale.length,
      retryExhaustedSteps: retryExhausted.length,
      parityMismatches: parityEvents.length,
      duplicateEffectsPrevented,
      pendingApprovals: pendingApprovals.length,
      oldestWaitingAgeSeconds: oldestAgeSeconds(
        waiting.map((row) => row.updated_at),
        input.now,
      ),
      oldestApprovalAgeSeconds: oldestAgeSeconds(
        pendingApprovals.map((row) => row.requested_at),
        input.now,
      ),
    },
    rates: {
      retryExhaustionPercent: input.steps.length === 0
        ? 0
        : Math.round(retryExhausted.length * 10000 / input.steps.length) / 100,
      abortPercent: input.items.length === 0 ? 0 : Math.round(
        input.items.filter((row) => row.status === "cancelled").length * 10000 /
          input.items.length,
      ) / 100,
    },
    releaseSignals: input.truncated
      ? {
        crossTenantAccess: null,
        falseCompletion: null,
        unverifiedMutationEffects: null,
        phiPayloadViolations: null,
        approvalBypassOrStaleAcceptance: null,
        unknownStateTransitions: null,
        staleRunningBeyondSlo: null,
        readinessEvidenceCoveragePercent: null,
      }
      : {
        crossTenantAccess: input.crossTenantAccess ?? 0,
        falseCompletion,
        unverifiedMutationEffects,
        phiPayloadViolations,
        approvalBypassOrStaleAcceptance,
        unknownStateTransitions,
        staleRunningBeyondSlo: stale.length,
        readinessEvidenceCoveragePercent,
      },
    aggregations: {
      workflows: Array.from(workflowGroups.values()).sort((a, b) =>
        `${a.workflowKey}:${a.workflowVersion}`.localeCompare(
          `${b.workflowKey}:${b.workflowVersion}`,
        )
      ),
      models: Array.from(modelGroups.values()).sort((a, b) =>
        `${a.provider}:${a.model}:${a.workflowVersion}`.localeCompare(
          `${b.provider}:${b.model}:${b.workflowVersion}`,
        )
      ),
    },
    drilldown: {
      blocked: blocked.slice(0, 50).map((row) => ({
        workItemId: row.id,
        reasonCode: safeMachineToken(row.failure_reason_code) ?? "not_recorded",
      })),
      waiting: waiting.slice(0, 50).map((row) => ({
        workItemId: row.work_item_id,
        stepId: row.id,
        reasonCode: safeMachineToken(row.last_error_code) ?? "waiting",
      })),
      staleLeases: stale.slice(0, 50).map((row) => ({
        workItemId: row.work_item_id,
        stepId: row.id,
        reasonCode: "lease_expired",
      })),
      retryExhausted: retryExhausted.slice(0, 50).map((row) => ({
        workItemId: row.work_item_id,
        stepId: row.id,
        reasonCode: safeMachineToken(row.last_error_code) ?? "retry_exhausted",
      })),
      parityMismatches: parityEvents.slice(0, 50).map((row) => ({
        workItemId: row.work_item_id,
        stepId: row.step_id,
        reasonCode:
          safeMachineToken(row.sanitized_metadata.reason_code as string) ??
            "parity_mismatch",
      })),
    },
    nonBlocking: {
      medianTimeToNeedsReviewSeconds: median(completedDurations),
      retryAbortRatePercent: input.items.length === 0 ? 0 : Math.round(
        input.items.filter((row) =>
          row.status === "failed" || row.status === "cancelled"
        ).length *
          10000 / input.items.length,
      ) / 100,
      humanOverrideRatePercent: input.approvals.length === 0 ? 0 : Math.round(
        input.approvals.filter((row) =>
          row.status === "rejected" || row.status === "revoked"
        ).length *
          10000 / input.approvals.length,
      ) / 100,
      duplicateEffectsPrevented,
      tokensPerCompletedObjective: completedItems.size === 0
        ? null
        : Math.round(totalTokens / completedItems.size),
      costPerCompletedObjective: completedItems.size === 0
        ? null
        : Math.round(totalCost * 1_000_000 / completedItems.size) / 1_000_000,
      timeInEachStateSeconds,
      blockerResolutionTimeSeconds: {
        value: null,
        availability: "unavailable" as const,
        reasonCode: "blocker_resolution_not_recorded",
      },
      clinicianAdministrativeTimeSeconds: {
        value: null,
        availability: "unavailable" as const,
        reasonCode: "not_recorded",
      },
    },
  };
};

const buildAgentWorkReplayPacket = (input: AgentWorkReplayInput) => {
  const guardrails = new Map(
    input.guardrails.map((row) => [row.attemptId, row.outcome]),
  );
  const transitions = input.events
    .filter((row) => row.event_type === "step.transitioned")
    .map((row) => {
      const metadata = sanitizeOperationalMetadata(row.sanitized_metadata);
      const toStatus = metadata.to_status;
      if (typeof toStatus !== "string" || !WORK_STEP_STATUSES.has(toStatus)) {
        throw new Error("Replay packet contains an unknown transition");
      }
      return {
        eventId: row.id,
        stepId: row.step_id,
        attemptId: row.attempt_id,
        toStatus,
        reasonCode: typeof metadata.reason_code === "string"
          ? metadata.reason_code
          : "not_recorded",
        occurredAt: row.created_at,
      };
    });

  return {
    schemaVersion: "agent-work-replay.v1" as const,
    executionAllowed: false as const,
    workItemId: input.item.id,
    workflow: {
      key: requireMachineToken(input.item.workflow_key, "workflow key"),
      version: input.item.workflow_version,
      status: requireMachineToken(input.item.status, "workflow status"),
    },
    steps: input.steps.map((row) => ({
      stepId: row.id,
      stepKey: requireMachineToken(row.step_key, "step key"),
      status: requireMachineToken(row.status, "step status"),
    })),
    stateTransitions: transitions,
    evidence: input.evidence.map((row) => {
      if (!SHA256_PATTERN.test(row.sha256)) {
        throw new Error("Invalid evidence hash");
      }
      return {
        evidenceId: row.id,
        stepId: row.step_id,
        sourceKind: requireMachineToken(
          row.source_kind,
          "evidence source kind",
        ),
        sourceId: requireReportIdentifier(row.source_id, "evidence source id"),
        sha256: requireSha256(row.sha256, "evidence"),
        capturedAt: row.captured_at,
      };
    }),
    approvals: input.approvals.map((row) => ({
      approvalId: row.id,
      stepId: row.step_id,
      status: requireMachineToken(row.status, "approval status"),
      approvalHash: optionalSha256(row.approval_hash, "approval"),
      requestedAt: row.requested_at,
      decidedAt: row.decided_at,
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at,
    })),
    attempts: input.attempts.map((row) => ({
      attemptId: row.id,
      stepId: row.step_id,
      status: row.status,
      provider: safeMachineToken(row.provider) ?? "not_recorded",
      model: safeMachineToken(row.model) ?? "not_recorded",
      promptVersion: safeMachineToken(row.prompt_version) ?? "not_recorded",
      toolVersion: safeMachineToken(row.tool_version) ?? "not_recorded",
      workflowVersion: row.workflow_version,
      modelRequestSchemaVersion:
        safeMachineToken(row.model_request_schema_version) ?? "not_recorded",
      guardrailOutcome: safeMachineToken(guardrails.get(row.id)) ??
        "not_recorded",
      errorCode: safeMachineToken(row.error_code),
      startedAt: row.created_at,
      finishedAt: row.finished_at,
    })),
    effects: input.effects.map((row) => ({
      effectId: row.id,
      stepId: row.step_id,
      attemptId: row.attempt_id,
      effectKind: requireMachineToken(row.effect_kind, "effect kind"),
      targetKind: requireMachineToken(row.target_kind, "effect target kind"),
      targetId: row.target_id === null
        ? null
        : requireReportIdentifier(row.target_id, "effect target id"),
      payloadHash: requireSha256(row.payload_hash, "effect payload"),
      uniqueEffectKey: requireSha256(
        row.unique_effect_key,
        "unique effect key",
      ),
      status: requireMachineToken(row.status, "effect status"),
      verified: row.status === "verified" && Boolean(row.verified_at),
      verifiedAt: row.verified_at,
    })),
  };
};

const AGENT_WORK_REPORT_LIMIT = 500;

const scopeOptionalOrgRows = <T extends { organization_id?: string | null }>(
  rows: T[],
  organizationId: string,
): T[] => rows.filter((row) => row.organization_id === organizationId);

const loadAgentWorkOperations = async (organizationId: string) => {
  const [
    itemsResult,
    stepsResult,
    approvalsResult,
    attemptsResult,
    effectsResult,
    evidenceResult,
    eventsResult,
  ] = await Promise.all([
    supabaseAdmin
      .from("agent_work_items")
      .select(
        "id,organization_id,workflow_key,workflow_version,status,created_at,updated_at,completed_at,failure_reason_code",
        { count: "exact" },
      )
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(AGENT_WORK_REPORT_LIMIT),
    supabaseAdmin
      .from("agent_work_steps")
      .select(
        "id,organization_id,work_item_id,step_key,execution_mode,status,attempt_count,max_attempts,lease_expires_at,updated_at,completed_at,last_error_code",
        { count: "exact" },
      )
      .eq("organization_id", organizationId)
      .order("updated_at", { ascending: false })
      .limit(AGENT_WORK_REPORT_LIMIT),
    supabaseAdmin
      .from("agent_work_approvals")
      .select(
        "id,organization_id,work_item_id,step_id,status,approval_hash,requested_at,decided_at,expires_at,revoked_at,request_reason_code",
        { count: "exact" },
      )
      .eq("organization_id", organizationId)
      .order("requested_at", { ascending: false })
      .limit(AGENT_WORK_REPORT_LIMIT),
    supabaseAdmin
      .from("agent_work_attempts")
      .select(
        "id,organization_id,work_item_id,step_id,status,provider,model,prompt_version,tool_version,workflow_version,model_request_schema_version,input_token_count,output_token_count,computed_cost,error_code,created_at,finished_at",
        { count: "exact" },
      )
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(AGENT_WORK_REPORT_LIMIT),
    supabaseAdmin
      .from("agent_work_effects")
      .select(
        "id,organization_id,work_item_id,step_id,attempt_id,effect_kind,target_kind,target_id,payload_hash,unique_effect_key,status,verified_at",
        { count: "exact" },
      )
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(AGENT_WORK_REPORT_LIMIT),
    supabaseAdmin
      .from("agent_work_evidence")
      .select(
        "id,organization_id,work_item_id,step_id,source_kind,source_id,sha256,captured_at",
        { count: "exact" },
      )
      .eq("organization_id", organizationId)
      .order("captured_at", { ascending: false })
      .limit(AGENT_WORK_REPORT_LIMIT),
    supabaseAdmin
      .from("agent_work_events")
      .select(
        "id,organization_id,work_item_id,step_id,attempt_id,event_type,sanitized_metadata,created_at",
        { count: "exact" },
      )
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(AGENT_WORK_REPORT_LIMIT),
  ]);

  const results = [
    itemsResult,
    stepsResult,
    approvalsResult,
    attemptsResult,
    effectsResult,
    evidenceResult,
    eventsResult,
  ];
  if (results.some((result) => result.error)) {
    throw new Error("agent_work_operations_query_failed");
  }

  const truncated = results.some((result) =>
    typeof result.count === "number" &&
    result.count > (result.data?.length ?? 0)
  );
  const crossTenantAccess = results.reduce(
    (count, result) =>
      count +
      ((result.data ?? []) as Array<{ organization_id?: string | null }>)
        .filter((row) => row.organization_id !== organizationId).length,
    0,
  );

  return buildAgentWorkOperationsReport({
    now: new Date().toISOString(),
    limit: AGENT_WORK_REPORT_LIMIT,
    truncated,
    crossTenantAccess,
    items: scopeOptionalOrgRows(
      (itemsResult.data ?? []) as AgentWorkItemRow[],
      organizationId,
    ),
    steps: scopeOptionalOrgRows(
      (stepsResult.data ?? []) as AgentWorkStepRow[],
      organizationId,
    ),
    approvals: scopeOptionalOrgRows(
      (approvalsResult.data ?? []) as AgentWorkApprovalRow[],
      organizationId,
    ),
    attempts: scopeOptionalOrgRows(
      (attemptsResult.data ?? []) as AgentWorkAttemptRow[],
      organizationId,
    ),
    effects: scopeOptionalOrgRows(
      (effectsResult.data ?? []) as AgentWorkEffectRow[],
      organizationId,
    ),
    evidence: scopeOptionalOrgRows(
      (evidenceResult.data ?? []) as AgentWorkEvidenceRow[],
      organizationId,
    ),
    events: scopeOptionalOrgRows(
      (eventsResult.data ?? []) as AgentWorkEventRow[],
      organizationId,
    ),
  });
};

const loadAgentWorkReplayPackets = async (
  organizationId: string,
  traces: SanitizedTraceRow[],
) => {
  const allWorkItemIds = Array.from(
    new Set(
      traces.map((row) => row.workItemId).filter((value): value is string =>
        Boolean(value)
      ),
    ),
  );
  if (allWorkItemIds.length !== 1) {
    throw new Error("agent_work_replay_requires_one_work_item");
  }
  const workItemIds = allWorkItemIds;

  const selectedStepsByItem = new Map<string, Set<string>>();
  const selectedAttemptsByItem = new Map<string, Set<string>>();
  for (const trace of traces) {
    if (!trace.workItemId) continue;
    if (trace.stepId) {
      const selected = selectedStepsByItem.get(trace.workItemId) ?? new Set();
      selected.add(trace.stepId);
      selectedStepsByItem.set(trace.workItemId, selected);
    }
    if (trace.attemptId) {
      const selected = selectedAttemptsByItem.get(trace.workItemId) ??
        new Set();
      selected.add(trace.attemptId);
      selectedAttemptsByItem.set(trace.workItemId, selected);
    }
  }
  if (
    workItemIds.some((id) =>
      (selectedStepsByItem.get(id)?.size ?? 0) === 0 &&
      (selectedAttemptsByItem.get(id)?.size ?? 0) === 0
    )
  ) {
    throw new Error("agent_work_replay_selector_not_step_bound");
  }

  const [
    itemsResult,
    stepsResult,
    evidenceResult,
    approvalsResult,
    attemptsResult,
    effectsResult,
    eventsResult,
  ] = await Promise.all([
    supabaseAdmin
      .from("agent_work_items")
      .select("id,organization_id,workflow_key,workflow_version,status", {
        count: "exact",
      })
      .eq("organization_id", organizationId)
      .in("id", workItemIds)
      .order("created_at", { ascending: true })
      .limit(51),
    supabaseAdmin
      .from("agent_work_steps")
      .select("id,organization_id,work_item_id,step_key,status", {
        count: "exact",
      })
      .eq("organization_id", organizationId)
      .in("work_item_id", workItemIds)
      .order("ordinal", { ascending: true })
      .limit(AGENT_WORK_REPORT_LIMIT + 1),
    supabaseAdmin
      .from("agent_work_evidence")
      .select(
        "id,organization_id,work_item_id,step_id,source_kind,source_id,sha256,captured_at",
        { count: "exact" },
      )
      .eq("organization_id", organizationId)
      .in("work_item_id", workItemIds)
      .order("captured_at", { ascending: true })
      .limit(AGENT_WORK_REPORT_LIMIT + 1),
    supabaseAdmin
      .from("agent_work_approvals")
      .select(
        "id,organization_id,work_item_id,step_id,status,approval_hash,requested_at,decided_at,expires_at,revoked_at,request_reason_code",
        { count: "exact" },
      )
      .eq("organization_id", organizationId)
      .in("work_item_id", workItemIds)
      .order("requested_at", { ascending: true })
      .limit(AGENT_WORK_REPORT_LIMIT + 1),
    supabaseAdmin
      .from("agent_work_attempts")
      .select(
        "id,organization_id,work_item_id,step_id,status,provider,model,prompt_version,tool_version,workflow_version,model_request_schema_version,error_code,created_at,finished_at",
        { count: "exact" },
      )
      .eq("organization_id", organizationId)
      .in("work_item_id", workItemIds)
      .order("created_at", { ascending: true })
      .limit(AGENT_WORK_REPORT_LIMIT + 1),
    supabaseAdmin
      .from("agent_work_effects")
      .select(
        "id,organization_id,work_item_id,step_id,attempt_id,effect_kind,target_kind,target_id,payload_hash,unique_effect_key,status,verified_at",
        { count: "exact" },
      )
      .eq("organization_id", organizationId)
      .in("work_item_id", workItemIds)
      .order("created_at", { ascending: true })
      .limit(AGENT_WORK_REPORT_LIMIT + 1),
    supabaseAdmin
      .from("agent_work_events")
      .select(
        "id,organization_id,work_item_id,step_id,attempt_id,event_type,sanitized_metadata,created_at",
        { count: "exact" },
      )
      .eq("organization_id", organizationId)
      .in("work_item_id", workItemIds)
      .order("created_at", { ascending: true })
      .limit(AGENT_WORK_REPORT_LIMIT + 1),
  ]);

  const results = [
    itemsResult,
    stepsResult,
    evidenceResult,
    approvalsResult,
    attemptsResult,
    effectsResult,
    eventsResult,
  ];
  if (results.some((result) => result.error)) {
    throw new Error("agent_work_replay_query_failed");
  }
  if (
    (typeof itemsResult.count === "number" && itemsResult.count > 50) ||
    results.slice(1).some((result) =>
      typeof result.count === "number" &&
      result.count > AGENT_WORK_REPORT_LIMIT
    )
  ) {
    throw new Error("agent_work_replay_incomplete");
  }

  const items = scopeOptionalOrgRows(
    (itemsResult.data ?? []) as AgentWorkItemRow[],
    organizationId,
  );
  const steps = scopeOptionalOrgRows(
    (stepsResult.data ?? []) as AgentWorkStepRow[],
    organizationId,
  );
  const evidence = scopeOptionalOrgRows(
    (evidenceResult.data ?? []) as AgentWorkEvidenceRow[],
    organizationId,
  );
  const approvals = scopeOptionalOrgRows(
    (approvalsResult.data ?? []) as AgentWorkApprovalRow[],
    organizationId,
  );
  const attempts = scopeOptionalOrgRows(
    (attemptsResult.data ?? []) as AgentWorkAttemptRow[],
    organizationId,
  );
  const effects = scopeOptionalOrgRows(
    (effectsResult.data ?? []) as AgentWorkEffectRow[],
    organizationId,
  );
  const events = scopeOptionalOrgRows(
    (eventsResult.data ?? []) as AgentWorkEventRow[],
    organizationId,
  );
  const guardrails = traces
    .filter((row) =>
      row.attemptId && typeof row.diagnostics.guardrailResult === "string"
    )
    .map((row) => ({
      attemptId: row.attemptId as string,
      outcome: row.diagnostics.guardrailResult as string,
    }));

  return items.map((item) => {
    const selectedStepIds = selectedStepsByItem.get(item.id) ?? new Set();
    const selectedAttemptIds = selectedAttemptsByItem.get(item.id) ??
      new Set();
    const matchesStep = (stepId: string | null) =>
      stepId !== null && selectedStepIds.has(stepId);
    const matchesAttemptOrStep = (
      attemptId: string | null,
      stepId: string | null,
    ) =>
      selectedAttemptIds.size > 0
        ? attemptId !== null && selectedAttemptIds.has(attemptId)
        : matchesStep(stepId);

    return buildAgentWorkReplayPacket({
      item,
      steps: steps.filter((row) =>
        row.work_item_id === item.id && selectedStepIds.has(row.id)
      ),
      evidence: evidence.filter((row) =>
        row.work_item_id === item.id && matchesStep(row.step_id)
      ),
      approvals: approvals.filter((row) =>
        row.work_item_id === item.id && matchesStep(row.step_id)
      ),
      attempts: attempts.filter((row) =>
        row.work_item_id === item.id && selectedAttemptIds.has(row.id)
      ),
      effects: effects.filter((row) =>
        row.work_item_id === item.id &&
        matchesAttemptOrStep(row.attempt_id, row.step_id)
      ),
      events: events.filter((row) =>
        row.work_item_id === item.id &&
        matchesAttemptOrStep(row.attempt_id, row.step_id)
      ),
      guardrails: guardrails.filter((row) =>
        selectedAttemptIds.has(row.attemptId)
      ),
    });
  });
};

export const __TESTING__ = {
  parseSelector,
  scopeRowsToOrganization,
  sanitizeTraceRow,
  buildTimeline,
  sanitizeOperationalMetadata,
  buildAgentWorkOperationsReport,
  buildAgentWorkReplayPacket,
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "GET" && req.method !== "POST") {
    return jsonResponse({ success: false, error: "Method not allowed" }, 405);
  }

  const logger = getLogger(req, { functionName: "agent-trace-report" });

  try {
    const requestClient = createRequestClient(req);
    const user = await getUserOrThrow(requestClient);
    const organizationId = await resolveOrgId(requestClient);
    if (!organizationId) {
      throw new Response("Forbidden", { status: 403 });
    }
    await assertAllowedOperatorForOrg(requestClient, organizationId);

    const body = req.method === "POST"
      ? await req.json().catch(() => ({}))
      : {};
    const mode = typeof body === "object" && body !== null
      ? normalizeText((body as Record<string, unknown>).mode)
      : undefined;
    if (mode === "operations") {
      const operations = await loadAgentWorkOperations(organizationId);
      logger.info("operations_report.requested", {
        truncated: operations.sample.truncated,
      });
      return jsonResponse({
        success: true,
        data: { operations },
      });
    }
    if (mode === "replay") {
      const selector = parseSelector(req, body);
      const traces = await loadTraceRows(selector, organizationId, true);
      const replayPackets = await loadAgentWorkReplayPackets(
        organizationId,
        traces.map(sanitizeTraceRow),
      );
      logger.info("replay_packet.requested", {
        packetCount: replayPackets.length,
      });
      return jsonResponse({
        success: true,
        data: { selector, replayPackets },
      });
    }
    if (mode) {
      throw new Response("Invalid report mode", { status: 400 });
    }
    const selector = parseSelector(req, body);

    logger.info("report.requested");

    const [traces, orchestrations, auditRows] = await Promise.all([
      loadTraceRows(selector, organizationId),
      loadOrchestrationRows(selector, organizationId),
      loadSessionAuditRows(selector, organizationId),
    ]);

    const sanitizedTraces = traces.map(sanitizeTraceRow);
    const sanitizedOrchestrations = orchestrations.map(
      sanitizeOrchestrationRow,
    );
    const sanitizedAuditRows = auditRows.map(sanitizeSessionAuditRow);

    const timeline = buildTimeline(
      sanitizedTraces,
      sanitizedOrchestrations,
      sanitizedAuditRows,
    );
    const summary = {
      traces: sanitizedTraces.length,
      orchestrationRuns: sanitizedOrchestrations.length,
      sessionAuditRows: sanitizedAuditRows.length,
      timelineEvents: timeline.length,
      requestIds: Array.from(
        new Set([
          ...sanitizedTraces.map((row) => row.requestId),
          ...sanitizedOrchestrations.map((row) => row.requestId),
          ...timeline.map((event) => event.requestId).filter((
            value,
          ): value is string => typeof value === "string"),
        ]),
      ),
      correlationIds: Array.from(
        new Set([
          ...sanitizedTraces.map((row) => row.correlationId),
          ...sanitizedOrchestrations.map((row) => row.correlationId),
          ...timeline.map((event) => event.correlationId).filter((
            value,
          ): value is string => typeof value === "string"),
        ]),
      ),
      agentOperationIds: Array.from(
        new Set(
          timeline
            .map((event) => event.agentOperationId)
            .filter((value): value is string => typeof value === "string"),
        ),
      ),
    };

    return jsonResponse({
      success: true,
      data: {
        selector,
        organizationId,
        summary,
        timeline,
        traces: sanitizedTraces,
        orchestrationRuns: sanitizedOrchestrations,
        sessionAudit: sanitizedAuditRows,
      },
    });
  } catch (error) {
    if (error instanceof Response) {
      return jsonResponse(
        { success: false, error: await error.text() },
        error.status,
      );
    }

    logger.error("report.failed", { errorCode: "trace_report_failed" });

    return jsonResponse(
      { success: false, error: "Internal server error" },
      500,
    );
  }
});
