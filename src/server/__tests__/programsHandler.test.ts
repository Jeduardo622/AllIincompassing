import { beforeEach, describe, expect, it, vi } from "vitest";
import { programsHandler } from "../api/programs";

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

describe("programsHandler", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns 401 when authorization header is missing", async () => {
    const response = await programsHandler(
      new Request("http://localhost/api/programs?client_id=client-1", { method: "GET" }),
    );

    expect(response.status).toBe(401);
  });

  it("returns program records for scoped client GET requests", async () => {
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
      data: [{ id: "program-1", client_id: "11111111-1111-1111-1111-111111111111" }],
    });

    const response = await programsHandler(
      new Request(
        "http://localhost/api/programs?client_id=11111111-1111-1111-1111-111111111111",
        { method: "GET", headers: { Authorization: "Bearer token" } },
      ),
    );

    expect(response.status).toBe(200);
    expect(fetchJson).toHaveBeenCalledWith(
      expect.stringContaining("organization_id=eq.org-1"),
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("returns 403 when creating a program for a client outside org scope", async () => {
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
      data: [],
    });

    const response = await programsHandler(
      new Request("http://localhost/api/programs", {
        method: "POST",
        headers: { Authorization: "Bearer token" },
        body: JSON.stringify({
          client_id: "11111111-1111-1111-1111-111111111111",
          name: "Program A",
        }),
      }),
    );

    expect(response.status).toBe(403);
  });

  it("returns 403 when org context cannot be resolved", async () => {
    vi.mocked(getAccessToken).mockReturnValue("token");
    vi.mocked(resolveOrgAndRole).mockResolvedValue({
      organizationId: null,
      isTherapist: true,
      isAdmin: false,
      isSuperAdmin: false,
    });
    vi.mocked(getSupabaseConfig).mockReturnValue({
      supabaseUrl: "https://example.supabase.co",
      anonKey: "anon",
    });

    const response = await programsHandler(
      new Request("http://localhost/api/programs?client_id=11111111-1111-1111-1111-111111111111", {
        method: "GET",
        headers: { Authorization: "Bearer token" },
      }),
    );

    expect(response.status).toBe(403);
    expect(fetchJson).not.toHaveBeenCalled();
  });

  const roleMatrix = [
    {
      label: "therapist",
      role: { isTherapist: true, isAdmin: false, isSuperAdmin: false },
    },
    {
      label: "admin",
      role: { isTherapist: false, isAdmin: true, isSuperAdmin: false },
    },
    {
      label: "super_admin",
      role: { isTherapist: false, isAdmin: false, isSuperAdmin: true },
    },
  ] as const;

  it.each(roleMatrix)("returns 403 for out-of-scope client POST as $label", async ({ role }) => {
    vi.mocked(getAccessToken).mockReturnValue("token");
    vi.mocked(resolveOrgAndRole).mockResolvedValue({
      organizationId: "org-1",
      ...role,
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

    const response = await programsHandler(
      new Request("http://localhost/api/programs", {
        method: "POST",
        headers: { Authorization: "Bearer token" },
        body: JSON.stringify({
          client_id: "11111111-1111-1111-1111-111111111111",
          name: "Program A",
        }),
      }),
    );

    expect(response.status).toBe(403);
  });

  it.each(roleMatrix)("returns 403 for out-of-org program PATCH as $label", async ({ role }) => {
    vi.mocked(getAccessToken).mockReturnValue("token");
    vi.mocked(resolveOrgAndRole).mockResolvedValue({
      organizationId: "org-1",
      ...role,
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

    const response = await programsHandler(
      new Request("http://localhost/api/programs?program_id=11111111-1111-4111-8111-111111111111", {
        method: "PATCH",
        headers: { Authorization: "Bearer token" },
        body: JSON.stringify({ name: "Updated Program" }),
      }),
    );

    expect(response.status).toBe(403);
    expect(fetchJson).toHaveBeenCalledWith(
      expect.stringContaining("organization_id=eq.org-1"),
      expect.objectContaining({ method: "PATCH" }),
    );
  });

  it.each(roleMatrix)("returns 403 for out-of-scope client_id PATCH as $label", async ({ role }) => {
    vi.mocked(getAccessToken).mockReturnValue("token");
    vi.mocked(resolveOrgAndRole).mockResolvedValue({
      organizationId: "org-1",
      ...role,
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

    const response = await programsHandler(
      new Request("http://localhost/api/programs?program_id=11111111-1111-4111-8111-111111111111", {
        method: "PATCH",
        headers: { Authorization: "Bearer token" },
        body: JSON.stringify({ client_id: "22222222-2222-4222-8222-222222222222" }),
      }),
    );

    expect(response.status).toBe(403);
    expect(fetchJson).toHaveBeenCalledTimes(1);
    expect(fetchJson).toHaveBeenCalledWith(
      expect.stringContaining("/rest/v1/clients"),
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("returns 400 when PATCH program_id is not a UUID", async () => {
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

    const response = await programsHandler(
      new Request("http://localhost/api/programs?program_id=not-a-uuid", {
        method: "PATCH",
        headers: { Authorization: "Bearer token" },
        body: JSON.stringify({ name: "Updated Program" }),
      }),
    );

    expect(response.status).toBe(400);
    expect(fetchJson).not.toHaveBeenCalled();
  });
});
