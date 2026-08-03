import { createHash } from "node:crypto";
import {
  assert,
  assertEquals,
  assertObjectMatch,
} from "https://deno.land/std@0.224.0/testing/asserts.ts";
import {
  AgentWorkRunnerError,
  assertLocalSupabaseUrl,
  computeRetryDelaySeconds,
  createAgentWorkRunnerHandler,
  deriveLegacyProjectionEffectKey,
  deriveProjectionEffect,
} from "./index.ts";

const WORKER_ID = "worker:runner:test";
const MESSAGE_ID = "msg-0001";
const CORRELATION_ID = "corr-0001";
const WORK_ITEM_ID = "11111111-1111-4111-8111-111111111111";
const STEP_ID = "22222222-2222-4222-8222-222222222222";
const ORGANIZATION_ID = "33333333-3333-4333-8333-333333333333";
const CLIENT_ID = "44444444-4444-4444-8444-444444444444";
const ACTOR_USER_ID = "55555555-5555-4555-8555-555555555555";
const ATTEMPT_ID = "77777777-7777-4777-8777-777777777777";
const EVIDENCE_HASH =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const OUTPUT_HASH =
  "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const EFFECT_KEY = "effect:assessment:review-ready";
const INVOCATION_SECRET = "runner-secret-value";
const SERVICE_ROLE_KEY = "local-service-role-jwt";
const NOW_ISO = "2026-08-02T16:00:00.000Z";
const RETRY_DELAY_SECONDS = 68;
const RETRY_AT_ISO = "2026-08-02T16:01:08.000Z";

type AgentWorkQueueMessage = {
  workItemId: string;
  stepId?: string;
  organizationId: string;
  availableAt: string;
  correlationId: string;
  workflowVersion: number;
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

type QueueEnvelope = {
  messageId: string;
  payload: AgentWorkQueueMessage | Record<string, unknown>;
};

type RuntimeMode = "disabled" | "shadow" | "advisory";

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

type ExecuteScope = AuthoritativeScope;

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
  ) => Promise<{ effectKey: string; outputHash: string }>;
  claimStepLease: (stepId: string) => Promise<ClaimedLease>;
  executeStep: (scope: ExecuteScope) => Promise<ExecuteStepResult>;
  verifyPostcondition: (scope: ExecuteScope) => Promise<PostconditionResult>;
  findRecordedEffect: (
    stepId: string,
    effectKey: string,
  ) => Promise<RecordedEffect | null>;
  markEffectVerified: (effectKey: string) => Promise<void>;
  transitionStep: (input: TransitionInput) => Promise<void>;
  scheduleRetry: (input: RetryInput) => Promise<RetryDisposition>;
  appendEvent: (eventType: string) => Promise<void>;
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

type Calls = {
  readQueueCount: number;
  archives: Array<{ messageId: string; reasonCode: string }>;
  policyLoads: number;
  authoritativeReads: Array<{
    workItemId: string;
    stepId: string | null;
    organizationId: string;
    workflowVersion: number;
  }>;
  projectionReads: string[];
  claims: string[];
  executions: string[];
  postconditions: string[];
  effectChecks: string[];
  effectMarks: string[];
  transitions: TransitionInput[];
  retries: Array<{ stepId: string; delaySeconds: number; reasonCode: string }>;
  events: string[];
};

function createQueueMessage(
  overrides: Partial<AgentWorkQueueMessage> = {},
): AgentWorkQueueMessage {
  return {
    workItemId: WORK_ITEM_ID,
    stepId: STEP_ID,
    organizationId: ORGANIZATION_ID,
    availableAt: NOW_ISO,
    correlationId: CORRELATION_ID,
    workflowVersion: 1,
    ...overrides,
  };
}

function createAuthoritativeScope(
  overrides: Partial<AuthoritativeScope> = {},
): AuthoritativeScope {
  return {
    workItemId: WORK_ITEM_ID,
    stepId: STEP_ID,
    organizationId: ORGANIZATION_ID,
    clientId: CLIENT_ID,
    workflowKey: "assessment.iehp.prepare_for_clinical_review",
    workflowVersion: 1,
    stepKey: "build_review_readiness",
    actorUserId: ACTOR_USER_ID,
    executionMode: "deterministic",
    stepStatus: "ready",
    itemStatus: "queued",
    attemptCount: 0,
    maxAttempts: 3,
    inputHash: OUTPUT_HASH,
    evidenceHashes: [EVIDENCE_HASH],
    effectKey: EFFECT_KEY,
    ...overrides,
  };
}

