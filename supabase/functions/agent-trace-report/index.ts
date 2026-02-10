import { createRequestClient, supabaseAdmin } from "../_shared/database.ts";
import { getUserOrThrow } from "../_shared/auth.ts";
import { getLogger } from "../_shared/logging.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
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

type IdempotencyRow = {
  id: string;
  endpoint: string;
  idempotency_key: string;
  status_code: number;
  response_body: Record<string, unknown>;
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
  source: "agent_execution_traces" | "scheduling_orchestration_runs" | "function_idempotency_keys" | "session_audit_logs";
  occurredAt: string;
  requestId: string | null;
  correlationId: string | null;
  agentOperationId: string | null;
  detail: Record<string, unknown>;
};

const ADMIN_ROLES = new Set(["admin", "super_admin", "monitoring"]);

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

const parseSelector = (req: Request, body: unknown): Selector => {
  const url = new URL(req.url);
  const fromBody = typeof body === "object" && body !== null ? body as Record<string, unknown> : {};

  const correlationId = normalizeText(fromBody.correlationId) ??
    normalizeText(url.searchParams.get("correlationId"));
  const requestId = normalizeText(fromBody.requestId) ??
    normalizeText(url.searchParams.get("requestId"));
  const agentOperationId = normalizeText(fromBody.agentOperationId) ??
    normalizeText(url.searchParams.get("agentOperationId"));

  if (!correlationId && !requestId && !agentOperationId) {
    throw new Response("Provide correlationId, requestId, or agentOperationId", { status: 400 });
  }

  return { correlationId, requestId, agentOperationId };
};

const parseRoleEntries = (data: unknown): string[] => {
  if (!Array.isArray(data)) return [];

  return data.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [] as string[];
    const rolesValue = (entry as { roles?: unknown }).roles;

    if (Array.isArray(rolesValue)) {
      return rolesValue
        .filter((role): role is string => typeof role === "string")
        .map((role) => role.trim().toLowerCase())
        .filter(Boolean);
    }

    if (typeof rolesValue === "string") {
      const trimmed = rolesValue.trim();
      if (!trimmed) return [];

      try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (Array.isArray(parsed)) {
          return parsed
            .filter((role): role is string => typeof role === "string")
            .map((role) => role.trim().toLowerCase())
            .filter(Boolean);
        }
      } catch {
        // fall through
      }

      return trimmed.split(",").map((role) => role.trim().toLowerCase()).filter(Boolean);
    }

    return [] as string[];
  });
};

const assertAllowedOperator = async (requestClient: ReturnType<typeof createRequestClient>): Promise<void> => {
  const { data, error } = await requestClient.rpc("get_user_roles");
  if (error) {
    throw new Response("Role check failed", { status: 500 });
  }

  const roles = parseRoleEntries(data);
  const allowed = roles.some((role) => ADMIN_ROLES.has(role));
  if (!allowed) {
    throw new Response("Forbidden", { status: 403 });
  }
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
  if (typeof fromPayload === "string" && fromPayload.length > 0) return fromPayload;
  const fromReplay = row.replay_payload?.agentOperationId;
  if (typeof fromReplay === "string" && fromReplay.length > 0) return fromReplay;
  return null;
};

const extractOrchestrationAgentOperationId = (row: OrchestrationRow): string | null => {
  const candidate = row.inputs?.agentOperationId;
  return typeof candidate === "string" && candidate.length > 0 ? candidate : null;
};

const extractAuditTrace = (
  row: SessionAuditRow,
): { requestId: string | null; correlationId: string | null; agentOperationId: string | null } => {
  const payload = row.event_payload ?? {};
  const trace = (payload.trace ?? {}) as Record<string, unknown>;

  const requestId = typeof trace.requestId === "string" ? trace.requestId : null;
  const correlationId = typeof trace.correlationId === "string" ? trace.correlationId : null;
  const topLevelOp = typeof payload.agentOperationId === "string" ? payload.agentOperationId : null;
  const traceOp = typeof trace.agentOperationId === "string" ? trace.agentOperationId : null;

  return {
    requestId,
    correlationId,
    agentOperationId: topLevelOp ?? traceOp,
  };
};

const parseAgentOperationFromIdempotencyKey = (key: string): string | null => {
  const parts = key.split(":").map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  return parts[parts.length - 1] ?? null;
};

