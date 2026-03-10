import { afterEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();

vi.mock("../supabase", () => ({
  supabase: {
    functions: {
      invoke: invokeMock,
    },
  },
}));

describe("useDashboardData edge invocation", () => {
  afterEach(() => {
    invokeMock.mockReset();
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
  });
});


