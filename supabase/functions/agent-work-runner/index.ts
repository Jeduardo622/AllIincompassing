import { createHash, timingSafeEqual } from "node:crypto";
import {
  createClient,
  type SupabaseClient,
} from "npm:@supabase/supabase-js@2.99.0";
import { corsHeadersForRequest } from "../_shared/cors.ts";
import {
  authorizeWorkAction,
  type WorkflowDefinition,
} from "../_shared/agent-work/policy.ts";
import { assertAgentWorkSupabaseUrl } from "../_shared/agent-work/runtime-url.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;
const BIGINT_PATTERN = /^(0|[1-9][0-9]*)$/;
const WORKER_ACTOR_ID = "00000000-0000-4000-8000-000000000001";
const IEHP_WORKFLOW_KEY = "assessment.iehp.prepare_for_clinical_review";
const CALOPTIMA_WORKFLOW_KEY = "assessment.caloptima.prepare_draft_review";
const DEFAULT_VISIBILITY_TIMEOUT_SECONDS = 30;
const DEFAULT_LEASE_SECONDS = 60;
const RETRY_BASE_SECONDS = 30;
const RETRY_CAP_SECONDS = 1800;
const RETRY_JITTER_PERCENT = 20;
const EXECUTION_MODES = new Set(["deterministic", "model_suggested", "human"]);
const RUNNABLE_STEP_STATUSES = new Set([
  "ready",
  "running",
  "waiting",
  "cancelled",
  "completed",
]);
const ITEM_STATUSES = new Set([
  "queued",
  "running",
  "waiting",
  "blocked",
  "needs_review",
  "failed",
  "cancelled",
]);

type RuntimeMode = "disabled" | "shadow" | "advisory";
type RunnerOutcome =
  | {
    outcome: "completed";
    workItemId: string;
    stepId: string;
    reasonCode: string;
  }
  | {
    outcome: "blocked";
    workItemId: string;
    stepId: string;
    reasonCode: string;
  }
  | {
    outcome: "retry_scheduled";
    workItemId: string;
    stepId: string;
    retryAt: string;
  }
  | {
    outcome: "waiting";
    workItemId: string;
    stepId: string;
    wakeAt: string;
  }
  | { outcome: "no_work" };

export type AgentWorkQueueMessage = {
  workItemId: string;
  stepId?: string;
  organizationId: string;
  availableAt: string;
  correlationId: string;
  workflowVersion: number;
};

export type QueueEnvelope = {
  messageId: string;
  payload: AgentWorkQueueMessage | Record<string, unknown>;
};

type AuthoritativeScope = {
  workItemId: string;
  stepId: string;
  organizationId: string;
  clientId: string;
  workflowKey: string;
  workflowVersion: number;
  stepKey: string;
  actorUserId: string;
  executionMode: "deterministic" | "model_suggested" | "human";
  stepStatus: "ready" | "running" | "waiting" | "cancelled" | "completed";
  itemStatus:
    | "queued"
    | "running"
    | "waiting"
    | "blocked"
    | "needs_review"
    | "failed"
    | "cancelled";
  attemptCount: number;
  maxAttempts: number;
  inputHash: string | null;
  evidenceHashes: string[];
  effectKey: string;
};

export type ProjectionEffectDescriptor = {
  effectKey: string;
  outputHash: string;
};

type RereadScopeInput = {
  workItemId: string;
  stepId: string | null;
  organizationId: string;
  workflowVersion: number;
};

type ClaimedLease = {
  ok: true;
  stepId: string;
  workItemId: string;
  stateVersion: string;
  attemptId: string;
};

type ExecuteStepResult = {
  kind: "completed";
  reasonCode: string;
  outputHash: string;
  effectKey: string;
};

type PostconditionResult =
  | { ok: true; outputHash: string }
  | { ok: false; reasonCode: string };

type RecordedEffect = {
  effectKey: string;
  outputHash: string;
  status: "pending" | "verified";
  verifiedAt: string | null;
};

type TransitionInput = {
  stepId: string;
  expectedStateVersion: string;
  toStatus: string;
  reasonCode: string;
  outputHash: string;
  effectKey: string;
  workerId: string;
  attemptId: string;
};

type RetryInput = {
  stepId: string;
  delaySeconds: number;
  reasonCode: string;
};

type RetryDisposition =
  | { outcome: "retry_scheduled"; retryAt: string }
  | { outcome: "retry_limit_exhausted" };

export type AgentWorkRunnerHandlerDependencies = {
  now: () => Date;
  getCorsHeaders: () => HeadersInit;
  getInvocationSecret: () => string;
  getServiceRoleKey: () => string;
  getWorkerId: () => string;
  readQueueMessage: () => Promise<QueueEnvelope | null>;
  archiveQueueMessage: (messageId: string, reasonCode: string) => Promise<void>;
  loadRuntimePolicy: () => Promise<RuntimeMode>;
  rereadAuthoritativeScope: (
    input: RereadScopeInput,
  ) => Promise<AuthoritativeScope | null>;
  loadProjectionDescriptor: (
    scope: AuthoritativeScope,
  ) => Promise<ProjectionEffectDescriptor>;
  claimStepLease: (stepId: string) => Promise<ClaimedLease>;
  executeStep: (
    scope: AuthoritativeScope,
    lease: ClaimedLease,
    expectedEffect: ProjectionEffectDescriptor,
  ) => Promise<ExecuteStepResult>;
  verifyPostcondition: (
    scope: AuthoritativeScope,
    expectedEffect: ProjectionEffectDescriptor,
  ) => Promise<PostconditionResult>;
  findRecordedEffect: (
    stepId: string,
    effectKey: string,
  ) => Promise<RecordedEffect | null>;
  transitionStep: (input: TransitionInput) => Promise<void>;
  scheduleRetry: (input: RetryInput) => Promise<RetryDisposition>;
  appendEvent: (eventType: string) => Promise<void>;
};

