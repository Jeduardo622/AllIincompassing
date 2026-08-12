import { assertEquals, assertMatch } from "https://deno.land/std@0.224.0/testing/asserts.ts";
// deno-lint-ignore-file no-import-prefix
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.50.0";
import type { UserContext } from "../_shared/auth-middleware.ts";
import { handlePayrollTimesheets } from "./index.ts";

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
  return new Request("https://example.com/functions/v1/payroll-timesheets", {
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

Deno.test("rejects unsupported timesheet actions", async () => {
  const response = await handlePayrollTimesheets({
    req: createRequest({ action: "mutate_history" }),
    userContext: createUserContext(),
    db: createRpcClient(() => ({ data: null, error: null })),
  });

  const body = await response.json() as { error: string };
  assertEquals(response.status, 400);
  assertEquals(body.error, "Unsupported action");
});

Deno.test("get_period calls the protected payroll snapshot RPC", async () => {
  const calls: RpcCall[] = [];
  const response = await handlePayrollTimesheets({
    req: createRequest({
      action: "get_period",
      selectedLocalDate: "2026-08-11",
    }),
    userContext: createUserContext(),
    db: createRpcClient((fn, args) => {
      calls.push({ fn, args });
      return {
        data: {
          state: "ok",
          snapshot: null,
          period: {
            selectedLocalDate: "2026-08-11",
            localDate: "2026-08-11",
            periodStart: "2026-08-10",
            periodEnd: "2026-08-16",
            timezone: "America/Los_Angeles",
            events: [],
            exceptions: [],
          },
        },
        error: null,
      };
    }),
  });

  assertEquals(response.status, 200);
  assertEquals(calls, [{
    fn: "get_payroll_timesheet_period",
    args: {
      selected_local_date: "2026-08-11",
    },
  }]);
});

Deno.test("derive_snapshot requires Idempotency-Key and returns replay headers", async () => {
  const response = await handlePayrollTimesheets({
    req: createRequest({
      action: "derive_snapshot",
      selectedLocalDate: "2026-08-11",
    }, {
      headers: {
        "Idempotency-Key": "timesheet-key-1",
      },
    }),
    userContext: createUserContext(),
    db: createRpcClient((fn, args) => {
      assertEquals(fn, "derive_timesheet_snapshot");
      assertEquals(args, {
        selected_local_date: "2026-08-11",
        p_idempotency_key: "timesheet-key-1",
      });
      return {
        data: {
          snapshot_id: "11111111-1111-1111-1111-111111111111",
          replayed: true,
        },
        error: null,
      };
    }),
  });

  const body = await response.json() as { idempotencyKey: string; replayed: boolean };
  assertEquals(response.status, 200);
  assertEquals(response.headers.get("Idempotency-Key"), "timesheet-key-1");
  assertEquals(response.headers.get("Idempotent-Replay"), "true");
  assertEquals(body.idempotencyKey, "timesheet-key-1");
  assertEquals(body.replayed, true);
});

Deno.test("derive_snapshot preserves blocked payloads from the protected RPC", async () => {
  const response = await handlePayrollTimesheets({
    req: createRequest({
      action: "derive_snapshot",
      selectedLocalDate: "2026-08-11",
    }, {
      headers: {
        "Idempotency-Key": "timesheet-key-blocked",
      },
    }),
    userContext: createUserContext(),
    db: createRpcClient((fn, args) => {
      assertEquals(fn, "derive_timesheet_snapshot");
      assertEquals(args, {
        selected_local_date: "2026-08-11",
        p_idempotency_key: "timesheet-key-blocked",
      });
      return {
        data: {
          state: "blocked",
          snapshotId: null,
          sourceHash: null,
          lockable: false,
          period: {
            selectedLocalDate: "2026-08-11",
            localDate: "2026-08-11",
            periodStart: "2026-08-10",
            periodEnd: "2026-08-16",
          },
          totals: {
            regularSeconds: 0,
            overtimeSeconds: 0,
            doubleTimeSeconds: 0,
            mealPremiumCents: 0,
            grossEarningsCents: 0,
          },
          exceptions: [
            {
              code: "meal_unresolved",
              blocking: true,
            },
          ],
        },
        error: null,
      };
    }),
  });

  const body = await response.json() as {
    state: string;
    sourceHash: string | null;
    idempotencyKey: string;
    exceptions: Array<{ code: string; blocking: boolean }>;
  };
  assertEquals(response.status, 200);
  assertEquals(response.headers.get("Idempotency-Key"), "timesheet-key-blocked");
  assertEquals(body.state, "blocked");
  assertEquals(body.sourceHash, null);
  assertEquals(body.idempotencyKey, "timesheet-key-blocked");
  assertEquals(body.exceptions[0], {
    code: "meal_unresolved",
    blocking: true,
  });
});

Deno.test("rejects caller-supplied authority fields before any RPC", async () => {
  const response = await handlePayrollTimesheets({
    req: createRequest({
      action: "get_period",
      selectedLocalDate: "2026-08-11",
      organizationId: "33333333-3333-3333-3333-333333333333",
    }),
    userContext: createUserContext(),
    db: createRpcClient(() => {
      throw new Error("RPC should not execute for authority-injected payloads");
    }),
  });

  const body = await response.json() as { error: string };
  assertEquals(response.status, 400);
  assertMatch(body.error, /authority/i);
});
