import { createRequestClient, supabaseAdmin } from "./database.ts";
import { resolveOrgId } from "./org.ts";
import { getRequestId } from "../lib/http/error.ts";

export type SchedulingWorkflow = "hold" | "confirm" | "cancel" | "reschedule";
export type SchedulingExecutionMode = "suggestion" | "enforced";

export type SchedulingOrchestrationRequest = {
  req: Request;
  workflow: SchedulingWorkflow;
  actorId: string | null;
  actorRole?: string | null;
  executionMode?: SchedulingExecutionMode;
  request: {
    therapistId?: string | null;
    clientId?: string | null;
    startTime?: string | null;
    endTime?: string | null;
    timeZone?: string | null;
    holdKey?: string | null;
    sessionId?: string | null;
    idempotencyKey?: string | null;
    conflictCode?: string | null;
    retryAfter?: string | null;
  };
  authorization?: {
    ok: boolean;
    reason?: string | null;
  };
  allowAi?: boolean;
  allowedTools?: string[];
};

export type SchedulingDelegationStep = {
  name: string;
  status: "ok" | "skipped" | "blocked" | "error";
  detail?: Record<string, unknown> | null;
};

export type SchedulingOrchestrationResult = {
  status: "ok" | "skipped" | "blocked" | "error";
  orchestrationId?: string | null;
  workflow: SchedulingWorkflow;
  decision?: {
    conflictDetected?: boolean;
    conflictCode?: string | null;
    retryAfter?: string | null;
  };
  alternatives?: Record<string, unknown> | null;
  authorization?: {
    ok: boolean;
    reason?: string | null;
  };
  rollbackPlan?: Record<string, unknown> | null;
  ai?: {
    response?: string | null;
    action?: { type: string; data: Record<string, unknown> } | null;
  } | null;
  steps?: SchedulingDelegationStep[];
  error?: { message: string; code?: string | null } | null;
  trace?: { requestId: string; correlationId: string };
};

const AI_DEFAULT_ALLOWED_TOOLS = ["predict_conflicts", "suggest_optimal_times"];

const getEnv = (key: string): string =>
  (typeof Deno !== "undefined" ? Deno.env.get(key) ?? "" : "");

const resolveSupabaseFunctionUrl = (functionName: string): string => {
  const base = getEnv("SUPABASE_URL").replace(/\/$/, "");
  return `${base}/functions/v1/${functionName}`;
};

const isAiOrchestrationEnabled = (): boolean => {
  const disabled = getEnv("SCHEDULING_ORCHESTRATION_DISABLED");
  return disabled.trim().toLowerCase() !== "true";
};

const buildRollbackPlan = (
  workflow: SchedulingWorkflow,
  conflictCode: string | null | undefined,
  retryAfter: string | null | undefined,
  holdKey: string | null | undefined,
): Record<string, unknown> | null => {
  if (workflow === "hold" || workflow === "confirm") {
    return {
      action: "retry_hold",
      holdKey,
      retryAfter,
      conflictCode,
      guidance: retryAfter
        ? "Retry after the suggested time window."
        : "Retry with alternate time suggestions.",
    };
  }
  if (workflow === "cancel") {
    return {
      action: "reacquire_hold",
      holdKey,
      guidance: "If cancellation was unintended, re-acquire a new hold.",
    };
  }
  if (workflow === "reschedule") {
    return {
      action: "propose_alternatives",
      conflictCode,
      guidance: "Use alternative time suggestions to reschedule safely.",
    };
  }
  return null;
};

const computeDurationMinutes = (startTime?: string | null, endTime?: string | null): number | null => {
  if (!startTime || !endTime) return null;
  const start = Date.parse(startTime);
  const end = Date.parse(endTime);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const minutes = Math.round((end - start) / 60000);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : null;
};

const buildAiMessage = (
  workflow: SchedulingWorkflow,
  request: SchedulingOrchestrationRequest["request"],
): string => {
  const conflictCode = request.conflictCode ? ` conflictCode=${request.conflictCode}` : "";
  return `Scheduling delegation for ${workflow}.${conflictCode} Provide conflict analysis and alternative times.`;
};

const insertOrchestrationRun = async (
  payload: Record<string, unknown>,
): Promise<string | null> => {
  try {
    const { data, error } = await supabaseAdmin
      .from("scheduling_orchestration_runs")
      .insert(payload)
      .select("id")
      .maybeSingle();
    if (error) {
      console.warn("scheduling_orchestration_runs insert failed", error.message ?? "unknown");
      return null;
    }
    return (data as { id?: string } | null)?.id ?? null;
  } catch (error) {
    console.warn("scheduling_orchestration_runs insert failed", String(error));
    return null;
  }
};

const invokeAiAgent = async (
  req: Request,
  message: string,
  context: Record<string, unknown>,
  allowedTools: string[],
  timeoutMs = 2500,
): Promise<{ response?: string; action?: { type: string; data: Record<string, unknown> } } | null> => {
  const url = resolveSupabaseFunctionUrl("ai-agent-optimized");
  if (!url || !url.startsWith("http")) {
    return null;
  }
  const headers = new Headers();
  const auth = req.headers.get("Authorization");
  if (auth) headers.set("Authorization", auth);
  const anon = getEnv("SUPABASE_ANON_KEY");
  if (anon) headers.set("apikey", anon);
  headers.set("Content-Type", "application/json");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        message,
        context: {
          ...context,
          guardrails: { allowedTools },
        },
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      return null;
    }
    const body = await response.json() as {
      response?: string;
      action?: { type: string; data: Record<string, unknown> };
    };
    return { response: body.response, action: body.action };
  } catch (error) {
    console.warn("ai-agent-optimized invocation failed", String(error));
    return null;
  } finally {
    clearTimeout(timeout);
  }
};

