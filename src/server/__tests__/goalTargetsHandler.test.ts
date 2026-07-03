import { beforeEach, describe, expect, it, vi } from "vitest";
import { goalTargetsHandler } from "../api/goal-targets";

vi.mock("../api/shared", async () => {
  const actual = await vi.importActual<typeof import("../api/shared")>("../api/shared");
  return {
    ...actual,
    currentUserCanManageProgramsGoals: vi.fn(),
    fetchJson: vi.fn(),
    getAccessToken: vi.fn(),
    getAccessTokenSubject: vi.fn(),
    getSupabaseConfig: vi.fn(),
    resolveOrgAndRoleWithStatus: vi.fn(),
  };
});

import {
  currentUserCanManageProgramsGoals,
  fetchJson,
  getAccessToken,
  getAccessTokenSubject,
  getSupabaseConfig,
  resolveOrgAndRoleWithStatus,
} from "../api/shared";

const ACCESS_TOKEN = "token-123";
const ORG_ID = "11111111-1111-4111-8111-111111111111";
const GOAL_ID = "22222222-2222-4222-8222-222222222222";

describe("goalTargetsHandler", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getAccessToken).mockReturnValue(ACCESS_TOKEN);
    vi.mocked(getAccessTokenSubject).mockReturnValue("user-1");
    vi.mocked(getSupabaseConfig).mockReturnValue({
      supabaseUrl: "https://example.supabase.co",
      anonKey: "anon-key",
    });
    vi.mocked(resolveOrgAndRoleWithStatus).mockResolvedValue({
      organizationId: ORG_ID,
      isTherapist: false,
      isAdmin: false,
      isOrgMember: false,
      isSuperAdmin: false,
      upstreamError: false,
    });
  });

  it("denies target creation when the program-goal capability helper rejects the caller", async () => {
    vi.mocked(currentUserCanManageProgramsGoals).mockResolvedValue({ allowed: false, upstreamError: false });

    const response = await goalTargetsHandler(
      new Request("http://localhost/api/goal-targets", {
        method: "POST",
        body: JSON.stringify({
          goal_id: GOAL_ID,
          name: "Requests break",
          measurement_type: "frequency",
        }),
      }),
    );

    expect(response.status).toBe(403);
    expect(currentUserCanManageProgramsGoals).toHaveBeenCalledWith(ACCESS_TOKEN, ORG_ID);
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("returns 502 when the program-goal capability helper cannot be validated", async () => {
    vi.mocked(currentUserCanManageProgramsGoals).mockResolvedValue({ allowed: false, upstreamError: true });

    const response = await goalTargetsHandler(
      new Request("http://localhost/api/goal-targets", {
        method: "POST",
        body: JSON.stringify({
          goal_id: GOAL_ID,
          name: "Requests break",
          measurement_type: "frequency",
        }),
      }),
    );

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Unable to validate program-goal access" });
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("loads targets without duplicating a broad role allowlist in the handler", async () => {
    vi.mocked(fetchJson).mockResolvedValue({
      ok: true,
      status: 200,
      data: [],
    });

    const response = await goalTargetsHandler(
      new Request(`http://localhost/api/goal-targets?goal_id=${GOAL_ID}`, { method: "GET" }),
    );

    expect(response.status).toBe(200);
    expect(currentUserCanManageProgramsGoals).not.toHaveBeenCalled();
    expect(fetchJson).toHaveBeenCalledWith(
      expect.stringContaining("/rest/v1/goal_targets?select=*&organization_id=eq."),
      expect.objectContaining({ method: "GET" }),
    );
  });
});
