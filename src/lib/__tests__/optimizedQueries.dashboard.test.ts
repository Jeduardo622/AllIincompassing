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

describe("useDashboardData /api/dashboard fetch", () => {
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
    const url = String(fetchMock.mock.calls[0]?.[0] ?? "");
    expect(url).toContain("/api/dashboard");
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const headers = init?.headers as Headers | undefined;
    expect(init?.method).toBe("GET");
    expect(init?.cache).toBe("no-store");
    expect(headers?.get("Authorization")).toBe("Bearer token");
    expect(headers?.get("X-Supabase-Authorization")).toBe("Bearer token");
    expect(headers?.get("apikey")).toBe("test-anon-key");
    expect(headers?.get("Content-Type")).toBeNull();
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
    expect(headers?.get("X-Supabase-Authorization")).toBe("Bearer fresh-token");
    expect(headers?.get("apikey")).toBe("test-anon-key");
  });

  it("does not call /api/dashboard when no access token can be resolved", async () => {
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
          error: "Unauthorized",
          code: "unauthorized",
        }),
        { status: 401 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { fetchDashboardData } = await import("../optimizedQueries");
    await expect(fetchDashboardData()).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
