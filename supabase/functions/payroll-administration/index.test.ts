import { assertEquals, assertMatch } from "https://deno.land/std@0.224.0/testing/asserts.ts";
// deno-lint-ignore-file no-import-prefix
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.50.0";
import type { UserContext } from "../_shared/auth-middleware.ts";
import {
  applyPayrollCors,
  handlePayrollAdministration as handlePayrollAdministrationBase,
  handler,
} from "./index.ts";

type RpcCall = {
  fn: string;
  args: Record<string, unknown>;
};

const allowedRateLimitDependencies = {
  getEnv: (name: string) => name === "UPSTASH_REDIS_REST_URL" ? "https://redis.example" : "synthetic-token",
  fetch: () => Promise.resolve(new Response(JSON.stringify([
    { result: 1 },
    { result: 1 },
    { result: 60 },
  ]), { status: 200 })),
};

const handlePayrollAdministration = (
  params: Parameters<typeof handlePayrollAdministrationBase>[0],
) => handlePayrollAdministrationBase({
  ...params,
  rateLimitDependencies: allowedRateLimitDependencies,
} as Parameters<typeof handlePayrollAdministrationBase>[0]);

function createUserContext(role: UserContext["profile"]["role"] = "admin", userId = "admin-user-1"): UserContext {
  return {
    user: { id: userId, email: `${userId}@example.com` },
    profile: { id: userId, email: `${userId}@example.com`, role, is_active: true },
  };
}

function createRequest(body: unknown, init: { method?: string; headers?: HeadersInit; origin?: string | null } = {}) {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  const method = init.method ?? "POST";
  if (init.origin !== null) {
    headers.set("Origin", init.origin ?? "https://app.allincompassing.ai");
  }
  return new Request("https://example.com/functions/v1/payroll-administration", {
    method,
    headers,
    body: method === "OPTIONS" || method === "GET" || method === "HEAD" ? undefined : JSON.stringify(body),
  });
}

function createRpcClient(
  resolver: (fn: string, args: Record<string, unknown>) => { data: unknown; error: unknown },
): SupabaseClient {
  return {
    rpc: async (fn: string, args: Record<string, unknown>) => resolver(fn, args),
  } as unknown as SupabaseClient;
}

async function expectStructuredError(
  response: Response,
  expected: {
    status: number;
    code: string;
    error: string;
    message: string;
    classification: Record<string, unknown>;
    idempotencyKey?: string | null;
  },
) {
  const body = await response.json() as Record<string, unknown>;
  assertEquals(response.status, expected.status);
  assertEquals(body.success, false);
  assertMatch(String(body.requestId ?? ""), /.+/);
  assertEquals(body.code, expected.code);
  assertEquals(body.error, expected.error);
  assertEquals(body.message, expected.message);
  assertEquals(body.classification, expected.classification);
  assertEquals(body.idempotencyKey ?? null, expected.idempotencyKey ?? null);
}

const edgeReadResult = {
  state: "ok",
  selectedLocalDate: "2026-08-12",
  capabilities: {
    canConfigureEmployment: true,
    canResolveExceptions: false,
    canLockPeriod: false,
    canReopenPeriod: false,
    canGeneratePeriods: true,
    canViewCompensation: false,
    canManagePolicyMutations: false,
  },
  orgSettings: [],
  policies: [],
  employments: [],
  payGroups: [],
  generationVersions: [],
  payPeriods: [],
  bounds: { orgSettings: 50, policies: 20, employments: 50, payGroups: 50, generationVersions: 50, payPeriods: 50 },
};

