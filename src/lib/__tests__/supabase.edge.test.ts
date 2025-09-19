import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
const fetchMock = vi.fn();
const originalFetch = globalThis.fetch;

vi.mock("../supabaseClient", () => ({
  supabase: {
    auth: {
      getSession: getSessionMock,
    },
  },
}));

vi.mock("../runtimeConfig", () => ({
  buildSupabaseEdgeUrl: (path: string) => `https://edge.test/${path}`,
}));

const { callEdge: actualCallEdge } = await vi.importActual<typeof import("../supabase")>("../supabase");

describe("callEdge", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    getSessionMock.mockReset();
    globalThis.fetch = fetchMock;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  it("uses a provided bearer token without consulting the auth client", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));

    await actualCallEdge("sessions-test", { method: "GET" }, { accessToken: "token-123" });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://edge.test/sessions-test",
      expect.objectContaining({ headers: expect.any(Headers) }),
    );
    const headers = fetchMock.mock.calls[0][1]?.headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer token-123");
    expect(getSessionMock).not.toHaveBeenCalled();
  });

  it("attaches the anon apikey when supplied", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));

    await actualCallEdge(
      "sessions-test",
      { method: "POST", headers: new Headers({ "Content-Type": "application/json" }) },
      { accessToken: "token-456", anonKey: "anon-key" },
    );

    const headers = fetchMock.mock.calls[0][1]?.headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer token-456");
    expect(headers.get("apikey")).toBe("anon-key");
  });

  it("falls back to the active session when no token is provided", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    getSessionMock.mockResolvedValue({ data: { session: { access_token: "session-token" } } });

    await actualCallEdge("sessions-test");

    const headers = fetchMock.mock.calls[0][1]?.headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer session-token");
    expect(getSessionMock).toHaveBeenCalled();
  });
});
