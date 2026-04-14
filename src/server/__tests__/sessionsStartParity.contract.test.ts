import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimitsForTests } from "../api/shared";

vi.mock("../api/shared", async () => {
  const actual = await vi.importActual<typeof import("../api/shared")>("../api/shared");
  return {
    ...actual,
    getAccessToken: vi.fn(),
    resolveOrgAndRoleWithStatus: vi.fn(),
    fetchAuthenticatedUserIdWithStatus: vi.fn(),
  };
});

import {
  fetchAuthenticatedUserIdWithStatus,
  getAccessToken,
  resolveOrgAndRoleWithStatus,
} from "../api/shared";

const createAuthToken = (subject = "therapist-1") => {
  const payload = Buffer.from(JSON.stringify({ sub: subject }), "utf8").toString("base64url");
  return `header.${payload}.signature`;
};

describe("sessionsStartHandler edge proxy parity (WIN-38E / A08)", () => {
  const ORIGINAL_ENV = { ...process.env } as NodeJS.ProcessEnv;

  beforeEach(() => {
    resetRateLimitsForTests();
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_ANON_KEY = "anon";
    process.env.API_AUTHORITY_MODE = "edge";
    vi.resetAllMocks();
    vi.mocked(getAccessToken).mockReturnValue(createAuthToken());
    vi.mocked(resolveOrgAndRoleWithStatus).mockResolvedValue({
      organizationId: "org-1",
      isTherapist: true,
      isAdmin: false,
      isSuperAdmin: false,
      upstreamError: false,
    });
    vi.mocked(fetchAuthenticatedUserIdWithStatus).mockResolvedValue({
      userId: "therapist-1",
      upstreamError: false,
    });
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = { ...ORIGINAL_ENV } as NodeJS.ProcessEnv;
  });

  const createPost = (token: string, body: Record<string, string>) =>
    new Request("http://localhost/api/sessions-start", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Origin: "http://localhost:3000",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

  const validBody = () => ({
    session_id: "11111111-1111-1111-1111-111111111111",
    program_id: "22222222-2222-2222-2222-222222222222",
    goal_id: "33333333-3333-3333-3333-333333333333",
  });

  it("passes through edge 403 status and JSON body unchanged", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const edgeBody = JSON.stringify({ error: "Forbidden" });
    fetchSpy.mockResolvedValueOnce(
      new Response(edgeBody, { status: 403, headers: { "content-type": "application/json" } }),
    );

    const { sessionsStartHandler } = await import("../api/sessions-start");
    const response = await sessionsStartHandler(createPost("edge-token", validBody()));

    expect(response.status).toBe(403);
    expect(await response.text()).toBe(edgeBody);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const calledUrl = fetchSpy.mock.calls[0]?.[0];
    expect(String(calledUrl)).toContain("/functions/v1/sessions-start");
  });

  it("forwards Retry-After when edge returns 429", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const edgeBody = JSON.stringify({ code: "rate_limited", message: "Too many requests" });
    fetchSpy.mockResolvedValueOnce(
      new Response(edgeBody, {
        status: 429,
        headers: { "content-type": "application/json", "Retry-After": "30" },
      }),
    );

    const { sessionsStartHandler } = await import("../api/sessions-start");
    const response = await sessionsStartHandler(createPost("token", validBody()));

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("30");
    expect(await response.json()).toEqual(JSON.parse(edgeBody));
  });
});