function createDeps(
  overrides: Partial<HandlerDeps> = {},
): HandlerDeps & { calls: Calls } {
  const calls: Calls = {
    readQueueCount: 0,
    archives: [],
    policyLoads: 0,
    authoritativeReads: [],
    projectionReads: [],
    claims: [],
    executions: [],
    postconditions: [],
    effectChecks: [],
    effectMarks: [],
    transitions: [],
    retries: [],
    events: [],
  };

  const deps: HandlerDeps = {
    now: () => new Date(NOW_ISO),
    getCorsHeaders: () => ({
      "Access-Control-Allow-Origin": "http://localhost:5173",
      Vary: "Origin",
    }),
    getInvocationSecret: () => INVOCATION_SECRET,
    getServiceRoleKey: () => SERVICE_ROLE_KEY,
    getWorkerId: () => WORKER_ID,
    readQueueMessage: async () => {
      calls.readQueueCount += 1;
      return {
        messageId: MESSAGE_ID,
        payload: createQueueMessage(),
      };
    },
    archiveQueueMessage: async (messageId: string, reasonCode: string) => {
      calls.archives.push({ messageId, reasonCode });
    },
    loadRuntimePolicy: async () => {
      calls.policyLoads += 1;
      return "advisory";
    },
    rereadAuthoritativeScope: async (input: RereadScopeInput) => {
      calls.authoritativeReads.push({ ...input });
      return createAuthoritativeScope();
    },
    loadProjectionDescriptor: async (scope: AuthoritativeScope) => {
      calls.projectionReads.push(scope.stepId);
      return deriveProjectionEffect(scope);
    },
    claimStepLease: async (stepId: string) => {
      calls.claims.push(stepId);
      return {
        ok: true,
        stepId,
        workItemId: WORK_ITEM_ID,
        stateVersion: "7",
        attemptId: ATTEMPT_ID,
      };
    },
    executeStep: async (scope: ExecuteScope) => {
      calls.executions.push(scope.stepId);
      const projection = deriveProjectionEffect(scope);
      return {
        kind: "completed",
        reasonCode: "review_readiness_built",
        ...projection,
      };
    },
    verifyPostcondition: async (scope: ExecuteScope) => {
      calls.postconditions.push(scope.stepId);
      return {
        ok: true,
        outputHash: deriveProjectionEffect(scope).outputHash,
      };
    },
    findRecordedEffect: async (_stepId: string, effectKey: string) => {
      calls.effectChecks.push(effectKey);
      return null;
    },
    markEffectVerified: async (effectKey: string) => {
      calls.effectMarks.push(effectKey);
    },
    transitionStep: async (input: TransitionInput) => {
      calls.transitions.push({ ...input });
    },
    scheduleRetry: async (input: RetryInput) => {
      calls.retries.push({ ...input });
      return {
        outcome: "retry_scheduled",
        retryAt: new Date(
          new Date(NOW_ISO).getTime() + input.delaySeconds * 1000,
        ).toISOString(),
      };
    },
    appendEvent: async (eventType: string) => {
      calls.events.push(eventType);
    },
  };

  return { ...deps, ...overrides, calls };
}

function createRequest(headers: HeadersInit = {}): Request {
  const requestHeaders = new Headers({
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
  });
  new Headers(headers).forEach((value, key) => requestHeaders.set(key, value));
  return new Request("http://localhost/agent-work-runner", {
    method: "POST",
    headers: requestHeaders,
  });
}

Deno.test("runner rejects missing or incorrect dedicated invocation secret before queue access", async () => {
  const deps = createDeps();
  const handler = createAgentWorkRunnerHandler(deps);

  for (
    const headers of [
      new Headers(),
      new Headers({ "x-agent-work-runner-secret": "wrong-secret" }),
      new Headers({
        Authorization: "",
        "x-agent-work-runner-secret": INVOCATION_SECRET,
      }),
      new Headers({
        Authorization: "Bearer wrong-service-role",
        "x-agent-work-runner-secret": INVOCATION_SECRET,
      }),
    ]
  ) {
    const response = await handler(createRequest(headers));
    assertEquals(response.status, 401);
    const body = await response.json();
    assertObjectMatch(body, {
      success: false,
      error: "Unauthorized",
      code: "runner_invocation_unauthorized",
    });
    assertEquals(JSON.stringify(body).includes(INVOCATION_SECRET), false);
  }

  assertEquals(deps.calls.readQueueCount, 0);
});

Deno.test("runner runtime accepts loopback by default and only exact Kong in phase2", () => {
  assertEquals(assertLocalSupabaseUrl("http://127.0.0.1:54321"), "http://127.0.0.1:54321");
  assertEquals(assertLocalSupabaseUrl("http://localhost:54321"), "http://localhost:54321");
  assertEquals(
    assertLocalSupabaseUrl("http://SUPABASE_KONG_AllIincompassing:8000", true),
    "http://supabase_kong_alliincompassing:8000",
  );
  for (const value of [
    "https://supabase_kong_alliincompassing:8000",
    "http://user@supabase_kong_alliincompassing:8000",
    "http://supabase_kong_alliincompassing:8000/path",
    "http://supabase_kong_alliincompassing:8000/?query=1",
    "http://supabase_kong_alliincompassing:8000/#fragment",
    "http://supabase_kong_alliincompassing:54321",
    "https://example.supabase.co",
    "http://host.docker.internal:54321",
    "http://kong:8000",
    "http://172.18.0.2:8000",
    "not-a-url",
  ]) {
    let rejected = false;
    try {
      assertLocalSupabaseUrl(value, true);
    } catch {
      rejected = true;
    }
    assertEquals(rejected, true, value);
  }
  let rejectedWithoutFlag = false;
  try {
    assertLocalSupabaseUrl("http://supabase_kong_alliincompassing:8000", false);
  } catch {
    rejectedWithoutFlag = true;
  }
  assertEquals(rejectedWithoutFlag, true);
});