export class AgentWorkRunnerError extends Error {
  constructor(
    readonly status: number,
    readonly publicMessage: string,
    readonly code: string,
  ) {
    super(code);
    this.name = "AgentWorkRunnerError";
  }
}

const ADVISORY_IEHP_WORKFLOW: WorkflowDefinition = {
  workflow: IEHP_WORKFLOW_KEY,
  version: 1,
  actions: {
    claim_step: {
      allowedRuntimeModes: ["advisory"],
      requiredRoles: ["worker"],
      allowedTools: ["claim_step"],
      clinicalEffect: false,
      requiresCurrentApproval: false,
    },
    transition_step: {
      allowedRuntimeModes: ["advisory"],
      requiredRoles: ["worker"],
      allowedTools: ["review_snapshot"],
      clinicalEffect: false,
      requiresCurrentApproval: false,
    },
    record_projection: {
      allowedRuntimeModes: ["shadow", "advisory"],
      requiredRoles: ["worker"],
      allowedTools: ["record_projection"],
      clinicalEffect: false,
      requiresCurrentApproval: false,
    },
  },
};

const ADVISORY_CALOPTIMA_WORKFLOW: WorkflowDefinition = {
  ...ADVISORY_IEHP_WORKFLOW,
  workflow: CALOPTIMA_WORKFLOW_KEY,
};

const ADVISORY_WORKFLOWS = new Map<string, WorkflowDefinition>([
  [IEHP_WORKFLOW_KEY, ADVISORY_IEHP_WORKFLOW],
  [CALOPTIMA_WORKFLOW_KEY, ADVISORY_CALOPTIMA_WORKFLOW],
]);

