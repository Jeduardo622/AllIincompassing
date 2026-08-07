import { describe, expect, it, vi, beforeEach } from "vitest";
import { callEdgeFunctionHttp } from "../api";
import {
  AGENT_WORKFLOW_KEYS,
  createCalOptimaDraftReviewWorkLedger,
  createIehpAssessmentPrepWorkLedger,
  createCalOptimaWorkLedgerQueryOptions,
  createAssessmentWorkLedgerQueryOptions,
  decideAgentWorkApproval,
  fetchAssessmentWorkLedger,
  requestAgentWorkApprovalHandoff,
} from "../agent-work-ledger";

vi.mock("../api", () => ({
  callEdgeFunctionHttp: vi.fn(),
}));

const mockedCallEdgeFunctionHttp = vi.mocked(callEdgeFunctionHttp);

const buildEnvelope = (overrides: Record<string, unknown> = {}) => ({
  success: true,
  data: [
    {
      id: "55555555-5555-4555-8555-555555555555",
      workflowKey: "assessment.iehp.prepare_for_clinical_review",
      workflowVersion: 1,
      objective: "Prepare this assessment for clinical review",
      status: "waiting",
      risk: "clinical",
      hasOwner: true,
      dueAt: null,
      blockers: [
        {
          code: "missing_required_evidence",
          stepKey: "request_clinical_review",
          action: "resolve_required_evidence",
        },
      ],
      steps: [
        {
          id: "66666666-6666-4666-8666-666666666666",
          key: "await_extraction",
          status: "waiting",
          executionMode: "deterministic",
          evidenceCount: 2,
          lastReasonCode: "waiting_for_extraction",
        },
      ],
      approvals: [
        {
          id: "77777777-7777-4777-8777-777777777777",
          stepId: "66666666-6666-4666-8666-666666666666",
          status: "pending",
          requiredRole: "bcba",
          expiresAt: null,
          requestedAt: "2026-08-02T12:00:00.000Z",
          evidenceCount: 2,
          evidenceHashSuffix: "89abcdef",
          canDecide: true,
        },
      ],
      updatedAt: "2026-08-02T12:00:00.000Z",
    },
  ],
  meta: {
    runtimeMode: "advisory",
  },
  ...overrides,
});