Deno.test("runner archives malformed queue payloads that violate the strict DTO contract", async () => {
  const badMessages: QueueEnvelope[] = [
    {
      messageId: "bad-extra-key",
      payload: {
        ...createQueueMessage(),
        actorUserId: ACTOR_USER_ID,
      },
    },
    {
      messageId: "bad-work-item",
      payload: {
        ...createQueueMessage(),
        workItemId: "not-a-uuid",
      },
    },
    {
      messageId: "bad-available-at",
      payload: {
        ...createQueueMessage(),
        availableAt: "not-a-timestamp",
      },
    },
    {
      messageId: "bad-step-id",
      payload: {
        ...createQueueMessage(),
        stepId: 42,
      },
    },
  ];

  for (const message of badMessages) {
    const deps = createDeps({
      readQueueMessage: async () => {
        deps.calls.readQueueCount += 1;
        return message;
      },
    });
    const handler = createAgentWorkRunnerHandler(deps);

    const response = await handler(
      createRequest({ "x-agent-work-runner-secret": INVOCATION_SECRET }),
    );

    assertEquals(response.status, 200);
    assertObjectMatch(await response.json(), {
      success: true,
      data: { outcome: "no_work" },
    });
    assertEquals(deps.calls.archives, [{
      messageId: message.messageId,
      reasonCode: "invalid_queue_message",
    }]);
    assertEquals(deps.calls.authoritativeReads.length, 0);
  }
});

Deno.test("runner fails closed without consuming work when runtime policy is disabled or unreadable", async () => {
  for (
    const policyCase of [
      {
        name: "disabled",
        loadRuntimePolicy: async () => "disabled" as const,
        expectedReasonCode: "runtime_mode_disabled",
      },
      {
        name: "unreadable",
        loadRuntimePolicy: async () => {
          throw new Error("policy row unreadable");
        },
        expectedReasonCode: "runtime_policy_unavailable",
      },
    ]
  ) {
    const deps = createDeps({
      loadRuntimePolicy: async () => {
        deps.calls.policyLoads += 1;
        return await policyCase.loadRuntimePolicy();
      },
    });
    const handler = createAgentWorkRunnerHandler(deps);

    const response = await handler(
      createRequest({ "x-agent-work-runner-secret": INVOCATION_SECRET }),
    );

    assertEquals(response.status, 200, policyCase.name);
    const body = await response.json();
    assertObjectMatch(body, {
      success: true,
      data: {
        outcome: "blocked",
        workItemId: WORK_ITEM_ID,
        stepId: STEP_ID,
        reasonCode: policyCase.expectedReasonCode,
      } satisfies RunnerResult,
    });
    assertEquals(deps.calls.archives, []);
    assertEquals(deps.calls.claims.length, 0);
    assertEquals(deps.calls.executions.length, 0);
    assertEquals(deps.calls.transitions.length, 0);
  }
});

Deno.test("runner re-reads authoritative tenant workflow and step scope before claiming work", async () => {
  const deps = createDeps({
    rereadAuthoritativeScope: async (input: RereadScopeInput) => {
      deps.calls.authoritativeReads.push({ ...input });
      return createAuthoritativeScope({
        organizationId: "99999999-9999-4999-8999-999999999999",
      });
    },
  });
  const handler = createAgentWorkRunnerHandler(deps);

  const response = await handler(
    createRequest({ "x-agent-work-runner-secret": INVOCATION_SECRET }),
  );

  assertEquals(response.status, 200);
  assertObjectMatch(await response.json(), {
    success: true,
    data: {
      outcome: "blocked",
      workItemId: WORK_ITEM_ID,
      stepId: STEP_ID,
      reasonCode: "authoritative_scope_mismatch",
    } satisfies RunnerResult,
  });
  assertEquals(deps.calls.authoritativeReads, [{
    workItemId: WORK_ITEM_ID,
    stepId: STEP_ID,
    organizationId: ORGANIZATION_ID,
    workflowVersion: 1,
  }]);
  assertEquals(deps.calls.claims.length, 0);
  assertEquals(deps.calls.archives, []);
});

Deno.test("runner requires an authoritative domain projection before claiming work", async () => {
  const deps = createDeps({
    loadProjectionDescriptor: async () => {
      throw new Error("assessment domain unavailable");
    },
  });
  const handler = createAgentWorkRunnerHandler(deps);

  const response = await handler(
    createRequest({ "x-agent-work-runner-secret": INVOCATION_SECRET }),
  );

  assertEquals(response.status, 200);
  assertObjectMatch(await response.json(), {
    success: true,
    data: {
      outcome: "blocked",
      workItemId: WORK_ITEM_ID,
      stepId: STEP_ID,
      reasonCode: "authoritative_projection_unavailable",
    } satisfies RunnerResult,
  });
  assertEquals(deps.calls.claims, []);
  assertEquals(deps.calls.archives, []);
});

Deno.test("runner fails closed without claiming when authoritative scope lookup errors", async () => {
  const deps = createDeps({
    rereadAuthoritativeScope: async () => {
      throw new Error("scope unavailable");
    },
  });
  const handler = createAgentWorkRunnerHandler(deps);

  const response = await handler(
    createRequest({ "x-agent-work-runner-secret": INVOCATION_SECRET }),
  );

  assertEquals(response.status, 200);
  assertObjectMatch(await response.json(), {
    success: true,
    data: {
      outcome: "blocked",
      workItemId: WORK_ITEM_ID,
      stepId: STEP_ID,
      reasonCode: "authoritative_scope_unavailable",
    } satisfies RunnerResult,
  });
  assertEquals(deps.calls.claims, []);
  assertEquals(deps.calls.archives, []);
});