export async function orchestrateScheduling(
  input: SchedulingOrchestrationRequest,
): Promise<SchedulingOrchestrationResult> {
  const requestId = getRequestId(input.req);
  const correlationId = input.req.headers.get("x-correlation-id") ?? requestId;
  const executionMode: SchedulingExecutionMode = input.executionMode ?? "suggestion";
  const steps: SchedulingDelegationStep[] = [];

  const db = createRequestClient(input.req);
  const orgId = await resolveOrgId(db);
  if (!orgId) {
    steps.push({ name: "tenant-scope", status: "blocked", detail: { reason: "missing-org" } });
    const rollbackPlan = buildRollbackPlan(
      input.workflow,
      input.request.conflictCode,
      input.request.retryAfter,
      input.request.holdKey,
    );
    await insertOrchestrationRun({
      organization_id: null,
      request_id: requestId,
      correlation_id: correlationId,
      workflow: input.workflow,
      status: "blocked",
      inputs: input.request,
      outputs: { rollbackPlan },
      rollback_plan: rollbackPlan,
    });
    return {
      status: "blocked",
      workflow: input.workflow,
      authorization: input.authorization ?? { ok: true },
      rollbackPlan,
      steps,
      trace: { requestId, correlationId },
      error: { message: "Organization context required", code: "missing_org" },
    };
  }

  const allowAi = input.allowAi ?? true;
  if (!allowAi || !isAiOrchestrationEnabled()) {
    steps.push({ name: "ai-orchestration", status: "skipped", detail: { reason: "disabled" } });
    const rollbackPlan = buildRollbackPlan(
      input.workflow,
      input.request.conflictCode,
      input.request.retryAfter,
      input.request.holdKey,
    );
    const orchestrationId = await insertOrchestrationRun({
      organization_id: orgId,
      request_id: requestId,
      correlation_id: correlationId,
      workflow: input.workflow,
      status: "skipped",
      inputs: input.request,
      outputs: { rollbackPlan },
      rollback_plan: rollbackPlan,
    });
    return {
      status: "skipped",
      orchestrationId,
      workflow: input.workflow,
      authorization: input.authorization ?? { ok: true },
      rollbackPlan,
      steps,
      trace: { requestId, correlationId },
    };
  }

  const durationMinutes = computeDurationMinutes(
    input.request.startTime,
    input.request.endTime,
  );
  const aiContext = {
    workflow: input.workflow,
    executionMode,
    actor: {
      id: input.actorId,
      role: input.actorRole ?? null,
    },
    tenant: {
      organizationId: orgId,
    },
    request: {
      therapistId: input.request.therapistId ?? null,
      clientId: input.request.clientId ?? null,
      startTime: input.request.startTime ?? null,
      endTime: input.request.endTime ?? null,
      timeZone: input.request.timeZone ?? null,
      holdKey: input.request.holdKey ?? null,
      sessionId: input.request.sessionId ?? null,
      durationMinutes,
    },
    conflict: {
      code: input.request.conflictCode ?? null,
      retryAfter: input.request.retryAfter ?? null,
    },
  };

  const allowedTools = Array.isArray(input.allowedTools) && input.allowedTools.length > 0
    ? input.allowedTools
    : AI_DEFAULT_ALLOWED_TOOLS;
  const aiMessage = buildAiMessage(input.workflow, input.request);
  const aiResult = await invokeAiAgent(input.req, aiMessage, aiContext, allowedTools);

  if (!aiResult) {
    steps.push({ name: "ai-orchestration", status: "error", detail: { reason: "no-response" } });
    const rollbackPlan = buildRollbackPlan(
      input.workflow,
      input.request.conflictCode,
      input.request.retryAfter,
      input.request.holdKey,
    );
    const orchestrationId = await insertOrchestrationRun({
      organization_id: orgId,
      request_id: requestId,
      correlation_id: correlationId,
      workflow: input.workflow,
      status: "error",
      inputs: input.request,
      outputs: { rollbackPlan },
      rollback_plan: rollbackPlan,
    });
    return {
      status: "error",
      orchestrationId,
      workflow: input.workflow,
      authorization: input.authorization ?? { ok: true },
      rollbackPlan,
      steps,
      trace: { requestId, correlationId },
      error: { message: "Delegation unavailable", code: "ai_unavailable" },
    };
  }

  steps.push({ name: "ai-orchestration", status: "ok" });
  const rollbackPlan = buildRollbackPlan(
    input.workflow,
    input.request.conflictCode,
    input.request.retryAfter,
    input.request.holdKey,
  );

  const outputs = {
    decision: {
      conflictDetected: Boolean(input.request.conflictCode),
      conflictCode: input.request.conflictCode ?? null,
      retryAfter: input.request.retryAfter ?? null,
    },
    alternatives: aiResult.action ?? null,
    authorization: input.authorization ?? { ok: true },
    rollbackPlan,
    ai: {
      response: aiResult.response ?? null,
      action: aiResult.action ?? null,
    },
  };

  const orchestrationId = await insertOrchestrationRun({
    organization_id: orgId,
    request_id: requestId,
    correlation_id: correlationId,
    workflow: input.workflow,
    status: "ok",
    inputs: input.request,
    outputs,
    rollback_plan: rollbackPlan,
  });

  return {
    status: "ok",
    orchestrationId,
    workflow: input.workflow,
    decision: outputs.decision,
    alternatives: outputs.alternatives,
    authorization: outputs.authorization,
    rollbackPlan,
    ai: outputs.ai,
    steps,
    trace: { requestId, correlationId },
  };
}

export const __TESTING__ = {
  buildRollbackPlan,
  computeDurationMinutes,
  buildAiMessage,
};
