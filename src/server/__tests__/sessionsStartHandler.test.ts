import { beforeEach, describe, expect, it, vi } from "vitest";
import { sessionsStartHandler } from "../api/sessions-start";

vi.mock("../api/shared", async () => {
  const actual = await vi.importActual<typeof import("../api/shared")>("../api/shared");
  return {
    ...actual,
    getAccessToken: vi.fn(),
    resolveOrgAndRole: vi.fn(),
    getSupabaseConfig: vi.fn(),
    fetchJson: vi.fn(),
  };
});

import { fetchJson, getAccessToken, getSupabaseConfig, resolveOrgAndRole } from "../api/shared";

describe("sessionsStartHandler", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns 405 for non-POST requests", async () => {
    const response = await sessionsStartHandler(
      new Request("http://localhost/api/sessions-start", { method: "GET" }),
    );

    expect(response.status).toBe(405);
  });

  it("returns 401 when authorization header is missing", async () => {
    const response = await sessionsStartHandler(
      new Request("http://localhost/api/sessions-start", { method: "POST", body: "{}" }),
    );

    expect(response.status).toBe(401);
  });

  it("returns 409 when session is already started", async () => {
    vi.mocked(getAccessToken).mockReturnValue("token");
    vi.mocked(resolveOrgAndRole).mockResolvedValue({
      organizationId: "org-1",
      isTherapist: true,
      isAdmin: false,
      isSuperAdmin: false,
    });
    vi.mocked(getSupabaseConfig).mockReturnValue({
      supabaseUrl: "https://example.supabase.co",
      anonKey: "anon",
    });
    vi.mocked(fetchJson).mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: [
        {
          id: "session-1",
          client_id: "client-1",
          organization_id: "org-1",
          started_at: "2026-01-01T10:00:00Z",
        },
      ],
    });

    const response = await sessionsStartHandler(
      new Request("http://localhost/api/sessions-start", {
        method: "POST",
        headers: { Authorization: "Bearer token" },
        body: JSON.stringify({
          session_id: "11111111-1111-1111-1111-111111111111",
          program_id: "22222222-2222-2222-2222-222222222222",
          goal_id: "33333333-3333-3333-3333-333333333333",
        }),
      }),
    );

    expect(response.status).toBe(409);
  });
});