Deno.test("runner processes at most one queue message and one claimed step per invocation", async () => {
  const queued: QueueEnvelope[] = [
    { messageId: "first-message", payload: createQueueMessage() },
    {
      messageId: "second-message",
      payload: createQueueMessage({
        workItemId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        stepId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        correlationId: "corr-0002",
      }),
    },
  ];
  const deps = createDeps({
    readQueueMessage: async () => {
      deps.calls.readQueueCount += 1;
      return queued.shift() ?? null;
    },
  });
  const handler = createAgentWorkRunnerHandler(deps);

  const response = await handler(
    createRequest({ "x-agent-work-runner-secret": INVOCATION_SECRET }),
  );

  assertEquals(response.status, 200);
  assertObjectMatch(await response.json(), {
    success: true,
    data: {
      outcome: "completed",
      workItemId: WORK_ITEM_ID,
      stepId: STEP_ID,
      reasonCode: "review_readiness_built",
    } satisfies RunnerResult,
  });
  assertEquals(deps.calls.readQueueCount, 1);
  assertEquals(deps.calls.claims, [STEP_ID]);
  assertEquals(deps.calls.executions, [STEP_ID]);
  assertEquals(deps.calls.transitions, [{
    stepId: STEP_ID,
    expectedStateVersion: "7",
    toStatus: "completed",
    reasonCode: "review_readiness_built",
    outputHash: deriveProjectionEffect(createAuthoritativeScope()).outputHash,
    effectKey: deriveProjectionEffect(createAuthoritativeScope()).effectKey,
    workerId: WORKER_ID,
    attemptId: ATTEMPT_ID,
  }]);
});

Deno.test("runner fails closed when the atomic claim does not match the queued authoritative step", async () => {
  const otherStepId = "66666666-6666-4666-8666-666666666666";
  const deps = createDeps({
    claimStepLease: async (stepId: string) => {
      deps.calls.claims.push(stepId);
      return {
        ok: true,
        stepId: otherStepId,
        workItemId: WORK_ITEM_ID,
        stateVersion: "7",
        attemptId: ATTEMPT_ID,
      };
    },
  });
  const handler = createAgentWorkRunnerHandler(deps);

  const response = await handler(
    createRequest({ "x-agent-work-runner-secret": INVOCATION_SECRET }),
  );

  assertEquals(response.status, 200);
  assertObjectMatch(await response.json(), {
    success: true,
    data: {
      outcome: "blocked",
      workItemId: WORK_ITEM_ID,
      stepId: STEP_ID,
      reasonCode: "claimed_scope_mismatch",
    } satisfies RunnerResult,
  });
  assertEquals(deps.calls.executions.length, 0);
  assertEquals(deps.calls.effectMarks.length, 0);
  assertEquals(deps.calls.transitions.length, 0);
});

Deno.test("runner reconciles duplicate effects through the authoritative postcondition and claimed transition", async () => {
  const duplicateDeps = createDeps({
    findRecordedEffect: async (_stepId: string, effectKey: string) => {
      duplicateDeps.calls.effectChecks.push(effectKey);
      return {
        effectKey,
        outputHash:
          deriveProjectionEffect(createAuthoritativeScope()).outputHash,
        status: "verified",
        verifiedAt: NOW_ISO,
      };
    },
  });
  const duplicateHandler = createAgentWorkRunnerHandler(duplicateDeps);

  const duplicateResponse = await duplicateHandler(
    createRequest({ "x-agent-work-runner-secret": INVOCATION_SECRET }),
  );

  assertEquals(duplicateResponse.status, 200);
  assertObjectMatch(await duplicateResponse.json(), {
    success: true,
    data: {
      outcome: "completed",
      workItemId: WORK_ITEM_ID,
      stepId: STEP_ID,
      reasonCode: "effect_already_applied",
    } satisfies RunnerResult,
  });
  assertEquals(duplicateDeps.calls.executions.length, 0);
  assertEquals(duplicateDeps.calls.postconditions, [STEP_ID]);
  assertEquals(duplicateDeps.calls.effectMarks, []);
  assertEquals(duplicateDeps.calls.transitions, [{
    stepId: STEP_ID,
    expectedStateVersion: "7",
    toStatus: "completed",
    reasonCode: "effect_already_applied",
    outputHash: deriveProjectionEffect(createAuthoritativeScope()).outputHash,
    effectKey: deriveProjectionEffect(createAuthoritativeScope()).effectKey,
    workerId: WORKER_ID,
    attemptId: ATTEMPT_ID,
  }]);
  assertEquals(duplicateDeps.calls.archives, [{
    messageId: MESSAGE_ID,
    reasonCode: "effect_already_applied",
  }]);

  const noWorkDeps = createDeps({
    readQueueMessage: async () => {
      noWorkDeps.calls.readQueueCount += 1;
      return null;
    },
  });
  const noWorkHandler = createAgentWorkRunnerHandler(noWorkDeps);

  const noWorkResponse = await noWorkHandler(
    createRequest({ "x-agent-work-runner-secret": INVOCATION_SECRET }),
  );

  assertEquals(noWorkResponse.status, 200);
  assertObjectMatch(await noWorkResponse.json(), {
    success: true,
    data: { outcome: "no_work" } satisfies RunnerResult,
  });
  assertEquals(noWorkDeps.calls.archives.length, 0);
  assertEquals(noWorkDeps.calls.authoritativeReads.length, 0);
});

