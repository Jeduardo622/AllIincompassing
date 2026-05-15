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

import { fetchJson, getAccessToken, getAccessTokenSubject, getSupabaseConfig, resolveOrgAndRole } from "../api/shared";

const buildAcceptedGoals = (
  counts: { childCount?: number; parentCount?: number } = {},
): Array<Record<string, unknown>> => [
  ...Array.from({ length: counts.childCount ?? 20 }, (_, index) => ({
    id: `child-goal-${index + 1}`,
    title: `Child Goal ${index + 1}`,
    description: `Child goal description ${index + 1} with enough detail.`,
    original_text: `Child goal original text ${index + 1} with enough detail for validation.`,
    goal_type: "child",
    objective_data_points: index === 0
      ? [{ metric_name: "baseline", metric_value: 2, metric_unit: "responses" }, "Legacy manual objective note"]
      : [],
    accept_state: "accepted",
  })),
  ...Array.from({ length: counts.parentCount ?? 6 }, (_, index) => ({
    id: `parent-goal-${index + 1}`,
    title: `Parent Goal ${index + 1}`,
    description: `Parent goal description ${index + 1} with enough detail.`,
    original_text: `Parent goal original text ${index + 1} with enough detail for validation.`,
    goal_type: "parent",
    objective_data_points: [],
    accept_state: "accepted",
  })),
];

