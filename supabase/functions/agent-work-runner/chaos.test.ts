import {
  assert,
  assertEquals,
  assertObjectMatch,
} from "https://deno.land/std@0.224.0/testing/asserts.ts";
import { createHash } from "node:crypto";
import {
  AgentWorkRunnerError,
  createAgentWorkRunnerHandler,
  deriveLegacyProjectionEffectKey,
  deriveProjectionEffect,
} from "./index.ts";

const WORKER_ID = "worker:runner:chaos";
const MESSAGE_ID = "msg-chaos-0001";
const CORRELATION_ID = "corr-chaos-0001";
const WORK_ITEM_ID = "11111111-1111-4111-8111-111111111111";
const STEP_ID = "22222222-2222-4222-8222-222222222222";
const ORGANIZATION_ID = "33333333-3333-4333-8333-333333333333";
const CLIENT_ID = "44444444-4444-4444-8444-444444444444";
const ACTOR_USER_ID = "55555555-5555-4555-8555-555555555555";
const ATTEMPT_ID = "77777777-7777-4777-8777-777777777777";
const INVOCATION_SECRET = "runner-secret-value";
const GATEWAY_API_KEY = "sb_publishable_local_gateway";

const CRASH_POINTS = [
  "before_claim",
  "after_claim",
  "before_effect",
  "after_effect_before_record",
  "after_record_before_transition",
  "after_transition_before_archive",
  "during_event_append",
] as const;

type CrashPoint = typeof CRASH_POINTS[number];
type RuntimeMode = "disabled" | "shadow" | "advisory";

type AgentWorkQueueMessage = {
  workItemId: string;
  stepId?: string;
  organizationId: string;
  availableAt: string;
  correlationId: string;
  workflowVersion: number;
};

type QueueEnvelope = {
  messageId: string;
  payload: AgentWorkQueueMessage | Record<string, unknown>;
};

type RunnerResult =
  | {
    outcome: "completed";
    workItemId: string;
    stepId: string;
    reasonCode: string;
  }
  | { outcome: "waiting"; workItemId: string; stepId: string; wakeAt: string }
  | {
    outcome: "retry_scheduled";
    workItemId: string;
    stepId: string;
    retryAt: string;
  }
  | {
    outcome: "blocked";
    workItemId: string;
    stepId: string;
    reasonCode: string;
  }
  | { outcome: "no_work" };

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

type HandlerDeps = {
  now: () => Date;
  getCorsHeaders: () => HeadersInit;
  getInvocationSecret: () => string;
  getGatewayApiKeys: () => string[];
  getWorkerId: () => string;
  readQueueMessage: () => Promise<QueueEnvelope | null>;
  archiveQueueMessage: (messageId: string, reasonCode: string) => Promise<void>;
  loadRuntimePolicy: () => Promise<RuntimeMode>;
  rereadAuthoritativeScope: (
    input: RereadScopeInput,
  ) => Promise<AuthoritativeScope | null>;
  loadProjectionDescriptor: (
    scope: AuthoritativeScope,
  ) => Promise<{ effectKey: string; outputHash: string }>;
  claimStepLease: (stepId: string) => Promise<ClaimedLease>;
  executeStep: (scope: AuthoritativeScope) => Promise<ExecuteStepResult>;
  verifyPostcondition: (
    scope: AuthoritativeScope,
    expectedEffect: { effectKey: string; outputHash: string },
  ) => Promise<PostconditionResult>;
  findRecordedEffect: (
    stepId: string,
    effectKey: string,
  ) => Promise<RecordedEffect | null>;
  transitionStep: (input: TransitionInput) => Promise<void>;
  scheduleRetry: (input: RetryInput) => Promise<RetryDisposition>;
  appendEvent: (eventType: string) => Promise<void>;
};

type ChaosState = {
  nowIso: string;
  messagePresent: boolean;
  archivedReasonCodes: string[];
  crashInjected: boolean;
  retryCount: number;
  transitionCount: number;
  eventCount: number;
  archiveFailures: number;
  effectMutationCount: number;
  wakeAtIso: string | null;
  targetSatisfied: boolean;
  effectRecord: RecordedEffect | null;
  approvalBindingHash: string;
  scope: AuthoritativeScope;
  eventFailuresRemaining: number;
};

