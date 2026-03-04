import { beforeEach, describe, expect, it, vi } from "vitest";
import { assessmentPromoteHandler } from "../api/assessment-promote";

vi.mock("../api/shared", async () => {
  const actual = await vi.importActual<typeof import("../api/shared")>("../api/shared");
  return {
    ...actual,
    getAccessToken: vi.fn(),
    resolveOrgAndRole: vi.fn(),
    getSupabaseConfig: vi.fn(),
    getAccessTokenSubject: vi.fn(),
    fetchJson: vi.fn(),
  };
});

import { fetchJson, getAccessToken, getSupabaseConfig, resolveOrgAndRole } from "../api/shared";

const buildAcceptedGoals = (): Array<Record<string, unknown>> => [
  ...Array.from({ length: 20 }, (_, index) => ({
    id: `child-goal-${index + 1}`,
    title: `Child Goal ${index + 1}`,
    description: `Child goal description ${index + 1} with enough detail.`,
    original_text: `Child goal original text ${index + 1} with enough detail for validation.`,
    goal_type: "child",
    accept_state: "accepted",
  })),
  ...Array.from({ length: 6 }, (_, index) => ({
    id: `parent-goal-${index + 1}`,
    title: `Parent Goal ${index + 1}`,
    description: `Parent goal description ${index + 1} with enough detail.`,
    original_text: `Parent goal original text ${index + 1} with enough detail for validation.`,
    goal_type: "parent",
    accept_state: "accepted",
  })),
];

describe("assessmentPromoteHandler", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("promotes accepted drafts without checklist mapping approvals", async () => {
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
    vi.mocked(fetchJson).mockImplementation(async (url: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && url.includes("/rest/v1/assessment_documents?select=id,organization_id,client_id,status")) {
        return { ok: true, status: 200, data: [{ id: "doc-1", organization_id: "org-1", client_id: "client-1", status: "drafted" }] };
      }
      if (method === "GET" && url.includes("/rest/v1/assessment_draft_programs?")) {
        return { ok: true, status: 200, data: [{ id: "program-1", name: "Draft Program", description: "x", accept_state: "accepted" }] };
      }
      if (method === "GET" && url.includes("/rest/v1/assessment_draft_goals?")) {
        return {
          ok: true,
          status: 200,
          data: buildAcceptedGoals(),
        };
      }
      if (method === "POST" && url.includes("/rest/v1/programs")) {
        return { ok: true, status: 201, data: [{ id: "prod-program-1" }] };
      }
      if (method === "POST" && url.includes("/rest/v1/goals")) {
        return { ok: true, status: 201, data: [{ id: "prod-goal-1" }] };
      }
      if (method === "PATCH" && url.includes("/rest/v1/assessment_documents")) {
        return { ok: true, status: 200, data: null };
      }
      if (method === "POST" && url.includes("/rest/v1/assessment_review_events")) {
        return { ok: true, status: 201, data: null };
      }
      return { ok: false, status: 500, data: null };
    });

    const response = await assessmentPromoteHandler(
      new Request("http://localhost/api/assessment-promote", {
        method: "POST",
        headers: { Authorization: "Bearer token" },
        body: JSON.stringify({ assessment_document_id: "11111111-1111-1111-1111-111111111111" }),
      }),
    );

    expect(response.status).toBe(200);
    const createGoalsCall = vi
      .mocked(fetchJson)
      .mock.calls.find(([url, init]) => typeof url === "string" && url.includes("/rest/v1/goals") && init?.method === "POST");
    expect(createGoalsCall).toBeTruthy();
    const createGoalsPayload = JSON.parse((createGoalsCall?.[1] as RequestInit).body as string) as Array<Record<string, unknown>>;
    expect(createGoalsPayload[0]?.goal_type).toBe("child");
    expect(createGoalsPayload.filter((goal) => goal.goal_type === "child")).toHaveLength(20);
    expect(createGoalsPayload.filter((goal) => goal.goal_type === "parent")).toHaveLength(6);
  });

  it("blocks promotion when accepted goals contain duplicate titles", async () => {
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
        data: [{ id: "doc-1", organization_id: "org-1", client_id: "client-1", status: "drafted" }],
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: [{ id: "program-1", name: "Draft Program", description: "x", accept_state: "accepted" }],
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: (() => {
          const goals = buildAcceptedGoals();
          goals[1] = {
            ...(goals[1] as Record<string, unknown>),
            title: "Child Goal 1",
            accept_state: "edited",
          };
          return goals;
        })(),
      });

    const response = await assessmentPromoteHandler(
      new Request("http://localhost/api/assessment-promote", {
        method: "POST",
        headers: { Authorization: "Bearer token" },
        body: JSON.stringify({ assessment_document_id: "11111111-1111-1111-1111-111111111111" }),
      }),
    );

    const body = await response.json();
    expect(response.status).toBe(409);
    expect(body.error).toContain("Duplicate accepted goal titles");
  });

  it("blocks promotion when accepted goals are missing minimum content", async () => {
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
        data: [{ id: "doc-1", organization_id: "org-1", client_id: "client-1", status: "drafted" }],
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: [{ id: "program-1", name: "Draft Program", description: "x", accept_state: "accepted" }],
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: (() => {
          const goals = buildAcceptedGoals();
          goals[0] = {
            ...(goals[0] as Record<string, unknown>),
            title: "Hi",
            description: "short",
            original_text: "tiny",
          };
          return goals;
        })(),
      });

    const response = await assessmentPromoteHandler(
      new Request("http://localhost/api/assessment-promote", {
        method: "POST",
        headers: { Authorization: "Bearer token" },
        body: JSON.stringify({ assessment_document_id: "11111111-1111-1111-1111-111111111111" }),
      }),
    );

    const body = await response.json();
    expect(response.status).toBe(409);
    expect(body.error).toContain("minimally complete");
  });

  it("blocks promotion when accepted parent/child minimums are not met", async () => {
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
        data: [{ id: "doc-1", organization_id: "org-1", client_id: "client-1", status: "drafted" }],
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: [{ id: "program-1", name: "Draft Program", description: "x", accept_state: "accepted" }],
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: Array.from({ length: 26 }, (_, index) => ({
          id: `child-goal-${index + 1}`,
          title: `Child Goal ${index + 1}`,
          description: `Child goal description ${index + 1} with enough detail.`,
          original_text: `Child goal original text ${index + 1} with enough detail for validation.`,
          goal_type: "child",
          accept_state: "accepted",
        })),
      });

    const response = await assessmentPromoteHandler(
      new Request("http://localhost/api/assessment-promote", {
        method: "POST",
        headers: { Authorization: "Bearer token" },
        body: JSON.stringify({ assessment_document_id: "11111111-1111-1111-1111-111111111111" }),
      }),
    );

    const body = await response.json();
    expect(response.status).toBe(409);
    expect(body.error).toContain("Promotion requires at least");
  });
});
