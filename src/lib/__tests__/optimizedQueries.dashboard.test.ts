import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
const originalFetch = globalThis.fetch;

vi.mock("../supabaseClient", () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: "token" } } }),
    },
  },
}));

describe("useDashboardData proxy", () => {
  beforeEach(async () => {
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("returns data when /api/dashboard is 200", async () => {
    const payload = { ok: true };
    fetchMock.mockResolvedValue(new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } }));
    const { useDashboardData } = await import("../optimizedQueries");

    // emulate query fn directly
    const result = await (useDashboardData() as any).options.queryFn();
    expect(result).toEqual(payload);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/dashboard",
      expect.objectContaining({ method: "GET", headers: expect.any(Headers) }),
    );
  });

  it("throws error with status on 403", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }));
    const { useDashboardData } = await import("../optimizedQueries");
    await expect((useDashboardData() as any).options.queryFn()).rejects.toMatchObject({ status: 403 });
  });
});