Deno.test("runner rejects cancelled human and unknown workflow executions after authoritative reread", async () => {
  const cases = [
    {
      name: "cancelled item",
      scope: createAuthoritativeScope({ itemStatus: "cancelled" }),
      expectedReasonCode: "work_item_cancelled",
    },
    {
      name: "human step",
      scope: createAuthoritativeScope({ executionMode: "human" }),
      expectedReasonCode: "human_step_requires_manual_action",
    },
    {
      name: "guarded model step",
      scope: createAuthoritativeScope({ executionMode: "model_suggested" }),
      expectedReasonCode: "model_step_requires_guarded_provider",
    },
    {
      name: "unknown workflow",
      scope: createAuthoritativeScope({
        workflowKey: "assessment.unknown.workflow",
      }),
      expectedReasonCode: "workflow_definition_not_found",
    },
  ] as const;

  for (const scenario of cases) {
    const deps = createDeps({
      rereadAuthoritativeScope: async (input: RereadScopeInput) => {
        deps.calls.authoritativeReads.push({ ...input });
        return scenario.scope;
      },
    });
    const handler = createAgentWorkRunnerHandler(deps);

    const response = await handler(
      createRequest({ "x-agent-work-runner-secret": INVOCATION_SECRET }),
    );

    assertEquals(response.status, 200, scenario.name);
    assertObjectMatch(await response.json(), {
      success: true,
      data: {
        outcome: "blocked",
        workItemId: WORK_ITEM_ID,
        stepId: STEP_ID,
        reasonCode: scenario.expectedReasonCode,
      } satisfies RunnerResult,
    });
    assertEquals(deps.calls.claims.length, 0, scenario.name);
    assertEquals(deps.calls.executions.length, 0, scenario.name);
    assertEquals(deps.calls.archives, [{
      messageId: MESSAGE_ID,
      reasonCode: scenario.expectedReasonCode,
    }], scenario.name);
  }
});

Deno.test("runner leaves the CalOptima immutable packet snapshot to its dedicated SQL adapter", async () => {
  const scope = createAuthoritativeScope({
    workflowKey: "assessment.caloptima.prepare_draft_review",
    stepKey: "snapshot_draft_packet",
  });
  const deps = createDeps({
    rereadAuthoritativeScope: async (input: RereadScopeInput) => {
      deps.calls.authoritativeReads.push({ ...input });
      return scope;
    },
  });
  const handler = createAgentWorkRunnerHandler(deps);

  const response = await handler(
    createRequest({ "x-agent-work-runner-secret": INVOCATION_SECRET }),
  );

  assertEquals(response.status, 200);
  assertObjectMatch(await response.json(), {
    success: true,
    data: {
      outcome: "blocked",
      workItemId: WORK_ITEM_ID,
      stepId: STEP_ID,
      reasonCode: "dedicated_adapter_step",
    } satisfies RunnerResult,
  });
  assertEquals(deps.calls.claims, []);
  assertEquals(deps.calls.executions.length, 0);
  assertEquals(deps.calls.archives, [{
    messageId: MESSAGE_ID,
    reasonCode: "dedicated_adapter_step",
  }]);
});

Deno.test("runner verifies the authoritative postcondition before marking an effect verified or completing the step", async () => {
  const deps = createDeps({
    verifyPostcondition: async (scope: ExecuteScope) => {
      deps.calls.postconditions.push(scope.stepId);
      return {
        ok: false,
        reasonCode: "postcondition_not_met",
      };
    },
  });
  const handler = createAgentWorkRunnerHandler(deps);

  const response = await handler(
    createRequest({ "x-agent-work-runner-secret": INVOCATION_SECRET }),
  );

  assertEquals(response.status, 200);
  assertObjectMatch(await response.json(), {
    success: true,
    data: {
      outcome: "blocked",
      workItemId: WORK_ITEM_ID,
      stepId: STEP_ID,
      reasonCode: "postcondition_not_met",
    } satisfies RunnerResult,
  });
  assertEquals(deps.calls.executions, [STEP_ID]);
  assertEquals(deps.calls.postconditions, [STEP_ID]);
  assertEquals(deps.calls.effectMarks.length, 0);
  assert(
    deps.calls.transitions.every((transition: TransitionInput) =>
      transition.toStatus !== "completed"
    ),
  );
});

