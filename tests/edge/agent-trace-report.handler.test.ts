// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const organizationId = "22222222-2222-4222-8222-222222222222";
const eqCalls: Array<{ table: string; column: string; value: unknown }> = [];
const fromCalls: string[] = [];
let roleAllowed = false;

function createQuery(table: string) {
  const query: Record<string, unknown> = {};
  query.select = vi.fn(() => query);
  query.eq = vi.fn((column: string, value: unknown) => {
    eqCalls.push({ table, column, value });
    return query;
  });
  query.contains = vi.fn(() => query);
  query.order = vi.fn(() => query);
  query.limit = vi.fn(() => query);
  query.then = (resolve: (value: unknown) => unknown) =>
    Promise.resolve(resolve({ data: [], error: null }));
  return query;
}

async function loadHandler() {
  let handler: ((req: Request) => Promise<Response>) | undefined;
  vi.stubGlobal("Deno", {
    env: { get: vi.fn(() => "") },
    serve: vi.fn((candidate: (req: Request) => Promise<Response>) => {
      handler = candidate;
      return {};
    }),
  });
  vi.doMock("../../supabase/functions/_shared/database.ts", () => ({
    createRequestClient: vi.fn(() => ({})),
    supabaseAdmin: {
      from: vi.fn((table: string) => {
        fromCalls.push(table);
        return createQuery(table);
      }),
    },
  }));
  vi.doMock("../../supabase/functions/_shared/auth.ts", () => ({
    getUserOrThrow: vi.fn(async () => ({
      id: "11111111-1111-4111-8111-111111111111",
    })),
  }));
  vi.doMock("../../supabase/functions/_shared/org.ts", () => ({
    resolveOrgId: vi.fn(async () => organizationId),
    assertUserHasOrgRole: vi.fn(async () => roleAllowed),
  }));
  vi.doMock("../../supabase/functions/_shared/logging.ts", () => ({
    getLogger: vi.fn(() => ({ info: vi.fn(), error: vi.fn() })),
  }));
  vi.doMock("../../supabase/functions/_shared/cors.ts", () => ({
    resolveAllowedOrigin: vi.fn(() => "http://localhost:5173"),
  }));

  await import("../../supabase/functions/agent-trace-report/index.ts");
  if (!handler) throw new Error("Function handler was not registered");
  return handler;
}

describe("agent-trace-report handler tenant boundary", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    eqCalls.length = 0;
    fromCalls.length = 0;
    roleAllowed = false;
  });

  it("fails closed before privileged queries for a caller without an operator role", async () => {
    const response = await (await loadHandler())(
      new Request(
        "http://localhost/functions/v1/agent-trace-report?requestId=req-1",
      ),
    );

    expect(response.status).toBe(403);
    expect(fromCalls).toEqual([]);
  });

  it("applies the resolved organization to every privileged query", async () => {
    roleAllowed = true;
    const response = await (await loadHandler())(
      new Request(
        "http://localhost/functions/v1/agent-trace-report?requestId=req-1",
      ),
    );

    expect(response.status).toBe(200);
    expect(fromCalls).toEqual([
      "agent_execution_traces",
      "scheduling_orchestration_runs",
      "session_audit_logs",
    ]);
    expect(eqCalls.filter((call) => call.column === "organization_id")).toEqual(
      [
        {
          table: "agent_execution_traces",
          column: "organization_id",
          value: organizationId,
        },
        {
          table: "scheduling_orchestration_runs",
          column: "organization_id",
          value: organizationId,
        },
        {
          table: "session_audit_logs",
          column: "organization_id",
          value: organizationId,
        },
      ],
    );
  });
});