export function createAgentWorkRunnerHandler(
  deps: AgentWorkRunnerHandlerDependencies,
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    const responseHeaders = {
      ...headersRecord(deps.getCorsHeaders()),
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    };
    const respond = (status: number, body: Record<string, unknown>) =>
      new Response(JSON.stringify(body), {
        status,
        headers: responseHeaders,
      });
    const reject = (status: number, error: string, code: string) =>
      respond(status, { success: false, error, code });

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: responseHeaders });
    }
    if (request.method !== "POST") {
      return reject(405, "Method not allowed", "method_not_allowed");
    }
    if (
      !isAuthorizedInvocation(
        request,
        deps.getInvocationSecret(),
        deps.getServiceRoleKey(),
      )
    ) {
      return reject(
        401,
        "Unauthorized",
        "runner_invocation_unauthorized",
      );
    }

    try {
      const queueEnvelope = await deps.readQueueMessage();
      if (!queueEnvelope) {
        return respond(200, { success: true, data: { outcome: "no_work" } });
      }

      const message = strictQueueMessage(queueEnvelope.payload);
      if (!message) {
        await archiveSilently(
          deps,
          queueEnvelope.messageId,
          "invalid_queue_message",
        );
        return respond(200, { success: true, data: { outcome: "no_work" } });
      }

      let runtimeMode: RuntimeMode;
      try {
        runtimeMode = await deps.loadRuntimePolicy();
      } catch {
        const reasonCode = "runtime_policy_unavailable";
        const result = blockedResult(message, reasonCode);
        return respond(200, { success: true, data: result });
      }

      if (runtimeMode !== "advisory") {
        const reasonCode = runtimeMode === "disabled"
          ? "runtime_mode_disabled"
          : "runtime_mode_unavailable";
        const result = blockedResult(message, reasonCode);
        return respond(200, { success: true, data: result });
      }

      let scope: AuthoritativeScope | null;
      try {
        scope = await deps.rereadAuthoritativeScope({
          workItemId: message.workItemId,
          stepId: message.stepId ?? null,
          organizationId: message.organizationId,
          workflowVersion: message.workflowVersion,
        });
      } catch {
        return respond(200, {
          success: true,
          data: blockedResult(message, "authoritative_scope_unavailable"),
        });
      }
      if (!scope || !matchesAuthoritativeScope(message, scope)) {
        const reasonCode = "authoritative_scope_mismatch";
        const result = blockedResult(message, reasonCode);
        return respond(200, { success: true, data: result });
      }

      const earlyBlock = classifyBlockedScope(scope);
      if (earlyBlock) {
        await archiveSilently(deps, queueEnvelope.messageId, earlyBlock);
        return respond(200, {
          success: true,
          data: blockedResult(scope, earlyBlock),
        });
      }

      if (
        scope.workflowKey === CALOPTIMA_WORKFLOW_KEY &&
        scope.stepKey === "snapshot_draft_packet"
      ) {
        const reasonCode = "dedicated_adapter_step";
        await archiveSilently(deps, queueEnvelope.messageId, reasonCode);
        return respond(200, {
          success: true,
          data: blockedResult(scope, reasonCode),
        });
      }

      const claimDecision = authorizeRunnerAction(
        runtimeMode,
        scope,
        "claim_step",
        "claim_step",
        deps.now(),
      );
      if (!claimDecision.allowed) {
        return respond(200, {
          success: true,
          data: blockedResult(scope, claimDecision.reasonCode),
        });
      }

      let expectedEffect: ProjectionEffectDescriptor;
      try {
        expectedEffect = await deps.loadProjectionDescriptor(scope);
      } catch {
        return respond(200, {
          success: true,
          data: blockedResult(scope, "authoritative_projection_unavailable"),
        });
      }
      if (
        !expectedEffect ||
        typeof expectedEffect.effectKey !== "string" ||
        expectedEffect.effectKey.length === 0 ||
        !SHA256_PATTERN.test(expectedEffect.outputHash)
      ) {
        return respond(200, {
          success: true,
          data: blockedResult(scope, "authoritative_projection_unavailable"),
        });
      }

      if (isCompletedReplayScope(scope)) {
        const replayedResult = await reconcileCompletedReplay(
          deps,
          queueEnvelope.messageId,
          scope,
          expectedEffect,
        );
        return respond(200, {
          success: true,
          data: replayedResult,
        });
      }

      const claimedLease = await deps.claimStepLease(scope.stepId);
      if (
        claimedLease.stepId !== scope.stepId ||
        claimedLease.workItemId !== scope.workItemId ||
        !BIGINT_PATTERN.test(claimedLease.stateVersion) ||
        !isUuid(claimedLease.attemptId)
      ) {
        const reasonCode = "claimed_scope_mismatch";
        await archiveSilently(deps, queueEnvelope.messageId, reasonCode);
        return respond(200, {
          success: true,
          data: blockedResult(scope, reasonCode),
        });
      }

      const existingEffect = await findCompatibleRecordedEffect(
        deps,
        scope,
        expectedEffect,
      );
      if (existingEffect.kind === "mismatch") {
        const reasonCode = "effect_record_mismatch";
        await archiveSilently(deps, queueEnvelope.messageId, reasonCode);
        return respond(200, {
          success: true,
          data: blockedResult(scope, reasonCode),
        });
      }
      if (existingEffect.kind === "found") {
        const resolvedEffect = {
          effectKey: existingEffect.record.effectKey,
          outputHash: expectedEffect.outputHash,
        };
        if (
          existingEffect.record.outputHash !== expectedEffect.outputHash ||
          (existingEffect.record.status !== "pending" &&
            existingEffect.record.status !== "verified")
        ) {
          const reasonCode = "effect_record_mismatch";
          await archiveSilently(deps, queueEnvelope.messageId, reasonCode);
          return respond(200, {
            success: true,
            data: blockedResult(scope, reasonCode),
          });
        }

        const postcondition = await deps.verifyPostcondition(
          scope,
          resolvedEffect,
        );
        if (
          !postcondition.ok ||
          !SHA256_PATTERN.test(postcondition.outputHash) ||
          postcondition.outputHash !== expectedEffect.outputHash
        ) {
          const reasonCode = postcondition.ok
            ? "postcondition_not_met"
            : postcondition.reasonCode;
          await archiveSilently(deps, queueEnvelope.messageId, reasonCode);
          return respond(200, {
            success: true,
            data: blockedResult(scope, reasonCode),
          });
        }

        const transitionDecision = authorizeRunnerAction(
          runtimeMode,
          scope,
          "transition_step",
          "review_snapshot",
          deps.now(),
        );
        if (!transitionDecision.allowed) {
          await archiveSilently(
            deps,
            queueEnvelope.messageId,
            transitionDecision.reasonCode,
          );
          return respond(200, {
            success: true,
            data: blockedResult(scope, transitionDecision.reasonCode),
          });
        }

        try {
          await deps.transitionStep({
            stepId: scope.stepId,
            expectedStateVersion: claimedLease.stateVersion,
            toStatus: "completed",
            reasonCode: "effect_already_applied",
            outputHash: postcondition.outputHash,
            effectKey: resolvedEffect.effectKey,
            workerId: deps.getWorkerId(),
            attemptId: claimedLease.attemptId,
          });
        } catch {
          return respond(200, {
            success: true,
            data: blockedResult(scope, "finalization_conflict"),
          });
        }
        const duplicateEventAppended = await appendEventRequired(
          deps,
          "agent_work_runner.completed",
        );
        if (!duplicateEventAppended) {
          return respond(200, {
            success: true,
            data: blockedResult(scope, "event_append_failed"),
          });
        }
        await archiveSilently(
          deps,
          queueEnvelope.messageId,
          "effect_already_applied",
        );
        return respond(200, {
          success: true,
          data: completedResult(scope, "effect_already_applied"),
        });
      }

      let execution: ExecuteStepResult;
      try {
        execution = await deps.executeStep(scope, claimedLease, expectedEffect);
      } catch (error) {
        const recovered = await recoverExecutionError(
          deps,
          queueEnvelope.messageId,
          scope,
          error,
        );
        return respond(recovered.status, recovered.body);
      }

      if (
        execution.effectKey !== expectedEffect.effectKey ||
        execution.outputHash !== expectedEffect.outputHash
      ) {
        const reasonCode = "effect_record_mismatch";
        await archiveSilently(deps, queueEnvelope.messageId, reasonCode);
        return respond(200, {
          success: true,
          data: blockedResult(scope, reasonCode),
        });
      }

      const postcondition = await deps.verifyPostcondition(
        scope,
        expectedEffect,
      );
      if (
        !postcondition.ok ||
        !SHA256_PATTERN.test(postcondition.outputHash) ||
        postcondition.outputHash !== execution.outputHash
      ) {
        const reasonCode = postcondition.ok
          ? "postcondition_not_met"
          : postcondition.reasonCode;
        await archiveSilently(deps, queueEnvelope.messageId, reasonCode);
        return respond(200, {
          success: true,
          data: blockedResult(scope, reasonCode),
        });
      }

      const transitionDecision = authorizeRunnerAction(
        runtimeMode,
        scope,
        "transition_step",
        "review_snapshot",
        deps.now(),
      );
      if (!transitionDecision.allowed) {
        await archiveSilently(
          deps,
          queueEnvelope.messageId,
          transitionDecision.reasonCode,
        );
        return respond(200, {
          success: true,
          data: blockedResult(scope, transitionDecision.reasonCode),
        });
      }

      try {
        await deps.transitionStep({
          stepId: scope.stepId,
          expectedStateVersion: claimedLease.stateVersion,
          toStatus: "completed",
          reasonCode: execution.reasonCode,
          outputHash: execution.outputHash,
          effectKey: execution.effectKey,
          workerId: deps.getWorkerId(),
          attemptId: claimedLease.attemptId,
        });
      } catch {
        return respond(200, {
          success: true,
          data: blockedResult(scope, "finalization_conflict"),
        });
      }
      const completionEventAppended = await appendEventRequired(
        deps,
        "agent_work_runner.completed",
      );
      if (!completionEventAppended) {
        return respond(200, {
          success: true,
          data: blockedResult(scope, "event_append_failed"),
        });
      }
      await archiveSilently(
        deps,
        queueEnvelope.messageId,
        execution.reasonCode,
      );

      return respond(200, {
        success: true,
        data: completedResult(scope, execution.reasonCode),
      });
    } catch {
      return reject(500, "Runner execution failed", "runner_execution_failed");
    }
  };
}

