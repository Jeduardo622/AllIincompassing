import { beforeEach, describe, expect, it, vi } from "vitest";
import { programNotesHandler } from "../api/program-notes";

vi.mock("../api/shared", async () => {
  const actual = await vi.importActual<typeof import("../api/shared")>("../api/shared");
  return {
    ...actual,
    currentUserCanManageProgramsGoals: vi.fn(),
    getAccessToken: vi.fn(),
    resolveOrgAndRole: vi.fn(),
    getSupabaseConfig: vi.fn(),
    fetchJson: vi.fn(),
  };
});

import {
  currentUserCanManageProgramsGoals,
  fetchJson,
  getAccessToken,
  getSupabaseConfig,
  resolveOrgAndRole,
} from "../api/shared";

const createAuthToken = (subject = "therapist-1") => {
  const payload = Buffer.from(JSON.stringify({ sub: subject }), "utf8").toString("base64url");
  return `header.${payload}.signature`;
};

describe("programNotesHandler", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(currentUserCanManageProgramsGoals).mockResolvedValue({ allowed: true, upstreamError: false });
  });

  it("returns 401 when authorization header is missing", async () => {
    const response = await programNotesHandler(
      new Request("http://localhost/api/program-notes?program_id=program-1", { method: "GET" }),
    );

    expect(response.status).toBe(401);
  });

  it("allows therapist GET reads for same-org visible programs", async () => {
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
        data: [{ id: "program-1", client_id: "client-1" }],
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: [{ id: "note-1" }],
      });

    const response = await programNotesHandler(
      new Request("http://localhost/api/program-notes?program_id=11111111-1111-1111-1111-111111111111", {
        method: "GET",
        headers: { Authorization: `Bearer ${createAuthToken("therapist-1")}` },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([{ id: "note-1" }]);
    expect(fetchJson).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("/rest/v1/programs?select=id,client_id"),
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("allows same-org program note GET when the caller is a visible midtier/bcba viewer without legacy manager booleans", async () => {
    vi.mocked(getAccessToken).mockReturnValue(createAuthToken("viewer-1"));
    vi.mocked(resolveOrgAndRole).mockResolvedValue({
      organizationId: "org-1",
      isTherapist: false,
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
        data: [{ id: "program-1", client_id: "client-1" }],
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: [{ id: "note-1" }],
      });

    const response = await programNotesHandler(
      new Request("http://localhost/api/program-notes?program_id=11111111-1111-1111-1111-111111111111", {
        method: "GET",
        headers: { Authorization: `Bearer ${createAuthToken("viewer-1")}` },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([{ id: "note-1" }]);
  });

  it("returns 403 for program note GET when a viewer cannot see the requested program", async () => {
    vi.mocked(getAccessToken).mockReturnValue(createAuthToken("bt-1"));
    vi.mocked(resolveOrgAndRole).mockResolvedValue({
      organizationId: "org-1",
      isTherapist: false,
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

    const response = await programNotesHandler(
      new Request("http://localhost/api/program-notes?program_id=11111111-1111-1111-1111-111111111111", {
        method: "GET",
        headers: { Authorization: `Bearer ${createAuthToken("bt-1")}` },
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "program_id is not in scope for this organization",
    });
    expect(fetchJson).toHaveBeenCalledTimes(1);
  });

  it("returns 403 when posting notes for a program outside org scope", async () => {
    vi.mocked(getAccessToken).mockReturnValue(createAuthToken("actor-1"));
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

    const response = await programNotesHandler(
      new Request("http://localhost/api/program-notes", {
        method: "POST",
        headers: { Authorization: `Bearer ${createAuthToken("actor-1")}` },
        body: JSON.stringify({
          program_id: "11111111-1111-1111-1111-111111111111",
          note_type: "plan_update",
          content: { text: "note" },
        }),
      }),
    );

    expect(response.status).toBe(403);
  });

  it("writes author_id from JWT subject on successful note creation", async () => {
    vi.mocked(getAccessToken).mockReturnValue(createAuthToken("actor-1"));
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
        data: [{ id: "program-1" }],
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        data: [{ id: "note-1" }],
      });

    const response = await programNotesHandler(
      new Request("http://localhost/api/program-notes", {
        method: "POST",
        headers: { Authorization: `Bearer ${createAuthToken("actor-1")}` },
        body: JSON.stringify({
          program_id: "11111111-1111-1111-1111-111111111111",
          note_type: "plan_update",
          content: { text: "note" },
        }),
      }),
    );

    expect(response.status).toBe(201);
    expect(fetchJson).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("/rest/v1/program_notes"),
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("\"author_id\":\"actor-1\""),
      }),
    );
  });

  it("allows same-org program note POST when the manage-program-goals helper approves a non-therapist caller", async () => {
    vi.mocked(getAccessToken).mockReturnValue(createAuthToken("actor-1"));
    vi.mocked(resolveOrgAndRole).mockResolvedValue({
      organizationId: "org-1",
      isTherapist: false,
      isAdmin: false,
      isSuperAdmin: false,
    });
    vi.mocked(currentUserCanManageProgramsGoals).mockResolvedValue({ allowed: true, upstreamError: false });
    vi.mocked(getSupabaseConfig).mockReturnValue({
      supabaseUrl: "https://example.supabase.co",
      anonKey: "anon",
    });
    vi.mocked(fetchJson)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: [{ id: "program-1" }],
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        data: [{ id: "note-1" }],
      });

    const response = await programNotesHandler(
      new Request("http://localhost/api/program-notes", {
        method: "POST",
        headers: { Authorization: `Bearer ${createAuthToken("actor-1")}` },
        body: JSON.stringify({
          program_id: "11111111-1111-1111-1111-111111111111",
          note_type: "plan_update",
          content: { text: "note" },
        }),
      }),
    );

    expect(response.status).toBe(201);
    expect(currentUserCanManageProgramsGoals).toHaveBeenCalledWith(createAuthToken("actor-1"), "org-1");
  });

  it("returns 403 for program note POST when the manage-program-goals helper denies the caller", async () => {
    vi.mocked(getAccessToken).mockReturnValue(createAuthToken("actor-1"));
    vi.mocked(resolveOrgAndRole).mockResolvedValue({
      organizationId: "org-1",
      isTherapist: false,
      isAdmin: false,
      isSuperAdmin: false,
    });
    vi.mocked(currentUserCanManageProgramsGoals).mockResolvedValue({ allowed: false, upstreamError: false });
    vi.mocked(getSupabaseConfig).mockReturnValue({
      supabaseUrl: "https://example.supabase.co",
      anonKey: "anon",
    });

    const response = await programNotesHandler(
      new Request("http://localhost/api/program-notes", {
        method: "POST",
        headers: { Authorization: `Bearer ${createAuthToken("actor-1")}` },
        body: JSON.stringify({
          program_id: "11111111-1111-1111-1111-111111111111",
          note_type: "plan_update",
          content: { text: "note" },
        }),
      }),
    );

    expect(response.status).toBe(403);
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("returns 403 for therapist program note POST when canonical manage access is denied", async () => {
    vi.mocked(getAccessToken).mockReturnValue(createAuthToken("therapist-1"));
    vi.mocked(resolveOrgAndRole).mockResolvedValue({
      organizationId: "org-1",
      isTherapist: true,
      isAdmin: false,
      isSuperAdmin: false,
    });
    vi.mocked(currentUserCanManageProgramsGoals).mockResolvedValue({ allowed: false, upstreamError: false });
    vi.mocked(getSupabaseConfig).mockReturnValue({
      supabaseUrl: "https://example.supabase.co",
      anonKey: "anon",
    });

    const response = await programNotesHandler(
      new Request("http://localhost/api/program-notes", {
        method: "POST",
        headers: { Authorization: `Bearer ${createAuthToken("therapist-1")}` },
        body: JSON.stringify({
          program_id: "11111111-1111-1111-1111-111111111111",
          note_type: "plan_update",
          content: { text: "note" },
        }),
      }),
    );

    expect(response.status).toBe(403);
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("returns 502 for program note POST when the manage-program-goals helper cannot be validated", async () => {
    vi.mocked(getAccessToken).mockReturnValue(createAuthToken("actor-1"));
    vi.mocked(resolveOrgAndRole).mockResolvedValue({
      organizationId: "org-1",
      isTherapist: false,
      isAdmin: false,
      isSuperAdmin: false,
    });
    vi.mocked(currentUserCanManageProgramsGoals).mockResolvedValue({ allowed: false, upstreamError: true });
    vi.mocked(getSupabaseConfig).mockReturnValue({
      supabaseUrl: "https://example.supabase.co",
      anonKey: "anon",
    });

    const response = await programNotesHandler(
      new Request("http://localhost/api/program-notes", {
        method: "POST",
        headers: { Authorization: `Bearer ${createAuthToken("actor-1")}` },
        body: JSON.stringify({
          program_id: "11111111-1111-1111-1111-111111111111",
          note_type: "plan_update",
          content: { text: "note" },
        }),
      }),
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: "Unable to validate program-goal access" });
    expect(fetchJson).not.toHaveBeenCalled();
  });
});
