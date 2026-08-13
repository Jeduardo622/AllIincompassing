import { beforeEach, describe, expect, it, vi } from "vitest";
import { payrollExportHandler } from "../api/payroll-export";

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
} from "../api/shared";
import { getApiAuthorityMode, proxyToEdgeAuthority } from "../api/edgeAuthority";

const createAuthToken = (subject = "admin-user-1") => {
  const payload = Buffer.from(JSON.stringify({ sub: subject }), "utf8").toString("base64url");
  return `header.${payload}.signature`;
};

const createPostRequest = (body: Record<string, unknown>, headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/payroll-export", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${createAuthToken()}`,
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });

const createGetRequest = (query = "runId=11111111-1111-1111-1111-111111111111", headers: Record<string, string> = {}) =>
  new Request(`http://localhost/api/payroll-export?${query}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${createAuthToken()}`,
      ...headers,
    },
  });

async function readJson(response: Response) {
  return await response.json() as Record<string, unknown>;
}

const postSuccessPayload = {
  runId: "11111111-1111-1111-1111-111111111111",
  payPeriodId: "22222222-2222-2222-2222-222222222222",
  adapterVersion: "provider-neutral-v1",
  replayed: false,
  createdAt: "2026-08-12T18:00:00.000Z",
  exportedAt: "2026-08-12T18:00:00.000Z",
  reconciliationStatus: "reconciled",
  checksumSha256: "a".repeat(64),
  rowCount: 2,
  totalRegularSeconds: 28800,
  totalOvertimeSeconds: 0,
  totalDoubleTimeSeconds: 0,
  totalMealPremiumCents: 0,
  totalGrossEarningsCents: 96000,
  sourceSnapshotCount: 1,
  adjustsRunId: null,
};