describe("agent-work-ledger client", () => {
  beforeEach(() => {
    mockedCallEdgeFunctionHttp.mockReset();
  });

  it("fetches the read-only work item list through the authenticated edge path and forwards AbortSignal", async () => {
    mockedCallEdgeFunctionHttp.mockResolvedValue(
      new Response(JSON.stringify(buildEnvelope()), { status: 200 }),
    );

    const controller = new AbortController();
    const result = await fetchAssessmentWorkLedger({
      assessmentDocumentId: "44444444-4444-4444-8444-444444444444",
      signal: controller.signal,
    });

    expect(mockedCallEdgeFunctionHttp).toHaveBeenCalledWith(
      "agent-work-items?assessment_document_id=44444444-4444-4444-8444-444444444444&workflow_key=assessment.iehp.prepare_for_clinical_review",
      expect.objectContaining({
        method: "GET",
        signal: controller.signal,
      }),
    );
    expect(result).toMatchObject({
      kind: "available",
      runtimeMode: "advisory",
      item: {
        status: "waiting",
        objective: "Prepare this assessment for clinical review",
      },
    });
  });

  it("normalizes disabled runtime mode from the edge error envelope", async () => {
    mockedCallEdgeFunctionHttp.mockResolvedValue(
      new Response(
        JSON.stringify({
          success: false,
          error: "Runtime mode disabled",
          code: "runtime_mode_disabled",
        }),
        { status: 403 },
      ),
    );

    await expect(
      fetchAssessmentWorkLedger({
        assessmentDocumentId: "44444444-4444-4444-8444-444444444444",
      }),
    ).resolves.toEqual({ kind: "disabled" });
  });

  it("normalizes unauthorized responses without exposing raw response bodies", async () => {
    mockedCallEdgeFunctionHttp.mockResolvedValue(
      new Response(
        JSON.stringify({
          success: false,
          error: "Unauthorized",
          code: "unauthorized",
        }),
        { status: 401 },
      ),
    );

    await expect(
      fetchAssessmentWorkLedger({
        assessmentDocumentId: "44444444-4444-4444-8444-444444444444",
      }),
    ).resolves.toEqual({ kind: "unauthorized" });
  });

  it("normalizes non-disabled forbidden responses separately from session loss", async () => {
    mockedCallEdgeFunctionHttp.mockResolvedValue(
      new Response(
        JSON.stringify({
          success: false,
          error: "Forbidden",
          code: "forbidden",
        }),
        { status: 403 },
      ),
    );

    await expect(
      fetchAssessmentWorkLedger({
        assessmentDocumentId: "44444444-4444-4444-8444-444444444444",
      }),
    ).resolves.toEqual({ kind: "forbidden" });
  });

  it("normalizes an empty advisory list as no-ledger instead of unavailable", async () => {
    mockedCallEdgeFunctionHttp.mockResolvedValue(
      new Response(JSON.stringify(buildEnvelope({ data: [] })), { status: 200 }),
    );

    await expect(
      fetchAssessmentWorkLedger({
        assessmentDocumentId: "44444444-4444-4444-8444-444444444444",
      }),
    ).resolves.toEqual({
      kind: "no-ledger",
      runtimeMode: "advisory",
    });
  });

  it("fails closed on strict DTO mismatches and returns a sanitized unavailable state", async () => {
    mockedCallEdgeFunctionHttp.mockResolvedValue(
      new Response(
        JSON.stringify(
          buildEnvelope({
            data: [
              {
                ...buildEnvelope().data[0],
                extra: "leak-me",
              },
            ],
          }),
        ),
        { status: 200 },
      ),
    );

    const result = await fetchAssessmentWorkLedger({
      assessmentDocumentId: "44444444-4444-4444-8444-444444444444",
    });

    expect(result).toEqual({ kind: "unavailable" });
  });

  it("normalizes aborts distinctly from other transport failures", async () => {
    mockedCallEdgeFunctionHttp.mockRejectedValue(new DOMException("Aborted", "AbortError"));

    await expect(
      fetchAssessmentWorkLedger({
        assessmentDocumentId: "44444444-4444-4444-8444-444444444444",
      }),
    ).resolves.toEqual({ kind: "aborted" });
  });

  it("uses a query key scoped by organization, client, document, and auth identity with zero cache times", () => {
    const options = createAssessmentWorkLedgerQueryOptions({
      organizationId: "org-1",
      clientId: "client-1",
      assessmentDocumentId: "44444444-4444-4444-8444-444444444444",
      authIdentity: "user-1",
    });

    expect(options.queryKey).toEqual([
      "assessment-work-ledger",
      AGENT_WORKFLOW_KEYS.iehpAssessmentPrep,
      "org-1",
      "client-1",
      "44444444-4444-4444-8444-444444444444",
      "user-1",
    ]);
    expect(options.staleTime).toBe(0);
    expect(options.gcTime).toBe(0);
  });

  it("defaults GET/query workflow scoping to IEHP, isolates cache by workflow key, and creates CalOptima draft-review work items through a fixed POST contract", async () => {
    expect(AGENT_WORKFLOW_KEYS.caloptimaDraftReview).toBe(
      "assessment.caloptima.prepare_draft_review",
    );
    mockedCallEdgeFunctionHttp
      .mockResolvedValueOnce(
        new Response(JSON.stringify(buildEnvelope()), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify(
            {
              success: true,
              data: {
                ...buildEnvelope().data[0],
                workflowKey: AGENT_WORKFLOW_KEYS.caloptimaDraftReview,
                objective: "Prepare approved CalOptima assessment evidence as a draft program/goal packet for human review.",
              },
              meta: {
                runtimeMode: "advisory",
              },
            },
          ),
          { status: 201 },
        ),
      );

    await expect(
      fetchAssessmentWorkLedger({
        assessmentDocumentId: "44444444-4444-4444-8444-444444444444",
      }),
    ).resolves.toMatchObject({
      kind: "available",
      item: {
        workflowKey: AGENT_WORKFLOW_KEYS.iehpAssessmentPrep,
      },
    });

    expect(mockedCallEdgeFunctionHttp).toHaveBeenNthCalledWith(
      1,
      "agent-work-items?assessment_document_id=44444444-4444-4444-8444-444444444444&workflow_key=assessment.iehp.prepare_for_clinical_review",
      expect.objectContaining({
        method: "GET",
      }),
    );

    const defaultOptions = createAssessmentWorkLedgerQueryOptions({
      organizationId: "org-1",
      clientId: "client-1",
      assessmentDocumentId: "44444444-4444-4444-8444-444444444444",
      authIdentity: "user-1",
    });

    const calOptimaOptions = createCalOptimaWorkLedgerQueryOptions({
      organizationId: "org-1",
      clientId: "client-1",
      assessmentDocumentId: "44444444-4444-4444-8444-444444444444",
      authIdentity: "user-1",
    });

    expect(defaultOptions.queryKey).toEqual([
      "assessment-work-ledger",
      AGENT_WORKFLOW_KEYS.iehpAssessmentPrep,
      "org-1",
      "client-1",
      "44444444-4444-4444-8444-444444444444",
      "user-1",
    ]);
    expect(calOptimaOptions.queryKey).toEqual([
      "assessment-work-ledger",
      AGENT_WORKFLOW_KEYS.caloptimaDraftReview,
      "org-1",
      "client-1",
      "44444444-4444-4444-8444-444444444444",
      "user-1",
    ]);

    await expect(
      createCalOptimaDraftReviewWorkLedger({
        assessmentDocumentId: "44444444-4444-4444-8444-444444444444",
      }),
    ).resolves.toMatchObject({
      workflowKey: AGENT_WORKFLOW_KEYS.caloptimaDraftReview,
      objective: "Prepare approved CalOptima assessment evidence as a draft program/goal packet for human review.",
    });

    expect(mockedCallEdgeFunctionHttp).toHaveBeenNthCalledWith(
      2,
      "agent-work-items/caloptima-draft-review",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assessmentDocumentId: "44444444-4444-4444-8444-444444444444",
        }),
      }),
    );
  });

  it("creates IEHP assessment-prep work items through the authenticated fixed POST contract without arbitrary payload fields", async () => {
    mockedCallEdgeFunctionHttp.mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            ...buildEnvelope().data[0],
            workflowKey: AGENT_WORKFLOW_KEYS.iehpAssessmentPrep,
            workflowVersion: 1,
          },
          meta: {
            runtimeMode: "advisory",
          },
        }),
        { status: 201 },
      ),
    );

    await expect(
      createIehpAssessmentPrepWorkLedger({
        assessmentDocumentId: "44444444-4444-4444-8444-444444444444",
      }),
    ).resolves.toMatchObject({
      workflowKey: AGENT_WORKFLOW_KEYS.iehpAssessmentPrep,
      workflowVersion: 1,
    });

    expect(mockedCallEdgeFunctionHttp).toHaveBeenCalledWith(
      "agent-work-items/assessment-prep",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assessmentDocumentId: "44444444-4444-4444-8444-444444444444",
          workflowVersion: 1,
        }),
      }),
    );
  });

  it("sanitizes IEHP assessment-prep create failures instead of exposing backend error bodies", async () => {
    mockedCallEdgeFunctionHttp.mockResolvedValue(
      new Response(
        JSON.stringify({
          success: false,
          error: "Tenant scope mismatch: org-1/client-1/document-9",
          code: "tenant_scope_mismatch",
        }),
        { status: 403 },
      ),
    );

    await expect(
      createIehpAssessmentPrepWorkLedger({
        assessmentDocumentId: "44444444-4444-4444-8444-444444444444",
      }),
    ).rejects.toThrow("Assessment-prep work item creation failed");
  });

  it("posts a bounded advisory approval decision and validates the sanitized response", async () => {
    const approval = buildEnvelope().data[0].approvals[0];
    mockedCallEdgeFunctionHttp.mockResolvedValue(new Response(JSON.stringify({
      success: true,
      data: {
        ...approval,
        status: "approved",
        evidenceCount: null,
        evidenceHashSuffix: null,
        canDecide: false,
      },
      meta: { outcome: "decided" },
    }), { status: 200 }));

    await expect(decideAgentWorkApproval({
      workItemId: "55555555-5555-4555-8555-555555555555",
      approvalId: "77777777-7777-4777-8777-777777777777",
      decision: "approve",
      reasonCode: "clinical_review_accepted",
    })).resolves.toMatchObject({ status: "approved", evidenceHashSuffix: null });
    expect(mockedCallEdgeFunctionHttp).toHaveBeenCalledWith(
      "agent-work-items/55555555-5555-4555-8555-555555555555/approvals/77777777-7777-4777-8777-777777777777/decision",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ decision: "approve", reasonCode: "clinical_review_accepted" }),
      }),
    );
  });

  it("requests a hash-bound human handoff through the fixed owner route", async () => {
    const approval = buildEnvelope().data[0].approvals[0];
    mockedCallEdgeFunctionHttp.mockResolvedValue(new Response(JSON.stringify({
      success: true,
      data: approval,
    }), { status: 201 }));

    await expect(requestAgentWorkApprovalHandoff({
      workItemId: "55555555-5555-4555-8555-555555555555",
      stepId: "66666666-6666-4666-8666-666666666666",
      assignedOwnerUserId: "11111111-1111-4111-8111-111111111111",
      reasonCode: "clinical_review_handoff",
      expiresAt: "2026-08-10T12:00:00.000Z",
    })).resolves.toMatchObject({ id: approval.id, status: "pending" });

    expect(mockedCallEdgeFunctionHttp).toHaveBeenCalledWith(
      "agent-work-items/55555555-5555-4555-8555-555555555555/owner",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          stepId: "66666666-6666-4666-8666-666666666666",
          assignedOwnerUserId: "11111111-1111-4111-8111-111111111111",
          reasonCode: "clinical_review_handoff",
          expiresAt: "2026-08-10T12:00:00.000Z",
        }),
      }),
    );
  });
});