Deno.test("runner replays a completion event and archives the stale message after a transient append failure", async () => {
  let attempts = 0;
  const firstDeps = createDeps({
    appendEvent: async (eventType: string) => {
      firstDeps.calls.events.push(eventType);
      attempts += 1;
      if (attempts === 1) {
        throw new Error("event sink unavailable");
      }
    },
  });
  const firstHandler = createAgentWorkRunnerHandler(firstDeps);

  const firstResponse = await firstHandler(
    createRequest({ "x-agent-work-runner-secret": INVOCATION_SECRET }),
  );

  assertEquals(firstResponse.status, 200);
  assertObjectMatch(await firstResponse.json(), {
    success: true,
    data: {
      outcome: "blocked",
      workItemId: WORK_ITEM_ID,
      stepId: STEP_ID,
      reasonCode: "event_append_failed",
    } satisfies RunnerResult,
  });
  assertEquals(firstDeps.calls.transitions, [{
    stepId: STEP_ID,
    expectedStateVersion: "7",
    toStatus: "completed",
    reasonCode: "review_readiness_built",
    outputHash: deriveProjectionEffect(createAuthoritativeScope()).outputHash,
    effectKey: deriveProjectionEffect(createAuthoritativeScope()).effectKey,
    workerId: WORKER_ID,
    attemptId: ATTEMPT_ID,
  }]);
  assertEquals(firstDeps.calls.archives, []);
  assertEquals(firstDeps.calls.events, ["agent_work_runner.completed"]);

  const replayDeps = createDeps({
    rereadAuthoritativeScope: async (input: RereadScopeInput) => {
      replayDeps.calls.authoritativeReads.push({ ...input });
      return createAuthoritativeScope({
        stepStatus: "completed",
        itemStatus: "needs_review",
      });
    },
    findRecordedEffect: async (_stepId: string, effectKey: string) => {
      replayDeps.calls.effectChecks.push(effectKey);
      return {
        effectKey,
        outputHash: deriveProjectionEffect(createAuthoritativeScope()).outputHash,
        status: "verified",
        verifiedAt: NOW_ISO,
      };
    },
  });
  const replayHandler = createAgentWorkRunnerHandler(replayDeps);
  const secondResponse = await replayHandler(
    createRequest({ "x-agent-work-runner-secret": INVOCATION_SECRET }),
  );
  assertEquals(secondResponse.status, 200);
  assertObjectMatch(await secondResponse.json(), {
    success: true,
    data: {
      outcome: "completed",
      workItemId: WORK_ITEM_ID,
      stepId: STEP_ID,
      reasonCode: "effect_already_applied",
    } satisfies RunnerResult,
  });
  assertEquals(replayDeps.calls.claims, []);
  assertEquals(replayDeps.calls.executions, []);
  assertEquals(replayDeps.calls.archives, [{
    messageId: MESSAGE_ID,
    reasonCode: "effect_already_applied",
  }]);
  assertEquals(replayDeps.calls.events, ["agent_work_runner.completed"]);
});

Deno.test("runner reconciles a legacy projection effect key recorded before canonical hashing", async () => {
  const scope = createAuthoritativeScope();
  const expectedEffect = deriveProjectionEffect(scope);
  const legacyKey = deriveLegacyProjectionEffectKey(scope);
  const deps = createDeps({
    findRecordedEffect: async (_stepId: string, effectKey: string) => {
      deps.calls.effectChecks.push(effectKey);
      if (effectKey === expectedEffect.effectKey) {
        return null;
      }
      if (effectKey === legacyKey) {
        return {
          effectKey: legacyKey,
          outputHash: expectedEffect.outputHash,
          status: "verified",
          verifiedAt: NOW_ISO,
        };
      }
      return null;
    },
  });
  const handler = createAgentWorkRunnerHandler(deps);

  const response = await handler(
    createRequest({ "x-agent-work-runner-secret": INVOCATION_SECRET }),
  );

  assertEquals(response.status, 200);
  assertObjectMatch(await response.json(), {
    success: true,
    data: {
      outcome: "completed",
      workItemId: WORK_ITEM_ID,
      stepId: STEP_ID,
      reasonCode: "effect_already_applied",
    } satisfies RunnerResult,
  });
  assertEquals(deps.calls.effectChecks, [expectedEffect.effectKey, legacyKey]);
  assertEquals(deps.calls.executions, []);
  assertEquals(deps.calls.transitions, [{
    stepId: STEP_ID,
    expectedStateVersion: "7",
    toStatus: "completed",
    reasonCode: "effect_already_applied",
    outputHash: expectedEffect.outputHash,
    effectKey: legacyKey,
    workerId: WORKER_ID,
    attemptId: ATTEMPT_ID,
  }]);
  assertEquals(deps.calls.archives, [{
    messageId: MESSAGE_ID,
    reasonCode: "effect_already_applied",
  }]);
});

Deno.test("runner leaves finalization conflicts deliverable for authoritative reconciliation", async () => {
  const deps = createDeps({
    transitionStep: async () => {
      throw new AgentWorkRunnerError(
        409,
        "Finalization conflict",
        "finalization_conflict",
      );
    },
  });
  const handler = createAgentWorkRunnerHandler(deps);

  const response = await handler(
    createRequest({ "x-agent-work-runner-secret": INVOCATION_SECRET }),
  );

  assertEquals(response.status, 200);
  assertObjectMatch(await response.json(), {
    success: true,
    data: {
      outcome: "blocked",
      workItemId: WORK_ITEM_ID,
      stepId: STEP_ID,
      reasonCode: "finalization_conflict",
    } satisfies RunnerResult,
  });
  assertEquals(deps.calls.archives, []);
});