function deterministicScenarioOrder(seed: string): readonly CrashPoint[] {
  if (CRASH_POINTS.length <= 1) {
    return CRASH_POINTS;
  }
  const digest = createHash("sha256").update(seed).digest("hex");
  const offset = Number.parseInt(digest.slice(0, 8), 16) % CRASH_POINTS.length;
  return CRASH_POINTS.slice(offset).concat(CRASH_POINTS.slice(0, offset));
}

function configuredCrashPoints(): readonly CrashPoint[] {
  const configured = safeGetEnv("AGENT_WORK_CHAOS_CRASH_POINTS");
  if (configured) {
    const parsed = configured.split(",").map((value) => value.trim()).filter(Boolean);
    const valid = parsed.filter((value): value is CrashPoint =>
      (CRASH_POINTS as readonly string[]).includes(value)
    );
    if (valid.length > 0) {
      return valid;
    }
  }

  return deterministicScenarioOrder(
    safeGetEnv("AGENT_WORK_CHAOS_SEED") ?? "task10-default-seed",
  );
}

function safeGetEnv(name: string): string | undefined {
  try {
    return Deno.env.get(name) ?? undefined;
  } catch {
    return undefined;
  }
}

function createQueueMessage(
  overrides: Partial<AgentWorkQueueMessage> = {},
): AgentWorkQueueMessage {
  return {
    workItemId: WORK_ITEM_ID,
    stepId: STEP_ID,
    organizationId: ORGANIZATION_ID,
    availableAt: "2026-08-02T18:30:00.000Z",
    correlationId: CORRELATION_ID,
    workflowVersion: 1,
    ...overrides,
  };
}

function createAuthoritativeScope(
  overrides: Partial<AuthoritativeScope> = {},
): AuthoritativeScope {
  const scope = {
    workItemId: WORK_ITEM_ID,
    stepId: STEP_ID,
    organizationId: ORGANIZATION_ID,
    clientId: CLIENT_ID,
    workflowKey: "assessment.iehp.prepare_for_clinical_review",
    workflowVersion: 1,
    stepKey: "build_review_readiness",
    actorUserId: ACTOR_USER_ID,
    executionMode: "deterministic" as const,
    stepStatus: "ready" as const,
    itemStatus: "queued" as const,
    attemptCount: 0,
    maxAttempts: 3,
    inputHash:
      "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    evidenceHashes: [
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    ],
    effectKey: "",
    ...overrides,
  };
  return { ...scope, effectKey: deriveProjectionEffect(scope).effectKey };
}

function createRequest(): Request {
  return new Request("http://localhost/agent-work-runner", {
    method: "POST",
    headers: {
      apikey: GATEWAY_API_KEY,
      "x-agent-work-runner-secret": INVOCATION_SECRET,
    },
  });
}

function currentApprovalBindingHash(effectKey: string): string {
  return createHash("sha256").update(`approval:${effectKey}`).digest("hex");
}

