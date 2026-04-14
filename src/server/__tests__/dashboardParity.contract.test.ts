import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimitsForTests } from "../api/shared";

describe("dashboardHandler edge proxy parity (WIN-38F / A07)", () => {
  const ORIGINAL_ENV = { ...process.env } as NodeJS.ProcessEnv;

  beforeEach(() => {
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

  const createDashboardGet = (token: string) =>
    new Request("http://localhost/api/dashboard", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Origin: "http://localhost:3000",
      },
    });

  it("passes through edge 403 status and JSON body unchanged", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const edgeBody = JSON.stringify({
      requestId: "parity-req-1",
      code: "missing_org",
      message: "Organization context required",
      classification: { category: "auth", severity: "medium", retryable: false, httpStatus: 403 },
    });
    fetchSpy.mockResolvedValueOnce(
      new Response(edgeBody, { status: 403, headers: { "content-type": "application/json" } }),
    );

    const { dashboardHandler } = await import("../api/dashboard");
    const response = await dashboardHandler(createDashboardGet("edge-token"));

    expect(response.status).toBe(403);
    expect(await response.text()).toBe(edgeBody);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("forwards Retry-After when edge returns 429", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const edgeBody = JSON.stringify({ code: "rate_limited", message: "Too many requests" });
    fetchSpy.mockResolvedValueOnce(
      new Response(edgeBody, {
        status: 429,
        headers: { "content-type": "application/json", "Retry-After": "42" },
      }),
    );

    const { dashboardHandler } = await import("../api/dashboard");
    const response = await dashboardHandler(createDashboardGet("token"));

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("42");
    expect(await response.json()).toEqual(JSON.parse(edgeBody));
  });
});
