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
    envValues.delete("DEFAULT_ORGANIZATION_ID");
  });

  afterEach(() => {
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
    const db = {
      rpc: async (fn: string) => {
        if (fn === "current_user_organization_id") return { data: null, error: null };
        if (fn === "current_user_is_super_admin") return { data: true, error: null };
        if (fn === "get_dashboard_data") return { data: { todaySessions: [] }, error: null };
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
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { success?: boolean; data?: { todaySessions?: unknown[] } };
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data?.todaySessions)).toBe(true);
  });

  it("maps RPC error code 42501 to 403 forbidden", async () => {
    const mod = await loadDashboardModule();
    const db = {
      rpc: async (fn: string) => {
        if (fn === "current_user_organization_id") return { data: "org-resolved", error: null };
        if (fn === "get_dashboard_data") {
          return { data: null, error: { code: "42501", message: "permission denied for relation" } };
        }
        return { data: null, error: null };
      },
    };
    const response = await mod.handleGetDashboardData({
      req: createDashboardRequest("GET", "c"),
      db: db as never,
    });
    expect(response.status).toBe(403);
    const body = (await response.json()) as { code?: string };
    expect(body.code).toBe("forbidden");
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
