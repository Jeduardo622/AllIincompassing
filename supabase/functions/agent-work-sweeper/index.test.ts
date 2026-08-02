import {
  assertEquals,
  assertObjectMatch,
} from "https://deno.land/std@0.224.0/testing/asserts.ts";
import {
  assertLocalSupabaseUrl,
  createAgentWorkSweeperHandler,
} from "./index.ts";

const INVOCATION_SECRET_HEADER = "x-agent-work-sweeper-secret";
const INVOCATION_SECRET = "sweeper-secret";
const SERVICE_ROLE_KEY = "local-service-role-jwt";
const WORK_ITEM_ID = "11111111-1111-4111-8111-111111111111";
const STEP_ID = "22222222-2222-4222-8222-222222222222";
const APPROVAL_ID = "33333333-3333-4333-8333-333333333333";
const QUEUE_MESSAGE_ID = "44444444-4444-4444-8444-444444444444";

type HandlerDeps = Parameters<typeof createAgentWorkSweeperHandler>[0];

type SweeperEntity = {
  workItemId: string;
  stepId?: string;
  approvalId?: string;
  queueMessageId?: string;
  reasonCode: string;
  privateError?: string;
  clinicalSummary?: string;
  payloadPreview?: string;
  signedUrl?: string;
  token?: string;
  wakeAt?: string;
};

type SweepInvocation = {
  maxItemsPerPass: number;
  now: string;
};

function createEntity(overrides: Partial<SweeperEntity> = {}): SweeperEntity {
  return {
    workItemId: WORK_ITEM_ID,
    stepId: STEP_ID,
    approvalId: APPROVAL_ID,
    queueMessageId: QUEUE_MESSAGE_ID,
    reasonCode: "lease_expired",
    privateError: "private database detail",
    clinicalSummary: "Johnny Appleseed clinical summary",
    payloadPreview: '{"document_text":"sensitive"}',
    signedUrl: "https://signed.example.invalid/object",
    token: "sk_live_123",
    wakeAt: "2026-08-02T12:05:00.000Z",
    ...overrides,
  };
}

function createRequest(init: RequestInit = {}): Request {
  const headers = new Headers({
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
  });
  new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  return new Request("http://localhost/agent-work-sweeper", {
    ...init,
    headers,
  });
}

function createDeps(
  overrides: Partial<HandlerDeps> = {},
): HandlerDeps & {
  calls: {
    requeueExpiredLeases: SweepInvocation[];
    wakeDueWaitingSteps: SweepInvocation[];
    expireApprovals: SweepInvocation[];
    archivePoisonMessages: SweepInvocation[];
    emitSanitizedAlert: unknown[];
    executeClinicalEffect: number;
  };
} {
  const calls = {
    requeueExpiredLeases: [] as SweepInvocation[],
    wakeDueWaitingSteps: [] as SweepInvocation[],
    expireApprovals: [] as SweepInvocation[],
    archivePoisonMessages: [] as SweepInvocation[],
    emitSanitizedAlert: [] as unknown[],
    executeClinicalEffect: 0,
  };

  const deps: HandlerDeps = {
    getCorsHeaders: () => ({
      "Access-Control-Allow-Origin": "http://localhost:5173",
      Vary: "Origin",
    }),
    getInvocationSecret: () => INVOCATION_SECRET,
    getServiceRoleKey: () => SERVICE_ROLE_KEY,
    getRuntimeMode: () => "shadow",
    getNow: () => new Date("2026-08-02T12:00:00.000Z"),
    getMaxItemsPerPass: () => 25,
    requeueExpiredLeases: async (invocation: SweepInvocation) => {
      calls.requeueExpiredLeases.push(invocation);
      return [createEntity({ reasonCode: "lease_requeued" })];
    },
    wakeDueWaitingSteps: async (invocation: SweepInvocation) => {
      calls.wakeDueWaitingSteps.push(invocation);
      return [
        createEntity({
          reasonCode: "wake_due",
          wakeAt: "2026-08-02T12:00:00.000Z",
        }),
      ];
    },
    expireApprovals: async (invocation: SweepInvocation) => {
      calls.expireApprovals.push(invocation);
      return {
        expired: [createEntity({ reasonCode: "approval_expired" })],
        skippedCurrent: [createEntity({
          approvalId: "55555555-5555-4555-8555-555555555555",
          reasonCode: "approval_current",
        })],
      };
    },
    archivePoisonMessages: async (invocation: SweepInvocation) => {
      calls.archivePoisonMessages.push(invocation);
      return {
        archived: [createEntity({ reasonCode: "poison_archived" })],
        retryCeiling: [createEntity({ reasonCode: "retry_ceiling_reached" })],
      };
    },
    emitSanitizedAlert: async (alert: unknown) => {
      calls.emitSanitizedAlert.push(alert);
    },
    executeClinicalEffect: async () => {
      calls.executeClinicalEffect += 1;
    },
  };

  return {
    ...deps,
    ...overrides,
    calls,
  };
}