function headersRecord(value: HeadersInit): Record<string, string> {
  const headers = new Headers(value);
  return Object.fromEntries(headers.entries());
}

function isAuthorizedInvocation(
  request: Request,
  secret: string,
  serviceRoleKey: string,
): boolean {
  const authorization = request.headers.get("authorization")?.trim() ?? "";
  const expectedAuthorization = serviceRoleKey
    ? `Bearer ${serviceRoleKey}`
    : "";
  const providedSecret = request.headers.get("x-agent-work-runner-secret") ??
    "";
  if (
    !secret || !providedSecret || !expectedAuthorization ||
    !authorization
  ) {
    return false;
  }
  return constantTimeEqual(expectedAuthorization, authorization) &&
    constantTimeEqual(secret, providedSecret);
}

function constantTimeEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length, 1);
  const paddedLeft = new Uint8Array(length);
  const paddedRight = new Uint8Array(length);
  paddedLeft.set(leftBytes);
  paddedRight.set(rightBytes);
  const matched = timingSafeEqual(paddedLeft, paddedRight);
  return matched && leftBytes.length === rightBytes.length;
}

function strictQueueMessage(
  payload: AgentWorkQueueMessage | Record<string, unknown>,
): AgentWorkQueueMessage | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const keys = Object.keys(payload);
  const allowed = new Set([
    "workItemId",
    "stepId",
    "organizationId",
    "availableAt",
    "correlationId",
    "workflowVersion",
  ]);
  if (keys.some((key) => !allowed.has(key))) return null;

  const candidate = payload as Record<string, unknown>;
  if (
    !isUuid(candidate.workItemId) ||
    !isUuid(candidate.organizationId) ||
    typeof candidate.availableAt !== "string" ||
    !isIsoTimestamp(candidate.availableAt) ||
    typeof candidate.correlationId !== "string" ||
    candidate.correlationId.trim().length === 0 ||
    !Number.isInteger(candidate.workflowVersion) ||
    Number(candidate.workflowVersion) <= 0
  ) {
    return null;
  }
  if (
    candidate.stepId !== undefined &&
    (typeof candidate.stepId !== "string" || !isUuid(candidate.stepId))
  ) {
    return null;
  }

  return {
    workItemId: candidate.workItemId,
    ...(candidate.stepId ? { stepId: candidate.stepId } : {}),
    organizationId: candidate.organizationId,
    availableAt: candidate.availableAt,
    correlationId: candidate.correlationId.trim(),
    workflowVersion: Number(candidate.workflowVersion),
  };
}

function matchesAuthoritativeScope(
  message: AgentWorkQueueMessage,
  scope: AuthoritativeScope,
): boolean {
  return scope.workItemId === message.workItemId &&
    scope.organizationId === message.organizationId &&
    scope.workflowVersion === message.workflowVersion &&
    scope.stepId === (message.stepId ?? scope.stepId);
}

function classifyBlockedScope(scope: AuthoritativeScope): string | null {
  if (!ADVISORY_WORKFLOWS.has(scope.workflowKey) || scope.workflowVersion !== 1) {
    return "workflow_definition_not_found";
  }
  if (scope.itemStatus === "cancelled" || scope.stepStatus === "cancelled") {
    return "work_item_cancelled";
  }
  if (scope.executionMode === "human") {
    return "human_step_requires_manual_action";
  }
  if (scope.executionMode === "model_suggested") {
    return "model_step_requires_guarded_provider";
  }
  if (scope.executionMode !== "deterministic") {
    return "workflow_definition_not_found";
  }
  if (scope.stepStatus === "completed" && scope.itemStatus === "needs_review") {
    return null;
  }
  if (scope.stepStatus !== "ready") {
    if (scope.stepStatus === "waiting") return "step_waiting";
    if (scope.stepStatus === "running") return "step_already_running";
    return "workflow_definition_not_found";
  }
  return null;
}

function isCompletedReplayScope(scope: AuthoritativeScope): boolean {
  return scope.stepStatus === "completed" && scope.itemStatus === "needs_review";
}

