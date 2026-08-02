import { describe, expect, it, vi, beforeEach } from "vitest";
import { callEdgeFunctionHttp } from "../api";
import {
  createAssessmentWorkLedgerQueryOptions,
  fetchAssessmentWorkLedger,
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
      ownerUserId: "11111111-1111-4111-8111-111111111111",
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
      "agent-work-items?assessment_document_id=44444444-4444-4444-8444-444444444444",
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
      "org-1",
      "client-1",
      "44444444-4444-4444-8444-444444444444",
      "user-1",
    ]);
    expect(options.staleTime).toBe(0);
    expect(options.gcTime).toBe(0);
  });
});