Deno.test("POST requires the dedicated sweeper invocation secret", async () => {
  const handler = createAgentWorkSweeperHandler(createDeps());

  for (
    const headers of [
      new Headers(),
      new Headers([[INVOCATION_SECRET_HEADER, "wrong-secret"]]),
      new Headers([
        ["authorization", ""],
        [INVOCATION_SECRET_HEADER, INVOCATION_SECRET],
      ]),
      new Headers([
        ["authorization", "Bearer wrong-service-role"],
        [INVOCATION_SECRET_HEADER, INVOCATION_SECRET],
      ]),
    ]
  ) {
    const response = await handler(
      createRequest({
        method: "POST",
        headers,
        body: "{}",
      }),
    );

    assertEquals(response.status, 401);
    assertObjectMatch(await response.json(), {
      success: false,
      error: "Unauthorized",
    });
  }
});

Deno.test("sweeper runtime accepts only loopback Supabase URLs", () => {
  assertEquals(assertLocalSupabaseUrl("http://127.0.0.1:54321"), "http://127.0.0.1:54321");
  assertEquals(assertLocalSupabaseUrl("http://localhost:54321"), "http://localhost:54321");
  for (const value of [
    "https://example.supabase.co",
    "http://host.docker.internal:54321",
    "not-a-url",
  ]) {
    let rejected = false;
    try {
      assertLocalSupabaseUrl(value);
    } catch {
      rejected = true;
    }
    assertEquals(rejected, true, value);
  }
});

Deno.test("POST fails closed when runtime mode is disabled, unreadable, or unsupported", async () => {
  const cases = [
    {
      name: "disabled",
      deps: createDeps({ getRuntimeMode: () => "disabled" }),
    },
    {
      name: "policy unreadable",
      deps: createDeps({
        getRuntimeMode: () => {
          throw new Error("policy unavailable");
        },
      }),
    },
    {
      name: "unsupported mode",
      deps: createDeps({ getRuntimeMode: () => "active" }),
    },
  ];

  for (const testCase of cases) {
    const handler = createAgentWorkSweeperHandler(testCase.deps);
    const response = await handler(
      createRequest({
        method: "POST",
        headers: { [INVOCATION_SECRET_HEADER]: INVOCATION_SECRET },
        body: "{}",
      }),
    );

    assertEquals(response.status, 403, testCase.name);
    assertObjectMatch(await response.json(), {
      success: false,
      code: "runtime_mode_disabled",
    });
    assertEquals(
      testCase.deps.calls.requeueExpiredLeases.length,
      0,
      testCase.name,
    );
    assertEquals(
      testCase.deps.calls.wakeDueWaitingSteps.length,
      0,
      testCase.name,
    );
    assertEquals(testCase.deps.calls.expireApprovals.length, 0, testCase.name);
    assertEquals(
      testCase.deps.calls.archivePoisonMessages.length,
      0,
      testCase.name,
    );
  }
});