function authorizeRunnerAction(
  runtimeMode: RuntimeMode,
  scope: AuthoritativeScope,
  action: "claim_step" | "transition_step",
  tool: "claim_step" | "review_snapshot",
  now: Date,
) {
  const workflow = ADVISORY_WORKFLOWS.get(scope.workflowKey);
  if (!workflow) {
    return { allowed: false as const, reasonCode: "workflow_definition_not_found" };
  }
  return authorizeWorkAction({
    actor: {
      id: WORKER_ACTOR_ID,
      kind: "worker",
      currentOrgRoles: [{
        organizationId: scope.organizationId,
        role: "worker",
        active: true,
        expiresAt: null,
      }],
    },
    scope: {
      organizationId: scope.organizationId,
      clientId: scope.clientId,
      workItemId: scope.workItemId,
      stepId: scope.stepId,
    },
    scopeValidation: {
      verdict: "in_scope",
      source: "authority_loader",
      authoritative: true,
      validatedOrganizationId: scope.organizationId,
      validatedClientId: scope.clientId,
      validatedWorkItemId: scope.workItemId,
      validatedStepId: scope.stepId,
    },
    runtimeMode,
    workflow,
    killSwitchEnabled: false,
    action: {
      action,
      workflow: scope.workflowKey,
      tool,
      approval: null,
      clinicalEffect: false,
      now,
    },
  });
}

async function recoverExecutionError(
  deps: AgentWorkRunnerHandlerDependencies,
  messageId: string,
  scope: AuthoritativeScope,
  error: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!(error instanceof AgentWorkRunnerError)) {
    return {
      status: 500,
      body: {
        success: false,
        error: "Runner execution failed",
        code: "runner_execution_failed",
      },
    };
  }

  if (isRetryableCode(error.code)) {
    const delaySeconds = computeRetryDelaySeconds(
      scope.stepId,
      scope.attemptCount + 1,
    );
    let disposition: RetryDisposition;
    try {
      disposition = await deps.scheduleRetry({
        stepId: scope.stepId,
        delaySeconds,
        reasonCode: error.code,
      });
    } catch {
      return {
        status: 200,
        body: {
          success: true,
          data: blockedResult(scope, "retry_schedule_failed"),
        },
      };
    }
    if (disposition.outcome === "retry_scheduled") {
      await archiveSilently(deps, messageId, "retry_scheduled");
      return {
        status: 200,
        body: {
          success: true,
          data: {
            outcome: "retry_scheduled",
            workItemId: scope.workItemId,
            stepId: scope.stepId,
            retryAt: disposition.retryAt,
          } satisfies RunnerOutcome,
        },
      };
    }
    await archiveSilently(deps, messageId, "retry_limit_exhausted");
    return {
      status: 200,
      body: {
        success: true,
        data: blockedResult(scope, "retry_limit_exhausted"),
      },
    };
  }

  await archiveSilently(deps, messageId, error.code);
  return {
    status: 200,
    body: {
      success: true,
      data: blockedResult(scope, error.code),
    },
  };
}

function completedResult(
  scope: Pick<AuthoritativeScope, "workItemId" | "stepId">,
  reasonCode: string,
): RunnerOutcome {
  return {
    outcome: "completed",
    workItemId: scope.workItemId,
    stepId: scope.stepId,
    reasonCode,
  };
}

function blockedResult(
  scope:
    | Pick<AuthoritativeScope, "workItemId" | "stepId">
    | AgentWorkQueueMessage,
  reasonCode: string,
): RunnerOutcome {
  return {
    outcome: "blocked",
    workItemId: scope.workItemId,
    stepId: "stepId" in scope && typeof scope.stepId === "string"
      ? scope.stepId
      : "00000000-0000-4000-8000-000000000000",
    reasonCode,
  };
}

async function archiveSilently(
  deps: AgentWorkRunnerHandlerDependencies,
  messageId: string,
  reasonCode: string,
): Promise<void> {
  try {
    await deps.archiveQueueMessage(messageId, reasonCode);
  } catch {
    // Preserve sanitized outward behavior.
  }
}

async function appendEventRequired(
  deps: AgentWorkRunnerHandlerDependencies,
  eventType: string,
): Promise<boolean> {
  try {
    await deps.appendEvent(eventType);
    return true;
  } catch {
    return false;
  }
}

function isRetryableCode(code: string): boolean {
  return code === "transient_provider" || code === "transient_network" ||
    code === "lease_expired";
}

export function deriveProjectionEffect(
  scope: Pick<
    AuthoritativeScope,
    | "workItemId"
    | "stepId"
    | "organizationId"
    | "clientId"
    | "workflowKey"
    | "workflowVersion"
    | "stepKey"
    | "actorUserId"
    | "inputHash"
    | "evidenceHashes"
  >,
): ProjectionEffectDescriptor {
  const evidenceHashes = [...scope.evidenceHashes].sort();
  const canonicalProjection = JSON.stringify({
    organizationId: scope.organizationId,
    clientId: scope.clientId,
    workItemId: scope.workItemId,
    stepId: scope.stepId,
    workflowKey: scope.workflowKey,
    workflowVersion: scope.workflowVersion,
    stepKey: scope.stepKey,
    inputHash: scope.inputHash,
    evidenceHashes,
  });
  const outputHash = createHash("sha256").update(canonicalProjection).digest(
    "hex",
  );
  const canonicalEffect = JSON.stringify({
    organizationId: scope.organizationId,
    actorUserId: scope.actorUserId,
    workflowKey: scope.workflowKey,
    workflowVersion: scope.workflowVersion,
    stepKey: scope.stepKey,
    targetKind: "agent_work_step",
    targetId: scope.stepId,
    payloadHash: outputHash,
  });

  return {
    effectKey: createHash("sha256").update(canonicalEffect).digest("hex"),
    outputHash,
  };
}

