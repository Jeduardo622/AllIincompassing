import { assertEquals, assertMatch } from "https://deno.land/std@0.224.0/testing/asserts.ts";
// deno-lint-ignore-file no-import-prefix
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.50.0";
import type { UserContext } from "../_shared/auth-middleware.ts";
import { applyPayrollCors, handlePayrollAdministration, handler } from "./index.ts";

type RpcCall = {
  fn: string;
  args: Record<string, unknown>;
};

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

Deno.test("rate limits direct edge callers by authenticated actor and returns retry metadata", async () => {
  let limitedResponse: Response | null = null;

  for (let attempt = 0; attempt < 61; attempt += 1) {
    const response = await handlePayrollAdministration({
      req: createRequest({
        action: "generate_periods",
        payGroupId: "55555555-5555-5555-5555-555555555555",
        from: "2026-08-01",
        to: "2026-08-31",
      }, {
        headers: {
          "Idempotency-Key": `admin-generate-key-${attempt}`,
        },
      }),
      userContext: createUserContext("admin", "edge-admin-user"),
      db: createRpcClient(() => ({
        data: {
          action: "generate_periods",
          payGroupId: "55555555-5555-5555-5555-555555555555",
          generatedCount: 1,
          replayed: false,
        },
        error: null,
      })),
    });
    if (response.status === 429) {
      limitedResponse = response;
      break;
    }
  }

  assertEquals(limitedResponse?.status, 429);
  assertMatch(limitedResponse?.headers.get("Retry-After") ?? "", /^\d+$/);
  const body = await limitedResponse?.json() as Record<string, unknown>;
  assertEquals(body.code, "rate_limited");
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