Deno.test("runner rejects an execution result that differs from the server-owned projection descriptor", async () => {
  const deps = createDeps({
    executeStep: async (scope: ExecuteScope) => {
      deps.calls.executions.push(scope.stepId);
      return {
        kind: "completed",
        reasonCode: "review_readiness_built",
        outputHash: OUTPUT_HASH,
        effectKey: "projection:mismatched",
      };
    },
  });
  const handler = createAgentWorkRunnerHandler(deps);

  const response = await handler(
    createRequest({ "x-agent-work-runner-secret": INVOCATION_SECRET }),
  );

  assertEquals(response.status, 200);
  assertObjectMatch(await response.json(), {
    success: true,
    data: {
      outcome: "blocked",
      workItemId: WORK_ITEM_ID,
      stepId: STEP_ID,
      reasonCode: "effect_record_mismatch",
    } satisfies RunnerResult,
  });
  assertEquals(deps.calls.postconditions.length, 0);
  assertEquals(deps.calls.effectMarks.length, 0);
  assertEquals(deps.calls.transitions.length, 0);
});

Deno.test("runner classifies only retryable failures into bounded retries and blocks non-retryable failures immediately", async () => {
  const retryableDeps = createDeps({
    rereadAuthoritativeScope: async (input: RereadScopeInput) => {
      retryableDeps.calls.authoritativeReads.push({ ...input });
      return createAuthoritativeScope({
        attemptCount: 1,
        maxAttempts: 3,
      });
    },
    executeStep: async (scope: ExecuteScope) => {
      retryableDeps.calls.executions.push(scope.stepId);
      throw new AgentWorkRunnerError(
        503,
        "Temporary provider outage",
        "transient_provider",
      );
    },
  });
  const retryableHandler = createAgentWorkRunnerHandler(retryableDeps);

  const retryableResponse = await retryableHandler(
    createRequest({ "x-agent-work-runner-secret": INVOCATION_SECRET }),
  );

  assertEquals(retryableResponse.status, 200);
  assertObjectMatch(await retryableResponse.json(), {
    success: true,
    data: {
      outcome: "retry_scheduled",
      workItemId: WORK_ITEM_ID,
      stepId: STEP_ID,
      retryAt: RETRY_AT_ISO,
    } satisfies RunnerResult,
  });
  assertEquals(retryableDeps.calls.retries, [{
    stepId: STEP_ID,
    delaySeconds: RETRY_DELAY_SECONDS,
    reasonCode: "transient_provider",
  }]);
  assertEquals(retryableDeps.calls.archives, [{
    messageId: MESSAGE_ID,
    reasonCode: "retry_scheduled",
  }]);

  const exhaustedDeps = createDeps({
    rereadAuthoritativeScope: async (input: RereadScopeInput) => {
      exhaustedDeps.calls.authoritativeReads.push({ ...input });
      return createAuthoritativeScope({
        attemptCount: 3,
        maxAttempts: 3,
      });
    },
    executeStep: async (scope: ExecuteScope) => {
      exhaustedDeps.calls.executions.push(scope.stepId);
      throw new AgentWorkRunnerError(
        503,
        "Temporary provider outage",
        "transient_provider",
      );
    },
    scheduleRetry: async (input: RetryInput) => {
      exhaustedDeps.calls.retries.push({ ...input });
      return { outcome: "retry_limit_exhausted" };
    },
  });
  const exhaustedHandler = createAgentWorkRunnerHandler(exhaustedDeps);

  const exhaustedResponse = await exhaustedHandler(
    createRequest({ "x-agent-work-runner-secret": INVOCATION_SECRET }),
  );

  assertEquals(exhaustedResponse.status, 200);
  assertObjectMatch(await exhaustedResponse.json(), {
    success: true,
    data: {
      outcome: "blocked",
      workItemId: WORK_ITEM_ID,
      stepId: STEP_ID,
      reasonCode: "retry_limit_exhausted",
    } satisfies RunnerResult,
  });
  assertEquals(exhaustedDeps.calls.retries.length, 1);

  const finalAttemptDeps = createDeps({
    rereadAuthoritativeScope: async (input: RereadScopeInput) => {
      finalAttemptDeps.calls.authoritativeReads.push({ ...input });
      return createAuthoritativeScope({
        attemptCount: 2,
        maxAttempts: 3,
      });
    },
    executeStep: async (scope: ExecuteScope) => {
      finalAttemptDeps.calls.executions.push(scope.stepId);
      throw new AgentWorkRunnerError(
        503,
        "Temporary provider outage",
        "transient_provider",
      );
    },
    scheduleRetry: async (input: RetryInput) => {
      finalAttemptDeps.calls.retries.push({ ...input });
      return { outcome: "retry_limit_exhausted" };
    },
  });
  const finalAttemptResponse = await createAgentWorkRunnerHandler(
    finalAttemptDeps,
  )(createRequest({ "x-agent-work-runner-secret": INVOCATION_SECRET }));

  assertEquals(finalAttemptResponse.status, 200);
  assertObjectMatch(await finalAttemptResponse.json(), {
    success: true,
    data: {
      outcome: "blocked",
      workItemId: WORK_ITEM_ID,
      stepId: STEP_ID,
      reasonCode: "retry_limit_exhausted",
    } satisfies RunnerResult,
  });
  assertEquals(finalAttemptDeps.calls.retries.length, 1);

  const retryRaceDeps = createDeps({
    executeStep: async () => {
      throw new AgentWorkRunnerError(
        503,
        "Temporary provider outage",
        "transient_provider",
      );
    },
    scheduleRetry: async () => {
      throw new Error("lease changed");
    },
  });
  const retryRaceResponse = await createAgentWorkRunnerHandler(retryRaceDeps)(
    createRequest({ "x-agent-work-runner-secret": INVOCATION_SECRET }),
  );
  assertEquals(retryRaceResponse.status, 200);
  assertObjectMatch(await retryRaceResponse.json(), {
    success: true,
    data: {
      outcome: "blocked",
      workItemId: WORK_ITEM_ID,
      stepId: STEP_ID,
      reasonCode: "retry_schedule_failed",
    } satisfies RunnerResult,
  });
  assertEquals(retryRaceDeps.calls.archives, []);

  const policyDeps = createDeps({
    executeStep: async (scope: ExecuteScope) => {
      policyDeps.calls.executions.push(scope.stepId);
      throw new AgentWorkRunnerError(403, "Forbidden action", "policy");
    },
  });
  const policyHandler = createAgentWorkRunnerHandler(policyDeps);

  const policyResponse = await policyHandler(
    createRequest({ "x-agent-work-runner-secret": INVOCATION_SECRET }),
  );

  assertEquals(policyResponse.status, 200);
  assertObjectMatch(await policyResponse.json(), {
    success: true,
    data: {
      outcome: "blocked",
      workItemId: WORK_ITEM_ID,
      stepId: STEP_ID,
      reasonCode: "policy",
    } satisfies RunnerResult,
  });
  assertEquals(policyDeps.calls.retries.length, 0);
  assertEquals(policyDeps.calls.archives, [{
    messageId: MESSAGE_ID,
    reasonCode: "policy",
  }]);
});

