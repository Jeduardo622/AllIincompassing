/**
 * MCP edge request handler (testable core). Wired from `index.ts` with production deps.
 */

export const RPC_ALLOWLIST = new Set<string>([
  "get_client_metrics",
  "get_therapist_metrics",
  "get_authorization_metrics",
]);

export type McpHandlerDeps = {
  supabaseUrl: string;
  /** Return authenticated user id, or null if invalid. */
  getUserId: (token: string) => Promise<string | null>;
  /** Invoke allowlisted RPC as the bearer; return data or error message for JSON. */
  rpc: (token: string, name: string, args: Record<string, unknown>) => Promise<{ ok: true; data: unknown } | { ok: false; message: string }>;
  allowedOrigins: Set<string>;
  fallbackAllowedOrigin: string;
  audit?: (event: string, details: Record<string, unknown>) => void;
};

const json = (body: unknown, init: ResponseInit & { headers?: Record<string, string> } = {}) =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json", "cache-control": "no-store", ...(init.headers || {}) },
    status: init.status ?? 200,
  });

/** Supabase gateway may expose `/health` or `.../mcp/health` style pathnames. */
export function resolveMcpRoute(pathname: string): "health" | "rpc" | "table" | "none" {
  const p = pathname.replace(/\/+$/, "") || "/";
  if (p === "/health" || p.endsWith("/mcp/health")) return "health";
  if (p === "/rpc" || p.endsWith("/mcp/rpc")) return "rpc";
  if (p.startsWith("/table/") || p.includes("/mcp/table/")) return "table";
  return "none";
}

export function createMcpHandler(deps: McpHandlerDeps): (req: Request) => Promise<Response> {
  const audit = deps.audit ?? (() => {});

  const resolveAllowedOrigin = (req: Request): string | null => {
    const origin = req.headers.get("origin");
    if (!origin) {
      return deps.fallbackAllowedOrigin;
    }
    return deps.allowedOrigins.has(origin) ? origin : null;
  };

  const corsHeadersForRequest = (req: Request): Record<string, string> => {
    const resolvedOrigin = resolveAllowedOrigin(req);
    return {
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "authorization,content-type",
      vary: "origin",
      "access-control-allow-origin": resolvedOrigin ?? deps.fallbackAllowedOrigin,
    };
  };

  const isDisallowedOriginRequest = (req: Request): boolean => {
    const origin = req.headers.get("origin");
    return Boolean(origin) && !deps.allowedOrigins.has(origin);
  };

  const getBearerToken = (req: Request): string | null => {
    const auth = req.headers.get("authorization") || "";
    const token = auth.replace(/^Bearer\s+/i, "").trim();
    if (token.length === auth.trim().length) return null;
    return token.length > 0 ? token : null;
  };

  const unauthorized = (req: Request) =>
    json({ error: "unauthorized" }, { status: 401, headers: corsHeadersForRequest(req) });

  async function handleRpc(req: Request, token: string): Promise<Response> {
    const body = await req.json().catch(() => ({}));
    const { name, args } = body as { name?: string; args?: Record<string, unknown> };
    if (!name || typeof name !== "string") {
      return json({ error: "invalid function name" }, { status: 400, headers: corsHeadersForRequest(req) });
    }
    if (!RPC_ALLOWLIST.has(name)) {
      audit("mcp.rpc.blocked", { name });
      return json({ error: "rpc_not_allowed" }, { status: 403, headers: corsHeadersForRequest(req) });
    }
    const result = await deps.rpc(token, name, args ?? {});
    if (!result.ok) {
      return json({ error: result.message }, { status: 400, headers: corsHeadersForRequest(req) });
    }
    audit("mcp.rpc.success", { name });
    return json({ data: result.data }, { headers: corsHeadersForRequest(req) });
  }

  async function handleTable(req: Request): Promise<Response> {
    audit("mcp.table.blocked", {});
    return json({ error: "table_access_blocked" }, { status: 403, headers: corsHeadersForRequest(req) });
  }

  return async (req: Request): Promise<Response> => {
    if (isDisallowedOriginRequest(req)) {
      return json({ error: "origin_not_allowed" }, { status: 403, headers: corsHeadersForRequest(req) });
    }

    if (req.method === "OPTIONS") {
      return new Response(null, { headers: corsHeadersForRequest(req) });
    }

    const url = new URL(req.url);
    const route = resolveMcpRoute(url.pathname);

    if (req.method === "GET" && route === "health") {
      return json({ ok: true, project: deps.supabaseUrl }, { headers: corsHeadersForRequest(req) });
    }

    const token = getBearerToken(req);
    if (!token) return unauthorized(req);

    const userId = await deps.getUserId(token);
    if (!userId) {
      audit("mcp.auth.denied", { reason: "user_not_found" });
      return unauthorized(req);
    }

    if (req.method === "POST" && route === "rpc") return handleRpc(req, token);
    if (req.method === "POST" && route === "table") return handleTable(req);
    return json({ error: "not_found" }, { status: 404, headers: corsHeadersForRequest(req) });
  };
}
