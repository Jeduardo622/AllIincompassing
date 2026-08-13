import { beforeEach, describe, expect, it, vi } from "vitest";
import { payrollTimesheetsHandler } from "../api/payroll-timesheets";

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

describe("payrollTimesheetsHandler", () => {
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
    vi.mocked(getSupabaseConfig).mockReturnValue({
      supabaseUrl: "https://example.supabase.co",
      anonKey: "anon-key",
    });
    vi.mocked(resolveUserRoleWithStatus).mockResolvedValue({ role: "bt", upstreamError: false });
  });

  it("rejects roles outside the Edge payroll allowlist before forwarding or calling legacy RPCs", async () => {
    vi.mocked(getApiAuthorityMode).mockReturnValue("legacy");
    vi.mocked(resolveUserRoleWithStatus).mockResolvedValueOnce({ role: "client", upstreamError: false });

    const response = await payrollTimesheetsHandler(
      new Request("http://localhost/api/payroll-timesheets", {
        method: "POST",
        headers: { Authorization: `Bearer ${createAuthToken()}` },
        body: JSON.stringify({ action: "get_period", selectedLocalDate: "2026-08-11" }),
      }),
    );

    expect(response.status).toBe(403);
    expect(vi.mocked(proxyToEdgeAuthority)).not.toHaveBeenCalled();
    expect(vi.mocked(fetchJson)).not.toHaveBeenCalled();
  });

  it("proxies to edge authority and preserves idempotency headers", async () => {
    vi.mocked(getApiAuthorityMode).mockReturnValue("edge");
    vi.mocked(proxyToEdgeAuthority).mockResolvedValue(
      new Response(JSON.stringify({ snapshotId: "snapshot-1", idempotencyKey: "timesheet-key-1" }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "timesheet-key-1",
          "Idempotent-Replay": "false",
        },
      }),
    );

    const request = new Request("http://localhost/api/payroll-timesheets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${createAuthToken()}`,
        "Idempotency-Key": "client-key",
      },
      body: JSON.stringify({
        action: "derive_snapshot",
        selectedLocalDate: "2026-08-11",
      }),
    });

    const response = await payrollTimesheetsHandler(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("Idempotency-Key")).toBe("timesheet-key-1");
    expect(response.headers.get("Idempotent-Replay")).toBe("false");
  });

  it("rejects authority fields before any legacy RPC call", async () => {
    vi.mocked(getApiAuthorityMode).mockReturnValue("legacy");

    const response = await payrollTimesheetsHandler(
      new Request("http://localhost/api/payroll-timesheets", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${createAuthToken()}`,
        },
        body: JSON.stringify({
          action: "get_period",
          selectedLocalDate: "2026-08-11",
          employmentProfileId: "99999999-9999-9999-9999-999999999999",
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(vi.mocked(fetchJson)).not.toHaveBeenCalled();
  });

  it("calls derive_timesheet_snapshot in legacy mode with only the caller token", async () => {
    vi.mocked(getApiAuthorityMode).mockReturnValue("legacy");
    vi.mocked(fetchJson).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        snapshot_id: "77777777-7777-7777-7777-777777777777",
        replayed: false,
      },
    });

    const response = await payrollTimesheetsHandler(
      new Request("http://localhost/api/payroll-timesheets", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${createAuthToken()}`,
          "Idempotency-Key": "timesheet-runtime-key",
        },
        body: JSON.stringify({
          action: "derive_snapshot",
          selectedLocalDate: "2026-08-11",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(vi.mocked(fetchJson)).toHaveBeenCalledWith(
      "https://example.supabase.co/rest/v1/rpc/derive_timesheet_snapshot",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          apikey: "anon-key",
          Authorization: `Bearer ${createAuthToken()}`,
        }),
        body: JSON.stringify({
          selected_local_date: "2026-08-11",
          p_idempotency_key: "timesheet-runtime-key",
        }),
      }),
    );
  });

  it("keeps HTTP-200 blocked derive payloads intact in legacy mode", async () => {
    vi.mocked(getApiAuthorityMode).mockReturnValue("legacy");
    vi.mocked(fetchJson).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        state: "blocked",
        snapshotId: null,
        sourceHash: null,
        lockable: false,
        period: {
          localDate: "2026-08-11",
          periodStart: "2026-08-10",
          periodEnd: "2026-08-16",
        },
        totals: {
          regularSeconds: 0,
          overtimeSeconds: 0,
          doubleTimeSeconds: 0,
          mealPremiumCents: 0,
          grossEarningsCents: 0,
        },
        exceptions: [
          {
            code: "meal_unresolved",
            blocking: true,
          },
        ],
      },
    });

    const response = await payrollTimesheetsHandler(
      new Request("http://localhost/api/payroll-timesheets", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${createAuthToken()}`,
          "Idempotency-Key": "timesheet-runtime-key",
        },
        body: JSON.stringify({
          action: "derive_snapshot",
          selectedLocalDate: "2026-08-11",
        }),
      }),
    );

    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      state: "blocked",
      snapshotId: null,
      sourceHash: null,
      idempotencyKey: "timesheet-runtime-key",
      exceptions: [
        expect.objectContaining({
          code: "meal_unresolved",
          blocking: true,
        }),
      ],
    });
  });
});
