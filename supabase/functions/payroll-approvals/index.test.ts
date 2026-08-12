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
  if (init.origin !== null) {
    headers.set("Origin", init.origin ?? "https://app.allincompassing.ai");
  }
  return new Request("https://example.com/functions/v1/payroll-approvals", {
    method: init.method ?? "POST",
    headers,
    body: init.method === "OPTIONS" ? undefined : JSON.stringify(body),
  });
}

function createRpcClient(resolver: (fn: string, args: Record<string, unknown>) => { data: unknown; error: unknown }): SupabaseClient {
  return {
    rpc: async (fn: string, args: Record<string, unknown>) => resolver(fn, args),
  } as unknown as SupabaseClient;
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

  const body = await response.json() as { error: string };
  assertEquals(response.status, 400);
  assertMatch(body.error, /authority/i);
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
        blockerType: "timekeeping_exception",
        blockerId: "55555555-5555-5555-5555-555555555555",
        action: "resolved",
        reason: "Reviewed and corrected.",
      },
      p_idempotency_key: "approval-blocker-key",
    },
  }]);
});

Deno.test("maps feature_disabled approval failures to an explicit typed response", async () => {
  const response = await handlePayrollApprovals({
    req: createRequest({
      action: "lock",
      snapshotId: "11111111-1111-1111-1111-111111111111",
      snapshotHash: "a".repeat(64),
    }, {
      headers: {
        "Idempotency-Key": "approval-feature-key",
      },
    }),
    userContext: createUserContext("admin"),
    db: createRpcClient(() => ({
      data: null,
      error: { code: "42501", message: "payroll approval workflow is feature_disabled" },
    })),
  });

  const body = await response.json() as { code?: string; state?: string; idempotencyKey?: string };
  assertEquals(response.status, 403);
  assertEquals(body.code, "feature_disabled");
  assertEquals(body.state, "feature_disabled");
  assertEquals(body.idempotencyKey, "approval-feature-key");
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
        grossEarningsCents: 123456,
      },
      error: null,
    })),
  });

  const body = await response.json() as { code?: string; error?: string };
  assertEquals(response.status, 502);
  assertEquals(body.code, "invalid_response");
  assertEquals(body.error, "Invalid payroll approval response.");
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
