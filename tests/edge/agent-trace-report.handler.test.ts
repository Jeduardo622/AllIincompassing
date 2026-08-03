// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const organizationId = "22222222-2222-4222-8222-222222222222";
const eqCalls: Array<{ table: string; column: string; value: unknown }> = [];
const inCalls: Array<{ table: string; column: string; values: unknown[] }> = [];
const fromCalls: string[] = [];
const tableData = new Map<string, unknown[]>();
const tableCounts = new Map<string, number>();
let roleAllowed = false;

function createQuery(table: string) {
  const query: Record<string, unknown> = {};
  query.select = vi.fn(() => query);
  query.eq = vi.fn((column: string, value: unknown) => {
    eqCalls.push({ table, column, value });
    return query;
  });
  query.contains = vi.fn(() => query);
  query.in = vi.fn((column: string, values: unknown[]) => {
    inCalls.push({ table, column, values });
    return query;
  });
  query.order = vi.fn(() => query);
  query.limit = vi.fn(() => query);
  query.then = (resolve: (value: unknown) => unknown) =>
    Promise.resolve(resolve({
      data: tableData.get(table) ?? [],
      error: null,
      count: tableCounts.get(table) ?? (tableData.get(table) ?? []).length,
    }));
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
    inCalls.length = 0;
    fromCalls.length = 0;
    tableData.clear();
    tableCounts.clear();
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

  it("does not load replay ledger rows on an ordinary trace report", async () => {
    roleAllowed = true;
    tableData.set("agent_execution_traces", [{
      id: "trace-1",
      request_id: "req-1",
      correlation_id: "corr-1",
      conversation_id: null,
      user_id: null,
      organization_id: organizationId,
      work_item_id: "33333333-3333-4333-8333-333333333333",
      step_id: "44444444-4444-4444-8444-444444444444",
      attempt_id: "55555555-5555-4555-8555-555555555555",
      step_name: "workflow.started",
      step_index: 0,
      status: "ok",
      payload: {},
      replay_payload: {},
      created_at: "2026-08-02T00:00:00.000Z",
    }]);

    const response = await (await loadHandler())(
      new Request("http://localhost/functions/v1/agent-trace-report?requestId=req-1"),
    );

    expect(response.status).toBe(200);
    expect(fromCalls).toEqual([
      "agent_execution_traces",
      "scheduling_orchestration_runs",
      "session_audit_logs",
    ]);
    const payload = await response.json();
    expect(payload.data).not.toHaveProperty("replayPackets");
  });

  it("fails closed before operations queries for a caller without an operator role", async () => {
    const response = await (await loadHandler())(
      new Request("http://localhost/functions/v1/agent-trace-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "operations" }),
      }),
    );

    expect(response.status).toBe(403);
    expect(fromCalls).toEqual([]);
  });

  it("scopes every bounded operations query to the resolved organization", async () => {
    roleAllowed = true;
    const response = await (await loadHandler())(
      new Request("http://localhost/functions/v1/agent-trace-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "operations" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(fromCalls).toEqual([
      "agent_work_items",
      "agent_work_steps",
      "agent_work_approvals",
      "agent_work_attempts",
      "agent_work_effects",
      "agent_work_evidence",
      "agent_work_events",
    ]);
    expect(eqCalls.filter((call) => call.column === "organization_id")).toHaveLength(7);
    expect(eqCalls.filter((call) => call.column === "organization_id")).toEqual(
      fromCalls.map((table) => ({ table, column: "organization_id", value: organizationId })),
    );
    const payload = await response.json();
    expect(payload.data.operations.schemaVersion).toBe("agent-work-operations.v1");
  });

  it("binds replay follow-up reads to organization and selected work-item IDs", async () => {
    roleAllowed = true;
    const workItemId = "33333333-3333-4333-8333-333333333333";
    tableData.set("agent_execution_traces", [{
      id: "trace-1",
      request_id: "req-1",
      correlation_id: "corr-1",
      conversation_id: null,
      user_id: null,
      organization_id: organizationId,
      work_item_id: workItemId,
      step_id: "44444444-4444-4444-8444-444444444444",
      attempt_id: "55555555-5555-4555-8555-555555555555",
      step_name: "workflow.started",
      step_index: 0,
      status: "ok",
      payload: {},
      replay_payload: {},
      created_at: "2026-08-02T00:00:00.000Z",
    }]);
    tableData.set("agent_work_items", [{
      id: workItemId,
      organization_id: organizationId,
      workflow_key: "assessment.iehp.prepare_for_clinical_review",
      workflow_version: 1,
      status: "running",
    }]);
    tableData.set("agent_work_steps", [{
      id: "44444444-4444-4444-8444-444444444444",
      organization_id: organizationId,
      work_item_id: workItemId,
      step_key: "selected_step",
      status: "running",
    }, {
      id: "66666666-6666-4666-8666-666666666666",
      organization_id: organizationId,
      work_item_id: workItemId,
      step_key: "unrelated_step",
      status: "completed",
    }]);
    tableData.set("agent_work_attempts", [{
      id: "55555555-5555-4555-8555-555555555555",
      organization_id: organizationId,
      work_item_id: workItemId,
      step_id: "44444444-4444-4444-8444-444444444444",
      status: "running",
      provider: "local_stub",
      model: "deterministic_fixture",
      prompt_version: "prompt_v1",
      tool_version: "tool_v1",
      workflow_version: 1,
      model_request_schema_version: "schema_v1",
      error_code: null,
      created_at: "2026-08-02T00:00:00.000Z",
      finished_at: null,
    }, {
      id: "77777777-7777-4777-8777-777777777777",
      organization_id: organizationId,
      work_item_id: workItemId,
      step_id: "66666666-6666-4666-8666-666666666666",
      status: "completed",
      provider: "local_stub",
      model: "deterministic_fixture",
      prompt_version: "prompt_v1",
      tool_version: "tool_v1",
      workflow_version: 1,
      model_request_schema_version: "schema_v1",
      error_code: null,
      created_at: "2026-08-01T00:00:00.000Z",
      finished_at: "2026-08-01T00:01:00.000Z",
    }]);

    const response = await (await loadHandler())(
      new Request("http://localhost/functions/v1/agent-trace-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "replay", requestId: "req-1" }),
      }),
    );

    expect(response.status).toBe(200);
    const ledgerTables = [
      "agent_work_items",
      "agent_work_steps",
      "agent_work_evidence",
      "agent_work_approvals",
      "agent_work_attempts",
      "agent_work_effects",
      "agent_work_events",
    ];
    for (const table of ledgerTables) {
      expect(eqCalls).toContainEqual({
        table,
        column: "organization_id",
        value: organizationId,
      });
    }
    expect(inCalls).toEqual(
      ledgerTables.map((table) => ({
        table,
        column: table === "agent_work_items" ? "id" : "work_item_id",
        values: [workItemId],
      })),
    );
    const payload = await response.json();
    expect(payload.data.replayPackets).toEqual([
      expect.objectContaining({
        executionAllowed: false,
        workItemId,
        steps: [expect.objectContaining({ stepKey: "selected_step" })],
        attempts: [expect.objectContaining({
          attemptId: "55555555-5555-4555-8555-555555555555",
        })],
        effects: [],
      }),
    ]);
    expect(JSON.stringify(payload)).not.toContain("unrelated_step");
    expect(JSON.stringify(payload)).not.toContain(
      "77777777-7777-4777-8777-777777777777",
    );
  });

  it("fails closed instead of returning a truncated replay packet", async () => {
    roleAllowed = true;
    const workItemId = "33333333-3333-4333-8333-333333333333";
    tableData.set("agent_execution_traces", [{
      id: "trace-1",
      request_id: "req-1",
      correlation_id: "corr-1",
      conversation_id: null,
      user_id: null,
      organization_id: organizationId,
      work_item_id: workItemId,
      step_id: "44444444-4444-4444-8444-444444444444",
      attempt_id: "55555555-5555-4555-8555-555555555555",
      step_name: "workflow.started",
      step_index: 0,
      status: "ok",
      payload: {},
      replay_payload: {},
      created_at: "2026-08-02T00:00:00.000Z",
    }]);
    tableCounts.set("agent_work_events", 501);

    const response = await (await loadHandler())(
      new Request("http://localhost/functions/v1/agent-trace-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "replay", requestId: "req-1" }),
      }),
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      success: false,
      error: "Internal server error",
    });
  });

  it("fails closed when the root trace selector exceeds the replay cap", async () => {
    roleAllowed = true;
    tableData.set("agent_execution_traces", [{
      id: "trace-1",
      request_id: "req-1",
      correlation_id: "corr-1",
      conversation_id: null,
      user_id: null,
      organization_id: organizationId,
      work_item_id: "33333333-3333-4333-8333-333333333333",
      step_id: "44444444-4444-4444-8444-444444444444",
      attempt_id: "55555555-5555-4555-8555-555555555555",
      step_name: "workflow.started",
      step_index: 0,
      status: "ok",
      payload: {},
      replay_payload: {},
      created_at: "2026-08-02T00:00:00.000Z",
    }]);
    tableCounts.set("agent_execution_traces", 501);

    const response = await (await loadHandler())(
      new Request("http://localhost/functions/v1/agent-trace-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "replay", requestId: "req-1" }),
      }),
    );

    expect(response.status).toBe(500);
    expect(fromCalls).toEqual(["agent_execution_traces"]);
  });

  it("fails closed when replay resolves to no ledger work item", async () => {
    roleAllowed = true;

    const response = await (await loadHandler())(
      new Request("http://localhost/functions/v1/agent-trace-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "replay", requestId: "req-missing" }),
      }),
    );

    expect(response.status).toBe(500);
    expect(fromCalls).toEqual(["agent_execution_traces"]);
  });

  it("fails closed when replay resolves to multiple ledger work items", async () => {
    roleAllowed = true;
    tableData.set("agent_execution_traces", [
      {
        id: "trace-1",
        request_id: "req-1",
        correlation_id: "corr-1",
        conversation_id: null,
        user_id: null,
        organization_id: organizationId,
        work_item_id: "33333333-3333-4333-8333-333333333333",
        step_id: "44444444-4444-4444-8444-444444444444",
        attempt_id: "55555555-5555-4555-8555-555555555555",
        step_name: "workflow.started",
        step_index: 0,
        status: "ok",
        payload: {},
        replay_payload: {},
        created_at: "2026-08-02T00:00:00.000Z",
      },
      {
        id: "trace-2",
        request_id: "req-1",
        correlation_id: "corr-1",
        conversation_id: null,
        user_id: null,
        organization_id: organizationId,
        work_item_id: "88888888-8888-4888-8888-888888888888",
        step_id: "99999999-9999-4999-8999-999999999999",
        attempt_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        step_name: "workflow.started",
        step_index: 0,
        status: "ok",
        payload: {},
        replay_payload: {},
        created_at: "2026-08-02T00:01:00.000Z",
      },
    ]);

    const response = await (await loadHandler())(
      new Request("http://localhost/functions/v1/agent-trace-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "replay", requestId: "req-1" }),
      }),
    );

    expect(response.status).toBe(500);
    expect(fromCalls).toEqual(["agent_execution_traces"]);
  });
});
