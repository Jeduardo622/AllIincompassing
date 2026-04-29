import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stubDenoEnv } from "../utils/stubDeno";

const envValues = new Map<string, string>([
  ["CORS_ALLOWED_ORIGINS", "https://app.example.com"],
  ["APP_ENV", "production"],
]);

stubDenoEnv((key) => envValues.get(key) ?? "");

function createDashboardRequest(method: string, xfwdSuffix: string) {
  return new Request("https://edge.example/functions/v1/get-dashboard-data", {
    method,
    headers: {
      "x-request-id": `req-dash-${xfwdSuffix}`,
      "x-forwarded-for": `dash-parity-${xfwdSuffix}`,
    },
  });
}

async function loadDashboardModule() {
  return import("../../supabase/functions/get-dashboard-data/index.ts");
}

describe("get-dashboard-data organization context parity", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useRealTimers();
    envValues.delete("DEFAULT_ORGANIZATION_ID");
  });

  afterEach(() => {
    vi.useRealTimers();
    envValues.delete("DEFAULT_ORGANIZATION_ID");
  });

  it("returns 403 missing_org when org context is missing and caller is not super_admin", async () => {
    const mod = await loadDashboardModule();
    const db = {
      rpc: async (fn: string) => {
        if (fn === "current_user_organization_id") return { data: null, error: null };
        if (fn === "current_user_is_super_admin") return { data: false, error: null };
        return { data: null, error: null };
      },
    };
    const response = await mod.handleGetDashboardData({
      req: createDashboardRequest("GET", "a"),
      db: db as never,
    });
    expect(response.status).toBe(403);
    const body = (await response.json()) as { code?: string };
    expect(body.code).toBe("missing_org");
  });

  it("super_admin resolves organization_id from user_metadata then returns dashboard payload", async () => {
    const mod = await loadDashboardModule();
    const adminRpc = vi.fn(async (fn: string, payload?: Record<string, unknown>) => {
      expect(fn).toBe("get_dashboard_data_for_org");
      expect(payload).toMatchObject({
        actor_user_id: "user-1",
        target_organization_id: "org-from-metadata",
      });
      return { data: { todaySessions: [] }, error: null };
    });
    const db = {
      rpc: async (fn: string) => {
        if (fn === "current_user_organization_id") return { data: null, error: null };
        if (fn === "current_user_is_super_admin") return { data: true, error: null };
        return { data: null, error: null };
      },
      auth: {
        getUser: vi.fn(async () => ({
          data: {
            user: {
              id: "user-1",
              user_metadata: { organization_id: "org-from-metadata" },
            },
          },
          error: null,
        })),
      },
      from: () => {
        throw new Error("profiles query should not run when metadata provides organization");
      },
    };
    const response = await mod.handleGetDashboardData({
      req: createDashboardRequest("GET", "b"),
      db: db as never,
      adminDb: { rpc: adminRpc } as never,
    });
    expect(response.status).toBe(200);
    expect(adminRpc).toHaveBeenCalledTimes(1);
    const body = (await response.json()) as { success?: boolean; data?: { todaySessions?: unknown[] } };
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data?.todaySessions)).toBe(true);
  });

  it("maps RPC error code 42501 to 403 forbidden", async () => {
    const mod = await loadDashboardModule();
    const adminRpc = vi.fn(async (fn: string) => {
      if (fn === "get_dashboard_data_for_org") {
        return { data: null, error: { code: "42501", message: "permission denied for function" } };
      }
      return { data: null, error: null };
    });
    const db = {
      rpc: async (fn: string) => {
        if (fn === "current_user_organization_id") return { data: "org-resolved", error: null };
        return { data: null, error: null };
      },
    };
    const response = await mod.handleGetDashboardData({
      req: createDashboardRequest("GET", "c"),
      db: db as never,
      adminDb: { rpc: adminRpc } as never,
      userContext: { user: { id: "user-1", email: null }, profile: { id: "user-1", email: null, role: "admin", is_active: true } },
    });
    expect(response.status).toBe(403);
    const body = (await response.json()) as { code?: string; message?: string };
    expect(body.code).toBe("forbidden");
    expect(body.message).toBe("Dashboard access denied");
    expect(JSON.stringify(body)).not.toContain("permission denied");
  });

  it("returns a typed timeout when organization resolution does not complete", async () => {
    vi.useFakeTimers();
    const mod = await loadDashboardModule();
    const db = {
      rpc: (fn: string) => {
        if (fn === "current_user_organization_id") return new Promise(() => undefined);
        return Promise.resolve({ data: null, error: null });
      },
    };
    const responsePromise = mod.handleGetDashboardData({
      req: createDashboardRequest("GET", "org-timeout"),
      db: db as never,
    });

    await vi.advanceTimersByTimeAsync(2_500);

    const response = await responsePromise;
    expect(response.status).toBe(504);
    const body = (await response.json()) as { code?: string; requestId?: string; classification?: { category?: string } };
    expect(body).toMatchObject({
      requestId: "req-dash-org-timeout",
      code: "upstream_timeout",
      classification: { category: "upstream" },
    });
  });

  it("returns a typed timeout when the dashboard RPC does not complete", async () => {
    vi.useFakeTimers();
    const mod = await loadDashboardModule();
    const adminRpc = vi.fn((fn: string) => {
      if (fn === "get_dashboard_data_for_org") return new Promise(() => undefined);
      return Promise.resolve({ data: null, error: null });
    });
    const db = {
      rpc: (fn: string) => {
        if (fn === "current_user_organization_id") return Promise.resolve({ data: "org-resolved", error: null });
        return Promise.resolve({ data: null, error: null });
      },
    };
    const responsePromise = mod.handleGetDashboardData({
      req: createDashboardRequest("GET", "rpc-timeout"),
      db: db as never,
      adminDb: { rpc: adminRpc } as never,
      userContext: { user: { id: "user-1", email: null }, profile: { id: "user-1", email: null, role: "admin", is_active: true } },
    });

    await vi.advanceTimersByTimeAsync(4_500);

    const response = await responsePromise;
    expect(response.status).toBe(504);
    const body = (await response.json()) as { code?: string; requestId?: string; classification?: { category?: string } };
    expect(body).toMatchObject({
      requestId: "req-dash-rpc-timeout",
      code: "upstream_timeout",
      classification: { category: "upstream" },
    });
  });

  it("fails closed as timeout when the dashboard RPC permission failure is slower than the deadline", async () => {
    vi.useFakeTimers();
    const mod = await loadDashboardModule();
    const adminRpc = vi.fn((fn: string) => {
      if (fn === "get_dashboard_data_for_org") {
        return new Promise((resolve) => {
          setTimeout(() => {
            resolve({ data: null, error: { code: "42501", message: "permission denied for function" } });
          }, 5_000);
        });
      }
      return Promise.resolve({ data: null, error: null });
    });
    const db = {
      rpc: (fn: string) => {
        if (fn === "current_user_organization_id") return Promise.resolve({ data: "org-resolved", error: null });
        return Promise.resolve({ data: null, error: null });
      },
    };
    const responsePromise = mod.handleGetDashboardData({
      req: createDashboardRequest("GET", "slow-forbidden"),
      db: db as never,
      adminDb: { rpc: adminRpc } as never,
      userContext: { user: { id: "user-1", email: null }, profile: { id: "user-1", email: null, role: "admin", is_active: true } },
    });

    await vi.advanceTimersByTimeAsync(4_500);

    const response = await responsePromise;
    expect(response.status).toBe(504);
    const body = (await response.json()) as { code?: string; requestId?: string; classification?: { category?: string } };
    expect(body).toMatchObject({
      requestId: "req-dash-slow-forbidden",
      code: "upstream_timeout",
      classification: { category: "upstream" },
    });
  });
});