export function deriveLegacyProjectionEffectKey(
  scope: Pick<AuthoritativeScope, "workItemId" | "stepId" | "workflowVersion">,
): string {
  return `projection:v${scope.workflowVersion}:${scope.workItemId}:${scope.stepId}`;
}

type RecordedEffectLookup =
  | { kind: "none" }
  | { kind: "mismatch" }
  | { kind: "found"; record: RecordedEffect };

async function findCompatibleRecordedEffect(
  deps: AgentWorkRunnerHandlerDependencies,
  scope: AuthoritativeScope,
  expectedEffect: ProjectionEffectDescriptor,
): Promise<RecordedEffectLookup> {
  const canonical = await deps.findRecordedEffect(scope.stepId, expectedEffect.effectKey);
  if (canonical) {
    return canonical.outputHash === expectedEffect.outputHash
      ? { kind: "found", record: canonical }
      : { kind: "mismatch" };
  }

  const legacyKey = deriveLegacyProjectionEffectKey(scope);
  if (legacyKey === expectedEffect.effectKey) {
    return { kind: "none" };
  }
  const legacy = await deps.findRecordedEffect(scope.stepId, legacyKey);
  if (!legacy) {
    return { kind: "none" };
  }
  return legacy.outputHash === expectedEffect.outputHash
    ? { kind: "found", record: legacy }
    : { kind: "mismatch" };
}

async function reconcileCompletedReplay(
  deps: AgentWorkRunnerHandlerDependencies,
  messageId: string,
  scope: AuthoritativeScope,
  expectedEffect: ProjectionEffectDescriptor,
): Promise<RunnerOutcome> {
  const existingEffect = await findCompatibleRecordedEffect(
    deps,
    scope,
    expectedEffect,
  );
  if (existingEffect.kind === "mismatch") {
    const reasonCode = "effect_record_mismatch";
    await archiveSilently(deps, messageId, reasonCode);
    return blockedResult(scope, reasonCode);
  }
  if (existingEffect.kind === "none") {
    return blockedResult(scope, "postcondition_not_met");
  }

  const resolvedEffect = {
    effectKey: existingEffect.record.effectKey,
    outputHash: expectedEffect.outputHash,
  };
  const postcondition = await deps.verifyPostcondition(scope, resolvedEffect);
  if (
    !postcondition.ok ||
    !SHA256_PATTERN.test(postcondition.outputHash) ||
    postcondition.outputHash !== expectedEffect.outputHash
  ) {
    const reasonCode = postcondition.ok
      ? "postcondition_not_met"
      : postcondition.reasonCode;
    return blockedResult(scope, reasonCode);
  }

  const eventAppended = await appendEventRequired(
    deps,
    "agent_work_runner.completed",
  );
  if (!eventAppended) {
    return blockedResult(scope, "event_append_failed");
  }

  await archiveSilently(deps, messageId, "effect_already_applied");
  return completedResult(scope, "effect_already_applied");
}

export function computeRetryDelaySeconds(
  stepId: string,
  attemptNumber: number,
): number {
  const boundedAttempt = Math.max(1, Math.min(31, Math.trunc(attemptNumber)));
  const exponential = Math.min(
    RETRY_CAP_SECONDS,
    RETRY_BASE_SECONDS * 2 ** (boundedAttempt - 1),
  );
  const jitterRange = Math.floor(exponential * RETRY_JITTER_PERCENT / 100);
  const jitterSeed = Number.parseInt(
    stepId.replaceAll("-", "").slice(0, 8),
    16,
  );
  const jitter = jitterRange > 0 && Number.isFinite(jitterSeed)
    ? jitterSeed % (jitterRange + 1)
    : 0;

  return Math.min(RETRY_CAP_SECONDS, exponential + jitter);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isIsoTimestamp(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

type QueueRpcRow = {
  msg_id: string | number;
  read_ct: number;
  enqueued_at: string;
  vt: string;
  message: Record<string, unknown>;
};

type ScopeRow = {
  work_item_id: string;
  step_id: string;
  organization_id: string;
  client_id: string;
  workflow_key: string;
  workflow_version: number;
  owner_user_id: string | null;
  execution_mode: "deterministic" | "model_suggested" | "human";
  step_status: "ready" | "running" | "waiting" | "cancelled";
  item_status:
    | "queued"
    | "running"
    | "waiting"
    | "blocked"
    | "needs_review"
    | "failed"
    | "cancelled";
  attempt_count: number;
  max_attempts: number;
  input_hash: string;
  evidence_hashes: string[] | null;
  unique_effect_key: string | null;
};

function runtimeMode(): RuntimeMode {
  const configured =
    (Deno.env.get("AGENT_WORK_LEDGER_RUNTIME_MODE") ?? "disabled").trim()
      .toLowerCase();
  return configured === "shadow" || configured === "advisory"
    ? configured
    : "disabled";
}

function createServiceClient(): SupabaseClient {
  const supabaseUrl = assertAgentWorkSupabaseUrl(
    Deno.env.get("SUPABASE_URL")?.trim() ?? "",
    {
      phase2Container:
        Deno.env.get("AGENT_WORK_PHASE2_CONTAINER")?.trim() === "1",
      hostedProjectRef:
        Deno.env.get("AGENT_WORK_HOSTED_PROJECT_REF")?.trim(),
    },
  );
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() ??
    "";
  if (!serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required");
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: {
        "X-Agent-Work-Runner": "agent-work-runner",
      },
    },
  });
}

