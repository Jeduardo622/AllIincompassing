import { beforeEach, describe, expect, it, vi } from "vitest";
import { goalDataPointsHandler } from "../api/goal-data-points";

vi.mock("../api/shared", async () => {
  const actual = await vi.importActual<typeof import("../api/shared")>("../api/shared");
  return {
    ...actual,
    getAccessToken: vi.fn(),
    resolveOrgAndRole: vi.fn(),
    getSupabaseConfig: vi.fn(),
    getAccessTokenSubject: vi.fn(),
    fetchJson: vi.fn(),
  };
});

import {
  fetchJson,
  getAccessToken,
  getAccessTokenSubject,
  getSupabaseConfig,
  resolveOrgAndRole,
} from "../api/shared";

describe("goalDataPointsHandler", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns 400 when no filter is provided on GET", async () => {
    vi.mocked(getAccessToken).mockReturnValue("token");
    vi.mocked(resolveOrgAndRole).mockResolvedValue({
      organizationId: "org-1",
      isTherapist: true,
      isAdmin: false,
      isSuperAdmin: false,
    });
    vi.mocked(getSupabaseConfig).mockReturnValue({
      supabaseUrl: "https://example.supabase.co",
      anonKey: "anon",
    });

    const response = await goalDataPointsHandler(
      new Request("http://localhost/api/goal-data-points", {
        method: "GET",
        headers: { Authorization: "Bearer token" },
      }),
    );
    expect(response.status).toBe(400);
  });

  it("creates a goal data point when payload is valid", async () => {
    vi.mocked(getAccessToken).mockReturnValue("token");
    vi.mocked(getAccessTokenSubject).mockReturnValue("user-1");
    vi.mocked(resolveOrgAndRole).mockResolvedValue({
      organizationId: "org-1",
      isTherapist: true,
      isAdmin: false,
      isSuperAdmin: false,
    });
    vi.mocked(getSupabaseConfig).mockReturnValue({
      supabaseUrl: "https://example.supabase.co",
      anonKey: "anon",
    });

    vi.mocked(fetchJson)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: [{ id: "goal-1", client_id: "11111111-1111-1111-1111-111111111111" }],
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: [{ id: "session-1", client_id: "11111111-1111-1111-1111-111111111111" }],
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        data: [{ id: "point-1" }],
      });

    const response = await goalDataPointsHandler(
      new Request("http://localhost/api/goal-data-points", {
        method: "POST",
        headers: { Authorization: "Bearer token" },
        body: JSON.stringify({
          goal_id: "11111111-1111-1111-1111-111111111111",
          session_id: "22222222-2222-2222-2222-222222222222",
          metric_name: "opportunities",
          metric_value: 5,
          metric_payload: { prompt_level: "with prompts" },
        }),
      }),
    );

    expect(response.status).toBe(201);
    expect(fetchJson).toHaveBeenCalledWith(
      expect.stringContaining("/rest/v1/goal_data_points"),
      expect.objectContaining({ method: "POST" }),
    );
  });
});
