// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { stubDenoEnv } from "../utils/stubDeno";

const completionCreateMock = vi.fn();
const rpcMock = vi.fn();
const traceInserts: Array<Record<string, unknown>> = [];

const ids = {
  user: "11111111-1111-4111-8111-111111111111",
  organization: "22222222-2222-4222-8222-222222222222",
  client: "33333333-3333-4333-8333-333333333333",
  workItem: "44444444-4444-4444-8444-444444444444",
  step: "55555555-5555-4555-8555-555555555555",
  attempt: "66666666-6666-4666-8666-666666666666",
  evidence: "77777777-7777-4777-8777-777777777777",
};

function createMaybeSingleQuery(data: unknown) {
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of ["select", "eq", "order", "limit"]) {
    query[method] = vi.fn(() => query);
  }
  query.maybeSingle = vi.fn(async () => ({ data, error: null }));
  return query;
}

async function loadHandler() {
  let serveHandler: ((req: Request) => Promise<Response>) | undefined;
  const env = new Map<string, string>([
    ["OPENAI_API_KEY", "local-fake-key"],
    ["AGENT_WORK_LEDGER_RUNTIME_MODE", "advisory"],
  ]);
  stubDenoEnv((key) => env.get(key) ?? "");
  vi.stubGlobal("Deno", {
    env: { get: (key: string) => env.get(key) ?? "" },
    serve: vi.fn((handler: (req: Request) => Promise<Response>) => {
      serveHandler = handler;
      return {};
    }),
  });
  vi.doMock("npm:openai@5.5.1", () => ({
    OpenAI: class {
      chat = { completions: { create: completionCreateMock } };
    },
  }));
  vi.doMock("npm:zod@3.23.8", async () => ({ z: (await import("zod")).z }));
  vi.doMock("../../supabase/functions/_shared/database.ts", () => ({
    createRequestClient: vi.fn(() => ({
      rpc: vi.fn(async (name: string, args?: Record<string, unknown>) => {
        if (name === "current_user_is_super_admin") return { data: false, error: null };
        if (name === "user_has_role_for_org") {
          return { data: args?.role_name === "bcba", error: null };
        }
        throw new Error(`Unexpected request RPC: ${name}`);
      }),
    })),
    supabaseAdmin: {
      rpc: rpcMock,
      from: vi.fn((table: string) => {
        if (table === "agent_execution_traces") {
          return {
            insert: vi.fn(async (row: Record<string, unknown>) => {
              traceInserts.push(row);
              return { error: null };
            }),
          };
        }
        if (table === "agent_runtime_config") {
          return createMaybeSingleQuery({ actions_disabled: false, reason: null });
        }
        if (table === "agent_prompt_tool_versions") {
          return createMaybeSingleQuery({
            id: "version-1",
            prompt_version: "prompt-v1",
            tool_version: "tools-v1",
            status: "active",
            is_current: true,
            metadata: null,
            rollback_reason: null,
            created_at: "2026-08-02T00:00:00.000Z",
          });
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    },
  }));
  vi.doMock("../../supabase/functions/_shared/auth.ts", () => ({
    getUserOrThrow: vi.fn(async () => ({ id: ids.user })),
  }));
  vi.doMock("../../supabase/functions/_shared/org.ts", () => ({
    resolveOrgId: vi.fn(async () => ids.organization),
  }));
  vi.doMock("../../supabase/functions/_shared/logging.ts", () => ({
    getLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn() })),
  }));
  vi.doMock("../../supabase/functions/ai-agent-optimized/persistence.ts", () => ({
    persistChatMessage: vi.fn(),
  }));

  await import("../../supabase/functions/ai-agent-optimized/index.ts");
  if (!serveHandler) throw new Error("Function handler was not registered");
  return serveHandler;
}

function ledgerRequest(extra: Record<string, unknown> = {}) {
  return new Request("http://localhost/functions/v1/ai-agent-optimized", {
    method: "POST",
    headers: {
      Authorization: "Bearer local-test-token",
      "Content-Type": "application/json",
      "x-request-id": "request-ledger-1",
    },
    body: JSON.stringify({
      agentWork: {
        organizationId: ids.organization,
        clientId: ids.client,
        workItemId: ids.workItem,
        stepId: ids.step,
        attemptId: ids.attempt,
        workflowVersion: 1,
        correlationId: "correlation-ledger-1",
      },
      ...extra,
    }),
  });
}