function createRuntimeDependencies(): AgentWorkRunnerHandlerDependencies {
  const serviceClient = createServiceClient();
  const stepToWorkItem = new Map<string, string>();

  return {
    now: () => new Date(),
    getCorsHeaders: () =>
      corsHeadersForRequest(
        new Request("http://localhost/agent-work-runner", { method: "POST" }),
      ),
    getInvocationSecret: () =>
      Deno.env.get("AGENT_WORK_RUNNER_SECRET")?.trim() ?? "",
    getServiceRoleKey: () =>
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() ?? "",
    getWorkerId: () => "agent_work_runner",
    readQueueMessage: async () => {
      const { data, error } = await serviceClient.rpc(
        "read_agent_work_messages",
        {
          p_visibility_timeout_seconds: DEFAULT_VISIBILITY_TIMEOUT_SECONDS,
          p_qty: 1,
        },
      );
      if (error) throw new Error("read_agent_work_messages_failed");
      const row = Array.isArray(data) ? data[0] as QueueRpcRow : null;
      if (!row) return null;
      return {
        messageId: String(row.msg_id),
        payload: row.message,
      };
    },
    archiveQueueMessage: async (messageId: string) => {
      const { error } = await serviceClient.rpc(
        "archive_agent_work_message",
        { p_msg_id: messageId },
      );
      if (error) throw new Error("archive_agent_work_message_failed");
    },
    loadRuntimePolicy: async () => {
      const { data, error } = await serviceClient.rpc(
        "load_agent_work_runtime_policy",
        { p_mode_input: runtimeMode() },
      );
      const row = Array.isArray(data)
        ? data[0] as Record<string, unknown> | undefined
        : undefined;
      if (
        error || !row || row.authoritative !== true ||
        typeof row.runtimeMode !== "string" ||
        typeof row.actionsDisabled !== "boolean" ||
        typeof row.killSwitchEnabled !== "boolean"
      ) {
        throw new Error("runtime_policy_unavailable");
      }
      if (row.actionsDisabled || row.killSwitchEnabled) return "disabled";
      if (
        row.runtimeMode !== "disabled" && row.runtimeMode !== "shadow" &&
        row.runtimeMode !== "advisory"
      ) {
        throw new Error("runtime_policy_unavailable");
      }
      return row.runtimeMode;
    },
    rereadAuthoritativeScope: async (input) => {
      const { data, error } = await serviceClient.rpc(
        "read_agent_work_runner_scope",
        {
          p_work_item_id: input.workItemId,
          p_step_id: input.stepId,
          p_organization_id: input.organizationId,
          p_workflow_version: input.workflowVersion,
        },
      );
      if (error) throw new Error("authoritative_scope_unavailable");
      const row = Array.isArray(data)
        ? data[0] as Record<string, unknown> | undefined
        : undefined;
      if (!row) return null;
      if (
        typeof row.work_item_id !== "string" ||
        typeof row.step_id !== "string" ||
        typeof row.organization_id !== "string" ||
        typeof row.client_id !== "string" ||
        typeof row.workflow_key !== "string" ||
        typeof row.workflow_version !== "number" ||
        typeof row.step_key !== "string" ||
        typeof row.execution_mode !== "string" ||
        !EXECUTION_MODES.has(row.execution_mode) ||
        typeof row.step_status !== "string" ||
        !RUNNABLE_STEP_STATUSES.has(row.step_status) ||
        typeof row.item_status !== "string" ||
        !ITEM_STATUSES.has(row.item_status) ||
        typeof row.attempt_count !== "number" ||
        typeof row.max_attempts !== "number" ||
        (row.input_hash !== null && typeof row.input_hash !== "string")
      ) {
        throw new Error("authoritative_scope_invalid");
      }
      const evidenceHashes = Array.isArray(row.evidence_hashes)
        ? row.evidence_hashes.filter((hash): hash is string =>
          typeof hash === "string" && SHA256_PATTERN.test(hash)
        )
        : [];
      stepToWorkItem.set(String(row.step_id), String(row.work_item_id));

      return {
        workItemId: String(row.work_item_id),
        stepId: String(row.step_id),
        organizationId: String(row.organization_id),
        clientId: row.client_id,
        workflowKey: row.workflow_key,
        workflowVersion: row.workflow_version,
        stepKey: row.step_key,
        actorUserId: row.owner_user_id
          ? String(row.owner_user_id)
          : WORKER_ACTOR_ID,
        executionMode: row.execution_mode as AuthoritativeScope["executionMode"],
        stepStatus: row.step_status as AuthoritativeScope["stepStatus"],
        itemStatus: row.item_status as AuthoritativeScope["itemStatus"],
        attemptCount: row.attempt_count,
        maxAttempts: row.max_attempts,
        inputHash: row.input_hash,
        evidenceHashes,
        effectKey: typeof row.effect_key === "string" ? row.effect_key : "",
      };
    },
    loadProjectionDescriptor: async (scope) => {
      const { data, error } = await serviceClient.rpc(
        "read_agent_work_advisory_projection_descriptor",
        { p_step_id: scope.stepId },
      );
      const row = Array.isArray(data)
        ? data[0] as Record<string, unknown> | undefined
        : undefined;
      if (
        error || !row || typeof row.effect_key !== "string" ||
        typeof row.output_hash !== "string" ||
        !SHA256_PATTERN.test(row.output_hash)
      ) {
        throw new Error("authoritative_projection_unavailable");
      }
      return {
        effectKey: row.effect_key,
        outputHash: row.output_hash,
      };
    },
    claimStepLease: async (stepId: string) => {
      const workItemId = stepToWorkItem.get(stepId);
      if (!workItemId) throw new Error("claim_agent_work_step_failed");
      const { data, error } = await serviceClient.rpc(
        "claim_queued_agent_work_step",
        {
          p_work_item_id: workItemId,
          p_step_id: stepId,
          p_worker_id: "agent_work_runner",
          p_lease_seconds: DEFAULT_LEASE_SECONDS,
        },
      );
      if (error) throw new Error("claim_agent_work_step_failed");
      const row = Array.isArray(data)
        ? data[0] as Record<string, unknown>
        : null;
      if (
        !row || typeof row.id !== "string" ||
        typeof row.work_item_id !== "string"
      ) {
        throw new Error("claim_agent_work_step_failed");
      }
      return {
        ok: true,
        stepId: row.id,
        workItemId: row.work_item_id,
        stateVersion: String(row.state_version ?? ""),
        attemptId: String(row.attempt_id ?? ""),
      };
    },
    executeStep: async (_scope, lease, expectedEffect) => {
      const { data, error } = await serviceClient.rpc(
        "record_agent_work_advisory_projection_effect",
        {
          p_step_id: lease.stepId,
          p_attempt_id: lease.attemptId,
          p_worker_id: "agent_work_runner",
          p_expected_state_version: lease.stateVersion,
          p_effect_key: expectedEffect.effectKey,
          p_payload_hash: expectedEffect.outputHash,
        },
      );
      const row = Array.isArray(data)
        ? data[0] as Record<string, unknown> | undefined
        : undefined;
      if (
        error || !row || row.unique_effect_key !== expectedEffect.effectKey ||
        row.payload_hash !== expectedEffect.outputHash ||
        (row.status !== "pending" && row.status !== "verified")
      ) {
        throw new Error("record_advisory_projection_effect_failed");
      }
      return {
        kind: "completed",
        reasonCode: "advisory_projection_applied",
        ...expectedEffect,
      };
    },
    verifyPostcondition: async (scope, expectedEffect) => {
      const { data, error } = await serviceClient.rpc(
        "read_agent_work_advisory_projection_effect",
        {
          p_step_id: scope.stepId,
          p_effect_key: expectedEffect.effectKey,
        },
      );
      const row = Array.isArray(data)
        ? data[0] as Record<string, unknown> | undefined
        : undefined;
      if (
        error || !row || row.work_item_id !== scope.workItemId ||
        row.step_id !== scope.stepId ||
        row.organization_id !== scope.organizationId ||
        row.client_id !== scope.clientId ||
        row.target_id !== scope.stepId ||
        row.effect_kind !== "advisory_projection" ||
        row.target_kind !== "agent_work_step" ||
        row.unique_effect_key !== expectedEffect.effectKey ||
        row.payload_hash !== expectedEffect.outputHash ||
        (row.status !== "pending" && row.status !== "verified")
      ) {
        return { ok: false, reasonCode: "postcondition_not_met" };
      }
      return { ok: true, outputHash: expectedEffect.outputHash };
    },
    findRecordedEffect: async (stepId: string, effectKey: string) => {
      if (!effectKey) return null;
      const { data, error } = await serviceClient.rpc(
        "read_agent_work_advisory_projection_effect",
        { p_step_id: stepId, p_effect_key: effectKey },
      );
      const row = Array.isArray(data)
        ? data[0] as Record<string, unknown> | undefined
        : undefined;
      if (error) throw new Error("find_recorded_effect_failed");
      if (!row) return null;
      if (
        typeof row.payload_hash !== "string" ||
        !SHA256_PATTERN.test(row.payload_hash) ||
        (row.status !== "pending" && row.status !== "verified") ||
        (row.verified_at !== null && typeof row.verified_at !== "string")
      ) {
        throw new Error("recorded_effect_invalid");
      }
      return {
        effectKey: String(row.unique_effect_key),
        outputHash: row.payload_hash,
        status: row.status,
        verifiedAt: row.verified_at as string | null,
      };
    },
    transitionStep: async (input) => {
      const { error } = await serviceClient.rpc(
        "finalize_agent_work_advisory_projection_effect",
        {
          p_step_id: input.stepId,
          p_attempt_id: input.attemptId,
          p_worker_id: input.workerId,
          p_expected_state_version: input.expectedStateVersion,
          p_effect_key: input.effectKey,
          p_payload_hash: input.outputHash,
        },
      );
      if (error) {
        throw new AgentWorkRunnerError(
          409,
          "Finalization conflict",
          "finalization_conflict",
        );
      }
    },
    scheduleRetry: async (input) => {
      const { data, error } = await serviceClient.rpc(
        "schedule_agent_work_step_retry",
        {
          p_step_id: input.stepId,
          p_delay_seconds: input.delaySeconds,
          p_reason_code: input.reasonCode,
          p_sanitized_metadata: {
            retry_scheduled: true,
            delay_seconds: input.delaySeconds,
          },
        },
      );
      const retryRow = data && !Array.isArray(data)
        ? data as Record<string, unknown>
        : null;
      if (error || !retryRow || typeof retryRow.outcome !== "string") {
        throw new Error("schedule_agent_work_step_retry_failed");
      }
      if (retryRow.outcome === "retry_limit_exhausted") {
        return { outcome: "retry_limit_exhausted" };
      }
      if (
        retryRow.outcome !== "retry_scheduled" ||
        typeof retryRow.retry_at !== "string"
      ) {
        throw new Error("schedule_agent_work_step_retry_failed");
      }
      return {
        outcome: "retry_scheduled",
        retryAt: retryRow.retry_at,
      };
    },
    appendEvent: async () => Promise.resolve(),
  };
}

const handler = (request: Request) =>
  createAgentWorkRunnerHandler(createRuntimeDependencies())(request);

if (import.meta.main) {
  Deno.serve(handler);
}

export default handler;
