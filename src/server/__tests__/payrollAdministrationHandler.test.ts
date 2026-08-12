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

const mutationKey = "payroll-admin-matrix-key";
const actionCases = [
  {
    name: "get_administration",
    payload: { action: "get_administration", selectedLocalDate: "2026-08-12" },
    rpcName: "get_payroll_administration",
    rpcArgs: { selected_local_date: "2026-08-12" },
    result: baseReadPayload,
    requiresIdempotency: false,
  },
  {
    name: "create_org_settings",
    payload: { action: "create_org_settings", effectiveFrom: "2026-08-01", effectiveThrough: null, externalPayrollOrganizationId: "org-ext-2", timezone: "America/Los_Angeles", workdayStartsAt: "06:00:00", workweekStartsOn: 1 },
    result: { action: "create_org_settings", organizationSettingsId: "11111111-1111-1111-1111-111111111111", replayed: false },
  },
  {
    name: "supersede_org_settings",
    payload: { action: "supersede_org_settings", effectiveFrom: "2026-09-01", externalPayrollOrganizationId: "org-ext-3", timezone: "America/Denver" },
    result: { action: "supersede_org_settings", organizationSettingsId: "11111111-1111-1111-1111-111111111112", replayed: false },
  },
  {
    name: "create_employment",
    payload: { action: "create_employment", userId: "44444444-4444-4444-4444-444444444444", employeeNumber: "EMP-2", payrollEmployeeId: "payroll-2", classification: "nonexempt", homeJurisdiction: "CA", timezone: "America/Los_Angeles", activeFrom: "2026-08-01", activeThrough: null, therapistId: null },
    result: { action: "create_employment", employmentProfileId: "33333333-3333-3333-3333-333333333333", replayed: false },
  },
  {
    name: "deactivate_employment",
    payload: { action: "deactivate_employment", employmentProfileId: "33333333-3333-3333-3333-333333333333", effectiveThrough: "2026-08-31" },
    result: { action: "deactivate_employment", employmentProfileId: "33333333-3333-3333-3333-333333333333", replayed: false },
  },
  {
    name: "add_rate_version",
    payload: { action: "add_rate_version", employmentProfileId: "33333333-3333-3333-3333-333333333333", hourlyRateCents: 4250, effectiveFrom: "2026-08-01T00:00:00Z", effectiveThrough: null },
    result: { action: "add_rate_version", rateVersionId: "88888888-8888-8888-8888-888888888888", replayed: false },
  },
  {
    name: "create_manager_assignment",
    payload: { action: "create_manager_assignment", employmentProfileId: "33333333-3333-3333-3333-333333333333", managerUserId: "99999999-9999-9999-9999-999999999999", effectiveFrom: "2026-08-01T00:00:00Z", effectiveThrough: null },
    result: { action: "create_manager_assignment", managerAssignmentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", replayed: false },
  },
  {
    name: "deactivate_manager_assignment",
    payload: { action: "deactivate_manager_assignment", managerAssignmentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", effectiveThrough: "2026-08-31T23:59:59Z" },
    result: { action: "deactivate_manager_assignment", managerAssignmentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", replayed: false },
  },
  {
    name: "grant_capability",
    payload: { action: "grant_capability", userId: "44444444-4444-4444-4444-444444444444", capability: "payroll.configure_employment", effectiveFrom: "2026-08-01T00:00:00Z", effectiveThrough: null },
    result: { action: "grant_capability", capabilityGrantId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", replayed: false },
  },
  {
    name: "revoke_capability",
    payload: { action: "revoke_capability", userId: "44444444-4444-4444-4444-444444444444", capability: "payroll.configure_employment", effectiveThrough: "2026-08-31T23:59:59Z" },
    result: { action: "revoke_capability", capabilityGrantId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", replayed: false },
  },
  {
    name: "create_pay_group",
    payload: { action: "create_pay_group", name: "Monthly Team", cadence: "monthly", timezone: "America/Los_Angeles", effectiveFrom: "2026-08-01", effectiveThrough: null },
    result: { action: "create_pay_group", payGroupId: "55555555-5555-5555-5555-555555555555", replayed: false },
  },
  {
    name: "deactivate_pay_group",
    payload: { action: "deactivate_pay_group", payGroupId: "55555555-5555-5555-5555-555555555555", effectiveThrough: "2026-08-31" },
    result: { action: "deactivate_pay_group", payGroupId: "55555555-5555-5555-5555-555555555555", replayed: false },
  },
  {
    name: "create_pay_group_assignment",
    payload: { action: "create_pay_group_assignment", employmentProfileId: "33333333-3333-3333-3333-333333333333", payGroupId: "55555555-5555-5555-5555-555555555555", effectiveFrom: "2026-08-01", effectiveThrough: null },
    result: { action: "create_pay_group_assignment", payGroupAssignmentId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", replayed: false },
  },
  {
    name: "deactivate_pay_group_assignment",
    payload: { action: "deactivate_pay_group_assignment", payGroupAssignmentId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", effectiveThrough: "2026-08-31" },
    result: { action: "deactivate_pay_group_assignment", payGroupAssignmentId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", replayed: false },
  },
  {
    name: "set_generation_version",
    payload: { action: "set_generation_version", payGroupId: "55555555-5555-5555-5555-555555555555", cadence: "biweekly", effectiveFrom: "2026-08-01", effectiveThrough: null, startsOn: "2026-08-01", timezone: "America/Los_Angeles" },
    result: { action: "set_generation_version", generationVersionId: "66666666-6666-6666-6666-666666666666", payGroupId: "55555555-5555-5555-5555-555555555555", replayed: false },
  },
  {
    name: "generate_periods",
    payload: { action: "generate_periods", payGroupId: "55555555-5555-5555-5555-555555555555", from: "2026-08-01", to: "2026-08-31" },
    result: { action: "generate_periods", payGroupId: "55555555-5555-5555-5555-555555555555", generatedCount: 3, replayed: false },
  },
] as const;

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

  it("uses the organization-scoped role when the global role has drifted", async () => {
    vi.mocked(getApiAuthorityMode).mockReturnValue("legacy");
    vi.mocked(resolveUserRoleWithStatus).mockResolvedValueOnce({
      role: "bcba",
      upstreamError: false,
    });
    vi.mocked(fetchJson).mockResolvedValue({ status: 200, ok: true, data: baseReadPayload });

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
    expect(resolveUserRoleWithStatus).not.toHaveBeenCalled();
    expect(fetchJson).toHaveBeenCalledTimes(1);
  });

  it("denies when the organization-scoped role is not admin even if the global role says admin", async () => {
    vi.mocked(resolveOrgAndRoleWithStatus).mockResolvedValueOnce({
      organizationId: "org-1",
      isTherapist: false,
      isAdmin: false,
      isOrgMember: true,
      isSuperAdmin: false,
      upstreamError: false,
    });

    const response = await payrollAdministrationHandler(new Request("http://localhost/api/payroll-administration", {
      method: "POST",
      headers: { Authorization: `Bearer ${createAuthToken()}` },
      body: JSON.stringify({ action: "get_administration", selectedLocalDate: "2026-08-12" }),
    }));

    expect(response.status).toBe(403);
    expect(resolveUserRoleWithStatus).not.toHaveBeenCalled();
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("advertises only POST and OPTIONS for preflight", async () => {
    const response = await payrollAdministrationHandler(new Request("http://localhost/api/payroll-administration", {
      method: "OPTIONS",
      headers: { Origin: "https://app.allincompassing.ai" },
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe("POST, OPTIONS");
  });

  it.each(actionCases)("maps $name to its exact RPC contract and validates its exact success result", async (testCase) => {
    vi.mocked(getApiAuthorityMode).mockReturnValue("legacy");
    vi.mocked(fetchJson)
      .mockResolvedValueOnce({ status: 200, ok: true, data: testCase.result })
      .mockResolvedValueOnce({ status: 200, ok: true, data: { ...testCase.result, unexpected: true } });
    const headers: Record<string, string> = { Authorization: `Bearer ${createAuthToken()}` };
    const isRead = testCase.name === "get_administration";
    if (!isRead) {
      headers["Idempotency-Key"] = mutationKey;
    }
    const request = () => new Request("http://localhost/api/payroll-administration", {
      method: "POST",
      headers,
      body: JSON.stringify(testCase.payload),
    });

    const response = await payrollAdministrationHandler(request());
    expect(response.status).toBe(200);
    const expectedRpcName = isRead ? "get_payroll_administration" : "execute_payroll_administration";
    const expectedRpcArgs = isRead
      ? { selected_local_date: "2026-08-12" }
      : { p_payload: testCase.payload, p_idempotency_key: mutationKey };
    expect(fetchJson).toHaveBeenNthCalledWith(
      1,
      `https://example.supabase.co/rest/v1/rpc/${expectedRpcName}`,
      expect.objectContaining({ body: JSON.stringify(expectedRpcArgs) }),
    );
    const expectedBody = isRead
      ? testCase.result
      : { ...testCase.result, idempotencyKey: mutationKey };
    expect(await readJson(response)).toEqual(expectedBody);
    expect(response.headers.get("Idempotency-Key")).toBe(isRead ? null : mutationKey);

    const malformedResponse = await payrollAdministrationHandler(request());
    expect(malformedResponse.status).toBe(502);
    expect(await readJson(malformedResponse)).toMatchObject({ code: "invalid_response" });
  });

  it("rejects monthly cadence only for set_generation_version", async () => {
    const response = await payrollAdministrationHandler(new Request("http://localhost/api/payroll-administration", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${createAuthToken()}`,
        "Idempotency-Key": mutationKey,
      },
      body: JSON.stringify({
        action: "set_generation_version",
        payGroupId: "55555555-5555-5555-5555-555555555555",
        cadence: "monthly",
        effectiveFrom: "2026-08-01",
        startsOn: "2026-08-01",
        timezone: "America/Los_Angeles",
      }),
    }));

    expect(response.status).toBe(400);
    expect(fetchJson).not.toHaveBeenCalled();
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

  it.each([
    {
      status: 401,
      code: "unauthorized",
      message: "Unauthorized",
      classification: { category: "auth", severity: "medium", retryable: false, httpStatus: 401 },
      responseHeaders: { "WWW-Authenticate": "Bearer", "x-request-id": "edge-auth-request" },
    },
    {
      status: 500,
      code: "internal_error",
      message: "Internal server error",
      classification: { category: "internal", severity: "critical", retryable: false, httpStatus: 500 },
      responseHeaders: { "Retry-After": "7", "x-request-id": "edge-internal-request" },
    },
  ])("forwards shared Edge $status envelopes losslessly", async (testCase) => {
    vi.mocked(getApiAuthorityMode).mockReturnValue("edge");
    const upstreamBody = {
      requestId: `${testCase.code}-body-request`,
      code: testCase.code,
      message: testCase.message,
      classification: testCase.classification,
    };
    vi.mocked(proxyToEdgeAuthority).mockResolvedValue(new Response(JSON.stringify(upstreamBody), {
      status: testCase.status,
      headers: { "Content-Type": "application/json", ...testCase.responseHeaders },
    }));

    const response = await payrollAdministrationHandler(new Request("http://localhost/api/payroll-administration", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${createAuthToken()}`,
        "x-correlation-id": "incoming-correlation",
      },
      body: JSON.stringify({ action: "get_administration", selectedLocalDate: "2026-08-12" }),
    }));

    expect(response.status).toBe(testCase.status);
    expect(await readJson(response)).toEqual(upstreamBody);
    expect(response.headers.get("x-request-id")).toBe(testCase.responseHeaders["x-request-id"]);
    expect(response.headers.get("x-correlation-id")).toBe("incoming-correlation");
    expect(response.headers.get("WWW-Authenticate")).toBe(testCase.status === 401 ? "Bearer" : null);
    expect(response.headers.get("Retry-After")).toBe(testCase.status === 500 ? "7" : null);
  });
});
