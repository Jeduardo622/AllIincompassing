import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchWithRetryMock = vi.hoisted(() => vi.fn());

vi.mock("../retry", () => ({
  fetchWithRetry: fetchWithRetryMock,
}));

describe("sdk client", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchWithRetryMock.mockReset();
    fetchMock.mockResolvedValue(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("attaches auth and trace headers for same-origin API routes", async () => {
    const { callApiRoute } = await import("../sdk/client");
    await callApiRoute(
      "/api/book",
      { method: "POST", body: JSON.stringify({}) },
      {
        accessToken: "token-123",
        anonKey: "anon-xyz",
        trace: {
          requestId: "req-1",
          correlationId: "corr-1",
          agentOperationId: "agent-1",
        },
      },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe("Bearer token-123");
    expect(headers.get("apikey")).toBe("anon-xyz");
    expect(headers.get("x-request-id")).toBe("req-1");
    expect(headers.get("x-correlation-id")).toBe("corr-1");
    expect(headers.get("x-agent-operation-id")).toBe("agent-1");
  });

  it("does not attach auth headers to cross-origin API routes", async () => {
    const { authenticatedFetch } = await import("../sdk/client");
    await authenticatedFetch("https://example.com/api/book", { method: "GET" }, { accessToken: "token-123" });

    const [, init] = fetchMock.mock.calls[0];
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBeNull();
  });

  it("attaches auth headers for edge routes that explicitly allow cross-origin auth", async () => {
    const { callEdgeRoute } = await import("../sdk/client");
    await callEdgeRoute(
      "sessions-start",
      (functionName) => `https://edge.example.com/functions/v1/${functionName}`,
      { method: "POST" },
      { accessToken: "token-123" },
    );

    const [, init] = fetchMock.mock.calls[0];
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe("Bearer token-123");
  });

  it("uses fetchWithRetry when retry options are supplied", async () => {
    const { authenticatedFetch } = await import("../sdk/client");
    fetchWithRetryMock.mockResolvedValueOnce(new Response("retry-ok", { status: 200 }));

    await authenticatedFetch("/api/runtime-config", { method: "GET" }, { retry: { maxAttempts: 2 } });

    expect(fetchWithRetryMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
