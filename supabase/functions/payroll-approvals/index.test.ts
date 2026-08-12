import { assertEquals, assertMatch } from "https://deno.land/std@0.224.0/testing/asserts.ts";
// deno-lint-ignore-file no-import-prefix
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.50.0";
import type { UserContext } from "../_shared/auth-middleware.ts";
import { applyPayrollCors, handlePayrollApprovals, handler } from "./index.ts";

type RpcCall = {
  fn: string;
  args: Record<string, unknown>;
};

function createUserContext(role: UserContext["profile"]["role"] = "bt", userId = "user-1"): UserContext {
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
  return new Request("https://example.com/functions/v1/payroll-approvals", {
    method,
    headers,
    body: method === "OPTIONS" || method === "GET" || method === "HEAD" ? undefined : JSON.stringify(body),
  });
}

function createRpcClient(resolver: (fn: string, args: Record<string, unknown>) => { data: unknown; error: unknown }): SupabaseClient {
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
    state?: string;
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
  assertEquals(body.state, expected.state);
}

Deno.test("OPTIONS returns payroll approval CORS headers for allowed origins", async () => {
  const response = await handler(
    new Request("https://example.com/functions/v1/payroll-approvals", {
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
    new Request("https://example.com/functions/v1/payroll-approvals", {
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
  const response = await handlePayrollApprovals({
    req: createRequest({}, {
      method: "GET",
      headers: {
        "Idempotency-Key": "approval-method-key",
      },
    }),
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

Deno.test("uses the protected structured envelope for malformed JSON", async () => {
  const response = await handlePayrollApprovals({
    req: new Request("https://example.com/functions/v1/payroll-approvals", {
      method: "POST",
      headers: {
        Origin: "https://app.allincompassing.ai",
        "Content-Type": "application/json",
        "Idempotency-Key": "approval-json-key",
      },
      body: "{",
    }),
    userContext: createUserContext(),
    db: createRpcClient(() => {
      throw new Error("RPC should not execute for malformed JSON");
    }),
  });

  await expectStructuredError(response, {
    status: 400,
    code: "validation_error",
    error: "Invalid JSON body",
    message: "Invalid JSON body",
    classification: {
      category: "validation",
      severity: "low",
      retryable: false,
      httpStatus: 400,
    },
  });
});

Deno.test("rejects nested authority fields before any approval RPC", async () => {
  const response = await handlePayrollApprovals({
    req: createRequest({
      action: "submit",
      snapshotId: "11111111-1111-1111-1111-111111111111",
      snapshotHash: "a".repeat(64),
      attestation: true,
      nested: {
        payPeriodId: "33333333-3333-3333-3333-333333333333",
      },
    }, {
      headers: {
        "Idempotency-Key": "approval-nested-key",
      },
    }),
    userContext: createUserContext(),
    db: createRpcClient(() => {
      throw new Error("RPC should not execute for authority-injected approval payloads");
    }),
  });

  await expectStructuredError(response, {
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
});

Deno.test("submit calls transition_timesheet_approval with exact payload and replay headers", async () => {
  const calls: RpcCall[] = [];
  const response = await handlePayrollApprovals({
    req: createRequest({
      action: "submit",
      snapshotId: "11111111-1111-1111-1111-111111111111",
      snapshotHash: "a".repeat(64),
      attestation: true,
    }, {
      headers: {
        "Idempotency-Key": "approval-submit-key",
      },
    }),
    userContext: createUserContext(),
    db: createRpcClient((fn, args) => {
      calls.push({ fn, args });
      return {
        data: {
          transitionId: "22222222-2222-2222-2222-222222222222",
          snapshotId: "11111111-1111-1111-1111-111111111111",
          snapshotHash: "a".repeat(64),
          canonicalSnapshotHash: "a".repeat(64),
          action: "submitted",
          previousTransitionId: null,
          replayed: true,
          occurredAt: "2026-08-12T18:00:00.000Z",
          idempotencyKey: "approval-submit-key",
        },
        error: null,
      };
    }),
  });

  const body = await response.json() as { idempotencyKey: string; replayed: boolean };
  assertEquals(response.status, 200);
  assertEquals(calls, [{
    fn: "transition_timesheet_approval",
    args: {
      p_payload: {
        action: "submit",
        snapshotId: "11111111-1111-1111-1111-111111111111",
        snapshotHash: "a".repeat(64),
        attestation: true,
      },
      p_idempotency_key: "approval-submit-key",
    },
  }]);
  assertEquals(response.headers.get("Idempotency-Key"), "approval-submit-key");
  assertEquals(response.headers.get("Idempotent-Replay"), "true");
  assertEquals(body.idempotencyKey, "approval-submit-key");
  assertEquals(body.replayed, true);
});

Deno.test("resolve_blocker calls resolve_payroll_blocker with exact blocker payload only", async () => {
  const calls: RpcCall[] = [];
  const response = await handlePayrollApprovals({
    req: createRequest({
      action: "resolve_blocker",
      snapshotId: "11111111-1111-1111-1111-111111111111",
      snapshotHash: "a".repeat(64),
      blockerType: "timekeeping_exception",
      blockerId: "55555555-5555-5555-5555-555555555555",
      resolution: "resolved",
      reason: "Reviewed and corrected.",
    }, {
      headers: {
        "Idempotency-Key": "approval-blocker-key",
      },
    }),
    userContext: createUserContext("admin"),
    db: createRpcClient((fn, args) => {
      calls.push({ fn, args });
      return {
        data: {
          resolutionId: "44444444-4444-4444-4444-444444444444",
          blockerType: "timekeeping_exception",
          blockerId: "55555555-5555-5555-5555-555555555555",
          payPeriodId: "66666666-6666-6666-6666-666666666666",
          action: "resolved",
          previousResolutionId: null,
          replayed: false,
          occurredAt: "2026-08-12T18:05:00.000Z",
          idempotencyKey: "approval-blocker-key",
        },
        error: null,
      };
    }),
  });

  assertEquals(response.status, 200);
  assertEquals(calls, [{
    fn: "resolve_payroll_blocker",
    args: {
      p_payload: {
        snapshotId: "11111111-1111-1111-1111-111111111111",
        snapshotHash: "a".repeat(64),
        blockerType: "timekeeping_exception",
        blockerId: "55555555-5555-5555-5555-555555555555",
        action: "resolved",
        reason: "Reviewed and corrected.",
      },
      p_idempotency_key: "approval-blocker-key",
    },
  }]);
});

Deno.test("maps payroll approval RPC failures to exact protected envelopes", async () => {
  const cases = [
    {
      name: "feature_disabled",
      error: { code: "42501", message: "payroll approval workflow is feature_disabled" },
      expectedStatus: 403,
      expected: {
        code: "feature_disabled",
        error: "Payroll approval workflow is unavailable.",
        message: "Payroll approval workflow is unavailable.",
        state: "feature_disabled",
        classification: {
          category: "feature",
          severity: "medium",
          retryable: false,
          httpStatus: 403,
        },
      },
    },
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
      name: "validation",
      error: { code: "22023", message: "invalid payroll blocker payload" },
      expectedStatus: 400,
      expected: {
        code: "validation_error",
        error: "Invalid payroll approval request.",
        message: "Invalid payroll approval request.",
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
      error: { code: "42501", message: "exact assigned manager authority is required" },
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
    {
      name: "upstream",
      error: { code: "XX000", message: "rpc blew up" },
      expectedStatus: 502,
      expected: {
        code: "upstream_error",
        error: "Payroll transport failed.",
        message: "Payroll transport failed.",
        classification: {
          category: "upstream",
          severity: "high",
          retryable: true,
          httpStatus: 502,
        },
      },
    },
  ] as const;

  for (const testCase of cases) {
    const response = await handlePayrollApprovals({
      req: createRequest({
        action: "lock",
        snapshotId: "11111111-1111-1111-1111-111111111111",
        snapshotHash: "a".repeat(64),
      }, {
        headers: {
          "Idempotency-Key": "approval-feature-key",
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
      idempotencyKey: "approval-feature-key",
      ...testCase.expected,
    });
  }
});

Deno.test("keeps state conflict, method deny, and invalid response bodies identical across direct edge parity paths", async () => {
  const stateConflictResponse = await handlePayrollApprovals({
    req: createRequest({
      action: "lock",
      snapshotId: "11111111-1111-1111-1111-111111111111",
      snapshotHash: "a".repeat(64),
    }, {
      headers: {
        "Idempotency-Key": "approval-state-key",
        "x-request-id": "state-request-id",
      },
    }),
    userContext: createUserContext("admin"),
    db: createRpcClient(() => ({
      data: null,
      error: { code: "23514", message: "approval transition violates current workflow state" },
    })),
  });
  const stateConflictBody = await stateConflictResponse.json() as Record<string, unknown>;
  assertEquals(stateConflictBody, {
    success: false,
    requestId: "state-request-id",
    code: "state_conflict",
    error: "Payroll state conflict.",
    message: "Payroll state conflict.",
    classification: {
      category: "request",
      severity: "medium",
      retryable: false,
      httpStatus: 409,
    },
    idempotencyKey: "approval-state-key",
  });

  const methodDenyResponse = await handlePayrollApprovals({
    req: createRequest({}, {
      method: "GET",
      headers: {
        "x-request-id": "method-request-id",
      },
    }),
    userContext: createUserContext(),
    db: createRpcClient(() => {
      throw new Error("RPC should not execute for method mismatch");
    }),
  });
  const methodDenyBody = await methodDenyResponse.json() as Record<string, unknown>;
  assertEquals(methodDenyBody, {
    success: false,
    requestId: "method-request-id",
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

  const invalidResponse = await handlePayrollApprovals({
    req: createRequest({
      action: "submit",
      snapshotId: "11111111-1111-1111-1111-111111111111",
      snapshotHash: "a".repeat(64),
      attestation: true,
    }, {
      headers: {
        "Idempotency-Key": "approval-invalid-key",
        "x-request-id": "invalid-request-id",
      },
    }),
    userContext: createUserContext(),
    db: createRpcClient(() => ({
      data: {
        transitionId: "22222222-2222-2222-2222-222222222222",
        snapshotId: "11111111-1111-1111-1111-111111111111",
        snapshotHash: "a".repeat(64),
        canonicalSnapshotHash: "a".repeat(64),
        action: "submitted",
        previousTransitionId: null,
        replayed: false,
        occurredAt: "2026-08-12T18:00:00.000Z",
        grossEarningsCents: 999999,
      },
      error: null,
    })),
  });
  const invalidResponseBody = await invalidResponse.json() as Record<string, unknown>;
  assertEquals(invalidResponseBody, {
    success: false,
    requestId: "invalid-request-id",
    code: "invalid_response",
    error: "Invalid payroll approval response.",
    message: "Invalid payroll approval response.",
    classification: {
      category: "upstream",
      severity: "high",
      retryable: false,
      httpStatus: 502,
    },
  });
});

Deno.test("fails closed when the approval response leaks compensation data", async () => {
  const response = await handlePayrollApprovals({
    req: createRequest({
      action: "manager_approve",
      snapshotId: "11111111-1111-1111-1111-111111111111",
      snapshotHash: "a".repeat(64),
      comment: "Looks correct.",
    }, {
      headers: {
        "Idempotency-Key": "approval-shape-key",
      },
    }),
    userContext: createUserContext("admin"),
    db: createRpcClient(() => ({
      data: {
        transitionId: "22222222-2222-2222-2222-222222222222",
        snapshotId: "11111111-1111-1111-1111-111111111111",
        snapshotHash: "a".repeat(64),
        canonicalSnapshotHash: "a".repeat(64),
        action: "manager_approved",
        previousTransitionId: null,
        replayed: false,
        occurredAt: "2026-08-12T18:10:00.000Z",
        idempotencyKey: "approval-shape-key",
        grossEarningsCents: 123456,
      },
      error: null,
    })),
  });

  await expectStructuredError(response, {
    status: 502,
    code: "invalid_response",
    error: "Invalid payroll approval response.",
    message: "Invalid payroll approval response.",
    classification: {
      category: "upstream",
      severity: "high",
      retryable: false,
      httpStatus: 502,
    },
  });
});

Deno.test("fails closed when the authoritative approval response omits the idempotency echo", async () => {
  const response = await handlePayrollApprovals({
    req: createRequest({
      action: "submit",
      snapshotId: "11111111-1111-1111-1111-111111111111",
      snapshotHash: "a".repeat(64),
      attestation: true,
    }, {
      headers: {
        "Idempotency-Key": "approval-submit-key",
      },
    }),
    userContext: createUserContext(),
    db: createRpcClient(() => ({
      data: {
        transitionId: "22222222-2222-2222-2222-222222222222",
        snapshotId: "11111111-1111-1111-1111-111111111111",
        snapshotHash: "a".repeat(64),
        canonicalSnapshotHash: "a".repeat(64),
        action: "submitted",
        previousTransitionId: null,
        replayed: false,
        occurredAt: "2026-08-12T18:00:00.000Z",
      },
      error: null,
    })),
  });

  await expectStructuredError(response, {
    status: 502,
    code: "invalid_response",
    error: "Invalid payroll approval response.",
    message: "Invalid payroll approval response.",
    classification: {
      category: "upstream",
      severity: "high",
      retryable: false,
      httpStatus: 502,
    },
  });
  assertEquals(response.headers.get("Idempotency-Key"), null);
  assertEquals(response.headers.get("Idempotent-Replay"), null);
});

Deno.test("uses the protected structured envelope for unsupported actions", async () => {
  const response = await handlePayrollApprovals({
    req: createRequest({
      action: "destroy",
      snapshotId: "11111111-1111-1111-1111-111111111111",
      snapshotHash: "a".repeat(64),
    }, {
      headers: {
        "Idempotency-Key": "approval-unsupported-key",
      },
    }),
    userContext: createUserContext(),
    db: createRpcClient(() => {
      throw new Error("RPC should not execute for unsupported actions");
    }),
  });

  await expectStructuredError(response, {
    status: 400,
    code: "validation_error",
    error: "Unsupported action",
    message: "Unsupported action",
    classification: {
      category: "validation",
      severity: "low",
      retryable: false,
      httpStatus: 400,
    },
  });
});

Deno.test("uses the protected structured envelope for request-shape validation", async () => {
  const response = await handlePayrollApprovals({
    req: createRequest({
      action: "reopen",
      snapshotId: "11111111-1111-1111-1111-111111111111",
      snapshotHash: "a".repeat(64),
    }, {
      headers: {
        "Idempotency-Key": "approval-shape-key",
      },
    }),
    userContext: createUserContext("admin"),
    db: createRpcClient(() => {
      throw new Error("RPC should not execute for invalid request shape");
    }),
  });

  await expectStructuredError(response, {
    status: 400,
    code: "validation_error",
    error: "Invalid payroll approval request body",
    message: "Invalid payroll approval request body",
    classification: {
      category: "validation",
      severity: "low",
      retryable: false,
      httpStatus: 400,
    },
  });
});

Deno.test("rate limits direct edge callers by authenticated actor and returns retry metadata", async () => {
  let limitedResponse: Response | null = null;

  for (let attempt = 0; attempt < 61; attempt += 1) {
    const response = await handlePayrollApprovals({
      req: createRequest({
        action: "submit",
        snapshotId: "11111111-1111-1111-1111-111111111111",
        snapshotHash: "a".repeat(64),
        attestation: true,
      }, {
        headers: {
          "Idempotency-Key": `approval-submit-key-${attempt}`,
        },
      }),
      userContext: createUserContext("bt", "edge-rate-user"),
      db: createRpcClient(() => ({
        data: {
          transitionId: "22222222-2222-2222-2222-222222222222",
          snapshotId: "11111111-1111-1111-1111-111111111111",
          snapshotHash: "a".repeat(64),
          canonicalSnapshotHash: "a".repeat(64),
          action: "submitted",
          previousTransitionId: null,
          replayed: false,
          occurredAt: "2026-08-12T18:00:00.000Z",
          idempotencyKey: `approval-submit-key-${attempt}`,
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
  assertEquals(body.error, "Too many payroll approval requests");
  assertEquals(body.message, "Too many payroll approval requests");
  assertEquals(body.classification, {
    category: "rate_limit",
    severity: "high",
    retryable: true,
    httpStatus: 429,
  });
});

Deno.test("applyPayrollCors preserves JSON approval responses and trace headers", async () => {
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