describe("ai-agent-optimized ledger-bound advisory execution", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    traceInserts.length = 0;
    rpcMock.mockImplementation(async (name: string) => {
      if (name === "load_agent_work_runtime_policy") {
        return {
          data: [{
            authoritative: true,
            runtimeMode: "advisory",
            actionsDisabled: false,
            killSwitchEnabled: false,
          }],
          error: null,
        };
      }
      if (name === "snapshot_agent_work_model_attempt") {
        return {
          data: [{
            organization_id: ids.organization,
            client_id: ids.client,
            work_item_id: ids.workItem,
            step_id: ids.step,
            attempt_id: ids.attempt,
            workflow_key: "assessment.iehp.prepare_for_clinical_review",
            workflow_version: 1,
            step_key: "validate_review_evidence",
            attempt_status: "running",
            prompt_version: "prompt-v1",
            tool_version: "tools-v1",
            allowed_tools: [],
            guarded_tools: [],
            blocker_codes: ["missing_required_evidence"],
            suggested_action_codes: ["request_missing_evidence"],
            evidence_source_ids: [ids.evidence],
          }],
          error: null,
        };
      }
      if (name === "record_agent_work_model_attempt_result") {
        return { data: {}, error: null };
      }
      throw new Error(`Unexpected admin RPC: ${name}`);
    });
    completionCreateMock.mockResolvedValue({
      choices: [{
        message: {
          content: JSON.stringify({
            blockerCode: "missing_required_evidence",
            suggestedActionCode: "request_missing_evidence",
            evidenceSourceIds: [ids.evidence],
            confidence: 0.8,
            requiresHumanReview: true,
          }),
        },
      }],
      usage: { prompt_tokens: 20, completion_tokens: 10 },
    });
  });

  it("snapshots before the fake provider and returns only candidate evidence", async () => {
    const order: string[] = [];
    rpcMock.mockImplementation(async (name: string) => {
      order.push(name);
      if (name === "load_agent_work_runtime_policy") {
        return { data: [{ authoritative: true, runtimeMode: "advisory", actionsDisabled: false, killSwitchEnabled: false }], error: null };
      }
      if (name === "snapshot_agent_work_model_attempt") {
        return { data: [{ organization_id: ids.organization, client_id: ids.client, work_item_id: ids.workItem, step_id: ids.step, attempt_id: ids.attempt, workflow_key: "assessment.iehp.prepare_for_clinical_review", workflow_version: 1, step_key: "validate_review_evidence", attempt_status: "running", prompt_version: "prompt-v1", tool_version: "tools-v1", allowed_tools: [], guarded_tools: [], blocker_codes: ["missing_required_evidence"], suggested_action_codes: ["request_missing_evidence"], evidence_source_ids: [ids.evidence] }], error: null };
      }
      if (name === "record_agent_work_model_attempt_result") return { data: {}, error: null };
      throw new Error(`Unexpected admin RPC: ${name}`);
    });
    completionCreateMock.mockImplementation(async () => {
      order.push("provider");
      return { choices: [{ message: { content: JSON.stringify({ blockerCode: "missing_required_evidence", suggestedActionCode: "request_missing_evidence", evidenceSourceIds: [ids.evidence], confidence: 0.8, requiresHumanReview: true }) } }], usage: { prompt_tokens: 20, completion_tokens: 10 } };
    });

    const response = await (await loadHandler())(ledgerRequest());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      response: "Advisory candidate evidence generated for human review.",
      candidateEvidence: { requiresHumanReview: true },
    });
    expect(order.indexOf("snapshot_agent_work_model_attempt")).toBeLessThan(order.indexOf("provider"));
    expect(order.indexOf("provider")).toBeLessThan(order.indexOf("record_agent_work_model_attempt_result"));
    expect(completionCreateMock).toHaveBeenCalledWith(expect.objectContaining({ tools: [] }));
    expect(JSON.stringify(traceInserts)).not.toContain("missing_signature");
    expect(traceInserts.every((row) => row.replay_payload === null)).toBe(true);
  });

  it("rejects a free-form message before snapshot or provider invocation", async () => {
    const response = await (await loadHandler())(ledgerRequest({ message: "raw clinical text" }));
    expect(response.status).toBe(400);
    expect(completionCreateMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects context and completion claims on ledger-bound ingress", async () => {
    const handler = await loadHandler();
    const contextResponse = await handler(
      ledgerRequest({ context: { userAgent: "raw clinical context" } }),
    );
    expect(contextResponse.status).toBe(400);
    const completionResponse = await handler(ledgerRequest({ completed: true }));
    expect(completionResponse.status).toBe(400);
    expect(completionCreateMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("emits no ledger trace and never calls the provider when snapshot authority is denied", async () => {
    rpcMock.mockImplementation(async (name: string) => {
      if (name === "load_agent_work_runtime_policy") {
        return { data: [{ authoritative: true, runtimeMode: "advisory", actionsDisabled: false, killSwitchEnabled: false }], error: null };
      }
      if (name === "snapshot_agent_work_model_attempt") {
        return { data: null, error: { message: "denied" } };
      }
      throw new Error(`Unexpected admin RPC: ${name}`);
    });

    const response = await (await loadHandler())(ledgerRequest());
    expect(response.status).toBe(409);
    expect(completionCreateMock).not.toHaveBeenCalled();
    expect(traceInserts).toEqual([]);
  });

  it("fails closed when successful model usage cannot be recorded", async () => {
    rpcMock.mockImplementation(async (name: string) => {
      if (name === "load_agent_work_runtime_policy") {
        return { data: [{ authoritative: true, runtimeMode: "advisory", actionsDisabled: false, killSwitchEnabled: false }], error: null };
      }
      if (name === "snapshot_agent_work_model_attempt") {
        return { data: [{ organization_id: ids.organization, client_id: ids.client, work_item_id: ids.workItem, step_id: ids.step, attempt_id: ids.attempt, workflow_key: "assessment.iehp.prepare_for_clinical_review", workflow_version: 1, step_key: "validate_review_evidence", attempt_status: "running", prompt_version: "prompt-v1", tool_version: "tools-v1", allowed_tools: [], guarded_tools: [], blocker_codes: ["missing_required_evidence"], suggested_action_codes: ["request_missing_evidence"], evidence_source_ids: [ids.evidence] }], error: null };
      }
      if (name === "record_agent_work_model_attempt_result") {
        return { data: null, error: { message: "write failed" } };
      }
      throw new Error(`Unexpected admin RPC: ${name}`);
    });

    const response = await (await loadHandler())(ledgerRequest());
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "attempt_result_recording_failed" });
  });

  it("records malformed provider output and returns a bounded error", async () => {
    completionCreateMock.mockResolvedValue({
      choices: [{ message: { content: "not-json" } }],
      usage: { prompt_tokens: 4, completion_tokens: 2 },
    });

    const response = await (await loadHandler())(ledgerRequest());
    expect(response.status).toBe(502);
    expect(rpcMock).toHaveBeenCalledWith(
      "record_agent_work_model_attempt_result",
      expect.objectContaining({ p_error_class: "model_output" }),
    );
  });

  it("fails closed when a provider failure cannot be recorded", async () => {
    completionCreateMock.mockRejectedValue(new Error("synthetic provider failure"));
    rpcMock.mockImplementation(async (name: string) => {
      if (name === "load_agent_work_runtime_policy") {
        return { data: [{ authoritative: true, runtimeMode: "advisory", actionsDisabled: false, killSwitchEnabled: false }], error: null };
      }
      if (name === "snapshot_agent_work_model_attempt") {
        return { data: [{ organization_id: ids.organization, client_id: ids.client, work_item_id: ids.workItem, step_id: ids.step, attempt_id: ids.attempt, workflow_key: "assessment.iehp.prepare_for_clinical_review", workflow_version: 1, step_key: "validate_review_evidence", attempt_status: "running", prompt_version: "prompt-v1", tool_version: "tools-v1", allowed_tools: [], guarded_tools: [], blocker_codes: ["missing_required_evidence"], suggested_action_codes: ["request_missing_evidence"], evidence_source_ids: [ids.evidence] }], error: null };
      }
      if (name === "record_agent_work_model_attempt_result") {
        return { data: null, error: { message: "write failed" } };
      }
      throw new Error(`Unexpected admin RPC: ${name}`);
    });

    const response = await (await loadHandler())(ledgerRequest());
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "attempt_result_recording_failed" });
    expect(rpcMock).toHaveBeenCalledWith(
      "record_agent_work_model_attempt_result",
      expect.objectContaining({ p_error_class: "provider", p_error_code: "upstream_unavailable" }),
    );
  });
});