describe("get-dashboard-data Supabase Edge entrypoint", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    stubDenoEnv((key) => envValues.get(key) ?? "");
    vi.resetModules();
  });

  it("registers a Deno.serve handler when the Edge runtime provides serve", async () => {
    const serve = vi.fn();
    vi.stubGlobal("Deno", {
      env: {
        get: (key: string) => envValues.get(key) ?? "",
      },
      serve,
    });

    await loadDashboardModule();

    expect(serve).toHaveBeenCalledTimes(1);
    expect(serve.mock.calls[0]?.[0]).toEqual(expect.any(Function));
  });

  it("returns a typed timeout when the protected Edge route does not complete", async () => {
    vi.useFakeTimers();
    vi.doMock("../../supabase/functions/_shared/auth-middleware.ts", () => ({
      createProtectedRoute: () => () => new Promise(() => undefined),
      RouteOptions: { admin: { requireAuth: true, allowedRoles: ["admin", "super_admin"] } },
    }));
    const module = await loadDashboardModule();
    const responsePromise = module.default(createDashboardRequest("GET", "route-timeout"));

    await vi.advanceTimersByTimeAsync(6_500);

    const response = await responsePromise;
    expect(response.status).toBe(504);
    const body = (await response.json()) as { code?: string; requestId?: string; classification?: { category?: string } };
    expect(body).toMatchObject({
      requestId: "req-dash-route-timeout",
      code: "upstream_timeout",
      classification: { category: "upstream" },
    });
  });
});

describe("resolveDashboardOrganizationId", () => {
  beforeEach(() => {
    vi.resetModules();
    envValues.delete("DEFAULT_ORGANIZATION_ID");
  });

  afterEach(() => {
    envValues.delete("DEFAULT_ORGANIZATION_ID");
  });

  it("uses DEFAULT_ORGANIZATION_ID for super_admin when no JWT org or profile org", async () => {
    envValues.set("DEFAULT_ORGANIZATION_ID", "org-default-env");
    const mod = await loadDashboardModule();
    const db = {
      rpc: async (fn: string) => {
        if (fn === "current_user_organization_id") return { data: null, error: null };
        if (fn === "current_user_is_super_admin") return { data: true, error: null };
        return { data: null, error: null };
      },
      auth: {
        getUser: vi.fn(async () => ({ data: { user: null }, error: null })),
      },
    } as const;

    const orgId = await mod.__TESTING__.resolveDashboardOrganizationId(db as never);
    expect(orgId).toBe("org-default-env");
  });
});
