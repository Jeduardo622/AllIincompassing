import { afterEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();

vi.mock("../supabase", () => ({
  supabase: {
    functions: {
      invoke: vi.fn(),
    },
    auth: {
      getSession: getSessionMock,
    },
  },
}));

describe("useDashboardData dashboard route fetch", () => {
  afterEach(() => {
    getSessionMock.mockReset();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns dashboard payload from /api/dashboard when auth token exists", async () => {
    const payload = { ok: true };
    getSessionMock.mockResolvedValue({
      data: { session: { access_token: "token" } },
      error: null,
    });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: payload }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { fetchDashboardData } = await import("../optimizedQueries");
    const result = await fetchDashboardData();
    expect(result).toEqual(payload);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/dashboard",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: "Bearer token",
        }),
      }),
    );
  });

  it("throws 401 when access token is missing for dashboard route", async () => {
    getSessionMock.mockResolvedValue({
      data: { session: null },
      error: null,
    });
    const { fetchDashboardData } = await import("../optimizedQueries");
    await expect(fetchDashboardData()).rejects.toMatchObject({ status: 401 });
  });
});


