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
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

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

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.supabase.co/functions/v1/sessions-complete",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          session_id: "11111111-1111-1111-1111-111111111111",
          outcome: "completed",
          notes: "done",
        }),
      }),
    );
    fetchMock.mockRestore();
  });

  it("falls back to runtime REST completion when edge returns 401", async () => {
    vi.mocked(getAccessToken).mockReturnValue("token-123");
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ success: false, error: "Unauthorized" }, 401))
      .mockResolvedValueOnce(jsonResponse(false, 200))
      .mockResolvedValueOnce(jsonResponse("org-1", 200))
      .mockResolvedValueOnce(jsonResponse(true, 200))
      .mockResolvedValueOnce(jsonResponse(false, 200))
      .mockResolvedValueOnce(jsonResponse(false, 200))
      .mockResolvedValueOnce(jsonResponse({ id: "therapist-1" }, 200))
      .mockResolvedValueOnce(jsonResponse([{ id: "session-1", status: "in_progress", therapist_id: "therapist-1" }], 200))
      .mockResolvedValueOnce(jsonResponse([{ goal_id: "goal-1" }], 200))
      .mockResolvedValueOnce(jsonResponse([{ goal_notes: { "goal-1": "Covered" } }], 200))
      .mockResolvedValueOnce(jsonResponse([{ id: "session-1", status: "completed", updated_at: "2026-01-01T00:00:00.000Z" }], 200));

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
    const payload = await response.json() as { success: boolean };

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(11);
    fetchMock.mockRestore();
  });
});
