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
