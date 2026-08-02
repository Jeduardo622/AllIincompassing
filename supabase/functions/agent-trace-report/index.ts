import { createRequestClient, supabaseAdmin } from "../_shared/database.ts";
import { getUserOrThrow } from "../_shared/auth.ts";
import { getLogger } from "../_shared/logging.ts";
import { resolveAllowedOrigin } from "../_shared/cors.ts";
import { assertUserHasOrgRole, resolveOrgId } from "../_shared/org.ts";

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

const SELECTOR_VALUE_PATTERN = /^[A-Za-z0-9._:/-]{1,200}$/;
const TRACE_REPORT_ROLES = ["admin", "super_admin", "monitoring"] as const;

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
    return fromPayload;
  }
  const fromReplay = row.replay_payload?.agentOperationId;
  if (typeof fromReplay === "string" && fromReplay.length > 0) {
    return fromReplay;
  }
  return null;
};

const extractOrchestrationAgentOperationId = (
  row: OrchestrationRow,
): string | null => {
  const candidate = row.inputs?.agentOperationId;
  return typeof candidate === "string" && candidate.length > 0
    ? candidate
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

  return {
    requestId,
    correlationId,
    agentOperationId: topLevelOp ?? traceOp,
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
  stepName: row.step_name,
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
  workflow: row.workflow,
  status: row.status,
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
    sessionId: row.session_id,
    eventType: row.event_type,
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
): Promise<TraceRow[]> => {
  const columns =
    "id,request_id,correlation_id,conversation_id,user_id,organization_id,work_item_id,step_id,attempt_id,step_name,step_index,status,payload,replay_payload,created_at";

  if (selector.correlationId || selector.requestId) {
    let query = supabaseAdmin
      .from("agent_execution_traces")
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
    if (error) throw new Error("agent_trace_query_failed");
    return scopeRowsToOrganization((data ?? []) as TraceRow[], organizationId);
  }

  const agentOperationId = selector.agentOperationId as string;
  const [payloadMatch, replayMatch] = await Promise.all([
    supabaseAdmin
      .from("agent_execution_traces")
      .select(columns)
      .eq("organization_id", organizationId)
      .contains("payload", { agentOperationId })
      .order("created_at", { ascending: true })
      .limit(500),
    supabaseAdmin
      .from("agent_execution_traces")
      .select(columns)
      .eq("organization_id", organizationId)
      .contains("replay_payload", { agentOperationId })
      .order("created_at", { ascending: true })
      .limit(500),
  ]);

  if (payloadMatch.error || replayMatch.error) {
    throw new Error("agent_trace_query_failed");
  }

  return mergeUniqueById(
    scopeRowsToOrganization(
      (payloadMatch.data ?? []) as TraceRow[],
      organizationId,
    ),
    scopeRowsToOrganization(
      (replayMatch.data ?? []) as TraceRow[],
      organizationId,
    ),
  ).sort((a, b) => a.created_at.localeCompare(b.created_at));
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

export const __TESTING__ = {
  parseSelector,
  scopeRowsToOrganization,
  sanitizeTraceRow,
  buildTimeline,
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
    const selector = parseSelector(req, body);

    logger.info("report.requested", {
      userId: user.id,
      organizationId,
      selector,
    });

    const traces = await loadTraceRows(selector, organizationId);
    const orchestrations = await loadOrchestrationRows(
      selector,
      organizationId,
    );

    const auditRows = await loadSessionAuditRows(selector, organizationId);

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
