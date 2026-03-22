import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dashboardHandler } from "../../src/server/api/dashboard";
import { sessionsStartHandler } from "../../src/server/api/sessions-start";
import { resetRuntimeSupabaseConfigForTests } from "../../src/lib/runtimeConfig";

const originalEnv = {
  SUPABASE_URL: process.env.SUPABASE_URL,
  VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL,
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
  VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY,
};

beforeEach(() => {
  resetRuntimeSupabaseConfigForTests();
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.VITE_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_ANON_KEY = "anon-key";
  process.env.VITE_SUPABASE_ANON_KEY = "anon-key";
});

afterEach(() => {
  resetRuntimeSupabaseConfigForTests();
  vi.resetModules();

  if (typeof originalEnv.SUPABASE_URL === "string") {
    process.env.SUPABASE_URL = originalEnv.SUPABASE_URL;
  } else {
    delete process.env.SUPABASE_URL;
  }

  if (typeof originalEnv.VITE_SUPABASE_URL === "string") {
    process.env.VITE_SUPABASE_URL = originalEnv.VITE_SUPABASE_URL;
  } else {
    delete process.env.VITE_SUPABASE_URL;
  }

  if (typeof originalEnv.SUPABASE_ANON_KEY === "string") {
    process.env.SUPABASE_ANON_KEY = originalEnv.SUPABASE_ANON_KEY;
  } else {
    delete process.env.SUPABASE_ANON_KEY;
  }

  if (typeof originalEnv.VITE_SUPABASE_ANON_KEY === "string") {
    process.env.VITE_SUPABASE_ANON_KEY = originalEnv.VITE_SUPABASE_ANON_KEY;
  } else {
    delete process.env.VITE_SUPABASE_ANON_KEY;
  }
});

describe("critical /api error envelope contracts", () => {
  it("returns JSON contract for /api/dashboard method guard", async () => {
    const response = await dashboardHandler(
      new Request("https://example.com/api/dashboard", {
        method: "POST",
      }),
    );

    const payload = await response.json() as Record<string, unknown>;
    expect(response.status).toBe(405);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(payload.success).toBe(false);
    expect(payload.code).toBe("validation_error");
    expect(payload.error).toBe("Method not allowed");
    expect(typeof payload.requestId).toBe("string");
  });

  it("returns JSON contract for /api/sessions-start unauthorized path", async () => {
    const response = await sessionsStartHandler(
      new Request("https://example.com/api/sessions-start", {
        method: "POST",
      }),
    );

    const payload = await response.json() as Record<string, unknown>;
    expect(response.status).toBe(401);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(response.headers.get("WWW-Authenticate")).toBe("Bearer");
    expect(payload.success).toBe(false);
    expect(payload.code).toBe("unauthorized");
    expect(payload.error).toBe("Missing authorization token");
    expect(typeof payload.requestId).toBe("string");
  });

  it("returns JSON contract for /api/book unauthorized path", async () => {
    const { bookHandler } = await import("../../src/server/api/book");

    const response = await bookHandler(
      new Request("https://example.com/api/book", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      }),
    );

    const payload = await response.json() as Record<string, unknown>;
    expect(response.status).toBe(401);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(response.headers.get("WWW-Authenticate")).toBe("Bearer");
    expect(payload.success).toBe(false);
    expect(payload.code).toBe("unauthorized");
    expect(payload.error).toBe("Missing authorization token");
    expect(typeof payload.requestId).toBe("string");
  });
});