describe("payrollExportHandler", () => {
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
    vi.mocked(getSupabaseConfig).mockReturnValue({
      supabaseUrl: "https://example.supabase.co",
      anonKey: "anon-key",
    });
  });

  it("calls create_payroll_export with exact provider-neutral payload only", async () => {
    vi.mocked(getApiAuthorityMode).mockReturnValue("legacy");
    vi.mocked(fetchJson).mockResolvedValue({
      ok: true,
      status: 200,
      data: postSuccessPayload,
    });

    const response = await payrollExportHandler(
      createPostRequest({
        payPeriodId: "22222222-2222-2222-2222-222222222222",
        idempotencyKey: "export-create-key",
      }),
    );

    expect(response.status).toBe(200);
    expect(vi.mocked(fetchJson)).toHaveBeenCalledWith(
      "https://example.supabase.co/rest/v1/rpc/create_payroll_export",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          apikey: "anon-key",
          Authorization: `Bearer ${createAuthToken()}`,
        }),
        body: JSON.stringify({
          payload: {
            payPeriodId: "22222222-2222-2222-2222-222222222222",
            adapterVersion: "provider-neutral-v1",
          },
          idempotency_key: "export-create-key",
        }),
      }),
    );
    expect(await readJson(response)).toEqual({
      ...postSuccessPayload,
      idempotencyKey: "export-create-key",
    });
    expect(response.headers.get("Idempotency-Key")).toBe("export-create-key");
    expect(response.headers.get("Idempotent-Replay")).toBe("false");
  });

  it("rejects unknown fields and recursive authority injection before any RPC call", async () => {
    vi.mocked(getApiAuthorityMode).mockReturnValue("legacy");

    const response = await payrollExportHandler(
      createPostRequest({
        payPeriodId: "22222222-2222-2222-2222-222222222222",
        idempotencyKey: "export-authority-key",
        nested: {
          employeeId: "33333333-3333-3333-3333-333333333333",
        },
      }),
    );

    expect(response.status).toBe(400);
    expect(vi.mocked(fetchJson)).not.toHaveBeenCalled();
  });

  it("calls get_payroll_export and returns protected csv headers with a safe filename", async () => {
    vi.mocked(getApiAuthorityMode).mockReturnValue("legacy");
    vi.mocked(fetchJson).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        runId: "11111111-1111-1111-1111-111111111111",
        payPeriodId: "22222222-2222-2222-2222-222222222222",
        adapterVersion: "provider-neutral-v1",
        periodStart: "2026-08-01",
        periodEnd: "2026-08-14",
        csv: "schema_version,export_id\r\nprovider-neutral-v1,11111111-1111-1111-1111-111111111111\r\n",
      },
    });

    const response = await payrollExportHandler(createGetRequest());

    expect(response.status).toBe(200);
    expect(vi.mocked(fetchJson)).toHaveBeenCalledWith(
      "https://example.supabase.co/rest/v1/rpc/get_payroll_export",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          run_id: "11111111-1111-1111-1111-111111111111",
        }),
      }),
    );
    expect(response.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Content-Disposition")).toMatch(
      /^attachment; filename="payroll-export-provider-neutral-v1-2026-08-01-to-2026-08-14-11111111-1111-1111-1111-111111111111\.csv"$/,
    );
    expect(response.headers.get("Content-Disposition")).not.toMatch(/org|employee|alice|bob/i);
    await expect(response.text()).resolves.toContain("schema_version,export_id");
  });

  it("rejects GET requests with unknown query parameters before any RPC call", async () => {
    vi.mocked(getApiAuthorityMode).mockReturnValue("legacy");

    const response = await payrollExportHandler(
      createGetRequest("runId=11111111-1111-1111-1111-111111111111&employeeId=bad"),
    );

    expect(response.status).toBe(400);
    expect(vi.mocked(fetchJson)).not.toHaveBeenCalled();
  });

  it("keeps state_conflict envelopes identical across legacy and edge modes", async () => {
    vi.mocked(getApiAuthorityMode).mockReturnValue("legacy");
    vi.mocked(fetchJson).mockResolvedValueOnce({
      ok: false,
      status: 409,
      data: {
        code: "23514",
        message: "export period is no longer locked",
      },
    });

    const request = createPostRequest(
      {
        payPeriodId: "22222222-2222-2222-2222-222222222222",
        idempotencyKey: "export-state-key",
      },
      { "x-request-id": "export-request-id" },
    );

    const legacyResponse = await payrollExportHandler(request.clone());
    const legacyBody = await readJson(legacyResponse);

    vi.mocked(getApiAuthorityMode).mockReturnValue("edge");
    vi.mocked(proxyToEdgeAuthority).mockResolvedValueOnce(
      new Response(JSON.stringify({
        success: false,
        error: "Payroll export state conflict.",
        requestId: "export-request-id",
        code: "state_conflict",
        message: "Payroll export state conflict.",
        classification: {
          category: "request",
          severity: "medium",
          retryable: false,
          httpStatus: 409,
        },
        idempotencyKey: "export-state-key",
      }), {
        status: 409,
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "export-state-key",
        },
      }),
    );

    const edgeResponse = await payrollExportHandler(request.clone());
    const edgeBody = await readJson(edgeResponse);

    expect(legacyResponse.status).toBe(409);
    expect(edgeResponse.status).toBe(409);
    expect(edgeBody).toEqual(legacyBody);
    expect(edgeResponse.headers.get("Idempotency-Key")).toBe("export-state-key");
  });

  it("proxies edge GET downloads without reformatting csv bytes or trace headers", async () => {
    vi.mocked(getApiAuthorityMode).mockReturnValue("edge");
    vi.mocked(proxyToEdgeAuthority).mockResolvedValue(
      new Response("schema_version,export_id\r\nprovider-neutral-v1,11111111-1111-1111-1111-111111111111\r\n", {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          "Content-Disposition": 'attachment; filename="payroll-export-provider-neutral-v1-2026-08-01-to-2026-08-14-11111111-1111-1111-1111-111111111111.csv"',
          "x-request-id": "edge-export-request",
        },
      }),
    );

    const response = await payrollExportHandler(createGetRequest(undefined, { "x-request-id": "node-export-request" }));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe("edge-export-request");
    expect(response.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    await expect(response.text()).resolves.toContain("provider-neutral-v1");
  });
});
