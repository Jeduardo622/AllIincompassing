import { beforeEach, describe, expect, it, vi } from "vitest";
import { payrollApprovalsHandler } from "../api/payroll-approvals";

vi.mock("../api/shared", async () => {
  const actual = await vi.importActual<typeof import("../api/shared")>("../api/shared");
  return {
    ...actual,
    consumeRateLimit: vi.fn(),
    fetchAuthenticatedUserIdWithStatus: vi.fn(),
    fetchJson: vi.fn(),
    getAccessToken: vi.fn(),
    getSupabaseConfig: vi.fn(),
    resolveOrgAndRoleWithStatus: vi.fn(),
    resolveUserRoleWithStatus: vi.fn(),
  };
});

vi.mock("../api/edgeAuthority", async () => {
  const actual = await vi.importActual<typeof import("../api/edgeAuthority")>("../api/edgeAuthority");
  return {
    ...actual,
    getApiAuthorityMode: vi.fn(),
    proxyToEdgeAuthority: vi.fn(),
  };
});

import {
  consumeRateLimit,
  fetchAuthenticatedUserIdWithStatus,
  fetchJson,
  getAccessToken,
  getSupabaseConfig,
  resolveOrgAndRoleWithStatus,
  resolveUserRoleWithStatus,
} from "../api/shared";
import { getApiAuthorityMode, proxyToEdgeAuthority } from "../api/edgeAuthority";

const createAuthToken = (subject = "bt-user-1") => {
  const payload = Buffer.from(JSON.stringify({ sub: subject }), "utf8").toString("base64url");
  return `header.${payload}.signature`;
};

async function readJson(response: Response) {
  return await response.json() as Record<string, unknown>;
}

