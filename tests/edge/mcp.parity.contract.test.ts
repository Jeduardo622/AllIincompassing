// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMcpHandler, resolveMcpRoute, RPC_ALLOWLIST } from "../../supabase/functions/mcp/mcpHandler.ts";

const baseUrl = "https://proj.supabase.co/functions/v1/mcp";

function req(
  method: string,
  pathSuffix: string,
  init?: { headers?: Record<string, string>; body?: unknown },
): Request {
  const headers = new Headers(init?.headers ?? {});
  if (init?.body !== undefined && method !== "GET" && method !== "OPTIONS") {
    headers.set("content-type", "application/json");
  }
  return new Request(`${baseUrl}${pathSuffix}`, {
    method,
    headers,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}

describe("P06 MCP edge contract (A11)", () => {
  const allowedOrigins = new Set([
    "https://app.allincompassing.ai",
    "http://localhost:5173",
  ]);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("resolveMcpRoute", () => {
    it("recognizes health and rpc for gateway-style pathnames", () => {
      expect(resolveMcpRoute("/health")).toBe("health");
      expect(resolveMcpRoute("/functions/v1/mcp/health")).toBe("health");
      expect(resolveMcpRoute("/rpc")).toBe("rpc");
      expect(resolveMcpRoute("/functions/v1/mcp/rpc")).toBe("rpc");
      expect(resolveMcpRoute("/functions/v1/mcp/table/x")).toBe("table");
      expect(resolveMcpRoute("/table/x")).toBe("table");
      expect(resolveMcpRoute("/unknown")).toBe("none");
    });
  });

  describe("RPC_ALLOWLIST", () => {
    it("contains only diagnostics RPCs from spec §7", () => {
      expect(RPC_ALLOWLIST).toEqual(
        new Set(["get_client_metrics", "get_therapist_metrics", "get_authorization_metrics"]),
      );
    });
  });

  it("A11-01: disallowed Origin returns 403 origin_not_allowed", async () => {
    const handler = createMcpHandler({
      supabaseUrl: "https://proj.supabase.co",
      allowedOrigins,
      fallbackAllowedOrigin: "https://app.allincompassing.ai",
      getUserId: async () => "user-1",
      rpc: async () => ({ ok: true, data: {} }),
    });
    const res = await handler(
      req("GET", "/health", { headers: { origin: "https://evil.example" } }),
    );
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "origin_not_allowed" });
  });

  it("A11-02: missing Bearer on POST /rpc returns 401 unauthorized", async () => {
    const handler = createMcpHandler({
      supabaseUrl: "https://proj.supabase.co",
      allowedOrigins,
      fallbackAllowedOrigin: "https://app.allincompassing.ai",
      getUserId: async () => "user-1",
      rpc: async () => ({ ok: true, data: {} }),
    });
    const res = await handler(req("POST", "/rpc", { body: { name: "get_client_metrics", args: {} } }));
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "unauthorized" });
  });

  it("A11-02: invalid session returns 401 unauthorized", async () => {
    const handler = createMcpHandler({
      supabaseUrl: "https://proj.supabase.co",
      allowedOrigins,
      fallbackAllowedOrigin: "https://app.allincompassing.ai",
      getUserId: async () => null,
      rpc: async () => ({ ok: true, data: {} }),
    });
    const res = await handler(
      req("POST", "/rpc", {
        headers: { authorization: "Bearer x" },
        body: { name: "get_client_metrics", args: {} },
      }),
    );
    expect(res.status).toBe(401);
  });

  it("A11-03: POST /rpc with name not in allowlist returns 403 rpc_not_allowed", async () => {
    const audit = vi.fn();
    const handler = createMcpHandler({
      supabaseUrl: "https://proj.supabase.co",
      allowedOrigins,
      fallbackAllowedOrigin: "https://app.allincompassing.ai",
      audit,
      getUserId: async () => "user-1",
      rpc: async () => ({ ok: true, data: {} }),
    });
    const res = await handler(
      req("POST", "/rpc", {
        headers: { authorization: "Bearer good" },
        body: { name: "delete_all_rows", args: {} },
      }),
    );
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "rpc_not_allowed" });
    expect(audit).toHaveBeenCalledWith("mcp.rpc.blocked", { name: "delete_all_rows" });
  });

  it("A11-04: POST /table/* returns 403 table_access_blocked", async () => {
    const audit = vi.fn();
    const handler = createMcpHandler({
      supabaseUrl: "https://proj.supabase.co",
      allowedOrigins,
      fallbackAllowedOrigin: "https://app.allincompassing.ai",
      audit,
      getUserId: async () => "user-1",
      rpc: async () => ({ ok: true, data: {} }),
    });
    const res = await handler(
      req("POST", "/table/clients", {
        headers: { authorization: "Bearer good" },
      }),
    );
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "table_access_blocked" });
    expect(audit).toHaveBeenCalledWith("mcp.table.blocked", {});
  });

  it("A11-05: POST /rpc allowlisted RPC returns 200 with data", async () => {
    const audit = vi.fn();
    const rpc = vi.fn().mockResolvedValue({ ok: true as const, data: { rows: 1 } });
    const handler = createMcpHandler({
      supabaseUrl: "https://proj.supabase.co",
      allowedOrigins,
      fallbackAllowedOrigin: "https://app.allincompassing.ai",
      audit,
      getUserId: async () => "user-1",
      rpc,
    });
    const res = await handler(
      req("POST", "/rpc", {
        headers: { authorization: "Bearer good" },
        body: {
          name: "get_client_metrics",
          args: { p_start_date: "2025-01-01", p_end_date: "2025-01-31" },
        },
      }),
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ data: { rows: 1 } });
    expect(rpc).toHaveBeenCalledWith("good", "get_client_metrics", {
      p_start_date: "2025-01-01",
      p_end_date: "2025-01-31",
    });
    expect(audit).toHaveBeenCalledWith("mcp.rpc.success", { name: "get_client_metrics" });
  });

  it("GET /health succeeds without Bearer when Origin is absent", async () => {
    const handler = createMcpHandler({
      supabaseUrl: "https://proj.supabase.co",
      allowedOrigins,
      fallbackAllowedOrigin: "https://app.allincompassing.ai",
      getUserId: async () => null,
      rpc: async () => ({ ok: true, data: {} }),
    });
    const res = await handler(req("GET", "/health"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, project: "https://proj.supabase.co" });
  });

  it("invalid RPC body name returns 400 invalid function name", async () => {
    const handler = createMcpHandler({
      supabaseUrl: "https://proj.supabase.co",
      allowedOrigins,
      fallbackAllowedOrigin: "https://app.allincompassing.ai",
      getUserId: async () => "user-1",
      rpc: async () => ({ ok: true, data: {} }),
    });
    const res = await handler(
      req("POST", "/rpc", {
        headers: { authorization: "Bearer good" },
        body: { name: "", args: {} },
      }),
    );
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "invalid function name" });
  });

  it("unknown method/path returns 404 not_found", async () => {
    const handler = createMcpHandler({
      supabaseUrl: "https://proj.supabase.co",
      allowedOrigins,
      fallbackAllowedOrigin: "https://app.allincompassing.ai",
      getUserId: async () => "user-1",
      rpc: async () => ({ ok: true, data: {} }),
    });
    const res = await handler(
      req("GET", "/rpc", { headers: { authorization: "Bearer good" } }),
    );
    expect(res.status).toBe(404);
  });
});
