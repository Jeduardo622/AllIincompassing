import { assertEquals, assertMatch } from "https://deno.land/std@0.224.0/testing/asserts.ts";
// deno-lint-ignore-file no-import-prefix
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.50.0";
import type { UserContext } from "../_shared/auth-middleware.ts";
import { applyPayrollExportCors, handlePayrollExport, handler } from "./index.ts";

type RpcCall = {
  fn: string;
  args: Record<string, unknown>;
};

function createUserContext(role: UserContext["profile"]["role"] = "admin", userId = "admin-1"): UserContext {
  return {
    user: { id: userId, email: `${userId}@example.com` },
    profile: { id: userId, email: `${userId}@example.com`, role, is_active: true },
  };
}

function createRequest(init: {
  method?: string;
  body?: unknown;
  query?: string;
  headers?: HeadersInit;
  origin?: string | null;
} = {}) {
  const method = init.method ?? "POST";
  const headers = new Headers(init.headers);
  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
    headers.set("Content-Type", "application/json");
  }
  if (init.origin !== null) {
    headers.set("Origin", init.origin ?? "https://app.allincompassing.ai");
  }
  const url = `https://example.com/functions/v1/payroll-export${init.query ? `?${init.query}` : ""}`;
  return new Request(url, {
    method,
    headers,
    body:
      method === "GET" || method === "HEAD" || method === "OPTIONS"
        ? undefined
        : JSON.stringify(init.body ?? {}),
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

Deno.test("OPTIONS returns payroll export CORS headers for allowed origins", async () => {
  const response = await handler(
    new Request("https://example.com/functions/v1/payroll-export", {
      method: "OPTIONS",
      headers: {
        Origin: "https://app.allincompassing.ai",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization,content-type",
      },
    }),
  );

  assertEquals(response.status, 204);
  assertEquals(response.headers.get("Access-Control-Allow-Origin"), "https://app.allincompassing.ai");
  assertEquals(response.headers.get("Access-Control-Allow-Methods"), "GET, POST, OPTIONS");
});

Deno.test("POST create_payroll_export calls the exact RPC contract and returns the typed metadata envelope", async () => {
  const calls: RpcCall[] = [];
  const response = await handlePayrollExport({
    req: createRequest({
      body: {
        payPeriodId: "22222222-2222-2222-2222-222222222222",
        idempotencyKey: "export-create-key",
      },
    }),
    userContext: createUserContext("admin"),
    db: createRpcClient((fn, args) => {
      calls.push({ fn, args });
      return {
        data: {
          runId: "11111111-1111-1111-1111-111111111111",
          payPeriodId: "22222222-2222-2222-2222-222222222222",
          adapterVersion: "provider-neutral-v1",
          replayed: false,
          createdAt: "2026-08-12T18:00:00.000Z",
          exportedAt: "2026-08-12T18:00:00.000Z",
          reconciliationStatus: "reconciled",
          checksumSha256: "a".repeat(64),
          rowCount: 2,
          totalRegularSeconds: 28800,
          totalOvertimeSeconds: 0,
          totalDoubleTimeSeconds: 0,
          totalMealPremiumCents: 0,
          totalGrossEarningsCents: 96000,
          sourceSnapshotCount: 1,
          adjustsRunId: null,
        },
        error: null,
      };
    }),
  });

  assertEquals(response.status, 200);
  assertEquals(calls, [{
    fn: "create_payroll_export",
    args: {
      payload: {
        payPeriodId: "22222222-2222-2222-2222-222222222222",
        adapterVersion: "provider-neutral-v1",
      },
      idempotency_key: "export-create-key",
    },
  }]);
  assertEquals(response.headers.get("Idempotency-Key"), "export-create-key");
  assertEquals(response.headers.get("Idempotent-Replay"), "false");
  assertEquals(await response.json(), {
    runId: "11111111-1111-1111-1111-111111111111",
    payPeriodId: "22222222-2222-2222-2222-222222222222",
    adapterVersion: "provider-neutral-v1",
    replayed: false,
    createdAt: "2026-08-12T18:00:00.000Z",
    exportedAt: "2026-08-12T18:00:00.000Z",
    reconciliationStatus: "reconciled",
    checksumSha256: "a".repeat(64),
    rowCount: 2,
    totalRegularSeconds: 28800,
    totalOvertimeSeconds: 0,
    totalDoubleTimeSeconds: 0,
    totalMealPremiumCents: 0,
    totalGrossEarningsCents: 96000,
    sourceSnapshotCount: 1,
    adjustsRunId: null,
    idempotencyKey: "export-create-key",
  });
});

Deno.test("GET get_payroll_export returns persisted csv with protected download headers", async () => {
  const calls: RpcCall[] = [];
  const response = await handlePayrollExport({
    req: createRequest({
      method: "GET",
      query: "runId=11111111-1111-1111-1111-111111111111",
    }),
    userContext: createUserContext("super_admin"),
    db: createRpcClient((fn, args) => {
      calls.push({ fn, args });
      return {
        data: {
          runId: "11111111-1111-1111-1111-111111111111",
          payPeriodId: "22222222-2222-2222-2222-222222222222",
          adapterVersion: "provider-neutral-v1",
          periodStart: "2026-08-01",
          periodEnd: "2026-08-14",
          csv: "schema_version,export_id\r\nprovider-neutral-v1,11111111-1111-1111-1111-111111111111\r\n",
        },
        error: null,
      };
    }),
  });

  assertEquals(response.status, 200);
  assertEquals(calls, [{
    fn: "get_payroll_export",
    args: {
      run_id: "11111111-1111-1111-1111-111111111111",
    },
  }]);
  assertEquals(response.headers.get("Content-Type"), "text/csv; charset=utf-8");
  assertEquals(response.headers.get("Cache-Control"), "no-store");
  assertEquals(response.headers.get("X-Content-Type-Options"), "nosniff");
  assertMatch(
    response.headers.get("Content-Disposition") ?? "",
    /^attachment; filename="payroll-export-provider-neutral-v1-2026-08-01-to-2026-08-14-11111111-1111-1111-1111-111111111111\.csv"$/,
  );
  assertEquals(await response.text(), "schema_version,export_id\r\nprovider-neutral-v1,11111111-1111-1111-1111-111111111111\r\n");
});

Deno.test("rejects nested authority injection and extra GET query fields before any RPC", async () => {
  let called = false;
  const postResponse = await handlePayrollExport({
    req: createRequest({
      body: {
        payPeriodId: "22222222-2222-2222-2222-222222222222",
        idempotencyKey: "export-authority-key",
        nested: {
          tenantId: "33333333-3333-3333-3333-333333333333",
        },
      },
    }),
    userContext: createUserContext("admin"),
    db: createRpcClient(() => {
      called = true;
      return { data: null, error: null };
    }),
  });
  assertEquals(postResponse.status, 400);
  assertEquals(called, false);

  const getResponse = await handlePayrollExport({
    req: createRequest({
      method: "GET",
      query: "runId=11111111-1111-1111-1111-111111111111&employeeId=bad",
    }),
    userContext: createUserContext("admin"),
    db: createRpcClient(() => {
      called = true;
      return { data: null, error: null };
    }),
  });
  assertEquals(getResponse.status, 400);
});

Deno.test("maps export RPC failures to the protected typed envelopes", async () => {
  const response = await handlePayrollExport({
    req: createRequest({
      body: {
        payPeriodId: "22222222-2222-2222-2222-222222222222",
        idempotencyKey: "export-state-key",
      },
      headers: {
        "x-request-id": "export-request-id",
      },
    }),
    userContext: createUserContext("admin"),
    db: createRpcClient(() => ({
      data: null,
      error: {
        code: "23514",
        message: "export period is no longer locked",
      },
    })),
  });

  await expectStructuredError(response, {
    status: 409,
    code: "state_conflict",
    error: "Payroll export state conflict.",
    message: "Payroll export state conflict.",
    classification: {
      category: "request",
      severity: "medium",
      retryable: false,
      httpStatus: 409,
    },
    idempotencyKey: "export-state-key",
  });
});

Deno.test("applyPayrollExportCors preserves csv bodies and trace headers", async () => {
  const updated = await applyPayrollExportCors(
    new Response("schema_version,export_id\r\n", {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "x-request-id": "edge-export-request",
      },
    }),
    "https://app.allincompassing.ai",
  );

  assertEquals(updated.headers.get("Access-Control-Allow-Origin"), "https://app.allincompassing.ai");
  assertEquals(updated.headers.get("x-request-id"), "edge-export-request");
  assertEquals(await updated.text(), "schema_version,export_id\r\n");
});