const loadTraceRows = async (selector: Selector): Promise<TraceRow[]> => {
  const columns =
    "id,request_id,correlation_id,conversation_id,user_id,organization_id,step_name,step_index,status,payload,replay_payload,created_at";

  if (selector.correlationId || selector.requestId) {
    let query = supabaseAdmin
      .from("agent_execution_traces")
      .select(columns)
      .order("created_at", { ascending: true })
      .limit(500);

    if (selector.correlationId) {
      query = query.eq("correlation_id", selector.correlationId);
    } else if (selector.requestId) {
      query = query.eq("request_id", selector.requestId);
    }

    const { data, error } = await query;
    if (error) throw new Error(`Failed to load agent traces: ${error.message}`);
    return (data ?? []) as TraceRow[];
  }

  const agentOperationId = selector.agentOperationId as string;
  const [payloadMatch, replayMatch] = await Promise.all([
    supabaseAdmin
      .from("agent_execution_traces")
      .select(columns)
      .contains("payload", { agentOperationId })
      .order("created_at", { ascending: true })
      .limit(500),
    supabaseAdmin
      .from("agent_execution_traces")
      .select(columns)
      .contains("replay_payload", { agentOperationId })
      .order("created_at", { ascending: true })
      .limit(500),
  ]);

  if (payloadMatch.error) throw new Error(`Failed to load agent traces: ${payloadMatch.error.message}`);
  if (replayMatch.error) throw new Error(`Failed to load replay traces: ${replayMatch.error.message}`);

  return mergeUniqueById(
    (payloadMatch.data ?? []) as TraceRow[],
    (replayMatch.data ?? []) as TraceRow[],
  ).sort((a, b) => a.created_at.localeCompare(b.created_at));
};

const loadOrchestrationRows = async (selector: Selector): Promise<OrchestrationRow[]> => {
  const columns =
    "id,organization_id,request_id,correlation_id,workflow,status,inputs,outputs,rollback_plan,created_at";

  if (selector.correlationId || selector.requestId) {
    let query = supabaseAdmin
      .from("scheduling_orchestration_runs")
      .select(columns)
      .order("created_at", { ascending: true })
      .limit(500);

    if (selector.correlationId) {
      query = query.eq("correlation_id", selector.correlationId);
    } else if (selector.requestId) {
      query = query.eq("request_id", selector.requestId);
    }

    const { data, error } = await query;
    if (error) throw new Error(`Failed to load orchestration runs: ${error.message}`);
    return (data ?? []) as OrchestrationRow[];
  }

  const { data, error } = await supabaseAdmin
    .from("scheduling_orchestration_runs")
    .select(columns)
    .contains("inputs", { agentOperationId: selector.agentOperationId })
    .order("created_at", { ascending: true })
    .limit(500);

  if (error) throw new Error(`Failed to load orchestration runs: ${error.message}`);
  return (data ?? []) as OrchestrationRow[];
};

const loadIdempotencyRows = async (selector: Selector, keyHints: string[]): Promise<IdempotencyRow[]> => {
  const columns = "id,endpoint,idempotency_key,status_code,response_body,created_at";
  let query = supabaseAdmin
    .from("function_idempotency_keys")
    .select(columns)
    .order("created_at", { ascending: true })
    .limit(500);

  const dedupedKeys = Array.from(new Set(keyHints.filter((key) => key.length > 0)));
  if (dedupedKeys.length > 0) {
    query = query.in("idempotency_key", dedupedKeys);
  } else if (selector.agentOperationId) {
    query = query.ilike("idempotency_key", `%:${selector.agentOperationId}`);
  } else {
    return [];
  }

  const { data, error } = await query;
  if (error) throw new Error(`Failed to load idempotency records: ${error.message}`);
  return (data ?? []) as IdempotencyRow[];
};

const loadSessionAuditRows = async (selector: Selector): Promise<SessionAuditRow[]> => {
  const columns = "id,session_id,event_type,event_payload,actor_id,organization_id,therapist_id,created_at";

  if (selector.correlationId) {
    const { data, error } = await supabaseAdmin
      .from("session_audit_logs")
      .select(columns)
      .contains("event_payload", { trace: { correlationId: selector.correlationId } })
      .order("created_at", { ascending: true })
      .limit(500);

    if (error) throw new Error(`Failed to load session audit logs: ${error.message}`);
    return (data ?? []) as SessionAuditRow[];
  }

  if (selector.requestId) {
    const { data, error } = await supabaseAdmin
      .from("session_audit_logs")
      .select(columns)
      .contains("event_payload", { trace: { requestId: selector.requestId } })
      .order("created_at", { ascending: true })
      .limit(500);

    if (error) throw new Error(`Failed to load session audit logs: ${error.message}`);
    return (data ?? []) as SessionAuditRow[];
  }

  const agentOperationId = selector.agentOperationId as string;
  const [topLevelMatch, nestedTraceMatch] = await Promise.all([
    supabaseAdmin
      .from("session_audit_logs")
      .select(columns)
      .contains("event_payload", { agentOperationId })
      .order("created_at", { ascending: true })
      .limit(500),
    supabaseAdmin
      .from("session_audit_logs")
      .select(columns)
      .contains("event_payload", { trace: { agentOperationId } })
      .order("created_at", { ascending: true })
      .limit(500),
  ]);

  if (topLevelMatch.error) throw new Error(`Failed to load session audit logs: ${topLevelMatch.error.message}`);
  if (nestedTraceMatch.error) throw new Error(`Failed to load session audit logs: ${nestedTraceMatch.error.message}`);

  return mergeUniqueById(
    (topLevelMatch.data ?? []) as SessionAuditRow[],
    (nestedTraceMatch.data ?? []) as SessionAuditRow[],
  ).sort((a, b) => a.created_at.localeCompare(b.created_at));
};

