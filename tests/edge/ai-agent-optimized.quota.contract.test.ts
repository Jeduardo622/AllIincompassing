// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { stubDenoEnv } from "../utils/stubDeno";

const completionCreateMock = vi.fn();
const createRequestClientMock = vi.fn();
const getUserOrThrowMock = vi.fn();
const resolveOrgIdMock = vi.fn();
const loggerInfoMock = vi.fn();
const loggerWarnMock = vi.fn();
const supabaseRpcMock = vi.fn();
const supabaseFromMock = vi.fn();

const envValues = new Map<string, string>([
  ["CORS_ALLOWED_ORIGINS", "https://app.allincompassing.ai"],
  ["APP_ENV", "production"],
  ["OPENAI_API_KEY", "test-openai-key"],
]);

function createMaybeSingleQuery() {
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of ["select", "eq", "order", "limit"]) {
    query[method] = vi.fn(() => query);
  }
  query.maybeSingle = vi.fn(async () => ({ data: null, error: null }));
  return query;
}

async function loadHandler() {
  let serveHandler: ((req: Request) => Promise<Response>) | undefined;
  stubDenoEnv((key) => envValues.get(key) ?? "");
  const denoObject = (
    globalThis as typeof globalThis & { Deno?: Record<string, unknown> }
  ).Deno ?? {};
  vi.stubGlobal("Deno", {
    ...denoObject,
    env: {
      get: (key: string) => envValues.get(key) ?? "",
    },
    serve: vi.fn((handler: (req: Request) => Promise<Response>) => {
      serveHandler = handler;
      return {};
    }),
  });

  vi.doMock("npm:openai@5.5.1", () => ({
    OpenAI: class {
      chat = { completions: { create: completionCreateMock } };
    },
  }));
  vi.doMock("npm:zod@3.23.8", async () => {
    const { z } = await import("zod");
    return { z };
  });
  vi.doMock("../../supabase/functions/_shared/database.ts", () => ({
    createRequestClient: createRequestClientMock,
    supabaseAdmin: {
      from: supabaseFromMock,
      rpc: supabaseRpcMock,
    },
  }));
  vi.doMock("../../supabase/functions/_shared/auth.ts", () => ({
    getUserOrThrow: getUserOrThrowMock,
  }));
  vi.doMock("../../supabase/functions/_shared/org.ts", () => ({
    resolveOrgId: resolveOrgIdMock,
  }));
  vi.doMock("../../supabase/functions/_shared/logging.ts", () => ({
    getLogger: vi.fn(() => ({
      info: loggerInfoMock,
      warn: loggerWarnMock,
    })),
  }));
  vi.doMock(
    "../../supabase/functions/ai-agent-optimized/persistence.ts",
    () => ({
      persistChatMessage: vi.fn(),
    }),
  );

  await import("../../supabase/functions/ai-agent-optimized/index.ts");

  if (!serveHandler) {
    throw new Error(
      "Expected ai-agent-optimized to register a Deno.serve handler",
    );
  }
  return serveHandler;
}

describe("ai-agent-optimized provider quota contract", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllGlobals();

    const db = {
      rpc: vi.fn(async (name: string, args?: Record<string, unknown>) => {
        if (name === "current_user_is_super_admin") {
          return { data: false, error: null };
        }
        if (name === "user_has_role_for_org") {
          return { data: args?.role_name === "bcba", error: null };
        }
        if (name === "get_dropdown_data") {
          return { data: {}, error: null };
        }
        if (name === "detect_scheduling_conflicts") {
          return { data: [], error: null };
        }
        throw new Error(`Unexpected request RPC: ${name}`);
      }),
    };
    createRequestClientMock.mockReturnValue(db);
    getUserOrThrowMock.mockResolvedValue({ id: "user-bcba" });
    resolveOrgIdMock.mockResolvedValue("org-1");

    supabaseFromMock.mockImplementation((table: string) => {
      if (table === "agent_execution_traces") {
        return {
          insert: vi.fn(async () => ({ error: null })),
        };
      }
      return createMaybeSingleQuery();
    });
    supabaseRpcMock.mockImplementation(async (name: string) => {
      if (name === "generate_semantic_cache_key") {
        return { data: "cache-key", error: null };
      }
      if (name === "get_cached_ai_response") {
        return { data: [], error: null };
      }
      throw new Error(`Unexpected admin RPC: ${name}`);
    });

    completionCreateMock.mockRejectedValue(
      Object.assign(new Error("You exceeded your current quota"), {
        status: 429,
        code: "insufficient_quota",
        type: "insufficient_quota",
        error: {
          code: "insufficient_quota",
          type: "insufficient_quota",
        },
      }),
    );
  });

  it("returns a 503 error envelope when OpenAI reports insufficient quota", async () => {
    const handler = await loadHandler();
    const response = await handler(
      new Request(
        "https://edge.example.com/functions/v1/ai-agent-optimized",
        {
          method: "POST",
          headers: {
            Origin: "https://app.allincompassing.ai",
            Authorization: "Bearer token",
            "Content-Type": "application/json",
            "x-request-id": "req-quota",
            "x-correlation-id": "corr-quota",
          },
          body: JSON.stringify({
            message: "List the scheduling tasks available to a BCBA.",
          }),
        },
      ),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://app.allincompassing.ai",
    );
    expect(response.headers.get("x-request-id")).toBe("req-quota");
    expect(response.headers.get("x-correlation-id")).toBe("corr-quota");

    const body = await response.json();
    expect(body).toMatchObject({
      requestId: "req-quota",
      code: "upstream_unavailable",
      message: "AI service is temporarily unavailable",
      classification: {
        category: "upstream",
        retryable: true,
        httpStatus: 503,
      },
    });
    expect(body).not.toHaveProperty("response");
    expect(body).not.toHaveProperty("action");
    expect(body).not.toHaveProperty("conversationId");
  });
});
