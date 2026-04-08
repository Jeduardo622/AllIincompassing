import { afterEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
const getUserMock = vi.fn();
const refreshSessionMock = vi.fn();

vi.mock("../supabase", () => ({
  supabase: {
    functions: {
      invoke: vi.fn(),
    },
    auth: {
      getSession: getSessionMock,
      getUser: getUserMock,
      refreshSession: refreshSessionMock,
    },
  },
}));

describe("useDashboardData dashboard route fetch", () => {
  afterEach(() => {
    getSessionMock.mockReset();
    getUserMock.mockReset();
    refreshSessionMock.mockReset();
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
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const headers = init?.headers as Headers | undefined;
    expect(init?.method).toBe("GET");
    expect(headers?.get("Authorization")).toBe("Bearer token");
  });

  it("refreshes an expired access token before calling /api/dashboard", async () => {
    const exp = Math.floor(Date.now() / 1000) - 120;
    const expiredToken = `x.${Buffer.from(JSON.stringify({ exp }), "utf8").toString("base64url")}.y`;
    getSessionMock.mockResolvedValue({
      data: { session: { access_token: expiredToken } },
      error: null,
    });
    refreshSessionMock.mockResolvedValue({
      data: { session: { access_token: "fresh-token" } },
      error: null,
    });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: { ok: true } }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { fetchDashboardData } = await import("../optimizedQueries");
    await fetchDashboardData();
    expect(refreshSessionMock).toHaveBeenCalled();
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const headers = init?.headers as Headers | undefined;
    expect(headers?.get("Authorization")).toBe("Bearer fresh-token");
  });

  it("surfaces 401 when no access token can be resolved for dashboard route", async () => {
    getSessionMock.mockResolvedValue({
      data: { session: null },
      error: null,
    });
    getUserMock.mockResolvedValue({
      data: { user: null },
      error: null,
    });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: false,
          error: "Missing authorization token",
          code: "unauthorized",
          message: "Missing authorization token",
        }),
        { status: 401 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { fetchDashboardData } = await import("../optimizedQueries");
    await expect(fetchDashboardData()).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalled();
  });
});
