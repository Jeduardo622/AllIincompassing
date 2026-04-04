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

vi.mock("../api/edgeAuthority", async () => {
  const actual = await vi.importActual<typeof import("../api/edgeAuthority")>("../api/edgeAuthority");
  return {
    ...actual,
    proxyToEdgeAuthority: vi.fn(),
  };
});

import { consumeRateLimit, getAccessToken } from "../api/shared";
import { proxyToEdgeAuthority } from "../api/edgeAuthority";

describe("sessionsCompleteHandler", () => {
  beforeEach(() => {
    vi.resetAllMocks();
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
    vi.mocked(proxyToEdgeAuthority).mockResolvedValue(
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
    expect(proxyToEdgeAuthority).toHaveBeenCalledWith(
      request,
      expect.objectContaining({
        functionName: "sessions-complete",
        accessToken: "token-123",
        method: "POST",
      }),
    );
  });
});