describe("assessmentPromoteHandler", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("promotes all accepted draft programs and preserves goal-to-program links", async () => {
    vi.mocked(getAccessToken).mockReturnValue("token");
    vi.mocked(getAccessTokenSubject).mockReturnValue("user-1");
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
        return {
          ok: true,
          status: 200,
          data: [
            { id: "draft-program-1", name: "Draft Program 1", description: "x", accept_state: "accepted" },
            { id: "draft-program-2", name: "Draft Program 2", description: "y", accept_state: "edited" },
          ],
        };
      }
      if (method === "GET" && url.includes("/rest/v1/assessment_draft_goals?")) {
        const goals = buildAcceptedGoals();
        return {
          ok: true,
          status: 200,
          data: goals.map((goal, index) => ({
            ...goal,
            draft_program_id: index < 13 ? "draft-program-1" : "draft-program-2",
          })),
        };
      }
      if (method === "POST" && url.includes("/rest/v1/programs")) {
        const body = JSON.parse(String(init?.body)) as { name: string };
        if (body.name === "Draft Program 1") {
          return { ok: true, status: 201, data: [{ id: "prod-program-1" }] };
        }
        if (body.name === "Draft Program 2") {
          return { ok: true, status: 201, data: [{ id: "prod-program-2" }] };
        }
        return { ok: false, status: 500, data: null };
      }
      if (method === "POST" && url.includes("/rest/v1/goals")) {
        return {
          ok: true,
          status: 201,
          data: buildAcceptedGoals().map((goal, index) => ({ id: `prod-goal-${index + 1}`, title: goal.title })),
        };
      }
      if (method === "POST" && url.includes("/rest/v1/goal_data_points")) {
        return { ok: true, status: 201, data: null };
      }
      if (method === "PATCH" && url.includes("/rest/v1/assessment_documents")) {
        return { ok: true, status: 200, data: [{ id: "doc-1", organization_id: "org-1", client_id: "client-1", status: "approved" }] };
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
    await expect(response.json()).resolves.toMatchObject({
      created_program_count: 2,
      created_goal_count: 26,
      created_program_ids: ["prod-program-1", "prod-program-2"],
    });
    const createEventCall = vi
      .mocked(fetchJson)
      .mock.calls.find(([url, init]) => typeof url === "string" && url.includes("/rest/v1/assessment_review_events") && init?.method === "POST");
    expect(createEventCall).toBeTruthy();
    const createEventPayload = JSON.parse((createEventCall?.[1] as RequestInit).body as string) as {
      event_payload: Record<string, unknown>;
    };
    expect(createEventPayload.event_payload).toMatchObject({
      created_program_count: 2,
      created_goal_count: 26,
      created_program_ids: ["prod-program-1", "prod-program-2"],
      promoted_program_count: 2,
      promoted_goal_count: 26,
    });
    const createGoalsCall = vi
      .mocked(fetchJson)
      .mock.calls.find(([url, init]) => typeof url === "string" && url.includes("/rest/v1/goals") && init?.method === "POST");
    expect(createGoalsCall).toBeTruthy();
    const createGoalsPayload = JSON.parse((createGoalsCall?.[1] as RequestInit).body as string) as Array<Record<string, unknown>>;
    expect(createGoalsPayload[0]?.goal_type).toBe("child");
    expect(createGoalsPayload.filter((goal) => goal.goal_type === "child")).toHaveLength(20);
    expect(createGoalsPayload.filter((goal) => goal.goal_type === "parent")).toHaveLength(6);
    expect(createGoalsPayload.slice(0, 13).every((goal) => goal.program_id === "prod-program-1")).toBe(true);
    expect(createGoalsPayload.slice(13).every((goal) => goal.program_id === "prod-program-2")).toBe(true);
    const dataPointCall = vi
      .mocked(fetchJson)
      .mock.calls.find(([url, init]) => typeof url === "string" && url.includes("/rest/v1/goal_data_points") && init?.method === "POST");
    expect(dataPointCall).toBeTruthy();
    const dataPointPayload = JSON.parse((dataPointCall?.[1] as RequestInit).body as string) as Array<Record<string, unknown>>;
    expect(dataPointPayload[0]).toMatchObject({
      goal_id: "prod-goal-1",
      metric_name: "baseline",
      source: "assessment_extraction",
    });
    expect(dataPointPayload[1]).toMatchObject({
      goal_id: "prod-goal-1",
      metric_name: "Legacy manual objective note",
      metric_payload: { label: "Legacy manual objective note", raw_text: "Legacy manual objective note" },
    });
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

  it("blocks re-promotion of an already approved assessment before live rows are created", async () => {
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
      data: [{ id: "doc-1", organization_id: "org-1", client_id: "client-1", status: "approved" }],
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
    expect(body.error).toContain("already been approved and promoted");
    expect(fetchJson).toHaveBeenCalledTimes(1);
    expect(fetchJson).not.toHaveBeenCalledWith(
      expect.stringContaining("/rest/v1/programs"),
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchJson).not.toHaveBeenCalledWith(
      expect.stringContaining("/rest/v1/goals"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("blocks promotion when the conditional promotion lock finds the assessment already promoted", async () => {
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
        return { ok: true, status: 200, data: [{ id: "draft-program-1", name: "Draft Program", description: "x", accept_state: "accepted" }] };
      }
      if (method === "GET" && url.includes("/rest/v1/assessment_draft_goals?")) {
        return {
          ok: true,
          status: 200,
          data: buildAcceptedGoals({ childCount: 1, parentCount: 0 }).map((goal) => ({ ...goal, draft_program_id: "draft-program-1" })),
        };
      }
      if (
        method === "PATCH" &&
        url.includes("/rest/v1/assessment_documents?id=eq.doc-1&status=not.in.(approved,promoted)")
      ) {
        return { ok: true, status: 200, data: [] };
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

    const body = await response.json();
    expect(response.status).toBe(409);
    expect(body.error).toContain("already been approved and promoted");
    expect(fetchJson).not.toHaveBeenCalledWith(
      expect.stringContaining("/rest/v1/programs"),
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchJson).not.toHaveBeenCalledWith(
      expect.stringContaining("/rest/v1/goals"),
      expect.objectContaining({ method: "POST" }),
    );
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

  it("promotes smaller accepted goal sets when draft content is otherwise valid", async () => {
    vi.mocked(getAccessToken).mockReturnValue("token");
    vi.mocked(getAccessTokenSubject).mockReturnValue("user-1");
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
    const acceptedGoals = buildAcceptedGoals({ childCount: 2, parentCount: 1 }).map((goal) => ({
      ...goal,
      draft_program_id: "program-1",
    }));
    vi.mocked(fetchJson).mockImplementation(async (url: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && url.includes("/rest/v1/assessment_documents?select=id,organization_id,client_id,status")) {
        return { ok: true, status: 200, data: [{ id: "doc-1", organization_id: "org-1", client_id: "client-1", status: "drafted" }] };
      }
      if (method === "GET" && url.includes("/rest/v1/assessment_draft_programs?")) {
        return { ok: true, status: 200, data: [{ id: "program-1", name: "Draft Program", description: "x", accept_state: "accepted" }] };
      }
      if (method === "GET" && url.includes("/rest/v1/assessment_draft_goals?")) {
        return { ok: true, status: 200, data: acceptedGoals };
      }
      if (method === "POST" && url.includes("/rest/v1/programs")) {
        return { ok: true, status: 201, data: [{ id: "prod-program-1" }] };
      }
      if (method === "POST" && url.includes("/rest/v1/goals")) {
        return {
          ok: true,
          status: 201,
          data: acceptedGoals.map((goal, index) => ({ id: `prod-goal-${index + 1}`, title: goal.title })),
        };
      }
      if (method === "POST" && url.includes("/rest/v1/goal_data_points")) {
        return { ok: true, status: 201, data: null };
      }
      if (method === "PATCH" && url.includes("/rest/v1/assessment_documents")) {
        return { ok: true, status: 200, data: [{ id: "doc-1", organization_id: "org-1", client_id: "client-1", status: "approved" }] };
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
    await expect(response.json()).resolves.toMatchObject({
      created_program_count: 1,
      created_goal_count: 3,
      promoted_goal_count: 3,
    });
  });

  it("rolls back created programs when production goal creation fails", async () => {
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
        return { ok: true, status: 200, data: [{ id: "draft-program-1", name: "Draft Program", description: "x", accept_state: "accepted" }] };
      }
      if (method === "GET" && url.includes("/rest/v1/assessment_draft_goals?")) {
        return {
          ok: true,
          status: 200,
          data: buildAcceptedGoals().map((goal) => ({ ...goal, draft_program_id: "draft-program-1" })),
        };
      }
      if (method === "POST" && url.includes("/rest/v1/programs")) {
        return { ok: true, status: 201, data: [{ id: "prod-program-rollback-1" }] };
      }
      if (method === "POST" && url.includes("/rest/v1/goals")) {
        return { ok: false, status: 500, data: null };
      }
      if (method === "PATCH" && url.includes("/rest/v1/assessment_documents")) {
        return { ok: true, status: 200, data: [{ id: "doc-1", organization_id: "org-1", client_id: "client-1", status: "approved" }] };
      }
      if (
        method === "DELETE" &&
        url.includes("/rest/v1/programs?id=in.(prod-program-rollback-1)&organization_id=eq.org-1&client_id=eq.client-1")
      ) {
        return { ok: true, status: 200, data: null };
      }
      if (
        method === "DELETE" &&
        url.includes("/rest/v1/goals?program_id=in.(prod-program-rollback-1)&organization_id=eq.org-1&client_id=eq.client-1")
      ) {
        return { ok: true, status: 200, data: null };
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

    const body = await response.json();
    expect(response.status).toBe(500);
    expect(body.error).toContain("rolled back safely");
    expect(fetchJson).toHaveBeenCalledWith(
      expect.stringContaining("/rest/v1/programs?id=in.(prod-program-rollback-1)&organization_id=eq.org-1&client_id=eq.client-1"),
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("returns created and promoted goal counts separately when the goal insert response includes extra live rows", async () => {
    vi.mocked(getAccessToken).mockReturnValue("token");
    vi.mocked(getAccessTokenSubject).mockReturnValue("user-1");
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
        return { ok: true, status: 200, data: [{ id: "draft-program-1", name: "Draft Program", description: "x", accept_state: "accepted" }] };
      }
      if (method === "GET" && url.includes("/rest/v1/assessment_draft_goals?")) {
        return {
          ok: true,
          status: 200,
          data: buildAcceptedGoals().map((goal) => ({ ...goal, draft_program_id: "draft-program-1" })),
        };
      }
      if (method === "POST" && url.includes("/rest/v1/programs")) {
        return { ok: true, status: 201, data: [{ id: "prod-program-1" }] };
      }
      if (method === "POST" && url.includes("/rest/v1/goals")) {
        return {
          ok: true,
          status: 201,
          data: [
            ...buildAcceptedGoals().map((goal, index) => ({ id: `prod-goal-${index + 1}`, title: goal.title })),
            { id: "prod-goal-extra", title: "Unexpected extra goal" },
          ],
        };
      }
      if (method === "POST" && url.includes("/rest/v1/goal_data_points")) {
        return { ok: true, status: 201, data: null };
      }
      if (method === "PATCH" && url.includes("/rest/v1/assessment_documents")) {
        return { ok: true, status: 200, data: [{ id: "doc-1", organization_id: "org-1", client_id: "client-1", status: "approved" }] };
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
    await expect(response.json()).resolves.toMatchObject({
      created_program_count: 1,
      created_goal_count: 27,
      promoted_program_count: 1,
      promoted_goal_count: 26,
    });
    const createEventCall = vi
      .mocked(fetchJson)
      .mock.calls.find(([url, init]) => typeof url === "string" && url.includes("/rest/v1/assessment_review_events") && init?.method === "POST");
    expect(createEventCall).toBeTruthy();
    const createEventPayload = JSON.parse((createEventCall?.[1] as RequestInit).body as string) as {
      event_payload: Record<string, unknown>;
    };
    expect(createEventPayload.event_payload).toMatchObject({
      created_program_count: 1,
      created_goal_count: 27,
      promoted_program_count: 1,
      promoted_goal_count: 26,
    });
  });

  it("rolls back already-created programs when a later program create fails", async () => {
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
        return {
          ok: true,
          status: 200,
          data: [
            { id: "draft-program-1", name: "Draft Program 1", description: "x", accept_state: "accepted" },
            { id: "draft-program-2", name: "Draft Program 2", description: "y", accept_state: "accepted" },
          ],
        };
      }
      if (method === "GET" && url.includes("/rest/v1/assessment_draft_goals?")) {
        return {
          ok: true,
          status: 200,
          data: buildAcceptedGoals().map((goal) => ({ ...goal, draft_program_id: "draft-program-1" })),
        };
      }
      if (method === "POST" && url.includes("/rest/v1/programs")) {
        const body = JSON.parse(String(init?.body)) as { name: string };
        if (body.name === "Draft Program 1") {
          return { ok: true, status: 201, data: [{ id: "prod-program-1" }] };
        }
        if (body.name === "Draft Program 2") {
          return { ok: false, status: 500, data: null };
        }
      }
      if (method === "DELETE" && url.includes("/rest/v1/goals?program_id=in.(prod-program-1)&organization_id=eq.org-1&client_id=eq.client-1")) {
        return { ok: true, status: 200, data: null };
      }
      if (method === "DELETE" && url.includes("/rest/v1/programs?id=in.(prod-program-1)&organization_id=eq.org-1&client_id=eq.client-1")) {
        return { ok: true, status: 200, data: null };
      }
      if (method === "PATCH" && url.includes("/rest/v1/assessment_documents")) {
        return { ok: true, status: 200, data: [{ id: "doc-1", organization_id: "org-1", client_id: "client-1", status: "approved" }] };
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

    const body = await response.json();
    expect(response.status).toBe(500);
    expect(body.error).toContain("rolled back safely");
    expect(fetchJson).toHaveBeenCalledWith(
      expect.stringContaining("/rest/v1/programs?id=in.(prod-program-1)&organization_id=eq.org-1&client_id=eq.client-1"),
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("blocks promotion when accepted goals point to a non-accepted draft program", async () => {
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
        data: [{ id: "draft-program-1", name: "Draft Program", description: "x", accept_state: "accepted" }],
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: buildAcceptedGoals().map((goal) => ({ ...goal, draft_program_id: "draft-program-rejected" })),
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
    expect(body.error).toContain("must belong to an accepted draft program");
  });

  it("blocks promotion when multiple accepted programs include unlinked accepted goals", async () => {
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
        data: [
          { id: "draft-program-1", name: "Draft Program 1", description: "x", accept_state: "accepted" },
          { id: "draft-program-2", name: "Draft Program 2", description: "y", accept_state: "accepted" },
        ],
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: buildAcceptedGoals().map((goal) => ({ ...goal, draft_program_id: null })),
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
    expect(body.error).toContain("must keep their draft program link");
  });

  it("rolls back live writes and restores assessment status when review-event persistence fails", async () => {
    vi.mocked(getAccessToken).mockReturnValue("token");
    vi.mocked(getAccessTokenSubject).mockReturnValue("user-1");
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
        return { ok: true, status: 200, data: [{ id: "draft-program-1", name: "Draft Program", description: "x", accept_state: "accepted" }] };
      }
      if (method === "GET" && url.includes("/rest/v1/assessment_draft_goals?")) {
        return {
          ok: true,
          status: 200,
          data: buildAcceptedGoals().map((goal) => ({ ...goal, draft_program_id: "draft-program-1" })),
        };
      }
      if (method === "POST" && url.includes("/rest/v1/programs")) {
        return { ok: true, status: 201, data: [{ id: "prod-program-1" }] };
      }
      if (method === "POST" && url.includes("/rest/v1/goals")) {
        return {
          ok: true,
          status: 201,
          data: buildAcceptedGoals().map((goal, index) => ({ id: `prod-goal-${index + 1}`, title: goal.title })),
        };
      }
      if (method === "POST" && url.includes("/rest/v1/goal_data_points")) {
        return { ok: true, status: 201, data: null };
      }
      if (method === "PATCH" && url.includes("/rest/v1/assessment_documents?id=eq.doc-1")) {
        return { ok: true, status: 200, data: [{ id: "doc-1", organization_id: "org-1", client_id: "client-1", status: "approved" }] };
      }
      if (method === "POST" && url.includes("/rest/v1/assessment_review_events")) {
        return { ok: false, status: 500, data: null };
      }
      if (method === "DELETE" && url.includes("/rest/v1/goals?program_id=in.(prod-program-1)&organization_id=eq.org-1&client_id=eq.client-1")) {
        return { ok: true, status: 200, data: null };
      }
      if (method === "DELETE" && url.includes("/rest/v1/programs?id=in.(prod-program-1)&organization_id=eq.org-1&client_id=eq.client-1")) {
        return { ok: true, status: 200, data: null };
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

    const body = await response.json();
    expect(response.status).toBe(500);
    expect(body.error).toContain("rolled back safely");
    expect(fetchJson).toHaveBeenCalledWith(
      expect.stringContaining("/rest/v1/assessment_documents?id=eq.doc-1"),
      expect.objectContaining({
        method: "PATCH",
        body: expect.stringContaining('"status":"drafted"'),
      }),
    );
  });

  it("surfaces rollback failure details when review-event cleanup cannot fully unwind live writes", async () => {
    vi.mocked(getAccessToken).mockReturnValue("token");
    vi.mocked(getAccessTokenSubject).mockReturnValue("user-1");
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
        return { ok: true, status: 200, data: [{ id: "draft-program-1", name: "Draft Program", description: "x", accept_state: "accepted" }] };
      }
      if (method === "GET" && url.includes("/rest/v1/assessment_draft_goals?")) {
        return {
          ok: true,
          status: 200,
          data: buildAcceptedGoals().map((goal) => ({ ...goal, draft_program_id: "draft-program-1" })),
        };
      }
      if (method === "POST" && url.includes("/rest/v1/programs")) {
        return { ok: true, status: 201, data: [{ id: "prod-program-1" }] };
      }
      if (method === "POST" && url.includes("/rest/v1/goals")) {
        return {
          ok: true,
          status: 201,
          data: buildAcceptedGoals().map((goal, index) => ({ id: `prod-goal-${index + 1}`, title: goal.title })),
        };
      }
      if (method === "POST" && url.includes("/rest/v1/goal_data_points")) {
        return { ok: true, status: 201, data: null };
      }
      if (method === "PATCH" && url.includes("/rest/v1/assessment_documents?id=eq.doc-1")) {
        return { ok: true, status: 200, data: [{ id: "doc-1", organization_id: "org-1", client_id: "client-1", status: "approved" }] };
      }
      if (method === "POST" && url.includes("/rest/v1/assessment_review_events")) {
        return { ok: false, status: 500, data: null };
      }
      if (method === "DELETE" && url.includes("/rest/v1/goals?program_id=in.(prod-program-1)&organization_id=eq.org-1&client_id=eq.client-1")) {
        return { ok: true, status: 200, data: null };
      }
      if (method === "DELETE" && url.includes("/rest/v1/programs?id=in.(prod-program-1)&organization_id=eq.org-1&client_id=eq.client-1")) {
        return { ok: false, status: 500, data: null };
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

    const body = await response.json();
    expect(response.status).toBe(500);
    expect(body.error).toContain("rollback did not complete cleanly");
    expect(body.rollback_failed_steps).toEqual(["delete_programs"]);
    const documentPatchBodies = vi
      .mocked(fetchJson)
      .mock.calls.filter(([url, init]) => {
        const method = (init?.method ?? "GET").toUpperCase();
        return typeof url === "string" && method === "PATCH" && url.includes("/rest/v1/assessment_documents?id=eq.doc-1");
      })
      .map(([, init]) => String((init as RequestInit | undefined)?.body ?? ""));
    expect(documentPatchBodies.some((bodyText) => bodyText.includes('"status":"approved"'))).toBe(true);
    expect(documentPatchBodies.some((bodyText) => bodyText.includes('"status":"drafted"'))).toBe(false);
  });
});
