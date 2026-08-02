import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { __TESTING__ } from "../../supabase/functions/agent-trace-report/index.ts";

describe("agent-trace-report utility", () => {
  it("parses selectors from POST payload", () => {
    const req = new Request("https://example.test/functions/v1/agent-trace-report", {
      method: "POST",
    });

    const selector = __TESTING__.parseSelector(req, {
      correlationId: "corr-123",
      requestId: "req-123",
      agentOperationId: "op-123",
    });

    expect(selector).toEqual({
      correlationId: "corr-123",
      requestId: "req-123",
      agentOperationId: "op-123",
    });
  });

  it("throws when selector is missing", () => {
    const req = new Request("https://example.test/functions/v1/agent-trace-report", {
      method: "GET",
    });

    expect(() => __TESTING__.parseSelector(req, {})).toThrowError(Response);
  });

  it("does not query the tenantless idempotency store", () => {
    const source = readFileSync(
      path.join(process.cwd(), "supabase", "functions", "agent-trace-report", "index.ts"),
      "utf8",
    );
    expect(source).not.toContain("function_idempotency_keys");
  });

  it("scopes trace rows to the current organization", () => {
    const rows = __TESTING__.scopeRowsToOrganization(
      [
        { id: "trace-1", organization_id: "org-1" },
        { id: "trace-2", organization_id: "org-2" },
      ],
      "org-1",
    );

    expect(rows).toEqual([{ id: "trace-1", organization_id: "org-1" }]);
  });

  it("returns only sanitized operational trace fields", () => {
    const trace = __TESTING__.sanitizeTraceRow({
      id: "trace-1",
      request_id: "req-1",
      correlation_id: "corr-1",
      conversation_id: "conversation-secret",
      user_id: "user-secret",
      organization_id: "org-1",
      work_item_id: "work-1",
      step_id: "step-1",
      attempt_id: "attempt-1",
      step_name: "llm.response.received",
      step_index: 3,
      status: "ok",
      payload: {
        prompt: "sensitive source prompt",
        rawModelOutput: "sensitive model output",
        latencyMs: 25,
        computedCost: 0.00015,
        attemptNumber: 2,
        tokenUsage: { input: 10, output: 5 },
        outcome: "candidate_evidence",
        guardrailResult: "allowed",
        promptVersion: "prompt-v1",
        toolVersion: "tools-v1",
        modelRequestSchemaVersion: "schema-v1",
        pricingVersion: "pricing-v1",
        errorClass: "retryable",
        errorCode: "provider_timeout",
      },
      replay_payload: { toolArguments: { client_id: "secret" } },
      created_at: "2026-08-02T00:00:00.000Z",
    });

    expect(trace).toEqual({
      id: "trace-1",
      requestId: "req-1",
      correlationId: "corr-1",
      workItemId: "work-1",
      stepId: "step-1",
      attemptId: "attempt-1",
      stepName: "llm.response.received",
      stepIndex: 3,
      status: "ok",
      createdAt: "2026-08-02T00:00:00.000Z",
      diagnostics: {
        latencyMs: 25,
        computedCost: 0.00015,
        attemptNumber: 2,
        tokenUsage: { input: 10, output: 5 },
        outcome: "candidate_evidence",
        guardrailResult: "allowed",
        promptVersion: "prompt-v1",
        toolVersion: "tools-v1",
        modelRequestSchemaVersion: "schema-v1",
        pricingVersion: "pricing-v1",
        errorClass: "retryable",
        errorCode: "provider_timeout",
      },
    });
    expect(JSON.stringify(trace)).not.toContain("sensitive");
    expect(JSON.stringify(trace)).not.toContain("toolArguments");
  });
});
