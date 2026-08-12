import { beforeEach, describe, expect, it, vi } from "vitest";
import { payrollAdministrationHandler } from "../api/payroll-administration";

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

const createAuthToken = (subject = "admin-user-1") => {
  const payload = Buffer.from(JSON.stringify({ sub: subject }), "utf8").toString("base64url");
  return `header.${payload}.signature`;
};

async function readJson(response: Response) {
  return await response.json() as Record<string, unknown>;
}

const baseReadPayload = {
  state: "ok",
  selectedLocalDate: "2026-08-12",
  capabilities: {
    canConfigureEmployment: true,
    canResolveExceptions: false,
    canLockPeriod: false,
    canReopenPeriod: false,
    canGeneratePeriods: true,
    canViewCompensation: false,
    canManagePolicyMutations: false,
  },
  orgSettings: [
    {
      id: "11111111-1111-1111-1111-111111111111",
      externalPayrollOrganizationId: "org-ext-1",
      timezone: "America/Los_Angeles",
      workdayStartsAt: "00:00:00",
      workweekStartsOn: 0,
      effectiveFrom: "2026-08-01",
      effectiveThrough: null,
    },
  ],
  policies: [
    {
      id: "22222222-2222-2222-2222-222222222222",
      jurisdiction: "CA",
      policyName: "California nonexempt",
      activationStatus: "active",
      supportsMonthlyNonexempt: false,
      effectiveFrom: "2026-01-01",
      effectiveThrough: null,
      mutationsReadOnlyInV1: true,
    },
  ],
  employments: [
    {
      id: "33333333-3333-3333-3333-333333333333",
      userId: "44444444-4444-4444-4444-444444444444",
      employeeNumber: "EMP-1",
      payrollEmployeeId: "payroll-1",
      classification: "nonexempt",
      homeJurisdiction: "CA",
      timezone: "America/Los_Angeles",
      activeFrom: "2026-08-01",
      activeThrough: null,
    },
  ],
  payGroups: [
    {
      id: "55555555-5555-5555-5555-555555555555",
      name: "Biweekly Team",
      cadence: "biweekly",
      timezone: "America/Los_Angeles",
      effectiveFrom: "2026-08-01",
      effectiveThrough: null,
    },
  ],
  generationVersions: [
    {
      id: "66666666-6666-6666-6666-666666666666",
      payGroupId: "55555555-5555-5555-5555-555555555555",
      cadence: "biweekly",
      startsOn: "2026-08-01",
      timezone: "America/Los_Angeles",
      effectiveFrom: "2026-08-01",
      effectiveThrough: null,
    },
  ],
  payPeriods: [
    {
      id: "77777777-7777-7777-7777-777777777777",
      payGroupId: "55555555-5555-5555-5555-555555555555",
      startsOn: "2026-08-01",
      endsOn: "2026-08-14",
      lockedAt: null,
      exportedAt: null,
    },
  ],
  bounds: {
    orgSettings: 50,
    policies: 20,
    employments: 50,
    payGroups: 50,
    generationVersions: 50,
    payPeriods: 50,
  },
};