function createChaosHarness(
  crashPoint: CrashPoint,
): { state: ChaosState; handler: (request: Request) => Promise<Response> } {
  const scope = createAuthoritativeScope();
  const initialEffect = deriveProjectionEffect(scope);
  const state: ChaosState = {
    nowIso: "2026-08-02T18:30:00.000Z",
    messagePresent: true,
    archivedReasonCodes: [],
    crashInjected: false,
    retryCount: 0,
    transitionCount: 0,
    eventCount: 0,
    archiveFailures: 0,
    effectMutationCount: 0,
    wakeAtIso: null,
    targetSatisfied: false,
    effectRecord: null,
    approvalBindingHash: currentApprovalBindingHash(initialEffect.effectKey),
    scope,
    eventFailuresRemaining: crashPoint === "during_event_append" ? 1 : 0,
  };

  const deps: HandlerDeps = {
    now: () => new Date(state.nowIso),
    getCorsHeaders: () => ({ "Access-Control-Allow-Origin": "http://localhost:5173" }),
    getInvocationSecret: () => INVOCATION_SECRET,
    getGatewayApiKeys: () => [GATEWAY_API_KEY],
    getWorkerId: () => WORKER_ID,
    readQueueMessage: async () =>
      state.messagePresent ? { messageId: MESSAGE_ID, payload: createQueueMessage() } : null,
    archiveQueueMessage: async (_messageId: string, reasonCode: string) => {
      if (crashPoint === "after_transition_before_archive" && !state.crashInjected) {
        state.crashInjected = true;
        state.archiveFailures += 1;
        throw new Error("archive transport unavailable");
      }
      state.messagePresent = false;
      state.archivedReasonCodes.push(reasonCode);
    },
    loadRuntimePolicy: async () => "advisory",
    rereadAuthoritativeScope: async (_input: RereadScopeInput) => ({
      ...state.scope,
      effectKey: deriveProjectionEffect(state.scope).effectKey,
    }),
    loadProjectionDescriptor: async (scopeValue: AuthoritativeScope) =>
      deriveProjectionEffect(scopeValue),
    claimStepLease: async () => {
      if (crashPoint === "before_claim" && !state.crashInjected) {
        state.crashInjected = true;
        throw new Error("crash before claim");
      }
      state.scope = {
        ...state.scope,
        stepStatus: "running",
        itemStatus: "running",
        attemptCount: state.scope.attemptCount + 1,
      };
      if (crashPoint === "after_claim" && !state.crashInjected) {
        state.crashInjected = true;
        throw new Error("crash after claim");
      }
      return {
        ok: true,
        stepId: STEP_ID,
        workItemId: WORK_ITEM_ID,
        stateVersion: "7",
        attemptId: ATTEMPT_ID,
      };
    },
    executeStep: async (scopeValue: AuthoritativeScope) => {
      const expectedEffect = deriveProjectionEffect(scopeValue);
      if (crashPoint === "before_effect" && !state.crashInjected) {
        state.crashInjected = true;
        throw new AgentWorkRunnerError(
          503,
          "Temporary provider outage",
          "transient_provider",
        );
      }
      if (!state.targetSatisfied) {
        state.targetSatisfied = true;
        state.effectMutationCount += 1;
      }
      if (crashPoint === "after_effect_before_record" && !state.crashInjected) {
        state.crashInjected = true;
        throw new Error("crash after effect before record");
      }
      state.effectRecord = {
        effectKey: expectedEffect.effectKey,
        outputHash: expectedEffect.outputHash,
        status: "pending",
        verifiedAt: null,
      };
      if (
        crashPoint === "after_record_before_transition" && !state.crashInjected
      ) {
        state.crashInjected = true;
        throw new Error("crash after effect record before transition");
      }
      return {
        kind: "completed",
        reasonCode: "review_readiness_built",
        ...expectedEffect,
      };
    },
    verifyPostcondition: async (scopeValue: AuthoritativeScope) => {
      if (!state.targetSatisfied) {
        return { ok: false, reasonCode: "postcondition_not_met" };
      }
      return {
        ok: true,
        outputHash: deriveProjectionEffect(scopeValue).outputHash,
      };
    },
    findRecordedEffect: async (_stepId: string, effectKey: string) => {
      if (!state.effectRecord || state.effectRecord.effectKey !== effectKey) {
        return null;
      }
      return state.effectRecord;
    },
    transitionStep: async (_input: TransitionInput) => {
      state.transitionCount += 1;
      state.scope = {
        ...state.scope,
        stepStatus: "completed",
        itemStatus: "needs_review",
      };
      if (state.effectRecord) {
        state.effectRecord = {
          ...state.effectRecord,
          status: "verified",
          verifiedAt: state.nowIso,
        };
      }
    },
    scheduleRetry: async (input: RetryInput) => {
      state.retryCount += 1;
      state.scope = {
        ...state.scope,
        stepStatus: "waiting",
        itemStatus: "waiting",
      };
      state.wakeAtIso = new Date(
        new Date(state.nowIso).getTime() + input.delaySeconds * 1000,
      ).toISOString();
      return {
        outcome: "retry_scheduled",
        retryAt: state.wakeAtIso,
      };
    },
    appendEvent: async (_eventType: string) => {
      if (state.eventFailuresRemaining > 0) {
        state.eventFailuresRemaining -= 1;
        state.crashInjected = true;
        throw new Error("event append unavailable");
      }
      state.eventCount += 1;
    },
  };

  return {
    state,
    handler: createAgentWorkRunnerHandler(deps),
  };
}