Deno.test("runner responses and errors remain operational and PHI-free", async () => {
  const deps = createDeps({
    executeStep: async () => {
      throw new Error(
        "Client Jane Doe at 123 Main St uploaded IEHP-FBA.pdf with token abc123",
      );
    },
  });
  const handler = createAgentWorkRunnerHandler(deps);

  const response = await handler(
    createRequest({ "x-agent-work-runner-secret": INVOCATION_SECRET }),
  );

  assertEquals(response.status, 500);
  const body = await response.json();
  assertObjectMatch(body, {
    success: false,
    error: "Runner execution failed",
    code: "runner_execution_failed",
  });
  const serialized = JSON.stringify(body);
  for (
    const forbidden of [
      "Jane Doe",
      "123 Main St",
      "IEHP-FBA.pdf",
      "abc123",
      INVOCATION_SECRET,
      CLIENT_ID,
    ]
  ) {
    assertEquals(serialized.includes(forbidden), false, forbidden);
  }
});

Deno.test("runner derives a stable projection effect from authoritative PHI-free scope and evidence hashes", () => {
  const scope = createAuthoritativeScope();
  const first = deriveProjectionEffect(scope);
  const reordered = deriveProjectionEffect({
    ...scope,
    evidenceHashes: [
      "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      EVIDENCE_HASH,
    ],
  });
  const reorderedAgain = deriveProjectionEffect({
    ...scope,
    evidenceHashes: [
      EVIDENCE_HASH,
      "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    ],
  });

  const canonicalProjection = JSON.stringify({
    organizationId: scope.organizationId,
    clientId: scope.clientId,
    workItemId: scope.workItemId,
    stepId: scope.stepId,
    workflowKey: scope.workflowKey,
    workflowVersion: scope.workflowVersion,
    stepKey: scope.stepKey,
    inputHash: scope.inputHash,
    evidenceHashes: [...scope.evidenceHashes].sort(),
  });
  const payloadHash = createHash("sha256").update(canonicalProjection).digest(
    "hex",
  );
  const expectedEffectKey = createHash("sha256").update(
    JSON.stringify({
      organizationId: scope.organizationId,
      actorUserId: scope.actorUserId,
      workflowKey: scope.workflowKey,
      workflowVersion: scope.workflowVersion,
      stepKey: scope.stepKey,
      targetKind: "agent_work_step",
      targetId: scope.stepId,
      payloadHash,
    }),
  ).digest("hex");

  assertEquals(first.effectKey, expectedEffectKey);
  assertEquals(first.effectKey.length, 64);
  assertEquals(first.outputHash.length, 64);
  assertEquals(reordered.outputHash, reorderedAgain.outputHash);
  assert(first.outputHash !== scope.inputHash);
  assert(first.effectKey !== reordered.effectKey);
  const retargeted = deriveProjectionEffect({
    ...scope,
    stepId: "88888888-8888-4888-8888-888888888888",
  });
  assert(first.effectKey !== retargeted.effectKey);
});

Deno.test("runner retry policy uses bounded exponential backoff with deterministic jitter", () => {
  const first = computeRetryDelaySeconds(STEP_ID, 1);
  const second = computeRetryDelaySeconds(STEP_ID, 2);
  const capped = computeRetryDelaySeconds(STEP_ID, 100);

  assert(first >= 30 && first <= 36);
  assert(second >= 60 && second <= 72);
  assert(second > first);
  assert(capped <= 1800);
  assertEquals(computeRetryDelaySeconds(STEP_ID, 2), second);
});
