import { assertEquals, assertMatch } from "https://deno.land/std@0.224.0/testing/asserts.ts";
// deno-lint-ignore-file no-import-prefix
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.50.0";
import type { UserContext } from "../_shared/auth-middleware.ts";
import { applyPayrollCors, handlePayrollTimeEvents, handler } from "./index.ts";

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
  return new Request("https://example.com/functions/v1/payroll-time-events", {
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

const validTimeEvent = {
  occurredAt: "2026-08-11T16:00:00.000Z",
  timezone: "America/Los_Angeles",
  workLocation: "office",
  data: {
    eventType: "shift_started",
  },
};

const validAttendanceEvent = {
  occurredAt: "2026-08-11T16:05:00.000Z",
  timezone: "America/Los_Angeles",
  workLocation: "client_site",
  data: {
    eventType: "session_started",
    sessionId: "11111111-1111-1111-1111-111111111111",
  },
};

const validCorrection = {
  data: {
    originalEventId: "22222222-2222-2222-2222-222222222222",
    reasonCode: "missed_punch",
    replacementPayload: {
      occurredAt: "2026-08-11T17:00:00.000Z",
    },
  },
};

const maliciousNestedSessionAuthorityObjects = [
  {
    authority: {
      organization: {
        organizationId: "33333333-3333-3333-3333-333333333333",
      },
      actor: {
        actorUserId: "malicious-user",
      },
    },
  },
  {
    derivedAuthority: {
      shift: {
        activeShiftEventId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      },
      location: {
        canonicalWorkLocation: "office",
      },
    },
  },
];

Deno.test("OPTIONS returns CORS headers for allowed origins", async () => {
  const response = await handler(
    new Request("https://example.com/functions/v1/payroll-time-events", {
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

Deno.test("rejects unsupported actions with a safe validation error", async () => {
  const response = await handlePayrollTimeEvents({
    req: createRequest({ action: "delete_everything" }),
    userContext: createUserContext(),
    db: createRpcClient(() => ({ data: null, error: null })),
  });

  const body = await response.json() as { error: string };
  assertEquals(response.status, 400);
  assertEquals(body.error, "Unsupported action");
});

Deno.test("rejects forbidden authority fields before RPC execution", async () => {
  const response = await handlePayrollTimeEvents({
    req: createRequest({
      action: "record_time_event",
      event: {
        ...validTimeEvent,
        organization_id: "33333333-3333-3333-3333-333333333333",
      },
    }, {
      headers: {
        "Idempotency-Key": "time-key-1",
      },
    }),
    userContext: createUserContext(),
    db: createRpcClient(() => {
      throw new Error("RPC should not run when authority fields are present");
    }),
  });

  const body = await response.json() as { error: string };
  assertEquals(response.status, 400);
  assertMatch(body.error, /authority/i);
});

Deno.test("rejects forbidden top-level authority fields before schema parsing can strip them", async () => {
  const response = await handlePayrollTimeEvents({
    req: createRequest({
      action: "get_day",
      localDate: "2026-08-11",
      organization_id: "33333333-3333-3333-3333-333333333333",
    }),
    userContext: createUserContext(),
    db: createRpcClient(() => {
      throw new Error("RPC should not run when top-level authority fields are present");
    }),
  });

  const body = await response.json() as { error: string };
  assertEquals(response.status, 400);
  assertMatch(body.error, /authority/i);
});

Deno.test("get_day calls get_payroll_day without requiring an idempotency key", async () => {
  const calls: RpcCall[] = [];
  const response = await handlePayrollTimeEvents({
    req: createRequest({ action: "get_day", localDate: "2026-08-11" }),
    userContext: createUserContext(),
    db: createRpcClient((fn, args) => {
      calls.push({ fn, args });
      return { data: { state: "ok", bootstrap: {}, day: {}, totals: { label: "Calculation pending" } }, error: null };
    }),
  });

  assertEquals(response.status, 200);
  assertEquals(calls, [
    {
      fn: "get_payroll_day",
      args: { local_date: "2026-08-11" },
    },
  ]);
});

Deno.test("get_session_context calls get_session_payroll_context and returns a strictly validated context payload", async () => {
  const calls: RpcCall[] = [];
  const response = await handlePayrollTimeEvents({
    req: createRequest({
      action: "get_session_context",
      sessionId: "77777777-7777-7777-7777-777777777777",
    }),
    userContext: createUserContext(),
    db: createRpcClient((fn, args) => {
      calls.push({ fn, args });
      return {
        data: {
          sessionId: "77777777-7777-7777-7777-777777777777",
          organizationId: "88888888-8888-8888-8888-888888888888",
          employmentProfileId: "99999999-9999-9999-9999-999999999999",
          employmentTimezone: "America/Los_Angeles",
          actorIsAssignedEmployee: true,
          canClockSelf: true,
          canonicalWorkLocation: "client_site",
          activeShiftEventId: null,
        },
        error: null,
      };
    }),
  });

  assertEquals(response.status, 200);
  assertEquals(calls, [
    {
      fn: "get_session_payroll_context",
      args: { session_id: "77777777-7777-7777-7777-777777777777" },
    },
  ]);
  assertEquals(await response.json(), {
    sessionId: "77777777-7777-7777-7777-777777777777",
    organizationId: "88888888-8888-8888-8888-888888888888",
    employmentProfileId: "99999999-9999-9999-9999-999999999999",
    employmentTimezone: "America/Los_Angeles",
    actorIsAssignedEmployee: true,
    canClockSelf: true,
    canonicalWorkLocation: "client_site",
    activeShiftEventId: null,
  });
});

Deno.test("get_session_context rejects raw authority fields before schema stripping", async () => {
  const response = await handlePayrollTimeEvents({
    req: createRequest({
      action: "get_session_context",
      sessionId: "77777777-7777-7777-7777-777777777777",
      employmentProfileId: "99999999-9999-9999-9999-999999999999",
    }),
    userContext: createUserContext(),
    db: createRpcClient(() => {
      throw new Error("RPC should not run when authority fields are present");
    }),
  });

  const body = await response.json() as { error: string };
  assertEquals(response.status, 400);
  assertMatch(body.error, /authority/i);
});

Deno.test("get_session_context rejects malicious nested authority objects before RPC execution", async () => {
  let rpcCalls = 0;

  for (const nestedAuthority of maliciousNestedSessionAuthorityObjects) {
    const response = await handlePayrollTimeEvents({
      req: createRequest({
        action: "get_session_context",
        sessionId: "77777777-7777-7777-7777-777777777777",
        ...nestedAuthority,
      }),
      userContext: createUserContext(),
      db: createRpcClient(() => {
        rpcCalls += 1;
        return { data: null, error: null };
      }),
    });

    const body = await response.json() as { error: string };
    assertEquals(response.status, 400);
    assertMatch(body.error, /authority/i);
    assertEquals(rpcCalls, 0);
  }
});

Deno.test("mutation requires Idempotency-Key and echoes replay information from the RPC response", async () => {
  const response = await handlePayrollTimeEvents({
    req: createRequest(
      { action: "record_time_event", event: validTimeEvent },
      { headers: { "Idempotency-Key": "time-key-2" } },
    ),
    userContext: createUserContext(),
    db: createRpcClient((fn, args) => {
      assertEquals(fn, "record_employee_time_event");
      assertEquals(args, {
        event_payload: validTimeEvent,
        idempotency_key: "time-key-2",
      });
      return {
        data: {
          event_id: "44444444-4444-4444-4444-444444444444",
          operation: "record_employee_time_event",
          replayed: true,
        },
        error: null,
      };
    }),
  });

  const body = await response.json() as { idempotencyKey: string; replayed: boolean };
  assertEquals(response.status, 200);
  assertEquals(response.headers.get("Idempotency-Key"), "time-key-2");
  assertEquals(response.headers.get("Idempotent-Replay"), "true");
  assertEquals(body.idempotencyKey, "time-key-2");
  assertEquals(body.replayed, true);
});

Deno.test("maps same-key payload conflicts to 409 without leaking SQL details", async () => {
  const response = await handlePayrollTimeEvents({
    req: createRequest(
      { action: "request_correction", correction: validCorrection },
      { headers: { "Idempotency-Key": "correction-key-1" } },
    ),
    userContext: createUserContext(),
    db: createRpcClient(() => ({
      data: null,
      error: { code: "23505", message: "IDEMPOTENCY_CONFLICT detail should stay hidden" },
    })),
  });

  const body = await response.json() as { error: string; code?: string };
  assertEquals(response.status, 409);
  assertEquals(body.code, "conflict");
  assertMatch(body.error, /idempotency/i);
});

Deno.test("maps SQLSTATE 23514 state conflicts to 409 with a distinct safe code", async () => {
  const response = await handlePayrollTimeEvents({
    req: createRequest(
      { action: "record_session_attendance", event: validAttendanceEvent },
      { headers: { "Idempotency-Key": "attendance-key-23514" } },
    ),
    userContext: createUserContext(),
    db: createRpcClient(() => ({
      data: null,
      error: { code: "23514", message: "session end requires an active session" },
    })),
  });

  const body = await response.json() as { error: string; code?: string; idempotencyKey?: string };
  assertEquals(response.status, 409);
  assertEquals(body.code, "state_conflict");
  assertEquals(body.idempotencyKey, "attendance-key-23514");
  assertMatch(body.error, /state/i);
});

Deno.test("attendance correction uses the exact protected RPC and response headers stay CORS-safe", async () => {
  const response = await handlePayrollTimeEvents({
    req: createRequest(
      {
        action: "request_session_attendance_correction",
        correction: {
          data: {
            sessionAttendanceEventId: "55555555-5555-5555-5555-555555555555",
            reasonCode: "missed_attendance",
          },
        },
      },
      { headers: { "Idempotency-Key": "attendance-correction-key" } },
    ),
    userContext: createUserContext("admin_schedule"),
    db: createRpcClient((fn, args) => {
      assertEquals(fn, "request_session_attendance_correction");
      assertEquals(args, {
        correction_payload: {
          data: {
            sessionAttendanceEventId: "55555555-5555-5555-5555-555555555555",
            reasonCode: "missed_attendance",
          },
        },
        idempotency_key: "attendance-correction-key",
      });
      return {
        data: {
          request_id: "66666666-6666-6666-6666-666666666666",
          operation: "request_session_attendance_correction",
          replayed: false,
        },
        error: null,
      };
    }),
  });

  assertEquals(response.status, 200);
  assertEquals(response.headers.get("Access-Control-Allow-Origin"), "https://app.allincompassing.ai");
  assertEquals(response.headers.get("Content-Type"), "application/json");
  assertEquals(response.headers.get("Idempotency-Key"), "attendance-correction-key");
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
