// @vitest-environment node

import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";
import { stubDenoEnv } from "../utils/stubDeno";

const functionSource = readFileSync(
  path.join(
    process.cwd(),
    "supabase",
    "functions",
    "ai-agent-optimized",
    "index.ts",
  ),
  "utf8",
);

async function loadHandler() {
  let serveHandler: ((req: Request) => Promise<Response>) | undefined;
  stubDenoEnv((key) =>
    key === "CORS_ALLOWED_ORIGINS"
      ? "https://app.allincompassing.ai"
      : "",
  );
  const denoObject = (
    globalThis as typeof globalThis & { Deno?: Record<string, unknown> }
  ).Deno ?? {};
  vi.stubGlobal("Deno", {
    ...denoObject,
    env: {
      get: (key: string) =>
        key === "CORS_ALLOWED_ORIGINS"
          ? "https://app.allincompassing.ai"
          : "",
    },
    serve: vi.fn((handler: (req: Request) => Promise<Response>) => {
      serveHandler = handler;
      return {};
    }),
  });

  vi.doMock("npm:openai@5.5.1", () => ({
    OpenAI: class {
      chat = { completions: { create: vi.fn() } };
    },
  }));
  vi.doMock("npm:zod@3.23.8", async () => {
    const { z } = await import("zod");
    return { z };
  });
  vi.doMock("../../supabase/functions/_shared/database.ts", () => ({
    createRequestClient: vi.fn(),
    supabaseAdmin: {},
  }));
  vi.doMock("../../supabase/functions/_shared/auth.ts", () => ({
    getUserOrThrow: vi.fn(),
  }));
  vi.doMock("../../supabase/functions/_shared/org.ts", () => ({
    resolveOrgId: vi.fn(),
  }));
  vi.doMock("../../supabase/functions/_shared/logging.ts", () => ({
    getLogger: vi.fn(),
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

describe("ai-agent-optimized CORS contract", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("returns a browser-readable preflight response for trace headers", async () => {
    const handler = await loadHandler();
    const response = await handler(
      new Request(
        "https://edge.example.com/functions/v1/ai-agent-optimized",
        {
          method: "OPTIONS",
          headers: {
            Origin: "https://app.allincompassing.ai",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers":
              "authorization, apikey, content-type, x-request-id, x-correlation-id",
          },
        },
      ),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://app.allincompassing.ai",
    );
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe(
      "POST, OPTIONS",
    );
    const allowedHeaders =
      response.headers.get("Access-Control-Allow-Headers")?.toLowerCase() ?? "";
    for (const header of [
      "authorization",
      "apikey",
      "content-type",
      "x-request-id",
      "x-correlation-id",
    ]) {
      expect(allowedHeaders).toContain(header);
    }
    expect(response.headers.get("Vary")).toBe("Origin");
  });

  it("uses request-scoped shared CORS headers for browser requests", () => {
    expect(functionSource).toMatch(
      /import\s+\{\s*corsHeadersForRequest\s*\}\s+from\s+["']\.\.\/_shared\/cors\.ts["']/,
    );
    expect(functionSource).toContain("...corsHeadersForRequest(req)");
    expect(functionSource).not.toContain(
      '"Access-Control-Allow-Headers": "Content-Type, Authorization"',
    );
  });

  it("allows the complete browser caller header set", () => {
    const sharedCorsSource = readFileSync(
      path.join(
        process.cwd(),
        "supabase",
        "functions",
        "_shared",
        "cors.ts",
      ),
      "utf8",
    ).toLowerCase();

    for (const header of [
      "authorization",
      "apikey",
      "content-type",
      "x-request-id",
      "x-correlation-id",
    ]) {
      expect(sharedCorsSource).toContain(header);
    }
  });

  it("preserves the function-specific POST and OPTIONS method contract", () => {
    expect(functionSource).toContain(
      '"Access-Control-Allow-Methods": "POST, OPTIONS"',
    );
  });
});
