import { afterEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
const getSessionMock = vi.fn();

vi.mock("../supabase", () => ({
  supabase: {
    functions: {
      invoke: invokeMock,
    },
    auth: {
      getSession: getSessionMock,
    },
  },
}));

describe("useDashboardData edge invocation", () => {
  afterEach(() => {
    invokeMock.mockReset();
    getSessionMock.mockReset();
    vi.restoreAllMocks();
  });

  it("returns dashboard payload when edge invoke succeeds", async () => {
    const payload = { ok: true };
    invokeMock.mockResolvedValue({ data: { success: true, data: payload }, error: null });
    const { fetchDashboardData } = await import("../optimizedQueries");
    const result = await fetchDashboardData();
    expect(result).toEqual(payload);
    expect(invokeMock).toHaveBeenCalledWith(
      "get-dashboard-data",
      expect.objectContaining({ body: {} }),
    );
  });

  it("throws error with status from edge invoke failure context", async () => {
    invokeMock.mockResolvedValue({
      data: null,
      error: { message: "Forbidden", context: { status: 403 } },
    });
    const { fetchDashboardData } = await import("../optimizedQueries");
    await expect(fetchDashboardData()).rejects.toMatchObject({ status: 403 });
    expect(getSessionMock).not.toHaveBeenCalled();
  });

  it("falls back to /api/dashboard when edge invoke fails", async () => {
    const payload = { todaySessions: [] };
    getSessionMock.mockResolvedValue({
      data: { session: { access_token: "token" } },
      error: null,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ success: true, data: payload }), { status: 200 }),
      ),
    );
    invokeMock.mockResolvedValue({
      data: null,
      error: { message: "Edge unavailable", context: { status: 503 } },
    });

    const { fetchDashboardData } = await import("../optimizedQueries");
    await expect(fetchDashboardData()).resolves.toEqual(payload);
  });
});


