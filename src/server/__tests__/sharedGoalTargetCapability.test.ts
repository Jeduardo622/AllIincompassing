import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../env", () => ({
  getOptionalServerEnv: (key: string) => {
    if (key === "SUPABASE_URL") return "https://example.supabase.co/";
    if (key === "SUPABASE_ANON_KEY") return "anon-key";
    return undefined;
  },
  getRequiredServerEnv: vi.fn(),
}));

import { currentUserCanDeleteGoalTargets } from "../api/shared";

describe("currentUserCanDeleteGoalTargets", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("calls the restricted RPC with bearer credentials and organization scope", async () => {
    fetchMock.mockResolvedValue(new Response("true", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    await expect(currentUserCanDeleteGoalTargets("access-token", "org-1")).resolves.toEqual({
      allowed: true,
      upstreamError: false,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.supabase.co/rest/v1/rpc/current_user_can_delete_goal_targets",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: "anon-key",
          Authorization: "Bearer access-token",
        },
        body: JSON.stringify({ target_organization_id: "org-1" }),
      },
    );
  });
});