describe("payrollApprovalsHandler", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getAccessToken).mockReturnValue(createAuthToken());
    vi.mocked(consumeRateLimit).mockResolvedValue({
      limited: false,
      retryAfterSeconds: null,
      mode: "memory",
    });
    vi.mocked(resolveOrgAndRoleWithStatus).mockResolvedValue({
      organizationId: "org-1",
      isTherapist: false,
      isAdmin: false,
      isOrgMember: false,
      isSuperAdmin: false,
      upstreamError: false,
    });
    vi.mocked(fetchAuthenticatedUserIdWithStatus).mockResolvedValue({
      userId: "bt-user-1",
      upstreamError: false,
    });
    vi.mocked(resolveUserRoleWithStatus).mockResolvedValue({
      role: "bt",
      upstreamError: false,
    });
    vi.mocked(getSupabaseConfig).mockReturnValue({
      supabaseUrl: "https://example.supabase.co",
      anonKey: "anon-key",
    });
  });

  it("rejects unsupported payroll roles before forwarding or calling legacy RPCs", async () => {
    vi.mocked(getApiAuthorityMode).mockReturnValue("legacy");
    vi.mocked(resolveUserRoleWithStatus).mockResolvedValueOnce({
      role: "client",
      upstreamError: false,
    });

    const response = await payrollApprovalsHandler(
      new Request("http://localhost/api/payroll-approvals", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${createAuthToken()}`,
          "Idempotency-Key": "approval-role-key",
        },
        body: JSON.stringify({
          action: "submit",
          snapshotId: "11111111-1111-1111-1111-111111111111",
          snapshotHash: "a".repeat(64),
          attestation: true,
        }),
      }),
    );

    expect(response.status).toBe(403);
    expect(vi.mocked(proxyToEdgeAuthority)).not.toHaveBeenCalled();
    expect(vi.mocked(fetchJson)).not.toHaveBeenCalled();
  });

  it("proxies to edge authority and preserves protected approval headers", async () => {
    vi.mocked(getApiAuthorityMode).mockReturnValue("edge");
    vi.mocked(proxyToEdgeAuthority).mockResolvedValue(
      new Response(JSON.stringify({
        transitionId: "22222222-2222-2222-2222-222222222222",
        snapshotId: "11111111-1111-1111-1111-111111111111",
        snapshotHash: "a".repeat(64),
        canonicalSnapshotHash: "a".repeat(64),
        action: "submitted",
        previousTransitionId: null,
        replayed: false,
        occurredAt: "2026-08-12T18:00:00.000Z",
        idempotencyKey: "client-approval-key",
      }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "client-approval-key",
          "Idempotent-Replay": "false",
          "x-request-id": "edge-request-id",
        },
      }),
    );

    const request = new Request("http://localhost/api/payroll-approvals", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${createAuthToken()}`,
        "Idempotency-Key": "client-approval-key",
        "x-request-id": "request-1",
      },
      body: JSON.stringify({
        action: "submit",
        snapshotId: "11111111-1111-1111-1111-111111111111",
        snapshotHash: "a".repeat(64),
        attestation: true,
      }),
    });

    const response = await payrollApprovalsHandler(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("Idempotency-Key")).toBe("client-approval-key");
    expect(response.headers.get("Idempotent-Replay")).toBe("false");
    expect(response.headers.get("x-request-id")).toBe("edge-request-id");
  });

  it("returns an edge-authority review queue without mutation idempotency headers", async () => {
    vi.mocked(getApiAuthorityMode).mockReturnValue("edge");
    vi.mocked(proxyToEdgeAuthority).mockResolvedValue(
      new Response(JSON.stringify({
        state: "ok",
        selectedLocalDate: "2026-08-12",
        capabilities: {
          canReviewAssigned: true,
          canApproveAssigned: false,
          canViewCompensation: false,
          hasOrgPayrollAccess: false,
        },
        queue: [],
      }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "x-request-id": "edge-review-queue",
        },
      }),
    );

    const response = await payrollApprovalsHandler(
      new Request("http://localhost/api/payroll-approvals", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${createAuthToken()}`,
          "x-request-id": "node-review-queue",
        },
        body: JSON.stringify({
          action: "review_queue",
          selectedLocalDate: "2026-08-12",
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ state: "ok", queue: [] });
    expect(response.headers.get("Idempotency-Key")).toBeNull();
    expect(response.headers.get("Idempotent-Replay")).toBeNull();
    expect(response.headers.get("x-request-id")).toBe("edge-review-queue");
  });

  it("calls get_payroll_self_approval in legacy mode without Idempotency-Key requirements", async () => {
    vi.mocked(getApiAuthorityMode).mockReturnValue("legacy");
    vi.mocked(fetchJson).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        state: "ok",
        selectedLocalDate: "2026-08-12",
        approval: {
          currentState: "submitted",
          submittedAt: null,
          returnedComment: null,
          unresolvedBlockerCount: 0,
          snapshot: {
            id: "11111111-1111-1111-1111-111111111111",
            hash: "a".repeat(64),
            isCurrent: true,
          },
          actions: {
            canSubmit: true,
          },
          history: [],
        },
      },
    });

    const response = await payrollApprovalsHandler(
      new Request("http://localhost/api/payroll-approvals", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${createAuthToken()}`,
        },
        body: JSON.stringify({
          action: "self_approval",
          selectedLocalDate: "2026-08-12",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(vi.mocked(fetchJson)).toHaveBeenCalledWith(
      "https://example.supabase.co/rest/v1/rpc/get_payroll_self_approval",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          selected_local_date: "2026-08-12",
        }),
      }),
    );
    expect(response.headers.get("Idempotency-Key")).toBeNull();
    expect(response.headers.get("Idempotent-Replay")).toBeNull();
  });

  it("returns edge-authority review details without mutation idempotency headers", async () => {
    vi.mocked(getApiAuthorityMode).mockReturnValue("edge");
    vi.mocked(proxyToEdgeAuthority).mockResolvedValue(
      new Response(JSON.stringify({
        state: "ok",
        snapshotId: "11111111-1111-1111-1111-111111111111",
        snapshotHash: "a".repeat(64),
        periodStart: "2026-08-10",
        periodEnd: "2026-08-16",
        punches: [],
        classifiedSeconds: { regular: 0, overtime: 0, doubleTime: 0 },
        approvalHistory: [],
        blockers: [],
        unresolvedBlockerCount: 0,
      }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "x-request-id": "edge-review-details",
        },
      }),
    );

    const response = await payrollApprovalsHandler(
      new Request("http://localhost/api/payroll-approvals", {
        method: "POST",
        headers: { Authorization: `Bearer ${createAuthToken()}` },
        body: JSON.stringify({
          action: "review_details",
          snapshotId: "11111111-1111-1111-1111-111111111111",
          snapshotHash: "a".repeat(64),
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      state: "ok",
      snapshotId: "11111111-1111-1111-1111-111111111111",
    });
    expect(response.headers.get("Idempotency-Key")).toBeNull();
    expect(response.headers.get("Idempotent-Replay")).toBeNull();
    expect(response.headers.get("x-request-id")).toBe("edge-review-details");
  });

  it("rejects non-lowercase SHA-256 review snapshot hashes before edge forwarding", async () => {
    vi.mocked(getApiAuthorityMode).mockReturnValue("edge");

    const response = await payrollApprovalsHandler(
      new Request("http://localhost/api/payroll-approvals", {
        method: "POST",
        headers: { Authorization: `Bearer ${createAuthToken()}` },
        body: JSON.stringify({
          action: "review_details",
          snapshotId: "11111111-1111-1111-1111-111111111111",
          snapshotHash: "A".repeat(64),
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(vi.mocked(proxyToEdgeAuthority)).not.toHaveBeenCalled();
  });

  it("rejects recursive authority injection before any RPC call", async () => {
    vi.mocked(getApiAuthorityMode).mockReturnValue("legacy");

    const response = await payrollApprovalsHandler(
      new Request("http://localhost/api/payroll-approvals", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${createAuthToken()}`,
          "Idempotency-Key": "approval-authority-key",
        },
        body: JSON.stringify({
          action: "manager_approve",
          snapshotId: "11111111-1111-1111-1111-111111111111",
          snapshotHash: "a".repeat(64),
          nested: {
            employmentProfileId: "33333333-3333-3333-3333-333333333333",
          },
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(vi.mocked(fetchJson)).not.toHaveBeenCalled();
  });

  it("calls transition_timesheet_approval in legacy mode with exact RPC args only", async () => {
    vi.mocked(getApiAuthorityMode).mockReturnValue("legacy");
    vi.mocked(fetchJson).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        transitionId: "22222222-2222-2222-2222-222222222222",
        snapshotId: "11111111-1111-1111-1111-111111111111",
        snapshotHash: "a".repeat(64),
        canonicalSnapshotHash: "a".repeat(64),
        action: "submitted",
        previousTransitionId: null,
        replayed: false,
        occurredAt: "2026-08-12T18:00:00.000Z",
        idempotencyKey: "approval-submit-key",
      },
    });

    const response = await payrollApprovalsHandler(
      new Request("http://localhost/api/payroll-approvals", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${createAuthToken()}`,
          "Idempotency-Key": "approval-submit-key",
        },
        body: JSON.stringify({
          action: "submit",
          snapshotId: "11111111-1111-1111-1111-111111111111",
          snapshotHash: "a".repeat(64),
          attestation: true,
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(vi.mocked(fetchJson)).toHaveBeenCalledWith(
      "https://example.supabase.co/rest/v1/rpc/transition_timesheet_approval",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          apikey: "anon-key",
          Authorization: `Bearer ${createAuthToken()}`,
        }),
        body: JSON.stringify({
          p_payload: {
            action: "submit",
            snapshotId: "11111111-1111-1111-1111-111111111111",
            snapshotHash: "a".repeat(64),
            attestation: true,
          },
          p_idempotency_key: "approval-submit-key",
        }),
      }),
    );
  });

  it("calls get_payroll_review_queue in legacy mode without Idempotency-Key requirements", async () => {
    vi.mocked(getApiAuthorityMode).mockReturnValue("legacy");
    vi.mocked(fetchJson).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        state: "ok",
        selectedLocalDate: "2026-08-12",
        queue: [],
        capabilities: {
          canReviewAssigned: true,
          canApproveAssigned: false,
          canViewCompensation: false,
          hasOrgPayrollAccess: false,
        },
      },
    });

    const response = await payrollApprovalsHandler(
      new Request("http://localhost/api/payroll-approvals", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${createAuthToken()}`,
        },
        body: JSON.stringify({
          action: "review_queue",
          selectedLocalDate: "2026-08-12",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(vi.mocked(fetchJson)).toHaveBeenCalledWith(
      "https://example.supabase.co/rest/v1/rpc/get_payroll_review_queue",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          selected_local_date: "2026-08-12",
        }),
      }),
    );
  });

  it("calls get_payroll_review_details in legacy mode with exact snapshot binding and no mutation headers", async () => {
    vi.mocked(getApiAuthorityMode).mockReturnValue("legacy");
    vi.mocked(fetchJson).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        state: "ok",
        snapshotId: "11111111-1111-1111-1111-111111111111",
        snapshotHash: "a".repeat(64),
        periodStart: "2026-08-10",
        periodEnd: "2026-08-16",
        approvalHistory: [],
        punches: [],
        blockers: [],
        classifiedSeconds: {
          regular: 0,
          overtime: 0,
          doubleTime: 0,
        },
        unresolvedBlockerCount: 0,
      },
    });

    const response = await payrollApprovalsHandler(
      new Request("http://localhost/api/payroll-approvals", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${createAuthToken()}`,
        },
        body: JSON.stringify({
          action: "review_details",
          snapshotId: "11111111-1111-1111-1111-111111111111",
          snapshotHash: "a".repeat(64),
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(vi.mocked(fetchJson)).toHaveBeenCalledWith(
      "https://example.supabase.co/rest/v1/rpc/get_payroll_review_details",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          snapshot_id: "11111111-1111-1111-1111-111111111111",
          snapshot_hash: "a".repeat(64),
        }),
      }),
    );
  });

  it("calls resolve_payroll_blocker in legacy mode with exact blocker RPC args only", async () => {
    vi.mocked(getApiAuthorityMode).mockReturnValue("legacy");
    vi.mocked(fetchJson).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        resolutionId: "44444444-4444-4444-4444-444444444444",
        blockerType: "timekeeping_exception",
        blockerId: "55555555-5555-5555-5555-555555555555",
        payPeriodId: "66666666-6666-6666-6666-666666666666",
        action: "resolved",
        previousResolutionId: null,
        replayed: false,
        occurredAt: "2026-08-12T18:05:00.000Z",
        idempotencyKey: "approval-blocker-key",
      },
    });

    const response = await payrollApprovalsHandler(
      new Request("http://localhost/api/payroll-approvals", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${createAuthToken()}`,
          "Idempotency-Key": "approval-blocker-key",
        },
        body: JSON.stringify({
          action: "resolve_blocker",
          snapshotId: "11111111-1111-1111-1111-111111111111",
          snapshotHash: "a".repeat(64),
          blockerType: "timekeeping_exception",
          blockerId: "55555555-5555-5555-5555-555555555555",
          resolution: "resolved",
          reason: "Reviewed and corrected.",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(vi.mocked(fetchJson)).toHaveBeenCalledWith(
      "https://example.supabase.co/rest/v1/rpc/resolve_payroll_blocker",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          p_payload: {
            snapshotId: "11111111-1111-1111-1111-111111111111",
            snapshotHash: "a".repeat(64),
            blockerType: "timekeeping_exception",
            blockerId: "55555555-5555-5555-5555-555555555555",
            action: "resolved",
            reason: "Reviewed and corrected.",
          },
          p_idempotency_key: "approval-blocker-key",
        }),
      }),
    );
  });

  it("fails closed when the legacy blocker RPC response omits the authoritative idempotency echo", async () => {
    vi.mocked(getApiAuthorityMode).mockReturnValue("legacy");
    vi.mocked(fetchJson).mockResolvedValue({
      ok: true,
      status: 200,
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
    });

    const response = await payrollApprovalsHandler(
      new Request("http://localhost/api/payroll-approvals", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${createAuthToken()}`,
          "Idempotency-Key": "approval-blocker-key",
        },
        body: JSON.stringify({
          action: "resolve_blocker",
          snapshotId: "11111111-1111-1111-1111-111111111111",
          snapshotHash: "a".repeat(64),
          blockerType: "timekeeping_exception",
          blockerId: "55555555-5555-5555-5555-555555555555",
          resolution: "resolved",
          reason: "Reviewed and corrected.",
        }),
      }),
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      code: "invalid_response",
      error: "Invalid payroll approval response.",
    }));
    expect(response.headers.get("Idempotency-Key")).toBeNull();
    expect(response.headers.get("Idempotent-Replay")).toBeNull();
  });

  it("maps feature_disabled approval failures to an explicit typed response", async () => {
    vi.mocked(getApiAuthorityMode).mockReturnValue("legacy");
    vi.mocked(fetchJson).mockResolvedValue({
      ok: false,
      status: 403,
      data: {
        code: "42501",
        message: "payroll approval workflow is feature_disabled",
      },
    });

    const response = await payrollApprovalsHandler(
      new Request("http://localhost/api/payroll-approvals", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${createAuthToken()}`,
          "Idempotency-Key": "approval-feature-key",
        },
        body: JSON.stringify({
          action: "lock",
          snapshotId: "11111111-1111-1111-1111-111111111111",
          snapshotHash: "a".repeat(64),
        }),
      }),
    );

    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      code: "feature_disabled",
      state: "feature_disabled",
      idempotencyKey: "approval-feature-key",
    }));
    expect(response.status).toBe(403);
  });

  it("keeps 23514 state conflict envelopes identical across legacy node and node-edge mode", async () => {
    vi.mocked(getApiAuthorityMode).mockReturnValue("legacy");
    vi.mocked(fetchJson).mockResolvedValueOnce({
      ok: false,
      status: 409,
      data: {
        code: "23514",
        message: "approval transition violates current workflow state",
      },
    });

    const request = new Request("http://localhost/api/payroll-approvals", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${createAuthToken()}`,
        "Idempotency-Key": "approval-state-key",
        "x-request-id": "state-request-id",
      },
      body: JSON.stringify({
        action: "lock",
        snapshotId: "11111111-1111-1111-1111-111111111111",
        snapshotHash: "a".repeat(64),
      }),
    });

    const legacyResponse = await payrollApprovalsHandler(request.clone());
    const legacyBody = await readJson(legacyResponse);

    vi.mocked(getApiAuthorityMode).mockReturnValue("edge");
    vi.mocked(proxyToEdgeAuthority).mockResolvedValueOnce(
      new Response(JSON.stringify({
        success: false,
        error: "Payroll state conflict.",
        requestId: "state-request-id",
        code: "state_conflict",
        message: "Payroll state conflict.",
        classification: {
          category: "request",
          severity: "medium",
          retryable: false,
          httpStatus: 409,
        },
        idempotencyKey: "approval-state-key",
      }), {
        status: 409,
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "approval-state-key",
        },
      }),
    );

    const edgeModeResponse = await payrollApprovalsHandler(request.clone());
    const edgeModeBody = await readJson(edgeModeResponse);

    expect(legacyResponse.status).toBe(409);
    expect(edgeModeResponse.status).toBe(409);
    expect(legacyResponse.headers.get("Idempotency-Key")).toBe("approval-state-key");
    expect(edgeModeResponse.headers.get("Idempotency-Key")).toBe("approval-state-key");
    expect(edgeModeBody).toEqual(legacyBody);
  });

  it("keeps method deny and invalid_response classifications identical in legacy node and node-edge mode", async () => {
    vi.mocked(getApiAuthorityMode).mockReturnValue("legacy");

    const methodDenyRequest = new Request("http://localhost/api/payroll-approvals", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${createAuthToken()}`,
        "x-request-id": "method-request-id",
      },
    });

    const legacyMethodDeny = await payrollApprovalsHandler(methodDenyRequest.clone());
    const legacyMethodBody = await readJson(legacyMethodDeny);

    const forwardedMethodDeny = await payrollApprovalsHandler(methodDenyRequest.clone());
    const forwardedMethodBody = await readJson(forwardedMethodDeny);

    expect(forwardedMethodBody).toEqual(legacyMethodBody);
    expect(forwardedMethodBody.classification).toEqual({
      category: "validation",
      severity: "low",
      retryable: false,
      httpStatus: 405,
    });

    vi.mocked(fetchJson).mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: {
        transitionId: "22222222-2222-2222-2222-222222222222",
        snapshotId: "11111111-1111-1111-1111-111111111111",
        snapshotHash: "a".repeat(64),
        canonicalSnapshotHash: "a".repeat(64),
        action: "submitted",
        previousTransitionId: null,
        replayed: false,
        occurredAt: "2026-08-12T18:00:00.000Z",
        grossEarningsCents: 999999,
      },
    });

    const invalidResponseRequest = new Request("http://localhost/api/payroll-approvals", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${createAuthToken()}`,
        "Idempotency-Key": "approval-invalid-key",
        "x-request-id": "invalid-request-id",
      },
      body: JSON.stringify({
        action: "submit",
        snapshotId: "11111111-1111-1111-1111-111111111111",
        snapshotHash: "a".repeat(64),
        attestation: true,
      }),
    });

    const legacyInvalidResponse = await payrollApprovalsHandler(invalidResponseRequest.clone());
    const legacyInvalidBody = await readJson(legacyInvalidResponse);

    vi.mocked(getApiAuthorityMode).mockReturnValue("edge");
    vi.mocked(proxyToEdgeAuthority).mockResolvedValueOnce(
      new Response(JSON.stringify({
        transitionId: "22222222-2222-2222-2222-222222222222",
        snapshotId: "11111111-1111-1111-1111-111111111111",
        snapshotHash: "a".repeat(64),
        canonicalSnapshotHash: "a".repeat(64),
        action: "submitted",
        previousTransitionId: null,
        replayed: false,
        occurredAt: "2026-08-12T18:00:00.000Z",
        grossEarningsCents: 999999,
      }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "approval-invalid-key",
        },
      }),
    );

    const edgeInvalidResponse = await payrollApprovalsHandler(invalidResponseRequest.clone());
    const edgeInvalidBody = await readJson(edgeInvalidResponse);

    expect(edgeInvalidBody).toEqual(legacyInvalidBody);
    expect(edgeInvalidBody.classification).toEqual({
      category: "upstream",
      severity: "high",
      retryable: false,
      httpStatus: 502,
    });
  });

  it.each([
    {
      name: "feature_disabled",
      response: new Response(JSON.stringify({
        success: false,
        error: "Payroll approval workflow is unavailable.",
        requestId: "edge-feature",
        code: "feature_disabled",
        message: "Payroll approval workflow is unavailable.",
        state: "feature_disabled",
        classification: {
          category: "feature",
          severity: "medium",
          retryable: false,
          httpStatus: 403,
        },
        idempotencyKey: "approval-feature-key",
      }), {
        status: 403,
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "approval-feature-key",
        },
      }),
      expectedStatus: 403,
      expectedBody: {
        code: "feature_disabled",
        state: "feature_disabled",
        idempotencyKey: "approval-feature-key",
      },
    },
    {
      name: "conflict",
      response: new Response(JSON.stringify({
        success: false,
        error: "Idempotency conflict.",
        requestId: "edge-conflict",
        code: "conflict",
        message: "Idempotency conflict.",
        classification: {
          category: "request",
          severity: "medium",
          retryable: false,
          httpStatus: 409,
        },
        idempotencyKey: "approval-conflict-key",
      }), {
        status: 409,
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "approval-conflict-key",
        },
      }),
      expectedStatus: 409,
      expectedBody: {
        code: "conflict",
        idempotencyKey: "approval-conflict-key",
      },
    },
    {
      name: "validation",
      response: new Response(JSON.stringify({
        success: false,
        error: "Invalid payroll approval request.",
        requestId: "edge-validation",
        code: "validation_error",
        message: "Invalid payroll approval request.",
        classification: {
          category: "validation",
          severity: "low",
          retryable: false,
          httpStatus: 400,
        },
        idempotencyKey: "approval-validation-key",
      }), {
        status: 400,
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "approval-validation-key",
        },
      }),
      expectedStatus: 400,
      expectedBody: {
        code: "validation_error",
        idempotencyKey: "approval-validation-key",
      },
    },
    {
      name: "forbidden",
      response: new Response(JSON.stringify({
        success: false,
        error: "Forbidden",
        requestId: "edge-forbidden",
        code: "forbidden",
        message: "Forbidden",
        classification: {
          category: "auth",
          severity: "medium",
          retryable: false,
          httpStatus: 403,
        },
        idempotencyKey: "approval-forbidden-key",
      }), {
        status: 403,
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "approval-forbidden-key",
        },
      }),
      expectedStatus: 403,
      expectedBody: {
        code: "forbidden",
        idempotencyKey: "approval-forbidden-key",
      },
    },
    {
      name: "upstream",
      response: new Response(JSON.stringify({
        success: false,
        error: "Payroll transport failed.",
        requestId: "edge-upstream",
        code: "upstream_error",
        message: "Payroll transport failed.",
        classification: {
          category: "upstream",
          severity: "high",
          retryable: true,
          httpStatus: 502,
        },
        idempotencyKey: "approval-upstream-key",
      }), {
        status: 502,
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "approval-upstream-key",
        },
      }),
      expectedStatus: 502,
      expectedBody: {
        code: "upstream_error",
        idempotencyKey: "approval-upstream-key",
      },
    },
  ])("keeps exact edge-authority error parity for $name envelopes", async ({ response, expectedStatus, expectedBody }) => {
    vi.mocked(getApiAuthorityMode).mockReturnValue("edge");
    vi.mocked(proxyToEdgeAuthority).mockResolvedValue(response);

    const forwarded = await payrollApprovalsHandler(
      new Request("http://localhost/api/payroll-approvals", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${createAuthToken()}`,
          "Idempotency-Key": String(expectedBody.idempotencyKey),
        },
        body: JSON.stringify({
          action: "lock",
          snapshotId: "11111111-1111-1111-1111-111111111111",
          snapshotHash: "a".repeat(64),
        }),
      }),
    );

    expect(forwarded.status).toBe(expectedStatus);
    expect(forwarded.headers.get("Idempotency-Key")).toBe(String(expectedBody.idempotencyKey));
    await expect(forwarded.json()).resolves.toEqual(expect.objectContaining(expectedBody));
  });

  it("fails closed when a typed edge-authority error body omits the authoritative idempotency header echo", async () => {
    vi.mocked(getApiAuthorityMode).mockReturnValue("edge");
    vi.mocked(proxyToEdgeAuthority).mockResolvedValue(
      new Response(JSON.stringify({
        success: false,
        error: "Idempotency conflict.",
        requestId: "edge-conflict",
        code: "conflict",
        message: "Idempotency conflict.",
        classification: {
          category: "request",
          severity: "medium",
          retryable: false,
          httpStatus: 409,
        },
        idempotencyKey: "approval-conflict-key",
      }), {
        status: 409,
        headers: {
          "Content-Type": "application/json",
        },
      }),
    );

    const response = await payrollApprovalsHandler(
      new Request("http://localhost/api/payroll-approvals", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${createAuthToken()}`,
          "Idempotency-Key": "approval-conflict-key",
        },
        body: JSON.stringify({
          action: "lock",
          snapshotId: "11111111-1111-1111-1111-111111111111",
          snapshotHash: "a".repeat(64),
        }),
      }),
    );

    expect(response.status).toBe(502);
    expect(response.headers.get("Idempotency-Key")).toBeNull();
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      code: "invalid_response",
      error: "Invalid payroll approval response.",
    }));
  });

  it("fails closed when a typed edge-authority error header echo mismatches the body or request", async () => {
    vi.mocked(getApiAuthorityMode).mockReturnValue("edge");
    vi.mocked(proxyToEdgeAuthority).mockResolvedValue(
      new Response(JSON.stringify({
        success: false,
        error: "Idempotency conflict.",
        requestId: "edge-conflict",
        code: "conflict",
        message: "Idempotency conflict.",
        classification: {
          category: "request",
          severity: "medium",
          retryable: false,
          httpStatus: 409,
        },
        idempotencyKey: "approval-body-key",
      }), {
        status: 409,
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "approval-header-key",
        },
      }),
    );

    const response = await payrollApprovalsHandler(
      new Request("http://localhost/api/payroll-approvals", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${createAuthToken()}`,
          "Idempotency-Key": "approval-request-key",
        },
        body: JSON.stringify({
          action: "lock",
          snapshotId: "11111111-1111-1111-1111-111111111111",
          snapshotHash: "a".repeat(64),
        }),
      }),
    );

    expect(response.status).toBe(502);
    expect(response.headers.get("Idempotency-Key")).toBeNull();
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      code: "invalid_response",
      error: "Invalid payroll approval response.",
    }));
  });

  it("maps ad hoc edge-authority error bodies back into the protected approval envelope", async () => {
    vi.mocked(getApiAuthorityMode).mockReturnValue("edge");
    vi.mocked(proxyToEdgeAuthority).mockResolvedValue(
      new Response(JSON.stringify({ nope: true }), {
        status: 403,
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "approval-forbidden-key",
        },
      }),
    );

    const response = await payrollApprovalsHandler(
      new Request("http://localhost/api/payroll-approvals", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${createAuthToken()}`,
          "Idempotency-Key": "approval-forbidden-key",
        },
        body: JSON.stringify({
          action: "lock",
          snapshotId: "11111111-1111-1111-1111-111111111111",
          snapshotHash: "a".repeat(64),
        }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      code: "forbidden",
      error: "Forbidden",
      idempotencyKey: "approval-forbidden-key",
    }));
  });

  it("fails closed in edge-authority mode when the upstream success echo is missing", async () => {
    vi.mocked(getApiAuthorityMode).mockReturnValue("edge");
    vi.mocked(proxyToEdgeAuthority).mockResolvedValue(
      new Response(JSON.stringify({
        transitionId: "22222222-2222-2222-2222-222222222222",
        snapshotId: "11111111-1111-1111-1111-111111111111",
        snapshotHash: "a".repeat(64),
        canonicalSnapshotHash: "a".repeat(64),
        action: "submitted",
        previousTransitionId: null,
        replayed: false,
        occurredAt: "2026-08-12T18:00:00.000Z",
      }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "approval-submit-key",
          "Idempotent-Replay": "false",
        },
      }),
    );

    const response = await payrollApprovalsHandler(
      new Request("http://localhost/api/payroll-approvals", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${createAuthToken()}`,
          "Idempotency-Key": "approval-submit-key",
        },
        body: JSON.stringify({
          action: "submit",
          snapshotId: "11111111-1111-1111-1111-111111111111",
          snapshotHash: "a".repeat(64),
          attestation: true,
        }),
      }),
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      code: "invalid_response",
      error: "Invalid payroll approval response.",
    }));
    expect(response.headers.get("Idempotency-Key")).toBeNull();
    expect(response.headers.get("Idempotent-Replay")).toBeNull();
  });

  it("fails closed when the approval response leaks unexpected fields", async () => {
    vi.mocked(getApiAuthorityMode).mockReturnValue("legacy");
    vi.mocked(fetchJson).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        transitionId: "22222222-2222-2222-2222-222222222222",
        snapshotId: "11111111-1111-1111-1111-111111111111",
        snapshotHash: "a".repeat(64),
        canonicalSnapshotHash: "a".repeat(64),
        action: "submitted",
        previousTransitionId: null,
        replayed: false,
        occurredAt: "2026-08-12T18:00:00.000Z",
        grossEarningsCents: 999999,
      },
    });

    const response = await payrollApprovalsHandler(
      new Request("http://localhost/api/payroll-approvals", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${createAuthToken()}`,
          "Idempotency-Key": "approval-shape-key",
        },
        body: JSON.stringify({
          action: "submit",
          snapshotId: "11111111-1111-1111-1111-111111111111",
          snapshotHash: "a".repeat(64),
          attestation: true,
        }),
      }),
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      code: "invalid_response",
    }));
  });
});