const edgeActionCases = [
  { name: "get_administration", payload: { action: "get_administration", selectedLocalDate: "2026-08-12" }, rpcName: "get_payroll_administration", rpcArgs: { selected_local_date: "2026-08-12" }, result: edgeReadResult },
  { name: "create_org_settings", payload: { action: "create_org_settings", effectiveFrom: "2026-08-01", effectiveThrough: null, externalPayrollOrganizationId: "org-ext-2", timezone: "America/Los_Angeles", workdayStartsAt: "06:00:00", workweekStartsOn: 1 }, result: { action: "create_org_settings", organizationSettingsId: "11111111-1111-1111-1111-111111111111", replayed: false } },
  { name: "supersede_org_settings", payload: { action: "supersede_org_settings", effectiveFrom: "2026-09-01", externalPayrollOrganizationId: "org-ext-3", timezone: "America/Denver" }, result: { action: "supersede_org_settings", organizationSettingsId: "11111111-1111-1111-1111-111111111112", replayed: false } },
  { name: "create_employment", payload: { action: "create_employment", userId: "44444444-4444-4444-4444-444444444444", employeeNumber: "EMP-2", payrollEmployeeId: "payroll-2", classification: "nonexempt", homeJurisdiction: "CA", timezone: "America/Los_Angeles", activeFrom: "2026-08-01", activeThrough: null, therapistId: null }, result: { action: "create_employment", employmentProfileId: "33333333-3333-3333-3333-333333333333", replayed: false } },
  { name: "deactivate_employment", payload: { action: "deactivate_employment", employmentProfileId: "33333333-3333-3333-3333-333333333333", effectiveThrough: "2026-08-31" }, result: { action: "deactivate_employment", employmentProfileId: "33333333-3333-3333-3333-333333333333", replayed: false } },
  { name: "add_rate_version", payload: { action: "add_rate_version", employmentProfileId: "33333333-3333-3333-3333-333333333333", hourlyRateCents: 4250, effectiveFrom: "2026-08-01T00:00:00Z", effectiveThrough: null }, result: { action: "add_rate_version", rateVersionId: "88888888-8888-8888-8888-888888888888", replayed: false } },
  { name: "create_manager_assignment", payload: { action: "create_manager_assignment", employmentProfileId: "33333333-3333-3333-3333-333333333333", managerUserId: "99999999-9999-9999-9999-999999999999", effectiveFrom: "2026-08-01T00:00:00Z", effectiveThrough: null }, result: { action: "create_manager_assignment", managerAssignmentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", replayed: false } },
  { name: "deactivate_manager_assignment", payload: { action: "deactivate_manager_assignment", managerAssignmentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", effectiveThrough: "2026-08-31T23:59:59Z" }, result: { action: "deactivate_manager_assignment", managerAssignmentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", replayed: false } },
  { name: "grant_capability", payload: { action: "grant_capability", userId: "44444444-4444-4444-4444-444444444444", capability: "payroll.configure_employment", effectiveFrom: "2026-08-01T00:00:00Z", effectiveThrough: null }, result: { action: "grant_capability", capabilityGrantId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", replayed: false } },
  { name: "revoke_capability", payload: { action: "revoke_capability", userId: "44444444-4444-4444-4444-444444444444", capability: "payroll.configure_employment", effectiveThrough: "2026-08-31T23:59:59Z" }, result: { action: "revoke_capability", capabilityGrantId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", replayed: false } },
  { name: "create_pay_group", payload: { action: "create_pay_group", name: "Monthly Team", cadence: "monthly", timezone: "America/Los_Angeles", effectiveFrom: "2026-08-01", effectiveThrough: null }, result: { action: "create_pay_group", payGroupId: "55555555-5555-5555-5555-555555555555", replayed: false } },
  { name: "deactivate_pay_group", payload: { action: "deactivate_pay_group", payGroupId: "55555555-5555-5555-5555-555555555555", effectiveThrough: "2026-08-31" }, result: { action: "deactivate_pay_group", payGroupId: "55555555-5555-5555-5555-555555555555", replayed: false } },
  { name: "create_pay_group_assignment", payload: { action: "create_pay_group_assignment", employmentProfileId: "33333333-3333-3333-3333-333333333333", payGroupId: "55555555-5555-5555-5555-555555555555", effectiveFrom: "2026-08-01", effectiveThrough: null }, result: { action: "create_pay_group_assignment", payGroupAssignmentId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", replayed: false } },
  { name: "deactivate_pay_group_assignment", payload: { action: "deactivate_pay_group_assignment", payGroupAssignmentId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", effectiveThrough: "2026-08-31" }, result: { action: "deactivate_pay_group_assignment", payGroupAssignmentId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", replayed: false } },
  { name: "set_generation_version", payload: { action: "set_generation_version", payGroupId: "55555555-5555-5555-5555-555555555555", cadence: "biweekly", effectiveFrom: "2026-08-01", effectiveThrough: null, startsOn: "2026-08-01", timezone: "America/Los_Angeles" }, result: { action: "set_generation_version", generationVersionId: "66666666-6666-6666-6666-666666666666", payGroupId: "55555555-5555-5555-5555-555555555555", replayed: false } },
  { name: "generate_periods", payload: { action: "generate_periods", payGroupId: "55555555-5555-5555-5555-555555555555", from: "2026-08-01", to: "2026-08-31" }, result: { action: "generate_periods", payGroupId: "55555555-5555-5555-5555-555555555555", generatedCount: 3, replayed: false } },
] as const;

Deno.test("OPTIONS returns payroll administration CORS headers for allowed origins", async () => {
  const response = await handler(
    new Request("https://example.com/functions/v1/payroll-administration", {
      method: "OPTIONS",
      headers: {
        Origin: "https://app.allincompassing.ai",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization,idempotency-key",
      },
    }),
  );

  assertEquals(response.status, 204);
  assertEquals(response.headers.get("Access-Control-Allow-Origin"), "https://app.allincompassing.ai");
  assertEquals(response.headers.get("Access-Control-Allow-Methods"), "POST, OPTIONS");
});

Deno.test("uses the protected structured envelope for origin deny", async () => {
  const response = await handler(
    new Request("https://example.com/functions/v1/payroll-administration", {
      method: "POST",
      headers: {
        Origin: "https://denied.example.com",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    }),
  );

  await expectStructuredError(response, {
    status: 403,
    code: "forbidden",
    error: "Origin not allowed",
    message: "Origin not allowed",
    classification: {
      category: "auth",
      severity: "medium",
      retryable: false,
      httpStatus: 403,
    },
  });
});

Deno.test("uses the protected structured envelope for method deny", async () => {
  const response = await handlePayrollAdministration({
    req: createRequest({}, { method: "GET" }),
    userContext: createUserContext(),
    db: createRpcClient(() => {
      throw new Error("RPC should not execute for method mismatch");
    }),
  });

  await expectStructuredError(response, {
    status: 405,
    code: "validation_error",
    error: "Method not allowed",
    message: "Method not allowed",
    classification: {
      category: "validation",
      severity: "low",
      retryable: false,
      httpStatus: 405,
    },
  });
});

Deno.test("get_administration calls the exact read rpc without idempotency requirements", async () => {
  const calls: RpcCall[] = [];
  const response = await handlePayrollAdministration({
    req: createRequest({
      action: "get_administration",
      selectedLocalDate: "2026-08-12",
    }),
    userContext: createUserContext("admin"),
    db: createRpcClient((fn, args) => {
      calls.push({ fn, args });
      return {
        data: {
          state: "ok",
          selectedLocalDate: "2026-08-12",
          capabilities: {
            canConfigureEmployment: true,
            canResolveExceptions: false,
            canLockPeriod: false,
            canReopenPeriod: false,
            canGeneratePeriods: true,
            canViewCompensation: false,
            canManagePolicyMutations: false,
          },
          orgSettings: [],
          policies: [],
          employments: [],
          payGroups: [],
          generationVersions: [],
          payPeriods: [],
          bounds: {
            orgSettings: 50,
            policies: 20,
            employments: 50,
            payGroups: 50,
            generationVersions: 50,
            payPeriods: 50,
          },
        },
        error: null,
      };
    }),
  });

  assertEquals(response.status, 200);
  assertEquals(calls, [{
    fn: "get_payroll_administration",
    args: {
      selected_local_date: "2026-08-12",
    },
  }]);
  assertEquals(response.headers.get("Idempotency-Key"), null);
  assertEquals(response.headers.get("Idempotent-Replay"), null);
});

Deno.test("mutation requires Idempotency-Key and calls execute_payroll_administration with exact payload", async () => {
  const missingKey = await handlePayrollAdministration({
    req: createRequest({
      action: "generate_periods",
      payGroupId: "55555555-5555-5555-5555-555555555555",
      from: "2026-08-01",
      to: "2026-08-31",
    }),
    userContext: createUserContext("admin"),
    db: createRpcClient(() => {
      throw new Error("RPC should not execute for missing idempotency");
    }),
  });

  await expectStructuredError(missingKey, {
    status: 400,
    code: "validation_error",
    error: "Idempotency-Key is required for payroll mutations.",
    message: "Idempotency-Key is required for payroll mutations.",
    classification: {
      category: "validation",
      severity: "low",
      retryable: false,
      httpStatus: 400,
    },
  });

  const calls: RpcCall[] = [];
  const response = await handlePayrollAdministration({
    req: createRequest({
      action: "generate_periods",
      payGroupId: "55555555-5555-5555-5555-555555555555",
      from: "2026-08-01",
      to: "2026-08-31",
    }, {
      headers: {
        "Idempotency-Key": "admin-generate-key",
      },
    }),
    userContext: createUserContext("admin"),
    db: createRpcClient((fn, args) => {
      calls.push({ fn, args });
      return {
        data: {
          action: "generate_periods",
          payGroupId: "55555555-5555-5555-5555-555555555555",
          generatedCount: 3,
          replayed: false,
        },
        error: null,
      };
    }),
  });

  assertEquals(response.status, 200);
  assertEquals(calls, [{
    fn: "execute_payroll_administration",
    args: {
      p_payload: {
        action: "generate_periods",
        payGroupId: "55555555-5555-5555-5555-555555555555",
        from: "2026-08-01",
        to: "2026-08-31",
      },
      p_idempotency_key: "admin-generate-key",
    },
  }]);
  assertEquals(response.headers.get("Idempotency-Key"), "admin-generate-key");
  assertEquals(response.headers.get("Idempotent-Replay"), "false");
});

Deno.test("all payroll administration actions use exact RPC, result, and idempotency contracts", async () => {
  for (const testCase of edgeActionCases) {
    const isRead = testCase.name === "get_administration";
    const calls: RpcCall[] = [];
    const headers = isRead ? {} : { "Idempotency-Key": "edge-matrix-key" };
    const response = await handlePayrollAdministration({
      req: createRequest(testCase.payload, { headers }),
      userContext: createUserContext("admin", `matrix-${testCase.name}`),
      db: createRpcClient((fn, args) => {
        calls.push({ fn, args });
        return { data: testCase.result, error: null };
      }),
    });

    assertEquals(response.status, 200, testCase.name);
    assertEquals(calls, [{
      fn: isRead ? "get_payroll_administration" : "execute_payroll_administration",
      args: isRead
        ? { selected_local_date: "2026-08-12" }
        : { p_payload: testCase.payload, p_idempotency_key: "edge-matrix-key" },
    }], testCase.name);
    assertEquals(await response.json(), isRead
      ? testCase.result
      : { ...testCase.result, idempotencyKey: "edge-matrix-key" }, testCase.name);
    assertEquals(response.headers.get("Idempotency-Key"), isRead ? null : "edge-matrix-key", testCase.name);

    const malformedResponse = await handlePayrollAdministration({
      req: createRequest(testCase.payload, { headers }),
      userContext: createUserContext("admin", `matrix-invalid-${testCase.name}`),
      db: createRpcClient(() => ({ data: { ...testCase.result, unexpected: true }, error: null })),
    });
    assertEquals(malformedResponse.status, 502, testCase.name);
    assertEquals((await malformedResponse.json() as { code: string }).code, "invalid_response", testCase.name);
  }
});

Deno.test("set_generation_version rejects monthly while create_pay_group accepts it", async () => {
  const setGeneration = await handlePayrollAdministration({
    req: createRequest({
      action: "set_generation_version",
      payGroupId: "55555555-5555-5555-5555-555555555555",
      cadence: "monthly",
      effectiveFrom: "2026-08-01",
      startsOn: "2026-08-01",
      timezone: "America/Los_Angeles",
    }, { headers: { "Idempotency-Key": "monthly-generation-key" } }),
    userContext: createUserContext("admin", "monthly-generation-user"),
    db: createRpcClient(() => {
      throw new Error("RPC should not execute for monthly generation versions");
    }),
  });

  assertEquals(setGeneration.status, 400);

  const createPayGroup = await handlePayrollAdministration({
    req: createRequest({
      action: "create_pay_group",
      name: "Monthly Team",
      cadence: "monthly",
      timezone: "America/Los_Angeles",
    }, { headers: { "Idempotency-Key": "monthly-group-key" } }),
    userContext: createUserContext("admin", "monthly-group-user"),
    db: createRpcClient(() => ({
      data: { action: "create_pay_group", payGroupId: "55555555-5555-5555-5555-555555555555", replayed: false },
      error: null,
    })),
  });

  assertEquals(createPayGroup.status, 200);
});

Deno.test("rejects recursive authority keys and invalid identifiers before any RPC", async () => {
  const authorityResponse = await handlePayrollAdministration({
    req: createRequest({
      action: "create_employment",
      userId: "44444444-4444-4444-4444-444444444444",
      employeeNumber: "EMP-1",
      payrollEmployeeId: "payroll-1",
      timezone: "America/Los_Angeles",
      activeFrom: "2026-08-01",
      nested: {
        actorId: "override",
      },
    }, {
      headers: {
        "Idempotency-Key": "admin-authority-key",
      },
    }),
    userContext: createUserContext("admin"),
    db: createRpcClient(() => {
      throw new Error("RPC should not execute for authority-injected payloads");
    }),
  });

  await expectStructuredError(authorityResponse, {
    status: 400,
    code: "validation_error",
    error: "Authority fields are not allowed in payroll requests.",
    message: "Authority fields are not allowed in payroll requests.",
    classification: {
      category: "validation",
      severity: "low",
      retryable: false,
      httpStatus: 400,
    },
  });

  const invalidIdentifierResponse = await handlePayrollAdministration({
    req: createRequest({
      action: "create_employment",
      userId: "44444444-4444-4444-4444-444444444444",
      employeeNumber: " invalid",
      payrollEmployeeId: "payroll-1",
      timezone: "America/Los_Angeles",
      activeFrom: "2026-08-01",
    }, {
      headers: {
        "Idempotency-Key": "admin-invalid-id-key",
      },
    }),
    userContext: createUserContext("admin"),
    db: createRpcClient(() => {
      throw new Error("RPC should not execute for invalid identifiers");
    }),
  });

  assertEquals(invalidIdentifierResponse.status, 400);
});

Deno.test("fails closed when compensation leaks without capability and when policy mutation readonly drifts", async () => {
  const compensationLeak = await handlePayrollAdministration({
    req: createRequest({
      action: "get_administration",
      selectedLocalDate: "2026-08-12",
    }),
    userContext: createUserContext("admin"),
    db: createRpcClient(() => ({
      data: {
        state: "ok",
        selectedLocalDate: "2026-08-12",
        capabilities: {
          canConfigureEmployment: true,
          canResolveExceptions: false,
          canLockPeriod: false,
          canReopenPeriod: false,
          canGeneratePeriods: true,
          canViewCompensation: false,
          canManagePolicyMutations: false,
        },
        orgSettings: [],
        policies: [],
        employments: [
          {
            id: "33333333-3333-3333-3333-333333333333",
            userId: "44444444-4444-4444-4444-444444444444",
            employeeNumber: "EMP-1",
            payrollEmployeeId: "payroll-1",
            classification: "nonexempt",
            homeJurisdiction: "CA",
            timezone: "America/Los_Angeles",
            activeFrom: "2026-08-01",
            activeThrough: null,
            compensation: {
              hourlyRateCents: 12345,
              effectiveFrom: "2026-08-01T00:00:00.000Z",
              effectiveThrough: null,
            },
          },
        ],
        payGroups: [],
        generationVersions: [],
        payPeriods: [],
        bounds: {
          orgSettings: 50,
          policies: 20,
          employments: 50,
          payGroups: 50,
          generationVersions: 50,
          payPeriods: 50,
        },
      },
      error: null,
    })),
  });

  assertEquals(compensationLeak.status, 502);
  assertEquals((await compensationLeak.json() as { code: string }).code, "invalid_response");

  const policyDrift = await handlePayrollAdministration({
    req: createRequest({
      action: "get_administration",
      selectedLocalDate: "2026-08-12",
    }),
    userContext: createUserContext("admin"),
    db: createRpcClient(() => ({
      data: {
        state: "ok",
        selectedLocalDate: "2026-08-12",
        capabilities: {
          canConfigureEmployment: true,
          canResolveExceptions: false,
          canLockPeriod: false,
          canReopenPeriod: false,
          canGeneratePeriods: true,
          canViewCompensation: false,
          canManagePolicyMutations: true,
        },
        orgSettings: [],
        policies: [],
        employments: [],
        payGroups: [],
        generationVersions: [],
        payPeriods: [],
        bounds: {
          orgSettings: 50,
          policies: 20,
          employments: 50,
          payGroups: 50,
          generationVersions: 50,
          payPeriods: 50,
        },
      },
      error: null,
    })),
  });

  assertEquals(policyDrift.status, 502);
  assertEquals((await policyDrift.json() as { code: string }).code, "invalid_response");
});

Deno.test("maps payroll administration RPC failures to exact protected envelopes", async () => {
  const cases = [
    {
      name: "conflict",
      error: { code: "23505", message: "IDEMPOTENCY_CONFLICT" },
      expectedStatus: 409,
      expected: {
        code: "conflict",
        error: "Idempotency conflict.",
        message: "Idempotency conflict.",
        classification: {
          category: "request",
          severity: "medium",
          retryable: false,
          httpStatus: 409,
        },
      },
    },
    {
      name: "state_conflict",
      error: { code: "23514", message: "generation version boundary cannot change after payroll facts exist" },
      expectedStatus: 409,
      expected: {
        code: "state_conflict",
        error: "Payroll state conflict.",
        message: "Payroll state conflict.",
        classification: {
          category: "request",
          severity: "medium",
          retryable: false,
          httpStatus: 409,
        },
      },
    },
    {
      name: "validation",
      error: { code: "22023", message: "period generation range is invalid" },
      expectedStatus: 400,
      expected: {
        code: "validation_error",
        error: "Invalid payroll administration request.",
        message: "Invalid payroll administration request.",
        classification: {
          category: "validation",
          severity: "low",
          retryable: false,
          httpStatus: 400,
        },
      },
    },
    {
      name: "forbidden",
      error: { code: "42501", message: "payroll.export_period capability is required" },
      expectedStatus: 403,
      expected: {
        code: "forbidden",
        error: "Forbidden",
        message: "Forbidden",
        classification: {
          category: "auth",
          severity: "medium",
          retryable: false,
          httpStatus: 403,
        },
      },
    },
  ] as const;

  for (const testCase of cases) {
    const response = await handlePayrollAdministration({
      req: createRequest({
        action: "generate_periods",
        payGroupId: "55555555-5555-5555-5555-555555555555",
        from: "2026-08-01",
        to: "2026-08-31",
      }, {
        headers: {
          "Idempotency-Key": "admin-generate-key",
          "x-request-id": `${testCase.name}-request-id`,
        },
      }),
      userContext: createUserContext("admin"),
      db: createRpcClient(() => ({
        data: null,
        error: testCase.error,
      })),
    });

    const body = await response.json() as Record<string, unknown>;
    assertEquals(response.status, testCase.expectedStatus);
    assertEquals(body, {
      success: false,
      requestId: `${testCase.name}-request-id`,
      idempotencyKey: "admin-generate-key",
      ...testCase.expected,
    });
  }
});

Deno.test("distributed Edge limiter allows within quota and sends the actor-scoped Upstash pipeline", async () => {
  let requestedUrl = "";
  let requestedInit: RequestInit | undefined;
  const response = await handlePayrollAdministrationBase({
    req: createRequest({ action: "get_administration", selectedLocalDate: "2026-08-12" }),
    userContext: createUserContext("admin", "edge-admin-user"),
    db: createRpcClient(() => ({ data: edgeReadResult, error: null })),
    rateLimitDependencies: {
      getEnv: allowedRateLimitDependencies.getEnv,
      fetch: (input: RequestInfo | URL, init?: RequestInit) => {
        requestedUrl = String(input);
        requestedInit = init;
        return Promise.resolve(new Response(JSON.stringify([{ result: 1 }, { result: 1 }, { result: 60 }]), { status: 200 }));
      },
    },
  } as Parameters<typeof handlePayrollAdministrationBase>[0]);

  assertEquals(response.status, 200);
  assertEquals(requestedUrl, "https://redis.example/pipeline");
  assertEquals(new Headers(requestedInit?.headers).get("Authorization"), "Bearer synthetic-token");
  assertEquals(JSON.parse(String(requestedInit?.body)), [
    ["INCR", "payroll-administration:edge-admin-user"],
    ["EXPIRE", "payroll-administration:edge-admin-user", 60, "NX"],
    ["TTL", "payroll-administration:edge-admin-user"],
  ]);
});

Deno.test("distributed Edge limiter denies over quota with Retry-After", async () => {
  const response = await handlePayrollAdministrationBase({
    req: createRequest({ action: "get_administration", selectedLocalDate: "2026-08-12" }),
    userContext: createUserContext("admin", "edge-limited-user"),
    db: createRpcClient(() => {
      throw new Error("RPC should not execute when rate limited");
    }),
    rateLimitDependencies: {
      getEnv: allowedRateLimitDependencies.getEnv,
      fetch: () => Promise.resolve(new Response(JSON.stringify([{ result: 61 }, { result: 0 }, { result: 17 }]), { status: 200 })),
    },
  } as Parameters<typeof handlePayrollAdministrationBase>[0]);

  assertEquals(response.status, 429);
  assertEquals(response.headers.get("Retry-After"), "17");
  assertEquals((await response.json() as { code: string }).code, "rate_limited");
});

Deno.test("distributed Edge limiter accepts TTL zero and emits a minimum Retry-After", async () => {
  const response = await handlePayrollAdministrationBase({
    req: createRequest({ action: "get_administration", selectedLocalDate: "2026-08-12" }),
    userContext: createUserContext("admin", "edge-expiring-limit-user"),
    db: createRpcClient(() => {
      throw new Error("RPC should not execute when rate limited");
    }),
    rateLimitDependencies: {
      getEnv: allowedRateLimitDependencies.getEnv,
      fetch: () => Promise.resolve(new Response(JSON.stringify([{ result: 61 }, { result: 0 }, { result: 0 }]), { status: 200 })),
    },
  } as Parameters<typeof handlePayrollAdministrationBase>[0]);

  assertEquals(response.status, 429);
  assertEquals(response.headers.get("Retry-After"), "1");
  assertEquals((await response.json() as { code: string }).code, "rate_limited");
});

Deno.test("distributed Edge limiter accepts only a raw finite nonnegative integer TTL", async () => {
  const invalidTtls: Array<{ name: string; entry: Record<string, unknown> }> = [
    { name: "null", entry: { result: null } },
    { name: "empty string", entry: { result: "" } },
    { name: "numeric string", entry: { result: "17" } },
    { name: "missing", entry: {} },
    { name: "negative", entry: { result: -1 } },
    { name: "float", entry: { result: 1.5 } },
    { name: "positive infinity", entry: { result: Number.POSITIVE_INFINITY } },
    { name: "not a number", entry: { result: Number.NaN } },
  ];

  for (const testCase of invalidTtls) {
    const response = await handlePayrollAdministrationBase({
      req: createRequest({ action: "get_administration", selectedLocalDate: "2026-08-12" }),
      userContext: createUserContext("admin", `edge-invalid-ttl-${testCase.name}`),
      db: createRpcClient(() => {
        throw new Error("RPC should not execute when the limiter response is malformed");
      }),
      rateLimitDependencies: {
        getEnv: allowedRateLimitDependencies.getEnv,
        fetch: () => Promise.resolve({
          ok: true,
          json: () => Promise.resolve([
            { result: 61 },
            { result: 0 },
            testCase.entry,
          ]),
        } as Response),
      },
    } as Parameters<typeof handlePayrollAdministrationBase>[0]);

    assertEquals(response.status, 503, testCase.name);
    assertEquals((await response.json() as { code: string }).code, "upstream_error", testCase.name);
  }
});

Deno.test("distributed Edge limiter fails closed when Upstash configuration is missing", async () => {
  const response = await handlePayrollAdministrationBase({
    req: createRequest({ action: "get_administration", selectedLocalDate: "2026-08-12" }),
    userContext: createUserContext("admin", "edge-missing-config-user"),
    db: createRpcClient(() => {
      throw new Error("RPC should not execute without distributed limiter configuration");
    }),
    rateLimitDependencies: {
      getEnv: () => undefined,
      fetch: () => {
        throw new Error("fetch should not execute without configuration");
      },
    },
  } as Parameters<typeof handlePayrollAdministrationBase>[0]);

  await expectStructuredError(response, {
    status: 503,
    code: "upstream_error",
    error: "Payroll administration rate limiter unavailable.",
    message: "Payroll administration rate limiter unavailable.",
    classification: { category: "upstream", severity: "high", retryable: true, httpStatus: 503 },
  });
});

Deno.test("distributed Edge limiter fails closed on upstream and malformed responses", async () => {
  for (const fetchImpl of [
    () => Promise.reject(new Error("redis unavailable")),
    () => Promise.resolve(new Response(JSON.stringify([{ result: "not-a-count" }]), { status: 200 })),
  ]) {
    const response = await handlePayrollAdministrationBase({
      req: createRequest({ action: "get_administration", selectedLocalDate: "2026-08-12" }),
      userContext: createUserContext("admin", "edge-upstream-failure-user"),
      db: createRpcClient(() => {
        throw new Error("RPC should not execute when distributed limiter fails");
      }),
      rateLimitDependencies: {
        getEnv: allowedRateLimitDependencies.getEnv,
        fetch: fetchImpl,
      },
    } as Parameters<typeof handlePayrollAdministrationBase>[0]);

    assertEquals(response.status, 503);
    assertEquals((await response.json() as { code: string }).code, "upstream_error");
  }
});

Deno.test("applyPayrollCors preserves JSON responses and trace headers", async () => {
  const updated = await applyPayrollCors(
    new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "x-request-id": "req-1",
      },
    }),
    "https://app.allincompassing.ai",
  );

  assertEquals(updated.status, 200);
  assertEquals(updated.headers.get("Access-Control-Allow-Origin"), "https://app.allincompassing.ai");
  assertEquals(updated.headers.get("x-request-id"), "req-1");
  assertEquals(await updated.json(), { ok: true });
});
