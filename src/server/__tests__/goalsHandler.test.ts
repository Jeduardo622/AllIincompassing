import { beforeEach, describe, expect, it, vi } from "vitest";
import { goalsHandler } from "../api/goals";

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

describe("goalsHandler", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns 401 when authorization header is missing", async () => {
    const response = await goalsHandler(
      new Request("http://localhost/api/goals?program_id=program-1", { method: "GET" }),
    );

    expect(response.status).toBe(401);
  });

  it("returns 400 when GET program_id is not a UUID", async () => {
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

    const response = await goalsHandler(
      new Request("http://localhost/api/goals?program_id=not-a-uuid", {
        method: "GET",
        headers: { Authorization: "Bearer token" },
      }),
    );

    expect(response.status).toBe(400);
  });

  it("returns 400 when program_id does not belong to client_id on POST", async () => {
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
      data: [{ id: "program-1", client_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" }],
    });

    const response = await goalsHandler(
      new Request("http://localhost/api/goals", {
        method: "POST",
        headers: { Authorization: "Bearer token" },
        body: JSON.stringify({
          client_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
          program_id: "11111111-1111-1111-1111-111111111111",
          title: "Goal A",
          description: "Description",
          original_text: "Original clinical language",
        }),
      }),
    );

    expect(response.status).toBe(400);
  });

  it("creates a goal with structured criteria and objective data points", async () => {
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
    vi.mocked(fetchJson)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: [{ id: "program-1", client_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" }],
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        data: [{ id: "goal-1" }],
      });

    const response = await goalsHandler(
      new Request("http://localhost/api/goals", {
        method: "POST",
        headers: { Authorization: "Bearer token" },
        body: JSON.stringify({
          client_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
          program_id: "11111111-1111-1111-1111-111111111111",
          title: "Goal A",
          description: "Description",
          original_text: "Original clinical language",
          mastery_criteria: "80% for 2 sessions",
          objective_data_points: [{ objective: "Match emotions", criterion: "4/5" }],
        }),
      }),
    );

    expect(response.status).toBe(201);
    const createCall = vi
      .mocked(fetchJson)
      .mock.calls.find(([url, init]) => typeof url === "string" && url.includes("/rest/v1/goals") && init?.method === "POST");
    expect(createCall).toBeTruthy();
    const createPayload = JSON.parse((createCall?.[1] as RequestInit).body as string) as Record<string, unknown>;
    expect(createPayload.mastery_criteria).toBe("80% for 2 sessions");
    expect(Array.isArray(createPayload.objective_data_points)).toBe(true);
  });
});
