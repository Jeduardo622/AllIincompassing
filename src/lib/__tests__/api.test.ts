import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.hoisted(() => vi.fn());
const getUserMock = vi.hoisted(() => vi.fn());
const callApiRouteMock = vi.hoisted(() => vi.fn());
const callEdgeRouteMock = vi.hoisted(() => vi.fn());

vi.mock("../supabase", () => ({
  supabase: {
    auth: {
      getSession: getSessionMock,
      getUser: getUserMock,
    },
  },
}));

vi.mock("../sdk/client", () => ({
  callApiRoute: callApiRouteMock,
  callEdgeRoute: callEdgeRouteMock,
}));

describe("lib/api access token resolution", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    callApiRouteMock.mockResolvedValue(new Response(null, { status: 204 }));
    callEdgeRouteMock.mockResolvedValue(new Response(null, { status: 204 }));
  });

  it("uses existing session access token when available", async () => {
    getSessionMock.mockResolvedValue({
      data: { session: { access_token: "token-primary" } },
    });

    const { callApi } = await import("../api");
    await callApi("/api/sessions-complete", { method: "POST", body: "{}" });

    const options = callApiRouteMock.mock.calls[0]?.[2] as { getAccessToken?: () => Promise<string | null> };
    const token = await options.getAccessToken?.();
    expect(token).toBe("token-primary");
    expect(getUserMock).not.toHaveBeenCalled();
  });

  it("rehydrates token when session is initially empty but user exists", async () => {
    getSessionMock
      .mockResolvedValueOnce({ data: { session: null } })
      .mockResolvedValueOnce({ data: { session: { access_token: "token-reloaded" } } });
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });

    const { callApi } = await import("../api");
    await callApi("/api/sessions-complete", { method: "POST", body: "{}" });

    const options = callApiRouteMock.mock.calls[0]?.[2] as { getAccessToken?: () => Promise<string | null> };
    const token = await options.getAccessToken?.();
    expect(token).toBe("token-reloaded");
    expect(getUserMock).toHaveBeenCalledTimes(1);
  });
});
