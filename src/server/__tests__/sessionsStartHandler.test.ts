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

const createAuthToken = (subject = "therapist-1") => {
  const payload = Buffer.from(JSON.stringify({ sub: subject }), "utf8").toString("base64url");
  return `header.${payload}.signature`;
};

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
    vi.mocked(getAccessToken).mockReturnValue(createAuthToken());
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
          therapist_id: "therapist-1",
          started_at: "2026-01-01T10:00:00Z",
        },
      ],
    });

    const response = await sessionsStartHandler(
      new Request("http://localhost/api/sessions-start", {
        method: "POST",
        headers: { Authorization: `Bearer ${createAuthToken()}` },
        body: JSON.stringify({
          session_id: "11111111-1111-1111-1111-111111111111",
          program_id: "22222222-2222-2222-2222-222222222222",
          goal_id: "33333333-3333-3333-3333-333333333333",
        }),
      }),
    );

    expect(response.status).toBe(409);
  });

  it("returns 403 when therapist attempts to start another therapist session", async () => {
    vi.mocked(getAccessToken).mockReturnValue(createAuthToken("therapist-1"));
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
          therapist_id: "therapist-2",
          started_at: null,
        },
      ],
    });

    const response = await sessionsStartHandler(
      new Request("http://localhost/api/sessions-start", {
        method: "POST",
        headers: { Authorization: `Bearer ${createAuthToken("therapist-1")}` },
        body: JSON.stringify({
          session_id: "11111111-1111-1111-1111-111111111111",
          program_id: "22222222-2222-2222-2222-222222222222",
          goal_id: "33333333-3333-3333-3333-333333333333",
        }),
      }),
    );

    expect(response.status).toBe(403);
  });

  it("returns 409 when atomic update affects no rows", async () => {
    vi.mocked(getAccessToken).mockReturnValue(createAuthToken("therapist-1"));
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
    vi.mocked(fetchJson)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: [
          {
            id: "session-1",
            client_id: "client-1",
            organization_id: "org-1",
            therapist_id: "therapist-1",
            started_at: null,
          },
        ],
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: [{ id: "33333333-3333-3333-3333-333333333333" }],
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: [{ id: "33333333-3333-3333-3333-333333333333" }],
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: [],
      });

    const response = await sessionsStartHandler(
      new Request("http://localhost/api/sessions-start", {
        method: "POST",
        headers: { Authorization: `Bearer ${createAuthToken("therapist-1")}` },
        body: JSON.stringify({
          session_id: "11111111-1111-1111-1111-111111111111",
          program_id: "22222222-2222-2222-2222-222222222222",
          goal_id: "33333333-3333-3333-3333-333333333333",
        }),
      }),
    );

    expect(response.status).toBe(409);
  });

  it("starts a session and links goals on the success path", async () => {
    vi.mocked(getAccessToken).mockReturnValue(createAuthToken("therapist-1"));
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
    vi.mocked(fetchJson)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: [
          {
            id: "session-1",
            client_id: "client-1",
            organization_id: "org-1",
            therapist_id: "therapist-1",
            started_at: null,
          },
        ],
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: [{ id: "33333333-3333-3333-3333-333333333333" }],
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: [
          { id: "33333333-3333-3333-3333-333333333333" },
          { id: "44444444-4444-4444-4444-444444444444" },
        ],
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: [
          {
            id: "session-1",
            started_at: "2026-02-10T15:00:00.000Z",
          },
        ],
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        data: [{ session_id: "session-1", goal_id: "33333333-3333-3333-3333-333333333333" }],
      });

    const response = await sessionsStartHandler(
      new Request("http://localhost/api/sessions-start", {
        method: "POST",
        headers: { Authorization: `Bearer ${createAuthToken("therapist-1")}` },
        body: JSON.stringify({
          session_id: "11111111-1111-1111-1111-111111111111",
          program_id: "22222222-2222-2222-2222-222222222222",
          goal_id: "33333333-3333-3333-3333-333333333333",
          goal_ids: ["44444444-4444-4444-4444-444444444444"],
        }),
      }),
    );

    expect(response.status).toBe(200);
    const payload = await response.json() as { id: string; started_at: string };
    expect(payload.id).toBe("session-1");
    expect(payload.started_at).toBe("2026-02-10T15:00:00.000Z");
  });

  it("returns 404 when the session is outside caller org scope", async () => {
    vi.mocked(getAccessToken).mockReturnValue(createAuthToken("therapist-1"));
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
      data: [],
    });

    const response = await sessionsStartHandler(
      new Request("http://localhost/api/sessions-start", {
        method: "POST",
        headers: { Authorization: `Bearer ${createAuthToken("therapist-1")}` },
        body: JSON.stringify({
          session_id: "11111111-1111-1111-1111-111111111111",
          program_id: "22222222-2222-2222-2222-222222222222",
          goal_id: "33333333-3333-3333-3333-333333333333",
        }),
      }),
    );

    expect(response.status).toBe(404);
  });

  it("returns 400 when one or more merged goals are invalid", async () => {
    vi.mocked(getAccessToken).mockReturnValue(createAuthToken("therapist-1"));
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
    vi.mocked(fetchJson)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: [
          {
            id: "session-1",
            client_id: "client-1",
            organization_id: "org-1",
            therapist_id: "therapist-1",
            started_at: null,
          },
        ],
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: [{ id: "33333333-3333-3333-3333-333333333333" }],
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: [{ id: "33333333-3333-3333-3333-333333333333" }],
      });

    const response = await sessionsStartHandler(
      new Request("http://localhost/api/sessions-start", {
        method: "POST",
        headers: { Authorization: `Bearer ${createAuthToken("therapist-1")}` },
        body: JSON.stringify({
          session_id: "11111111-1111-1111-1111-111111111111",
          program_id: "22222222-2222-2222-2222-222222222222",
          goal_id: "33333333-3333-3333-3333-333333333333",
          goal_ids: ["44444444-4444-4444-4444-444444444444"],
        }),
      }),
    );

    expect(response.status).toBe(400);
  });

  it("allows admins to start sessions not assigned to their user id", async () => {
    vi.mocked(getAccessToken).mockReturnValue(createAuthToken("admin-actor"));
    vi.mocked(resolveOrgAndRole).mockResolvedValue({
      organizationId: "org-1",
      isTherapist: false,
      isAdmin: true,
      isSuperAdmin: false,
    });
    vi.mocked(getSupabaseConfig).mockReturnValue({
      supabaseUrl: "https://example.supabase.co",
      anonKey: "anon",
    });
    vi.mocked(fetchJson)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: [
          {
            id: "session-1",
            client_id: "client-1",
            organization_id: "org-1",
            therapist_id: "therapist-2",
            started_at: null,
          },
        ],
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: [{ id: "33333333-3333-3333-3333-333333333333" }],
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: [{ id: "33333333-3333-3333-3333-333333333333" }],
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: [{ id: "session-1", started_at: "2026-02-10T15:00:00.000Z" }],
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        data: [{ session_id: "session-1", goal_id: "33333333-3333-3333-3333-333333333333" }],
      });

    const response = await sessionsStartHandler(
      new Request("http://localhost/api/sessions-start", {
        method: "POST",
        headers: { Authorization: `Bearer ${createAuthToken("admin-actor")}` },
        body: JSON.stringify({
          session_id: "11111111-1111-1111-1111-111111111111",
          program_id: "22222222-2222-2222-2222-222222222222",
          goal_id: "33333333-3333-3333-3333-333333333333",
        }),
      }),
    );

    expect(response.status).toBe(200);
  });
});
