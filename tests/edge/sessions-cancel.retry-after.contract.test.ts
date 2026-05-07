// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { stubDenoEnv } from "../utils/stubDeno";

const envValues = new Map<string, string>([
  ["CORS_ALLOWED_ORIGINS", "https://app.example.com,https://preview.example.com"],
]);

const createRequestClientMock = vi.fn();
const createSupabaseIdempotencyServiceMock = vi.fn();

stubDenoEnv((key) => envValues.get(key) ?? "");

async function loadHandler() {
  let serveHandler: ((req: Request) => Promise<Response>) | undefined;
  const denoObject = (globalThis as typeof globalThis & { Deno?: Record<string, unknown> }).Deno ?? {};

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

  vi.doMock("../../supabase/functions/_shared/database.ts", () => ({
    createRequestClient: createRequestClientMock,
    supabaseAdmin: {
      from: vi.fn(),
      rpc: vi.fn(),
    },
  }));
  vi.doMock("../../supabase/functions/_shared/idempotency.ts", async () => {
    const actual = await vi.importActual<typeof import("../../supabase/functions/_shared/idempotency.ts")>(
      "../../supabase/functions/_shared/idempotency.ts",
    );
    return {
      ...actual,
      createSupabaseIdempotencyService: createSupabaseIdempotencyServiceMock,
    };
  });

  await import("../../supabase/functions/sessions-cancel/index.ts");

  if (!serveHandler) {
    throw new Error("Expected sessions-cancel to register a Deno.serve handler");
  }

  return serveHandler;
}

describe("sessions-cancel retry-after contract", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllGlobals();

    createRequestClientMock.mockReturnValue({
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: { id: "user-1" } },
          error: null,
        })),
      },
    });
    createSupabaseIdempotencyServiceMock.mockReturnValue({
      find: vi.fn(async () => null),
      persist: vi.fn(async () => undefined),
    });
  });

  it("does not emit Retry-After for non-retryable cancellation validation failures", async () => {
    const handler = await loadHandler();

    const response = await handler(
      new Request("https://edge.example.com/functions/v1/sessions-cancel", {
        method: "POST",
        headers: {
          Origin: "https://preview.example.com",
          Authorization: "Bearer token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("Retry-After")).toBeNull();
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://preview.example.com");
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: "Must provide hold_key, session_ids, or date",
    });
  });
});