const buildTimeline = (
  traces: TraceRow[],
  orchestrations: OrchestrationRow[],
  idempotencyRows: IdempotencyRow[],
  auditRows: SessionAuditRow[],
): TimelineEvent[] => {
  const events: TimelineEvent[] = [
    ...traces.map((row) => ({
      source: "agent_execution_traces" as const,
      occurredAt: row.created_at,
      requestId: row.request_id,
      correlationId: row.correlation_id,
      agentOperationId: extractTraceAgentOperationId(row),
      detail: {
        stepName: row.step_name,
        stepIndex: row.step_index,
        status: row.status,
      },
    })),
    ...orchestrations.map((row) => ({
      source: "scheduling_orchestration_runs" as const,
      occurredAt: row.created_at,
      requestId: row.request_id,
      correlationId: row.correlation_id,
      agentOperationId: extractOrchestrationAgentOperationId(row),
      detail: {
        workflow: row.workflow,
        status: row.status,
      },
    })),
    ...idempotencyRows.map((row) => ({
      source: "function_idempotency_keys" as const,
      occurredAt: row.created_at,
      requestId: null,
      correlationId: null,
      agentOperationId: parseAgentOperationFromIdempotencyKey(row.idempotency_key),
      detail: {
        endpoint: row.endpoint,
        idempotencyKey: row.idempotency_key,
        statusCode: row.status_code,
      },
    })),
    ...auditRows.map((row) => {
      const trace = extractAuditTrace(row);
      return {
        source: "session_audit_logs" as const,
        occurredAt: row.created_at,
        requestId: trace.requestId,
        correlationId: trace.correlationId,
        agentOperationId: trace.agentOperationId,
        detail: {
          sessionId: row.session_id,
          eventType: row.event_type,
        },
      };
    }),
  ];

  return events.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
};

export const __TESTING__ = {
  parseSelector,
  parseAgentOperationFromIdempotencyKey,
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
    await assertAllowedOperator(requestClient);

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const selector = parseSelector(req, body);

    logger.info("report.requested", {
      userId: user.id,
      selector,
    });

    const traces = await loadTraceRows(selector);
    const orchestrations = await loadOrchestrationRows(selector);

    const idempotencyKeyHints = orchestrations
      .map((run) => run.inputs?.idempotencyKey)
      .filter((value): value is string => typeof value === "string" && value.length > 0);
    const idempotencyRows = await loadIdempotencyRows(selector, idempotencyKeyHints);
    const auditRows = await loadSessionAuditRows(selector);

    const timeline = buildTimeline(traces, orchestrations, idempotencyRows, auditRows);

    const summary = {
      traces: traces.length,
      orchestrationRuns: orchestrations.length,
      idempotencyRows: idempotencyRows.length,
      sessionAuditRows: auditRows.length,
      timelineEvents: timeline.length,
      requestIds: Array.from(new Set([
        ...traces.map((row) => row.request_id),
        ...orchestrations.map((row) => row.request_id),
        ...timeline.map((event) => event.requestId).filter((value): value is string => typeof value === "string"),
      ])),
      correlationIds: Array.from(new Set([
        ...traces.map((row) => row.correlation_id),
        ...orchestrations.map((row) => row.correlation_id),
        ...timeline.map((event) => event.correlationId).filter((value): value is string => typeof value === "string"),
      ])),
      agentOperationIds: Array.from(new Set(
        timeline
          .map((event) => event.agentOperationId)
          .filter((value): value is string => typeof value === "string"),
      )),
    };

    return jsonResponse({
      success: true,
      data: {
        selector,
        summary,
        timeline,
        traces,
        orchestrationRuns: orchestrations,
        idempotency: idempotencyRows,
        sessionAudit: auditRows,
      },
    });
  } catch (error) {
    if (error instanceof Response) {
      return jsonResponse({ success: false, error: await error.text() }, error.status);
    }

    logger.error("report.failed", {
      error: error instanceof Error ? error.message : String(error),
    });

    return jsonResponse(
      { success: false, error: error instanceof Error ? error.message : "Internal server error" },
      500,
    );
  }
});
