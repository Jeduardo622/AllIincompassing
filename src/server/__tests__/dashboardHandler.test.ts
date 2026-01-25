import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("dashboardHandler", () => {
  const ORIGINAL_ENV = { ...process.env } as NodeJS.ProcessEnv;
  const mockFetch = () => vi.spyOn(globalThis, "fetch");

  beforeEach(async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_ANON_KEY = "anon";
    process.env.DEFAULT_ORGANIZATION_ID = "org-default";
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = { ...ORIGINAL_ENV } as NodeJS.ProcessEnv;
  });

  const createRequest = (method: string, token?: string) =>
    new Request("http://localhost/api/dashboard", {
      method,
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });

  it("returns 401 when missing Authorization header", async () => {
    const { dashboardHandler } = await import("../api/dashboard");
    const response = await dashboardHandler(createRequest("GET"));
    expect(response.status).toBe(401);
  });

  it("falls back to the default organization when org resolution fails", async () => {
    const body = { sessions: [] };
    const fetchSpy = mockFetch();
    fetchSpy.mockResolvedValueOnce(new Response("null", { status: 200, headers: { "content-type": "application/json" } })); // org
    fetchSpy.mockResolvedValueOnce(new Response("true", { status: 200, headers: { "content-type": "application/json" } })); // org_admin
    fetchSpy.mockResolvedValueOnce(new Response("false", { status: 200, headers: { "content-type": "application/json" } })); // therapist
    fetchSpy.mockResolvedValueOnce(new Response("false", { status: 200, headers: { "content-type": "application/json" } })); // super_admin
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })); // rpc

    vi.doMock("../runtimeConfig", async () => {
      const actual = await vi.importActual<typeof import("../runtimeConfig")>("../runtimeConfig");
      return {
        ...actual,
        getDefaultOrganizationId: () => "org-default",
      };
    });

    try {
      const { dashboardHandler } = await import("../api/dashboard");
      const response = await dashboardHandler(createRequest("GET", "token"));
      expect(fetchSpy).toHaveBeenCalledTimes(5);
      const roleRequest = fetchSpy.mock.calls[1]?.[1] as RequestInit | undefined;
      expect(typeof roleRequest?.body).toBe("string");
      if (typeof roleRequest?.body === "string") {
        expect(JSON.parse(roleRequest.body)).toMatchObject({ target_organization_id: "org-default" });
      }
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject(body);
    } finally {
      vi.doUnmock("../runtimeConfig");
    }
  });

  it("returns 403 when no organization context is available", async () => {
    const fetchSpy = mockFetch();
    fetchSpy.mockResolvedValueOnce(new Response("null", { status: 200, headers: { "content-type": "application/json" } }));

    vi.doMock("../runtimeConfig", async () => {
      const actual = await vi.importActual<typeof import("../runtimeConfig")>("../runtimeConfig");
      return {
        ...actual,
        getDefaultOrganizationId: () => null,
      };
    });

    try {
      const { dashboardHandler } = await import("../api/dashboard");
      const response = await dashboardHandler(createRequest("GET", "token"));
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(response.status).toBe(403);
    } finally {
      vi.doUnmock("../runtimeConfig");
    }
  });

  it("returns payload when RPC succeeds", async () => {
    const fetchSpy = mockFetch();
    // org id
    fetchSpy.mockResolvedValueOnce(new Response("\"org-1\"", { status: 200, headers: { "content-type": "application/json" } }));
    // role check (org_admin)
    fetchSpy.mockResolvedValueOnce(new Response("true", { status: 200, headers: { "content-type": "application/json" } }));
    // therapist check
    fetchSpy.mockResolvedValueOnce(new Response("false", { status: 200, headers: { "content-type": "application/json" } }));
    // super admin check
    fetchSpy.mockResolvedValueOnce(new Response("false", { status: 200, headers: { "content-type": "application/json" } }));
    // get_dashboard_data
    const body = { todaySessions: [], incompleteSessions: [] };
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));

    const { dashboardHandler } = await import("../api/dashboard");
    const response = await dashboardHandler(createRequest("GET", "token"));
    expect(fetchSpy).toHaveBeenCalledTimes(5);
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toMatchObject(body);
  });

  it("calls get_dashboard_data using caller JWT (anon apikey + bearer token)", async () => {
    const fetchSpy = mockFetch();
    fetchSpy.mockResolvedValueOnce(new Response("\"org-1\"", { status: 200, headers: { "content-type": "application/json" } }));
    fetchSpy.mockResolvedValueOnce(new Response("true", { status: 200, headers: { "content-type": "application/json" } }));
    fetchSpy.mockResolvedValueOnce(new Response("false", { status: 200, headers: { "content-type": "application/json" } }));
    fetchSpy.mockResolvedValueOnce(new Response("false", { status: 200, headers: { "content-type": "application/json" } }));
    const body = { todaySessions: [], incompleteSessions: [] };
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));

    const { dashboardHandler } = await import("../api/dashboard");
    const response = await dashboardHandler(createRequest("GET", "caller-token"));
    expect(response.status).toBe(200);

    const rpcCall = fetchSpy.mock.calls[4];
    expect(rpcCall?.[0]).toMatch("/rest/v1/rpc/get_dashboard_data");
    const rpcInit = rpcCall?.[1] as RequestInit | undefined;
    expect(rpcInit?.headers).toMatchObject({
      apikey: "anon",
      Authorization: "Bearer caller-token",
    });
  });

  it("maps downstream failures to 403 when applicable", async () => {
    const fetchSpy = mockFetch();
    // org id
    fetchSpy.mockResolvedValueOnce(new Response("\"org-1\"", { status: 200, headers: { "content-type": "application/json" } }));
    // role check -> false
    fetchSpy.mockResolvedValueOnce(new Response("false", { status: 200, headers: { "content-type": "application/json" } }));
    // therapist check -> false
    fetchSpy.mockResolvedValueOnce(new Response("false", { status: 200, headers: { "content-type": "application/json" } }));
    // super admin check -> false
    fetchSpy.mockResolvedValueOnce(new Response("false", { status: 200, headers: { "content-type": "application/json" } }));

    const { dashboardHandler } = await import("../api/dashboard");
    const response = await dashboardHandler(createRequest("GET", "token"));
    expect(response.status).toBe(403);
  });
});


