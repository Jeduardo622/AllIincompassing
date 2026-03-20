import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimitsForTests } from "../api/shared";

describe("dashboardHandler", () => {
  const ORIGINAL_ENV = { ...process.env } as NodeJS.ProcessEnv;
  const mockFetch = () => vi.spyOn(globalThis, "fetch");

  beforeEach(async () => {
    resetRateLimitsForTests();
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_ANON_KEY = "anon";
    process.env.API_AUTHORITY_MODE = "edge";
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
});