describe("payrollAdministrationHandler", () => {
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
      isAdmin: true,
      isOrgMember: true,
      isSuperAdmin: false,
      upstreamError: false,
    });
    vi.mocked(fetchAuthenticatedUserIdWithStatus).mockResolvedValue({
      userId: "admin-user-1",
      upstreamError: false,
    });
    vi.mocked(resolveUserRoleWithStatus).mockResolvedValue({
      role: "admin",
      upstreamError: false,
    });
    vi.mocked(getSupabaseConfig).mockReturnValue({
      supabaseUrl: "https://example.supabase.co",
      anonKey: "anon-key",
    });
  });

  it("rejects coarse roles outside admin and super_admin before forwarding or calling RPCs", async () => {
    vi.mocked(getApiAuthorityMode).mockReturnValue("legacy");
    vi.mocked(resolveUserRoleWithStatus).mockResolvedValueOnce({
      role: "bcba",
      upstreamError: false,
    });

    const response = await payrollAdministrationHandler(
      new Request("http://localhost/api/payroll-administration", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${createAuthToken()}`,
        },
        body: JSON.stringify({
          action: "get_administration",
          selectedLocalDate: "2026-08-12",
        }),
      }),
    );

    expect(response.status).toBe(403);
    expect(vi.mocked(proxyToEdgeAuthority)).not.toHaveBeenCalled();
    expect(vi.mocked(fetchJson)).not.toHaveBeenCalled();
  });

  it("calls the exact read rpc without idempotency requirements", async () => {
    vi.mocked(getApiAuthorityMode).mockReturnValue("legacy");
    vi.mocked(fetchJson).mockResolvedValue({
      ok: true,
      status: 200,
      data: baseReadPayload,
    });

    const response = await payrollAdministrationHandler(
      new Request("http://localhost/api/payroll-administration", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${createAuthToken()}`,
        },
        body: JSON.stringify({
          action: "get_administration",
          selectedLocalDate: "2026-08-12",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(vi.mocked(fetchJson)).toHaveBeenCalledWith(
      "https://example.supabase.co/rest/v1/rpc/get_payroll_administration",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          apikey: "anon-key",
          Authorization: `Bearer ${createAuthToken()}`,
        }),
        body: JSON.stringify({ selected_local_date: "2026-08-12" }),
      }),
    );
    expect(response.headers.get("Idempotency-Key")).toBeNull();
    expect(response.headers.get("Idempotent-Replay")).toBeNull();
  });

  it("proxies to edge authority and preserves replay headers for mutations", async () => {
    vi.mocked(getApiAuthorityMode).mockReturnValue("edge");
    vi.mocked(proxyToEdgeAuthority).mockResolvedValue(
      new Response(JSON.stringify({
        action: "generate_periods",
        payGroupId: "55555555-5555-5555-5555-555555555555",
        generatedCount: 3,
        replayed: false,
        idempotencyKey: "admin-generate-key",
      }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "admin-generate-key",
          "Idempotent-Replay": "false",
          "x-request-id": "edge-admin-request",
        },
      }),
    );

    const request = new Request("http://localhost/api/payroll-administration", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${createAuthToken()}`,
        "Idempotency-Key": "admin-generate-key",
        "x-request-id": "node-admin-request",
      },
      body: JSON.stringify({
        action: "generate_periods",
        payGroupId: "55555555-5555-5555-5555-555555555555",
        from: "2026-08-01",
        to: "2026-08-31",
      }),
    });

    const response = await payrollAdministrationHandler(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("Idempotency-Key")).toBe("admin-generate-key");
    expect(response.headers.get("Idempotent-Replay")).toBe("false");
    expect(response.headers.get("x-request-id")).toBe("edge-admin-request");
  });

  it("rejects recursive authority injection before any RPC call", async () => {
    vi.mocked(getApiAuthorityMode).mockReturnValue("legacy");

    const response = await payrollAdministrationHandler(
      new Request("http://localhost/api/payroll-administration", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${createAuthToken()}`,
          "Idempotency-Key": "admin-authority-key",
        },
        body: JSON.stringify({
          action: "create_employment",
          userId: "44444444-4444-4444-4444-444444444444",
          employeeNumber: "EMP-1",
          payrollEmployeeId: "payroll-1",
          timezone: "America/Los_Angeles",
          activeFrom: "2026-08-01",
          nested: {
            organizationId: "org-override",
          },
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(vi.mocked(fetchJson)).not.toHaveBeenCalled();
  });

  it("rejects invalid external identifiers and pay-group names before forwarding", async () => {
    vi.mocked(getApiAuthorityMode).mockReturnValue("edge");

    const invalidId = await payrollAdministrationHandler(
      new Request("http://localhost/api/payroll-administration", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${createAuthToken()}`,
          "Idempotency-Key": "admin-create-employment-key",
        },
        body: JSON.stringify({
          action: "create_employment",
          userId: "44444444-4444-4444-4444-444444444444",
          employeeNumber: " bad",
          payrollEmployeeId: "payroll-1",
          timezone: "America/Los_Angeles",
          activeFrom: "2026-08-01",
        }),
      }),
    );

    expect(invalidId.status).toBe(400);
    expect(vi.mocked(proxyToEdgeAuthority)).not.toHaveBeenCalled();

    const invalidName = await payrollAdministrationHandler(
      new Request("http://localhost/api/payroll-administration", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${createAuthToken()}`,
          "Idempotency-Key": "admin-pay-group-key",
        },
        body: JSON.stringify({
          action: "create_pay_group",
          name: "Payroll\nOps",
          cadence: "weekly",
          timezone: "America/Los_Angeles",
        }),
      }),
    );

    expect(invalidName.status).toBe(400);
    expect(vi.mocked(proxyToEdgeAuthority)).not.toHaveBeenCalled();
  });

  it("requires mutation idempotency and fails on nested conflicts", async () => {
    vi.mocked(getApiAuthorityMode).mockReturnValue("legacy");

    const missingKeyResponse = await payrollAdministrationHandler(
      new Request("http://localhost/api/payroll-administration", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${createAuthToken()}`,
        },
        body: JSON.stringify({
          action: "generate_periods",
          payGroupId: "55555555-5555-5555-5555-555555555555",
          from: "2026-08-01",
          to: "2026-08-31",
        }),
      }),
    );

    expect(missingKeyResponse.status).toBe(400);

    const conflictingKeyResponse = await payrollAdministrationHandler(
      new Request("http://localhost/api/payroll-administration", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${createAuthToken()}`,
          "Idempotency-Key": "header-key",
        },
        body: JSON.stringify({
          action: "generate_periods",
          payGroupId: "55555555-5555-5555-5555-555555555555",
          from: "2026-08-01",
          to: "2026-08-31",
          idempotencyKey: "body-key",
        }),
      }),
    );

    expect(conflictingKeyResponse.status).toBe(400);
  });

  it("calls execute_payroll_administration with exact mutation payload only", async () => {
    vi.mocked(getApiAuthorityMode).mockReturnValue("legacy");
    vi.mocked(fetchJson).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        action: "set_generation_version",
        generationVersionId: "66666666-6666-6666-6666-666666666666",
        payGroupId: "55555555-5555-5555-5555-555555555555",
        replayed: false,
      },
    });

    const response = await payrollAdministrationHandler(
      new Request("http://localhost/api/payroll-administration", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${createAuthToken()}`,
          "Idempotency-Key": "admin-generation-key",
        },
        body: JSON.stringify({
          action: "set_generation_version",
          payGroupId: "55555555-5555-5555-5555-555555555555",
          cadence: "weekly",
          effectiveFrom: "2026-08-01",
          startsOn: "2026-08-01",
          timezone: "America/Los_Angeles",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(vi.mocked(fetchJson)).toHaveBeenCalledWith(
      "https://example.supabase.co/rest/v1/rpc/execute_payroll_administration",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          p_payload: {
            action: "set_generation_version",
            payGroupId: "55555555-5555-5555-5555-555555555555",
            cadence: "weekly",
            effectiveFrom: "2026-08-01",
            startsOn: "2026-08-01",
            timezone: "America/Los_Angeles",
          },
          p_idempotency_key: "admin-generation-key",
        }),
      }),
    );
    expect(response.headers.get("Idempotency-Key")).toBe("admin-generation-key");
  });

  it("fails closed when the read response leaks compensation despite canViewCompensation=false", async () => {
    vi.mocked(getApiAuthorityMode).mockReturnValue("legacy");
    vi.mocked(fetchJson).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        ...baseReadPayload,
        employments: [
          {
            ...baseReadPayload.employments[0],
            compensation: {
              hourlyRateCents: 12345,
              effectiveFrom: "2026-08-01T00:00:00.000Z",
              effectiveThrough: null,
            },
          },
        ],
      },
    });

    const response = await payrollAdministrationHandler(
      new Request("http://localhost/api/payroll-administration", {
        method: "POST",
        headers: { Authorization: `Bearer ${createAuthToken()}` },
        body: JSON.stringify({
          action: "get_administration",
          selectedLocalDate: "2026-08-12",
        }),
      }),
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({ code: "invalid_response" });
  });

  it("fails closed when policy mutation readonly invariant drifts", async () => {
    vi.mocked(getApiAuthorityMode).mockReturnValue("legacy");
    vi.mocked(fetchJson).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        ...baseReadPayload,
        capabilities: {
          ...baseReadPayload.capabilities,
          canManagePolicyMutations: true,
        },
      },
    });

    const response = await payrollAdministrationHandler(
      new Request("http://localhost/api/payroll-administration", {
        method: "POST",
        headers: { Authorization: `Bearer ${createAuthToken()}` },
        body: JSON.stringify({
          action: "get_administration",
          selectedLocalDate: "2026-08-12",
        }),
      }),
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({ code: "invalid_response" });
  });

  it("keeps error parity for state conflicts and forwarded rate limits", async () => {
    vi.mocked(getApiAuthorityMode).mockReturnValue("legacy");
    vi.mocked(fetchJson).mockResolvedValueOnce({
      ok: false,
      status: 409,
      data: {
        code: "23514",
        message: "generation version boundary cannot change after payroll facts exist",
      },
    });

    const request = new Request("http://localhost/api/payroll-administration", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${createAuthToken()}`,
        "Idempotency-Key": "admin-state-key",
        "x-request-id": "state-request-id",
      },
      body: JSON.stringify({
        action: "set_generation_version",
        payGroupId: "55555555-5555-5555-5555-555555555555",
        cadence: "weekly",
        effectiveFrom: "2026-08-01",
        startsOn: "2026-08-01",
        timezone: "America/Los_Angeles",
      }),
    });

    const legacyResponse = await payrollAdministrationHandler(request.clone());
    const legacyBody = await readJson(legacyResponse);

    vi.mocked(getApiAuthorityMode).mockReturnValue("edge");
    vi.mocked(proxyToEdgeAuthority).mockResolvedValueOnce(
      new Response(JSON.stringify({
        success: false,
        error: "Too many payroll administration requests",
        requestId: "rate-request-id",
        code: "rate_limited",
        message: "Too many payroll administration requests",
        classification: {
          category: "rate_limit",
          severity: "high",
          retryable: true,
          httpStatus: 429,
        },
        idempotencyKey: "admin-state-key",
      }), {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "admin-state-key",
          "Retry-After": "9",
        },
      }),
    );

    const rateLimitedResponse = await payrollAdministrationHandler(request.clone());
    const rateLimitedBody = await readJson(rateLimitedResponse);

    expect(legacyResponse.status).toBe(409);
    expect(legacyBody).toMatchObject({
      code: "state_conflict",
      idempotencyKey: "admin-state-key",
    });
    expect(rateLimitedResponse.status).toBe(429);
    expect(rateLimitedResponse.headers.get("Retry-After")).toBe("9");
    expect(rateLimitedBody).toMatchObject({
      code: "rate_limited",
      idempotencyKey: "admin-state-key",
    });
  });

  it("fails closed when forwarded mutation success omits the idempotency echo", async () => {
    vi.mocked(getApiAuthorityMode).mockReturnValue("edge");
    vi.mocked(proxyToEdgeAuthority).mockResolvedValue(
      new Response(JSON.stringify({
        action: "generate_periods",
        payGroupId: "55555555-5555-5555-5555-555555555555",
        generatedCount: 3,
        replayed: false,
      }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "admin-generate-key",
        },
      }),
    );

    const response = await payrollAdministrationHandler(
      new Request("http://localhost/api/payroll-administration", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${createAuthToken()}`,
          "Idempotency-Key": "admin-generate-key",
        },
        body: JSON.stringify({
          action: "generate_periods",
          payGroupId: "55555555-5555-5555-5555-555555555555",
          from: "2026-08-01",
          to: "2026-08-31",
        }),
      }),
    );

    expect(response.status).toBe(502);
    expect(response.headers.get("Idempotency-Key")).toBeNull();
    await expect(response.json()).resolves.toMatchObject({ code: "invalid_response" });
  });
});