Deno.test("POST requeues stale leases and wakes due waits in the same bounded pass", async () => {
  const deps = createDeps();
  const handler = createAgentWorkSweeperHandler(deps);

  const response = await handler(
    createRequest({
      method: "POST",
      headers: { [INVOCATION_SECRET_HEADER]: INVOCATION_SECRET },
      body: JSON.stringify({ maxItemsPerPass: 500 }),
    }),
  );

  assertEquals(response.status, 200);
  assertEquals(deps.calls.requeueExpiredLeases, [{
    maxItemsPerPass: 25,
    now: "2026-08-02T12:00:00.000Z",
  }]);
  assertEquals(deps.calls.wakeDueWaitingSteps, [{
    maxItemsPerPass: 25,
    now: "2026-08-02T12:00:00.000Z",
  }]);

  const body = await response.json();
  assertObjectMatch(body, {
    success: true,
    data: {
      recoveredLeaseCount: 1,
      wokeWaitingCount: 1,
      maxItemsPerPass: 25,
    },
  });
});

Deno.test("POST expires only stale approvals and does not report still-current approvals", async () => {
  const handler = createAgentWorkSweeperHandler(createDeps());
  const response = await handler(
    createRequest({
      method: "POST",
      headers: { [INVOCATION_SECRET_HEADER]: INVOCATION_SECRET },
      body: "{}",
    }),
  );

  assertEquals(response.status, 200);
  const body = await response.json();
  assertObjectMatch(body, {
    success: true,
    data: {
      expiredApprovalCount: 1,
    },
  });
  assertEquals(JSON.stringify(body).includes("approval_current"), false);
  assertEquals(
    JSON.stringify(body).includes("55555555-5555-4555-8555-555555555555"),
    false,
  );
});

Deno.test("POST archives poison work and reports retry-ceiling quarantine counts without requeueing them", async () => {
  const deps = createDeps();
  const handler = createAgentWorkSweeperHandler(deps);
  const response = await handler(
    createRequest({
      method: "POST",
      headers: { [INVOCATION_SECRET_HEADER]: INVOCATION_SECRET },
      body: "{}",
    }),
  );

  assertEquals(response.status, 200);
  assertEquals(deps.calls.archivePoisonMessages.length, 1);
  const body = await response.json();
  assertObjectMatch(body, {
    success: true,
    data: {
      archivedPoisonCount: 1,
      retryCeilingCount: 1,
    },
  });
});

Deno.test("POST performs one bounded operational pass and never executes a clinical effect", async () => {
  const deps = createDeps();
  const handler = createAgentWorkSweeperHandler(deps);
  const response = await handler(
    createRequest({
      method: "POST",
      headers: { [INVOCATION_SECRET_HEADER]: INVOCATION_SECRET },
      body: JSON.stringify({ maxItemsPerPass: -1 }),
    }),
  );

  assertEquals(response.status, 200);
  assertEquals(deps.calls.executeClinicalEffect, 0);
  const body = await response.json();
  assertObjectMatch(body, {
    success: true,
    data: {
      processedActionCount: 4,
      maxItemsPerPass: 25,
    },
  });
});

Deno.test("POST emits sanitized operational alerts and strips clinical or secret-bearing fields from the response", async () => {
  const deps = createDeps();
  const handler = createAgentWorkSweeperHandler(deps);
  const response = await handler(
    createRequest({
      method: "POST",
      headers: { [INVOCATION_SECRET_HEADER]: INVOCATION_SECRET },
      body: "{}",
    }),
  );

  assertEquals(response.status, 200);
  assertEquals(deps.calls.emitSanitizedAlert.length, 1);

  const body = await response.json();
  const serialized = JSON.stringify(body);
  for (
    const forbidden of [
      "Johnny Appleseed",
      "private database detail",
      "https://signed.example.invalid/object",
      "sk_live_123",
      "document_text",
      WORK_ITEM_ID,
      STEP_ID,
      APPROVAL_ID,
      QUEUE_MESSAGE_ID,
    ]
  ) {
    assertEquals(serialized.includes(forbidden), false, forbidden);
  }

  assertObjectMatch(body, {
    success: true,
    data: {
      recoveredLeaseCount: 1,
      wokeWaitingCount: 1,
      expiredApprovalCount: 1,
      archivedPoisonCount: 1,
      retryCeilingCount: 1,
      alertCodes: [
        "lease_requeued",
        "wake_due",
        "approval_expired",
        "poison_archived",
        "retry_ceiling_reached",
      ],
    },
  });
});
