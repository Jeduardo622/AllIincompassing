import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimitsForTests } from "../api/shared";

const serverLoggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock("../../lib/logger/server", () => ({
  serverLogger: serverLoggerMock,
}));

describe("dashboardHandler", () => {
  const ORIGINAL_ENV = { ...process.env } as NodeJS.ProcessEnv;
  const mockFetch = () => vi.spyOn(globalThis, "fetch");

  beforeEach(async () => {
    resetRateLimitsForTests();
    vi.useRealTimers();
    serverLoggerMock.info.mockReset();
    serverLoggerMock.warn.mockReset();
    serverLoggerMock.error.mockReset();
    serverLoggerMock.debug.mockReset();
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_ANON_KEY = "anon";
    process.env.API_AUTHORITY_MODE = "edge";
    delete process.env.SUPABASE_EDGE_URL;
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = { ...ORIGINAL_ENV } as NodeJS.ProcessEnv;
  });

  const createRequest = (method: string, token?: string) =>
    new Request("http://localhost/api/dashboard", {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        Origin: "http://localhost:3000",
      },
    });

  it("returns CORS headers for OPTIONS requests", async () => {
    const { dashboardHandler } = await import("../api/dashboard");
    const response = await dashboardHandler(createRequest("OPTIONS"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:3000");
  });

  it("rejects disallowed origins", async () => {
    const fetchSpy = mockFetch();
    const { dashboardHandler } = await import("../api/dashboard");
    const response = await dashboardHandler(new Request("http://localhost/api/dashboard", {
      method: "GET",
      headers: {
        Authorization: "Bearer token",
        Origin: "https://attacker.example.com",
      },
    }));
    expect(response.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns 401 when missing Authorization header", async () => {
    const { dashboardHandler } = await import("../api/dashboard");
    const response = await dashboardHandler(createRequest("GET"));
    expect(response.status).toBe(401);
  });

  it("prefers X-Supabase-Authorization when Authorization bearer token is empty", async () => {
    const fetchSpy = mockFetch();
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true, data: { ok: true } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const { dashboardHandler } = await import("../api/dashboard");
    const response = await dashboardHandler(
      new Request("http://localhost/api/dashboard", {
        method: "GET",
        headers: {
          Authorization: "Bearer ",
          "X-Supabase-Authorization": "Bearer real-token",
          Origin: "http://localhost:3000",
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("accepts X-Supabase-Authorization when Authorization is absent", async () => {
    const fetchSpy = mockFetch();
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: { ok: true } }), { status: 200, headers: { "content-type": "application/json" } }));

    const { dashboardHandler } = await import("../api/dashboard");
    const response = await dashboardHandler(
      new Request("http://localhost/api/dashboard", {
        method: "GET",
        headers: {
          "X-Supabase-Authorization": "Bearer token-from-fallback",
          Origin: "http://localhost:3000",
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("accepts lowercase bearer prefix", async () => {
    const fetchSpy = mockFetch();
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: { ok: true } }), { status: 200, headers: { "content-type": "application/json" } }));

    const { dashboardHandler } = await import("../api/dashboard");
    const response = await dashboardHandler(new Request("http://localhost/api/dashboard", {
      method: "GET",
      headers: {
        Authorization: "bearer token-lower",
        Origin: "http://localhost:3000",
      },
    }));

    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("proxies /api/dashboard to edge authority", async () => {
    const fetchSpy = mockFetch();
    const body = { success: true, data: { todaySessions: [] } };
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));

    const { dashboardHandler } = await import("../api/dashboard");
    const response = await dashboardHandler(createRequest("GET", "token"));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toMatchObject(body);
  });

  it("propagates x-request-id to the edge authority and response", async () => {
    const fetchSpy = mockFetch();
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: { ok: true } }), { status: 200 }));

    const { dashboardHandler } = await import("../api/dashboard");
    const response = await dashboardHandler(
      new Request("http://localhost/api/dashboard", {
        method: "GET",
        headers: {
          Authorization: "Bearer token",
          Origin: "http://localhost:3000",
          "x-request-id": "dash-req-1",
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe("dash-req-1");
    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(init.headers).get("x-request-id")).toBe("dash-req-1");
  });

  it("returns upstream_error when edge authority request throws", async () => {
    const fetchSpy = mockFetch();
    fetchSpy.mockRejectedValueOnce(new TypeError("fetch failed"));

    const { dashboardHandler } = await import("../api/dashboard");
    const response = await dashboardHandler(createRequest("GET", "token"));

    expect(response.status).toBe(502);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:3000");
    await expect(response.json()).resolves.toMatchObject({
      code: "upstream_error",
      classification: expect.objectContaining({
        retryable: true,
        httpStatus: 502,
      }),
      message: "Failed to load dashboard data",
      success: false,
    });
  });

  it("aborts slow edge authority requests before the platform timeout and returns a typed upstream error", async () => {
    vi.useFakeTimers();
    const fetchSpy = mockFetch();
    fetchSpy.mockImplementationOnce((_, init) => new Promise<Response>((_, reject) => {
      const signal = (init as RequestInit)?.signal;
      if (!(signal instanceof AbortSignal)) {
        reject(new Error("missing abort signal"));
        return;
      }
      signal.addEventListener("abort", () => reject(new DOMException("The operation was aborted", "AbortError")));
    }));

    const { dashboardHandler } = await import("../api/dashboard");
    const promise = dashboardHandler(
      new Request("http://localhost/api/dashboard", {
        method: "GET",
        headers: {
          Authorization: "Bearer secret-dashboard-token",
          Origin: "http://localhost:3000",
          "x-request-id": "dash-timeout-req",
        },
      }),
    );
    await vi.advanceTimersByTimeAsync(8_000);
    const response = await promise;
    const text = await response.text();

    expect(response.status).toBe(502);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:3000");
    expect(response.headers.get("x-request-id")).toBe("dash-timeout-req");
    expect(text).not.toContain("secret-dashboard-token");
    expect(text).not.toContain("anon");
    expect(JSON.parse(text)).toMatchObject({
      requestId: "dash-timeout-req",
      code: "upstream_error",
      message: "Failed to load dashboard data",
      success: false,
      upstream: "get-dashboard-data",
      timedOut: true,
      classification: expect.objectContaining({
        retryable: true,
        httpStatus: 502,
      }),
    });
    expect(serverLoggerMock.warn).toHaveBeenCalledWith(
      "dashboard proxy upstream failed",
      expect.not.objectContaining({
        accessToken: expect.anything(),
        apikey: expect.anything(),
      }),
    );
    expect(JSON.stringify(serverLoggerMock.warn.mock.calls)).not.toContain("secret-dashboard-token");
    expect(JSON.stringify(serverLoggerMock.warn.mock.calls)).not.toContain("anon");
  });

  it("aborts when edge authority headers arrive but the response body stalls", async () => {
    vi.useFakeTimers();
    const fetchSpy = mockFetch();
    const stalledResponse = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"success":'));
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
    fetchSpy.mockResolvedValueOnce(stalledResponse);

    const { dashboardHandler } = await import("../api/dashboard");
    const promise = dashboardHandler(createRequest("GET", "token"));
    await vi.advanceTimersByTimeAsync(8_000);
    const response = await promise;
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(body).toMatchObject({
      code: "upstream_error",
      success: false,
      upstream: "get-dashboard-data",
      timedOut: true,
    });
  });

  it("generates a request ID and uses the same ID upstream and in the response", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue("generated-dashboard-request-id");
    const fetchSpy = mockFetch();
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: { ok: true } }), { status: 200 }));

    const { dashboardHandler } = await import("../api/dashboard");
    const response = await dashboardHandler(createRequest("GET", "token"));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe("generated-dashboard-request-id");
    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(init.headers).get("x-request-id")).toBe("generated-dashboard-request-id");
  });

  it("logs only long correlation suffixes for caller-provided correlation identifiers", async () => {
    const fetchSpy = mockFetch();
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: { ok: true } }), { status: 200 }));

    const { dashboardHandler } = await import("../api/dashboard");
    await dashboardHandler(
      new Request("http://localhost/api/dashboard", {
        method: "GET",
        headers: {
          Authorization: "Bearer token",
          Origin: "http://localhost:3000",
          "x-correlation-id": "sensitive-correlation-value",
        },
      }),
    );

    const logs = JSON.stringify(serverLoggerMock.info.mock.calls);
    expect(logs).toContain("on-value");
    expect(logs).not.toContain("sensitive-correlation-value");
  });

  it("does not log short caller-provided correlation identifiers verbatim", async () => {
    const fetchSpy = mockFetch();
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: { ok: true } }), { status: 200 }));

    const { dashboardHandler } = await import("../api/dashboard");
    await dashboardHandler(
      new Request("http://localhost/api/dashboard", {
        method: "GET",
        headers: {
          Authorization: "Bearer token",
          Origin: "http://localhost:3000",
          "x-correlation-id": "shortid",
        },
      }),
    );

    expect(JSON.stringify(serverLoggerMock.info.mock.calls)).not.toContain("shortid");
  });

  it("returns a typed upstream error when the edge authority URL is not HTTP(S)", async () => {
    process.env.SUPABASE_EDGE_URL = "postgres://user:password@example.supabase.co:5432/postgres";
    const fetchSpy = mockFetch();

    const { dashboardHandler } = await import("../api/dashboard");
    const response = await dashboardHandler(createRequest("GET", "token"));
    const text = await response.text();

    expect(response.status).toBe(502);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(text).not.toContain("password");
    expect(JSON.parse(text)).toMatchObject({
      code: "upstream_error",
      success: false,
      upstream: "get-dashboard-data",
    });
  });

  it("rethrows non-transport failures instead of relabeling them as upstream errors", async () => {
    const fetchSpy = mockFetch();
    fetchSpy.mockRejectedValueOnce(new Error("unexpected parse failure"));

    const { dashboardHandler } = await import("../api/dashboard");

    await expect(dashboardHandler(createRequest("GET", "token"))).rejects.toThrow(
      /unexpected parse failure/i,
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("rethrows non-network TypeErrors instead of relabeling them as upstream errors", async () => {
    const fetchSpy = mockFetch();
    fetchSpy.mockRejectedValueOnce(new TypeError("invalid url format"));

    const { dashboardHandler } = await import("../api/dashboard");

    await expect(dashboardHandler(createRequest("GET", "token"))).rejects.toThrow(
      /invalid url format/i,
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});