function advanceRecoveryState(
  state: ChaosState,
  crashPoint: CrashPoint,
): void {
  if (state.scope.stepStatus === "running") {
    state.scope = {
      ...state.scope,
      stepStatus: "ready",
      itemStatus: "queued",
    };
  }
  if (state.scope.stepStatus === "waiting" && state.wakeAtIso) {
    state.nowIso = new Date(
      new Date(state.wakeAtIso).getTime() + 1000,
    ).toISOString();
    state.scope = {
      ...state.scope,
      stepStatus: "ready",
      itemStatus: "queued",
    };
    state.messagePresent = true;
    state.wakeAtIso = null;
  }
  if (
    (crashPoint === "after_transition_before_archive" ||
      crashPoint === "during_event_append") &&
    state.scope.stepStatus === "completed" &&
    state.scope.itemStatus === "needs_review" &&
    !state.archivedReasonCodes.includes("effect_already_applied")
  ) {
    state.messagePresent = true;
  }
}

async function runScenario(crashPoint: CrashPoint): Promise<{
  attempts: number;
  outcomes: RunnerResult[];
  finalStatus: number;
  state: ChaosState;
}> {
  const { state, handler } = createChaosHarness(crashPoint);
  const outcomes: RunnerResult[] = [];
  let finalStatus = 200;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await handler(createRequest());
    finalStatus = response.status;
    const body = await response.json();
    if (body.success && body.data) {
      outcomes.push(body.data as RunnerResult);
    }
    const latest = outcomes.at(-1);
    if (latest?.outcome === "completed") {
      if (
        crashPoint === "after_transition_before_archive" ||
        crashPoint === "during_event_append"
      ) {
        if (state.archivedReasonCodes.includes("effect_already_applied")) {
          return { attempts: attempt + 1, outcomes, finalStatus, state };
        }
      } else if (!state.messagePresent) {
        return { attempts: attempt + 1, outcomes, finalStatus, state };
      }
    }
    if (latest?.outcome === "blocked" && latest.reasonCode === "event_append_failed") {
      advanceRecoveryState(state, crashPoint);
      continue;
    }
    advanceRecoveryState(state, crashPoint);
  }

  return { attempts: 5, outcomes, finalStatus, state };
}

for (const crashPoint of configuredCrashPoints()) {
  Deno.test(`agent work runner chaos ${crashPoint}`, async () => {
    const result = await runScenario(crashPoint);
    const lastOutcome = result.outcomes.at(-1);
    assert(lastOutcome);

    if (crashPoint === "after_transition_before_archive") {
      assertObjectMatch(lastOutcome, {
        outcome: "completed",
        reasonCode: "effect_already_applied",
      });
      assertEquals(result.state.effectMutationCount, 1);
      assertEquals(result.state.effectRecord?.status, "verified");
      assertEquals(result.state.scope.stepStatus === "running", false);
      return;
    }
    if (crashPoint === "during_event_append") {
      assertObjectMatch(lastOutcome, {
        outcome: "completed",
        reasonCode: "effect_already_applied",
      });
      assertEquals(result.state.effectRecord?.status, "verified");
      assertEquals(result.state.effectMutationCount, 1);
      assertEquals(result.state.eventCount, 1);
      assertEquals(result.state.scope.stepStatus === "running", false);
      return;
    }

    assertObjectMatch(lastOutcome, {
      outcome: "completed",
    });
    assertEquals(result.state.effectMutationCount, 1);
    assertEquals(result.state.effectRecord?.status, "verified");
    assertEquals(result.state.scope.stepStatus === "running", false);
  });
}

Deno.test(
  "agent work runner chaos keeps effect verification behind authoritative postconditions",
  async () => {
    const scope = createAuthoritativeScope();
    const expectedEffect = deriveProjectionEffect(scope);
    const deps: HandlerDeps = {
      now: () => new Date("2026-08-02T18:30:00.000Z"),
      getCorsHeaders: () => ({}),
      getInvocationSecret: () => INVOCATION_SECRET,
      getGatewayApiKeys: () => [GATEWAY_API_KEY],
      getWorkerId: () => WORKER_ID,
      readQueueMessage: async () => ({
        messageId: MESSAGE_ID,
        payload: createQueueMessage(),
      }),
      archiveQueueMessage: async () => Promise.resolve(),
      loadRuntimePolicy: async () => "advisory",
      rereadAuthoritativeScope: async () => scope,
      loadProjectionDescriptor: async () => expectedEffect,
      claimStepLease: async () => ({
        ok: true,
        stepId: STEP_ID,
        workItemId: WORK_ITEM_ID,
        stateVersion: "7",
        attemptId: ATTEMPT_ID,
      }),
      executeStep: async () => ({
        kind: "completed",
        reasonCode: "review_readiness_built",
        ...expectedEffect,
      }),
      verifyPostcondition: async () => ({
        ok: false,
        reasonCode: "postcondition_not_met",
      }),
      findRecordedEffect: async () => null,
      transitionStep: async () => {
        throw new Error("transition should not run");
      },
      scheduleRetry: async () => ({
        outcome: "retry_limit_exhausted",
      }),
      appendEvent: async () => Promise.resolve(),
    };
    const handler = createAgentWorkRunnerHandler(deps);
    const response = await handler(createRequest());
    assertEquals(response.status, 200);
    assertObjectMatch(await response.json(), {
      success: true,
      data: {
        outcome: "blocked",
        reasonCode: "postcondition_not_met",
      },
    });
  },
);

