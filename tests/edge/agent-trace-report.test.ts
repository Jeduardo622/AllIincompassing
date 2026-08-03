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

  it("rejects PHI-like values even when they use an allowlisted diagnostic key", () => {
    expect(() => __TESTING__.sanitizeTraceRow({
      id: "trace-unsafe",
      request_id: "req-1",
      correlation_id: "corr-1",
      conversation_id: null,
      user_id: null,
      organization_id: "org-1",
      work_item_id: null,
      step_id: null,
      attempt_id: null,
      step_name: "llm.response.received",
      step_index: 1,
      status: "ok",
      payload: { provider: "jane@example.com" },
      replay_payload: null,
      created_at: "2026-08-02T00:00:00.000Z",
    })).toThrowError(/forbidden/i);
  });

  it("builds bounded operations metrics and release gates from ledger state", () => {
    const report = __TESTING__.buildAgentWorkOperationsReport({
      now: "2026-08-02T12:00:00.000Z",
      limit: 50,
      truncated: false,
      items: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          workflow_key: "assessment.iehp.prepare_for_clinical_review",
          workflow_version: 3,
          status: "blocked",
          created_at: "2026-08-02T08:00:00.000Z",
          updated_at: "2026-08-02T09:00:00.000Z",
          completed_at: null,
          failure_reason_code: "evidence_missing",
        },
        {
          id: "22222222-2222-4222-8222-222222222222",
          workflow_key: "assessment.iehp.prepare_for_clinical_review",
          workflow_version: 3,
          status: "completed",
          created_at: "2026-08-02T10:00:00.000Z",
          updated_at: "2026-08-02T11:00:00.000Z",
          completed_at: "2026-08-02T11:00:00.000Z",
          failure_reason_code: null,
        },
      ],
      steps: [
        {
          id: "31111111-1111-4111-8111-111111111111",
          work_item_id: "11111111-1111-4111-8111-111111111111",
          step_key: "wait_for_evidence",
          execution_mode: "deterministic",
          status: "waiting",
          attempt_count: 0,
          max_attempts: 3,
          lease_expires_at: null,
          updated_at: "2026-08-02T10:00:00.000Z",
          completed_at: null,
          last_error_code: null,
        },
        {
          id: "32222222-2222-4222-8222-222222222222",
          work_item_id: "11111111-1111-4111-8111-111111111111",
          step_key: "reconcile",
          execution_mode: "deterministic",
          status: "running",
          attempt_count: 3,
          max_attempts: 3,
          lease_expires_at: "2026-08-02T11:59:00.000Z",
          updated_at: "2026-08-02T11:00:00.000Z",
          completed_at: null,
          last_error_code: "retry_exhausted",
        },
        {
          id: "33333333-3333-4333-8333-333333333333",
          work_item_id: "22222222-2222-4222-8222-222222222222",
          step_key: "project_review_snapshot",
          execution_mode: "deterministic",
          status: "completed",
          attempt_count: 3,
          max_attempts: 3,
          lease_expires_at: null,
          updated_at: "2026-08-02T11:00:00.000Z",
          completed_at: "2026-08-02T11:00:00.000Z",
          last_error_code: null,
        },
      ],
      approvals: [{
        id: "41111111-1111-4111-8111-111111111111",
        work_item_id: "11111111-1111-4111-8111-111111111111",
        step_id: "31111111-1111-4111-8111-111111111111",
        status: "pending",
        approval_hash: null,
        requested_at: "2026-08-02T09:00:00.000Z",
        decided_at: null,
        expires_at: "2026-08-03T09:00:00.000Z",
        revoked_at: null,
        request_reason_code: "clinical_review",
      }],
      attempts: [{
        id: "51111111-1111-4111-8111-111111111111",
        work_item_id: "22222222-2222-4222-8222-222222222222",
        step_id: "33333333-3333-4333-8333-333333333333",
        status: "completed",
        provider: "local_stub",
        model: "deterministic_fixture",
        prompt_version: "prompt_v1",
        tool_version: "tool_v2",
        workflow_version: 3,
        model_request_schema_version: "schema_v1",
        input_token_count: 10,
        output_token_count: 5,
        computed_cost: 0,
        created_at: "2026-08-02T10:30:00.000Z",
        finished_at: "2026-08-02T11:00:00.000Z",
        error_code: null,
      }],
      effects: [{
        id: "61111111-1111-4111-8111-111111111111",
        work_item_id: "22222222-2222-4222-8222-222222222222",
        step_id: "33333333-3333-4333-8333-333333333333",
        attempt_id: "51111111-1111-4111-8111-111111111111",
        effect_kind: "review_snapshot",
        target_kind: "agent_work_step",
        target_id: "33333333-3333-4333-8333-333333333333",
        payload_hash: "a".repeat(64),
        unique_effect_key: "b".repeat(64),
        status: "verified",
        verified_at: "2026-08-02T11:00:00.000Z",
      }],
      evidence: [{
        id: "71111111-1111-4111-8111-111111111111",
        work_item_id: "22222222-2222-4222-8222-222222222222",
        step_id: "33333333-3333-4333-8333-333333333333",
        source_kind: "assessment_review_event",
        source_id: "81111111-1111-4111-8111-111111111111",
        sha256: "c".repeat(64),
        captured_at: "2026-08-02T10:45:00.000Z",
      }],
      events: [
        {
          id: "91111111-1111-4111-8111-111111111111",
          work_item_id: "11111111-1111-4111-8111-111111111111",
          step_id: "31111111-1111-4111-8111-111111111111",
          attempt_id: null,
          event_type: "assessment.iehp.prepare_for_clinical_review.parity_detected",
          sanitized_metadata: { reason_code: "status_mismatch" },
          created_at: "2026-08-02T10:00:00.000Z",
        },
        {
          id: "92222222-2222-4222-8222-222222222222",
          work_item_id: "22222222-2222-4222-8222-222222222222",
          step_id: "33333333-3333-4333-8333-333333333333",
          attempt_id: "51111111-1111-4111-8111-111111111111",
          event_type: "step.transitioned",
          sanitized_metadata: { to_status: "running", reason_code: "claimed" },
          created_at: "2026-08-02T10:00:00.000Z",
        },
        {
          id: "93333333-3333-4333-8333-333333333333",
          work_item_id: "22222222-2222-4222-8222-222222222222",
          step_id: "33333333-3333-4333-8333-333333333333",
          attempt_id: "51111111-1111-4111-8111-111111111111",
          event_type: "step.transitioned",
          sanitized_metadata: { to_status: "completed", reason_code: "postcondition_verified" },
          created_at: "2026-08-02T11:00:00.000Z",
        },
      ],
    });

    expect(report.schemaVersion).toBe("agent-work-operations.v1");
    expect(report.summary).toMatchObject({
      totalWorkItems: 2,
      blockedWorkItems: 1,
      waitingSteps: 1,
      staleLeases: 1,
      retryExhaustedSteps: 1,
      parityMismatches: 1,
      duplicateEffectsPrevented: 2,
      pendingApprovals: 1,
      oldestWaitingAgeSeconds: 7200,
      oldestApprovalAgeSeconds: 10800,
    });
    expect(report.releaseSignals).toMatchObject({
      crossTenantAccess: 0,
      falseCompletion: 0,
      unverifiedMutationEffects: 0,
      phiPayloadViolations: 0,
      approvalBypassOrStaleAcceptance: 0,
      unknownStateTransitions: 0,
      staleRunningBeyondSlo: 1,
      readinessEvidenceCoveragePercent: 100,
    });
    expect(report.aggregations.workflows).toEqual([
      expect.objectContaining({
        workflowKey: "assessment.iehp.prepare_for_clinical_review",
        workflowVersion: 3,
        count: 2,
      }),
    ]);
    expect(report.aggregations.models).toEqual([
      expect.objectContaining({
        provider: "local_stub",
        model: "deterministic_fixture",
        promptVersion: "prompt_v1",
        toolVersion: "tool_v2",
        workflowVersion: 3,
        count: 1,
      }),
    ]);
    expect(report.nonBlocking.clinicianAdministrativeTimeSeconds).toEqual({
      value: null,
      availability: "unavailable",
      reasonCode: "not_recorded",
    });
    expect(report.nonBlocking.timeInEachStateSeconds).toMatchObject({
      running: 3600,
      completed: 0,
    });
  });

  it("rejects PHI-like event diagnostics instead of returning free-form values", () => {
    expect(() => __TESTING__.sanitizeOperationalMetadata({
      reason_code: "contact_jane@example.com",
    })).toThrowError(/forbidden/i);
    expect(() => __TESTING__.sanitizeOperationalMetadata({
      prompt: "synthetic but forbidden raw prompt",
    })).toThrowError(/forbidden/i);
  });

  it("blocks release-gate evaluation for an incomplete bounded sample", () => {
    const report = __TESTING__.buildAgentWorkOperationsReport({
      now: "2026-08-02T12:00:00.000Z",
      limit: 500,
      truncated: true,
      crossTenantAccess: 0,
      items: [],
      steps: [],
      approvals: [],
      attempts: [],
      effects: [],
      evidence: [],
      events: [],
    });

    expect(report.sample).toEqual({
      limit: 500,
      truncated: true,
      releaseGateStatus: "blocked_incomplete_sample",
    });
    expect(report.releaseSignals).toEqual({
      crossTenantAccess: null,
      falseCompletion: null,
      unverifiedMutationEffects: null,
      phiPayloadViolations: null,
      approvalBypassOrStaleAcceptance: null,
      unknownStateTransitions: null,
      staleRunningBeyondSlo: null,
      readinessEvidenceCoveragePercent: null,
    });
  });

  it("builds an inert allowlisted replay packet with hashes and version evidence", () => {
    const packet = __TESTING__.buildAgentWorkReplayPacket({
      item: {
        id: "11111111-1111-4111-8111-111111111111",
        workflow_key: "assessment.iehp.prepare_for_clinical_review",
        workflow_version: 3,
        status: "needs_review",
      },
      steps: [{
        id: "21111111-1111-4111-8111-111111111111",
        work_item_id: "11111111-1111-4111-8111-111111111111",
        step_key: "project_review_snapshot",
        status: "completed",
      }],
      evidence: [{
        id: "31111111-1111-4111-8111-111111111111",
        work_item_id: "11111111-1111-4111-8111-111111111111",
        step_id: "21111111-1111-4111-8111-111111111111",
        source_kind: "assessment_review_event",
        source_id: "41111111-1111-4111-8111-111111111111",
        sha256: "a".repeat(64),
        captured_at: "2026-08-02T10:00:00.000Z",
      }],
      approvals: [{
        id: "51111111-1111-4111-8111-111111111111",
        work_item_id: "11111111-1111-4111-8111-111111111111",
        step_id: "21111111-1111-4111-8111-111111111111",
        status: "approved",
        approval_hash: "b".repeat(64),
        requested_at: "2026-08-02T10:00:00.000Z",
        decided_at: "2026-08-02T10:05:00.000Z",
        expires_at: "2026-08-03T10:00:00.000Z",
        revoked_at: null,
        request_reason_code: "clinical_review",
      }],
      attempts: [{
        id: "61111111-1111-4111-8111-111111111111",
        work_item_id: "11111111-1111-4111-8111-111111111111",
        step_id: "21111111-1111-4111-8111-111111111111",
        status: "completed",
        provider: "local_stub",
        model: "deterministic_fixture",
        prompt_version: "prompt_v1",
        tool_version: "tool_v1",
        workflow_version: 3,
        model_request_schema_version: "schema_v1",
        error_code: null,
        created_at: "2026-08-02T10:00:00.000Z",
        finished_at: "2026-08-02T10:05:00.000Z",
      }],
      effects: [{
        id: "71111111-1111-4111-8111-111111111111",
        work_item_id: "11111111-1111-4111-8111-111111111111",
        step_id: "21111111-1111-4111-8111-111111111111",
        attempt_id: "61111111-1111-4111-8111-111111111111",
        effect_kind: "review_snapshot",
        target_kind: "agent_work_step",
        target_id: "21111111-1111-4111-8111-111111111111",
        payload_hash: "c".repeat(64),
        unique_effect_key: "d".repeat(64),
        status: "verified",
        verified_at: "2026-08-02T10:05:00.000Z",
      }],
      events: [{
        id: "81111111-1111-4111-8111-111111111111",
        work_item_id: "11111111-1111-4111-8111-111111111111",
        step_id: "21111111-1111-4111-8111-111111111111",
        attempt_id: "61111111-1111-4111-8111-111111111111",
        event_type: "step.transitioned",
        sanitized_metadata: {
          to_status: "completed",
          reason_code: "postcondition_verified",
        },
        created_at: "2026-08-02T10:05:00.000Z",
      }],
      guardrails: [{
        attemptId: "61111111-1111-4111-8111-111111111111",
        outcome: "allowed",
      }],
    });

    expect(packet).toMatchObject({
      schemaVersion: "agent-work-replay.v1",
      executionAllowed: false,
      workflow: {
        key: "assessment.iehp.prepare_for_clinical_review",
        version: 3,
      },
      stateTransitions: [expect.objectContaining({ toStatus: "completed" })],
      evidence: [expect.objectContaining({ sha256: "a".repeat(64) })],
      approvals: [expect.objectContaining({ approvalHash: "b".repeat(64), status: "approved" })],
      attempts: [expect.objectContaining({
        provider: "local_stub",
        model: "deterministic_fixture",
        promptVersion: "prompt_v1",
        toolVersion: "tool_v1",
        guardrailOutcome: "allowed",
      })],
      effects: [expect.objectContaining({ status: "verified", verified: true })],
    });
    expect(JSON.stringify(packet)).not.toContain("prompt\"");
    expect(JSON.stringify(packet)).not.toContain("toolArguments");
  });

  it("rejects unsafe replay fields before serializing the service-role response", () => {
    const baseInput = {
      item: {
        id: "11111111-1111-4111-8111-111111111111",
        workflow_key: "assessment.iehp.prepare_for_clinical_review",
        workflow_version: 3,
        status: "needs_review",
      },
      steps: [],
      evidence: [],
      approvals: [],
      attempts: [],
      effects: [],
      events: [],
      guardrails: [],
    };

    expect(() => __TESTING__.buildAgentWorkReplayPacket({
      ...baseInput,
      effects: [{
        id: "71111111-1111-4111-8111-111111111111",
        work_item_id: baseInput.item.id,
        step_id: "21111111-1111-4111-8111-111111111111",
        attempt_id: null,
        effect_kind: "review_snapshot",
        target_kind: "agent_work_step",
        target_id: "21111111-1111-4111-8111-111111111111",
        payload_hash: "not-a-hash",
        unique_effect_key: "not-a-hash",
        status: "verified",
        verified_at: "2026-08-02T10:05:00.000Z",
      }],
    })).toThrowError(/hash/i);

    expect(() => __TESTING__.buildAgentWorkReplayPacket({
      ...baseInput,
      item: { ...baseInput.item, workflow_key: "unsafe workflow name" },
    })).toThrowError(/workflow/i);
  });
});
