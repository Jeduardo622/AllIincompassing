import { beforeEach, describe, expect, it, vi } from "vitest";
import { assessmentDraftsHandler } from "../api/assessment-drafts";

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

import {
  fetchJson,
  getAccessToken,
  getAccessTokenSubject,
  getSupabaseConfig,
  resolveOrgAndRole,
} from "../api/shared";

const buildTypedGoals = (): Array<Record<string, unknown>> => [
  ...Array.from({ length: 20 }, (_, index) => ({
    title: `Child Goal ${index + 1}`,
    description: `Child goal description ${index + 1}`,
    original_text: `Child goal original text ${index + 1}`,
    goal_type: "child",
  })),
  ...Array.from({ length: 6 }, (_, index) => ({
    title: `Parent Goal ${index + 1}`,
    description: `Parent goal description ${index + 1}`,
    original_text: `Parent goal original text ${index + 1}`,
    goal_type: "parent",
  })),
];

describe("assessmentDraftsHandler", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("creates staged draft program and goals", async () => {
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
    vi.mocked(fetchJson)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: [{ id: "doc-1", organization_id: "org-1", client_id: "client-1" }],
      })
      .mockResolvedValueOnce({ ok: true, status: 201, data: [{ id: "draft-program-1" }] })
      .mockResolvedValueOnce({ ok: true, status: 201, data: null })
      .mockResolvedValueOnce({ ok: true, status: 200, data: null })
      .mockResolvedValueOnce({ ok: true, status: 201, data: null });

    const response = await assessmentDraftsHandler(
      new Request("http://localhost/api/assessment-drafts", {
        method: "POST",
        headers: { Authorization: "Bearer token" },
        body: JSON.stringify({
          assessment_document_id: "11111111-1111-1111-1111-111111111111",
          program: { name: "Communication Program" },
          goals: [
            {
              title: "Child Goal A",
              description: "Description A",
              original_text: "Original A",
              goal_type: "child",
              mastery_criteria: "80% across 2 sessions",
              maintenance_criteria: "80% across 2 maintenance checks",
              generalization_criteria: "Across home and clinic",
              objective_data_points: [{ objective: "Identify 4 emotions", data_settings: "Opportunity based with prompts" }],
            },
            ...Array.from({ length: 19 }, (_, index) => ({
              title: `Child Goal ${index + 2}`,
              description: `Description child ${index + 2}`,
              original_text: `Original child ${index + 2}`,
              goal_type: "child",
            })),
            ...Array.from({ length: 6 }, (_, index) => ({
              title: `Parent Goal ${index + 1}`,
              description: `Description parent ${index + 1}`,
              original_text: `Original parent ${index + 1}`,
              goal_type: "parent",
            })),
          ],
        }),
      }),
    );

    expect(response.status).toBe(201);
    expect(fetchJson).toHaveBeenCalledWith(
      expect.stringContaining("/assessment_draft_goals"),
      expect.objectContaining({ method: "POST" }),
    );
    const goalCreateCall = vi
      .mocked(fetchJson)
      .mock.calls.find(([url]) => typeof url === "string" && url.includes("/rest/v1/assessment_draft_goals"));
    expect(goalCreateCall).toBeTruthy();
    const goalPayload = JSON.parse((goalCreateCall?.[1] as RequestInit).body as string) as Array<Record<string, unknown>>;
    expect(goalPayload[0]?.mastery_criteria).toBe("80% across 2 sessions");
    expect(goalPayload[0]?.goal_type).toBe("child");
    expect(Array.isArray(goalPayload[0]?.objective_data_points)).toBe(true);
  });

  it("auto-generates staged drafts from extracted checklist values", async () => {
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
      if (method === "GET" && url.includes("/rest/v1/assessment_documents?")) {
        return {
          ok: true,
          status: 200,
          data: [{ id: "doc-1", organization_id: "org-1", client_id: "client-1" }],
        };
      }
      if (method === "GET" && url.includes("/rest/v1/assessment_checklist_items?")) {
        return {
          ok: true,
          status: 200,
          data: [
            {
              section_key: "clinical_summary",
              label: "Summary",
              placeholder_key: "CALOPTIMA_SUMMARY",
              value_text: "Client presents with communication deficits.",
              required: true,
              status: "drafted",
            },
          ],
        };
      }
      if (method === "GET" && url.includes("/rest/v1/clients?select=full_name")) {
        return { ok: true, status: 200, data: [{ full_name: "Client One" }] };
      }
      if (method === "POST" && url.includes("/functions/v1/generate-program-goals")) {
        return {
          ok: true,
          status: 200,
          data: {
            program: { name: "Communication Program", description: "Improve communication skills." },
            goals: buildTypedGoals(),
            rationale: "Generated from extracted field values.",
          },
        };
      }
      if (method === "POST" && url.includes("/rest/v1/assessment_draft_programs")) {
        return { ok: true, status: 201, data: [{ id: "draft-program-2" }] };
      }
      if (method === "POST" && url.includes("/rest/v1/assessment_draft_goals")) {
        return { ok: true, status: 201, data: null };
      }
      if (method === "PATCH" && url.includes("/rest/v1/assessment_documents")) {
        return { ok: true, status: 200, data: null };
      }
      if (method === "POST" && url.includes("/rest/v1/assessment_review_events")) {
        return { ok: true, status: 201, data: null };
      }
      return { ok: true, status: 200, data: null };
    });

    const response = await assessmentDraftsHandler(
      new Request("http://localhost/api/assessment-drafts", {
        method: "POST",
        headers: { Authorization: "Bearer token" },
        body: JSON.stringify({
          assessment_document_id: "11111111-1111-1111-1111-111111111111",
          auto_generate: true,
        }),
      }),
    );

    expect(response.status).toBe(201);
    expect(fetchJson).toHaveBeenCalledWith(
      expect.stringContaining("/functions/v1/generate-program-goals"),
      expect.objectContaining({ method: "POST" }),
    );
    const goalCreateCall = vi
      .mocked(fetchJson)
      .mock.calls.find(([url]) => typeof url === "string" && url.includes("/rest/v1/assessment_draft_goals"));
    expect(goalCreateCall).toBeTruthy();
    const goalPayload = JSON.parse((goalCreateCall?.[1] as RequestInit).body as string) as Array<Record<string, unknown>>;
    const childGoalCount = goalPayload.filter((goal) => goal.goal_type === "child").length;
    const parentGoalCount = goalPayload.filter((goal) => goal.goal_type === "parent").length;
    expect(childGoalCount).toBe(20);
    expect(parentGoalCount).toBe(6);
  });

  it("returns empty drafts when requested assessment is no longer in scope", async () => {
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
    vi.mocked(fetchJson).mockResolvedValue({
      ok: true,
      status: 200,
      data: [],
    });

    const response = await assessmentDraftsHandler(
      new Request(
        "http://localhost/api/assessment-drafts?assessment_document_id=11111111-1111-1111-1111-111111111111",
        {
          method: "GET",
          headers: { Authorization: "Bearer token" },
        },
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      assessment_document_id: "11111111-1111-1111-1111-111111111111",
      programs: [],
      goals: [],
    });
  });
});
