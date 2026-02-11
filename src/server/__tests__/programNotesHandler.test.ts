import { beforeEach, describe, expect, it, vi } from "vitest";
import { programNotesHandler } from "../api/program-notes";

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

describe("programNotesHandler", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns 401 when authorization header is missing", async () => {
    const response = await programNotesHandler(
      new Request("http://localhost/api/program-notes?program_id=program-1", { method: "GET" }),
    );

    expect(response.status).toBe(401);
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
});
