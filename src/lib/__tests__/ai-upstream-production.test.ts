import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("AI production upstream failure handling", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("DEV", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("degrades safely without calling the legacy endpoint after an optimized 503", async () => {
    const {
      resetRuntimeSupabaseConfigForTests,
      setRuntimeSupabaseConfig,
    } = await import("../runtimeConfig");
    setRuntimeSupabaseConfig({
      supabaseUrl: "https://example.supabase.co",
      supabaseAnonKey: "anon-key",
      defaultOrganizationId: "5238e88b-6198-4862-80a2-dbe15bbeabdd",
      supabaseEdgeUrl: "https://example.supabase.co/functions/v1/",
    });

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          requestId: "req-quota",
          code: "upstream_unavailable",
          message: "AI service is temporarily unavailable",
        }),
        {
          status: 503,
          headers: {
            "Content-Type": "application/json",
            "x-request-id": "req-quota",
            "x-correlation-id": "corr-quota",
          },
        },
      ),
    );
    const consoleErrorMock = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const { processMessage } = await import("../ai");
      const result = await processMessage(
        "List the scheduling tasks available to a BCBA.",
        {
          url: "https://app.allincompassing.ai/schedule",
          userAgent: "vitest",
          actor: { id: "user-1", role: "bcba" },
        },
        { accessToken: "mock-user-jwt" },
      );

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock).toHaveBeenNthCalledWith(
        1,
        "https://example.supabase.co/functions/v1/ai-agent-optimized",
        expect.any(Object),
      );
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        "https://example.supabase.co/functions/v1/ai-agent-optimized",
        expect.any(Object),
      );
      expect(fetchMock.mock.calls).not.toContainEqual([
        "https://example.supabase.co/functions/v1/process-message",
        expect.any(Object),
      ]);
      expect(result).toMatchObject({
        response:
          "I apologize, but I'm having trouble processing your request right now. Please try again in a moment or use the manual interface instead.",
        responseTime: 0,
        error: "AI fallback disabled in production (status 503)",
      });
      expect(consoleErrorMock).toHaveBeenCalled();
    } finally {
      resetRuntimeSupabaseConfigForTests();
    }
  });
});
