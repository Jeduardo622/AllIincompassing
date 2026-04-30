import { beforeEach, describe, expect, it, vi } from "vitest";
import { sessionsCompleteHandler } from "../api/sessions-complete";

vi.mock("../api/shared", async () => {
  const actual = await vi.importActual<typeof import("../api/shared")>("../api/shared");
  return {
    ...actual,
    getAccessToken: vi.fn(),
    consumeRateLimit: vi.fn(),
  };
});

vi.mock("../runtimeConfig", async () => {
  const actual = await vi.importActual<typeof import("../runtimeConfig")>("../runtimeConfig");
  return {
    ...actual,
    getRuntimeSupabaseConfig: vi.fn(),
  };
});

import { consumeRateLimit, getAccessToken } from "../api/shared";
import { getRuntimeSupabaseConfig } from "../runtimeConfig";

describe("sessionsCompleteHandler", () => {
  const jsonResponse = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getRuntimeSupabaseConfig).mockReturnValue({
      supabaseUrl: "https://example.supabase.co",
      supabaseAnonKey: "anon-key",
      defaultOrganizationId: "org-default",
    });
    vi.mocked(consumeRateLimit).mockResolvedValue({
      limited: false,
      retryAfterSeconds: null,
      mode: "memory",
    });
  });

  it("returns 405 for non-POST methods", async () => {
    const response = await sessionsCompleteHandler(
      new Request("http://localhost/api/sessions-complete", { method: "GET" }),
    );
    expect(response.status).toBe(405);
  });

  it("returns 401 when auth token is missing", async () => {
    vi.mocked(getAccessToken).mockReturnValue(null);
    const response = await sessionsCompleteHandler(
      new Request("http://localhost/api/sessions-complete", {
        method: "POST",
        body: JSON.stringify({
          session_id: "11111111-1111-1111-1111-111111111111",
          outcome: "completed",
          notes: null,
        }),
      }),
    );
    expect(response.status).toBe(401);
  });

  it("proxies valid payloads to edge authority", async () => {
    vi.mocked(getAccessToken).mockReturnValue("token-123");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({ success: true, data: { outcome: "completed" } }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
            "Idempotent-Replay": "true",
          },
        },
      ),
    );

    const request = new Request("http://localhost/api/sessions-complete", {
      method: "POST",
      headers: {
        Authorization: "Bearer token-123",
        "Idempotency-Key": "complete-idempotency-key",
      },
      body: JSON.stringify({
        session_id: "11111111-1111-1111-1111-111111111111",
        outcome: "completed",
        notes: "done",
      }),
    });
    const response = await sessionsCompleteHandler(request);

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.supabase.co/functions/v1/sessions-complete",
      expect.objectContaining({
        method: "POST",
        headers: expect.any(Headers),
        body: JSON.stringify({
          session_id: "11111111-1111-1111-1111-111111111111",
          outcome: "completed",
          notes: "done",
        }),
      }),
    );
    const forwardedHeaders = fetchMock.mock.calls[0]?.[1]?.headers as Headers;
    expect(forwardedHeaders.get("Idempotency-Key")).toBe("complete-idempotency-key");
    expect(response.headers.get("Idempotency-Key")).toBe("complete-idempotency-key");
    expect(response.headers.get("Idempotent-Replay")).toBe("true");
    fetchMock.mockRestore();
  });

  it("fails closed when edge returns 401 instead of degrading to runtime REST", async () => {
    vi.mocked(getAccessToken).mockReturnValue("token-123");
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ success: false, error: "Unauthorized" }, 401));

    const request = new Request("http://localhost/api/sessions-complete", {
      method: "POST",
      headers: { Authorization: "Bearer token-123" },
      body: JSON.stringify({
        session_id: "11111111-1111-1111-1111-111111111111",
        outcome: "completed",
        notes: "done",
      }),
    });
    const response = await sessionsCompleteHandler(request);
    const payload = await response.json() as { success: boolean; error: string };

    expect(response.status).toBe(401);
    expect(payload.success).toBe(false);
    expect(payload.error).toBe("Unauthorized");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockRestore();
  });
});