Deno.test(
  "agent work runner chaos derives distinct canonical effect keys and approval bindings for target or payload changes",
  () => {
    const base = createAuthoritativeScope();
    const baseEffect = deriveProjectionEffect(base);
    const changedTarget = deriveProjectionEffect({
      ...base,
      stepId: "99999999-9999-4999-8999-999999999999",
    });
    const changedPayload = deriveProjectionEffect({
      ...base,
      evidenceHashes: [
        ...base.evidenceHashes,
        "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      ],
    });

    assert(baseEffect.effectKey !== changedTarget.effectKey);
    assert(baseEffect.effectKey !== changedPayload.effectKey);
    assertEquals(
      currentApprovalBindingHash(baseEffect.effectKey) ===
        currentApprovalBindingHash(changedTarget.effectKey),
      false,
    );
    assertEquals(
      currentApprovalBindingHash(baseEffect.effectKey) ===
        currentApprovalBindingHash(changedPayload.effectKey),
      false,
    );
  },
);

Deno.test(
  "agent work runner chaos replays legacy projection effects recorded before canonical hashing",
  async () => {
    const scope = createAuthoritativeScope();
    const expectedEffect = deriveProjectionEffect(scope);
    const legacyKey = deriveLegacyProjectionEffectKey(scope);
    let replayedWithLegacy = false;
    const deps: HandlerDeps = {
      now: () => new Date("2026-08-02T18:30:00.000Z"),
      getCorsHeaders: () => ({}),
      getInvocationSecret: () => INVOCATION_SECRET,
      getGatewayApiKeys: () => [GATEWAY_API_KEY],
      getWorkerId: () => WORKER_ID,
      readQueueMessage: async () => ({
        messageId: MESSAGE_ID,
        payload: createQueueMessage(),
      }),
      archiveQueueMessage: async () => Promise.resolve(),
      loadRuntimePolicy: async () => "advisory",
      rereadAuthoritativeScope: async () => scope,
      loadProjectionDescriptor: async () => expectedEffect,
      claimStepLease: async () => ({
        ok: true,
        stepId: STEP_ID,
        workItemId: WORK_ITEM_ID,
        stateVersion: "7",
        attemptId: ATTEMPT_ID,
      }),
      executeStep: async () => {
        throw new Error("legacy replay should bypass execute");
      },
      verifyPostcondition: async (_scope, effect) => {
        replayedWithLegacy = effect.effectKey === legacyKey;
        return {
          ok: true,
          outputHash: expectedEffect.outputHash,
        };
      },
      findRecordedEffect: async (_stepId, effectKey) =>
        effectKey === legacyKey
          ? {
            effectKey: legacyKey,
            outputHash: expectedEffect.outputHash,
            status: "verified",
            verifiedAt: "2026-08-02T18:30:00.000Z",
          }
          : null,
      transitionStep: async (input) => {
        assertEquals(input.effectKey, legacyKey);
      },
      scheduleRetry: async () => ({
        outcome: "retry_limit_exhausted",
      }),
      appendEvent: async () => Promise.resolve(),
    };
    const handler = createAgentWorkRunnerHandler(deps);
    const response = await handler(createRequest());

    assertEquals(response.status, 200);
    assertObjectMatch(await response.json(), {
      success: true,
      data: {
        outcome: "completed",
        reasonCode: "effect_already_applied",
      },
    });
    assertEquals(replayedWithLegacy, true);
  },
);
