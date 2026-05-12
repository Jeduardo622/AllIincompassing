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
    program_name: "Communication Program",
    title: `Child Goal ${index + 1}`,
    description: `Child goal description ${index + 1}`,
    original_text: `Child goal original text ${index + 1}`,
    goal_type: "child",
    target_behavior: "Functional communication response",
    measurement_type: "Frequency",
    baseline_data: "Baseline noted",
    target_criteria: "Target criteria noted",
    mastery_criteria: "Mastery criteria noted",
    maintenance_criteria: "Maintenance criteria noted",
    generalization_criteria: "Generalization criteria noted",
    objective_data_points: ["Point A", "Point B"],
    rationale: "Goal rationale",
    evidence_refs: [{ section_key: "assessment_summary", source_span: "Child evidence snippet" }],
    review_flags: [],
  })),
  ...Array.from({ length: 6 }, (_, index) => ({
    program_name: "Communication Program",
    title: `Parent Goal ${index + 1}`,
    description: `Parent goal description ${index + 1}`,
    original_text: `Parent goal original text ${index + 1}`,
    goal_type: "parent",
    target_behavior: "Caregiver implementation fidelity",
    measurement_type: "Percent fidelity",
    baseline_data: "Baseline noted",
    target_criteria: "Target criteria noted",
    mastery_criteria: "Mastery criteria noted",
    maintenance_criteria: "Maintenance criteria noted",
    generalization_criteria: "Generalization criteria noted",
    objective_data_points: ["Point A", "Point B"],
    rationale: "Goal rationale",
    evidence_refs: [{ section_key: "parent_training", source_span: "Parent evidence snippet" }],
    review_flags: [],
  })),
];

const buildStructuredGoalSections = (programName = "Communication Program") =>
  buildTypedGoals().map((goal, index) => ({
    id: `structured-goal-${index + 1}`,
    section_key: "goals_treatment_planning",
    field_key: goal.goal_type === "parent" ? "CALOPTIMA_FBA_PARENT_GOALS" : "CALOPTIMA_FBA_SKILL_ACQUISITION_GOALS",
    section_index: index,
    payload: {
      ...goal,
      program_name: programName,
      objective_data_points: [{ metric_name: "Point A", metric_value: 1 }],
    },
    status: "approved",
    required: true,
  }));

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
        data: [{ id: "doc-1", organization_id: "org-1", client_id: "client-1", status: "extracted" }],
      })
      .mockResolvedValueOnce({ ok: true, status: 201, data: [{ id: "draft-program-1", name: "Communication Program" }] })
      .mockResolvedValueOnce({ ok: true, status: 201, data: null })
      .mockResolvedValueOnce({ ok: true, status: 200, data: null })
      .mockResolvedValueOnce({ ok: true, status: 201, data: null });

    const response = await assessmentDraftsHandler(
      new Request("http://localhost/api/assessment-drafts", {
        method: "POST",
        headers: { Authorization: "Bearer token" },
        body: JSON.stringify({
          assessment_document_id: "11111111-1111-1111-1111-111111111111",
          programs: [
            {
              name: "Communication Program",
              description: "Program description",
              rationale: "Program rationale",
              evidence_refs: [{ section_key: "assessment_summary", source_span: "Program evidence snippet" }],
              review_flags: [],
            },
          ],
          summary_rationale: "Summary rationale",
          confidence: "medium",
          goals: [
            {
              program_name: "Communication Program",
              title: "Child Goal A",
              description: "Description A",
              original_text: "Original A",
              goal_type: "child",
              target_behavior: "Functional communication",
              measurement_type: "Frequency",
              baseline_data: "Baseline text",
              target_criteria: "Target text",
              mastery_criteria: "80% across 2 sessions",
              maintenance_criteria: "80% across 2 maintenance checks",
              generalization_criteria: "Across home and clinic",
              objective_data_points: ["Identify 4 emotions", "Track prompts used"],
              rationale: "Goal rationale",
              evidence_refs: [{ section_key: "goals_treatment_planning", source_span: "Evidence snippet" }],
              review_flags: [],
            },
            ...Array.from({ length: 19 }, (_, index) => ({
              program_name: "Communication Program",
              title: `Child Goal ${index + 2}`,
              description: `Description child ${index + 2}`,
              original_text: `Original child ${index + 2}`,
              goal_type: "child",
              target_behavior: "Functional communication",
              measurement_type: "Frequency",
              baseline_data: "Baseline text",
              target_criteria: "Target text",
              mastery_criteria: "Mastery text",
              maintenance_criteria: "Maintenance text",
              generalization_criteria: "Generalization text",
              objective_data_points: ["Point A"],
              rationale: "Goal rationale",
              evidence_refs: [{ section_key: "assessment_summary", source_span: "Evidence snippet" }],
              review_flags: [],
            })),
            ...Array.from({ length: 6 }, (_, index) => ({
              program_name: "Communication Program",
              title: `Parent Goal ${index + 1}`,
              description: `Description parent ${index + 1}`,
              original_text: `Original parent ${index + 1}`,
              goal_type: "parent",
              target_behavior: "Caregiver implementation",
              measurement_type: "Percent fidelity",
              baseline_data: "Baseline text",
              target_criteria: "Target text",
              mastery_criteria: "Mastery text",
              maintenance_criteria: "Maintenance text",
              generalization_criteria: "Generalization text",
              objective_data_points: ["Point A"],
              rationale: "Goal rationale",
              evidence_refs: [{ section_key: "parent_training", source_span: "Evidence snippet" }],
              review_flags: [],
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
      .mock.calls.find(
        ([url, init]) =>
          typeof url === "string" &&
          url.includes("/rest/v1/assessment_draft_goals") &&
          (init?.method ?? "").toUpperCase() === "POST",
      );
    expect(goalCreateCall).toBeTruthy();
    const goalPayload = JSON.parse((goalCreateCall?.[1] as RequestInit).body as string) as Array<Record<string, unknown>>;
    expect(goalPayload[0]?.mastery_criteria).toBe("80% across 2 sessions");
    expect(goalPayload[0]?.goal_type).toBe("child");
    expect(Array.isArray(goalPayload[0]?.objective_data_points)).toBe(true);
    expect(Array.isArray(goalPayload[0]?.evidence_refs)).toBe(true);
    expect(Array.isArray(goalPayload[0]?.review_flags)).toBe(true);
    const programCreateCall = vi
      .mocked(fetchJson)
      .mock.calls.find(
        ([url, init]) =>
          typeof url === "string" &&
          url.includes("/rest/v1/assessment_draft_programs") &&
          (init?.method ?? "").toUpperCase() === "POST",
      );
    const programPayload = JSON.parse((programCreateCall?.[1] as RequestInit).body as string) as Array<Record<string, unknown>>;
    expect(programPayload[0]?.summary_rationale).toBe("Summary rationale");
    expect(programPayload[0]?.confidence).toBe("medium");
  });

  it("deterministically creates staged drafts from approved structured sections", async () => {
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
          data: [{ id: "doc-1", organization_id: "org-1", client_id: "client-1", status: "extracted" }],
        };
      }
      if (method === "GET" && url.includes("/rest/v1/assessment_structured_sections?")) {
        return {
          ok: true,
          status: 200,
          data: buildStructuredGoalSections(),
        };
      }
      if (method === "POST" && url.includes("/rest/v1/assessment_draft_programs")) {
        return { ok: true, status: 201, data: [{ id: "draft-program-2", name: "Communication Program" }] };
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
    expect(fetchJson).not.toHaveBeenCalledWith(
      expect.stringContaining("/functions/v1/generate-program-goals"),
      expect.anything(),
    );
    const goalCreateCall = vi
      .mocked(fetchJson)
      .mock.calls.find(
        ([url, init]) =>
          typeof url === "string" &&
          url.includes("/rest/v1/assessment_draft_goals") &&
          (init?.method ?? "").toUpperCase() === "POST",
      );
    expect(goalCreateCall).toBeTruthy();
    const goalPayload = JSON.parse((goalCreateCall?.[1] as RequestInit).body as string) as Array<Record<string, unknown>>;
    const childGoalCount = goalPayload.filter((goal) => goal.goal_type === "child").length;
    const parentGoalCount = goalPayload.filter((goal) => goal.goal_type === "parent").length;
    expect(childGoalCount).toBe(20);
    expect(parentGoalCount).toBe(6);
    expect(goalPayload[0]?.mastery_criteria).toBe("Mastery criteria noted");
    expect(goalPayload[0]?.evidence_refs).toEqual([
      { section_key: "goals_treatment_planning", source_span: "CALOPTIMA_FBA_SKILL_ACQUISITION_GOALS#0" },
    ]);
    const liveProgramWrite = vi
      .mocked(fetchJson)
      .mock.calls.find(([url]) => typeof url === "string" && url.includes("/rest/v1/programs"));
    const liveGoalWrite = vi
      .mocked(fetchJson)
      .mock.calls.find(([url]) => typeof url === "string" && url.includes("/rest/v1/goals"));
    expect(liveProgramWrite).toBeUndefined();
    expect(liveGoalWrite).toBeUndefined();
  });

  it("rolls back inserted draft programs when goal insert fails", async () => {
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
          data: [{ id: "doc-1", organization_id: "org-1", client_id: "client-1", status: "extracted" }],
        };
      }
      if (method === "POST" && url.includes("/rest/v1/assessment_draft_programs")) {
        return { ok: true, status: 201, data: [{ id: "draft-program-rollback-1", name: "Communication Program" }] };
      }
      if (method === "POST" && url.includes("/rest/v1/assessment_draft_goals")) {
        return { ok: false, status: 500, data: null };
      }
      if (method === "DELETE" && url.includes("/rest/v1/assessment_draft_programs?id=in.(draft-program-rollback-1)")) {
        return { ok: true, status: 200, data: null };
      }
      return { ok: true, status: 200, data: null };
    });

    const response = await assessmentDraftsHandler(
      new Request("http://localhost/api/assessment-drafts", {
        method: "POST",
        headers: { Authorization: "Bearer token" },
        body: JSON.stringify({
          assessment_document_id: "11111111-1111-1111-1111-111111111111",
          programs: [
            {
              name: "Communication Program",
              description: "Program description",
              rationale: "Program rationale",
              evidence_refs: [{ section_key: "assessment_summary", source_span: "Program evidence snippet" }],
              review_flags: [],
            },
          ],
          summary_rationale: "Summary rationale",
          confidence: "medium",
          goals: [
            {
              program_name: "Communication Program",
              title: "Child Goal A",
              description: "Description A",
              original_text: "Original A",
              goal_type: "child",
              target_behavior: "Functional communication",
              measurement_type: "Frequency",
              baseline_data: "Baseline text",
              target_criteria: "Target text",
              mastery_criteria: "Mastery text",
              maintenance_criteria: "Maintenance text",
              generalization_criteria: "Generalization text",
              objective_data_points: ["Point A"],
              rationale: "Goal rationale",
              evidence_refs: [{ section_key: "goals_treatment_planning", source_span: "Evidence snippet" }],
              review_flags: [],
            },
            ...Array.from({ length: 19 }, (_, index) => ({
              program_name: "Communication Program",
              title: `Child Goal ${index + 2}`,
              description: `Description child ${index + 2}`,
              original_text: `Original child ${index + 2}`,
              goal_type: "child",
              target_behavior: "Functional communication",
              measurement_type: "Frequency",
              baseline_data: "Baseline text",
              target_criteria: "Target text",
              mastery_criteria: "Mastery text",
              maintenance_criteria: "Maintenance text",
              generalization_criteria: "Generalization text",
              objective_data_points: ["Point A"],
              rationale: "Goal rationale",
              evidence_refs: [{ section_key: "assessment_summary", source_span: "Evidence snippet" }],
              review_flags: [],
            })),
            ...Array.from({ length: 6 }, (_, index) => ({
              program_name: "Communication Program",
              title: `Parent Goal ${index + 1}`,
              description: `Description parent ${index + 1}`,
              original_text: `Original parent ${index + 1}`,
              goal_type: "parent",
              target_behavior: "Caregiver implementation",
              measurement_type: "Percent fidelity",
              baseline_data: "Baseline text",
              target_criteria: "Target text",
              mastery_criteria: "Mastery text",
              maintenance_criteria: "Maintenance text",
              generalization_criteria: "Generalization text",
              objective_data_points: ["Point A"],
              rationale: "Goal rationale",
              evidence_refs: [{ section_key: "parent_training", source_span: "Evidence snippet" }],
              review_flags: [],
            })),
          ],
        }),
      }),
    );

    expect(response.status).toBe(500);
    expect(fetchJson).toHaveBeenCalledWith(
      expect.stringContaining("/rest/v1/assessment_draft_programs?id=in.(draft-program-rollback-1)"),
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("rejects deterministic draft creation when approved structured goal sections are missing", async () => {
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
          data: [{ id: "doc-1", organization_id: "org-1", client_id: "client-1", status: "extracted" }],
        };
      }
      if (method === "GET" && url.includes("/rest/v1/assessment_structured_sections?")) {
        return { ok: true, status: 200, data: [] };
      }
      if (method === "POST" && url.includes("/rest/v1/assessment_draft_programs")) {
        return { ok: true, status: 201, data: [{ id: "draft-program-mismatch-1", name: "Communication Program" }] };
      }
      if (method === "DELETE" && url.includes("/rest/v1/assessment_draft_programs?id=in.(draft-program-mismatch-1)")) {
        return { ok: true, status: 200, data: null };
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

    expect(response.status).toBe(409);
    const payload = (await response.json()) as { error?: string };
    expect(payload.error).toContain("No approved structured CalOptima goal sections");
    expect(fetchJson).not.toHaveBeenCalledWith(
      expect.stringContaining("/rest/v1/assessment_draft_programs"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("rejects malformed auto-generation request bodies before draft generation", async () => {
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

    const response = await assessmentDraftsHandler(
      new Request("http://localhost/api/assessment-drafts", {
        method: "POST",
        headers: { Authorization: "Bearer token" },
        body: JSON.stringify({ assessment_document_id: "not-a-uuid", auto_generate: true }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid request body" });
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("rejects invalid JSON bodies before draft generation", async () => {
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

    const response = await assessmentDraftsHandler(
      new Request("http://localhost/api/assessment-drafts", {
        method: "POST",
        headers: { Authorization: "Bearer token" },
        body: "{",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid JSON body" });
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("rejects auto-generation until extraction is complete", async () => {
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
        data: [{ id: "doc-1", organization_id: "org-1", client_id: "client-1", status: "extracting" }],
      })
      .mockResolvedValueOnce({ ok: true, status: 200, data: [] })
      .mockResolvedValueOnce({ ok: true, status: 200, data: [] });

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

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Assessment extraction must complete before deterministic drafts can be generated.",
    });
    expect(fetchJson).toHaveBeenCalledTimes(3);
    expect(fetchJson).not.toHaveBeenCalledWith(
      expect.stringContaining("/rest/v1/assessment_structured_sections"),
      expect.anything(),
    );
    expect(fetchJson).not.toHaveBeenCalledWith(
      expect.stringContaining("/functions/v1/generate-program-goals"),
      expect.anything(),
    );
  });

  it("allows deterministic draft retry after extraction failure and records the prior status", async () => {
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
          data: [{ id: "doc-1", organization_id: "org-1", client_id: "client-1", status: "extraction_failed" }],
        };
      }
      if (method === "GET" && url.includes("/rest/v1/assessment_draft_programs?")) {
        return { ok: true, status: 200, data: [] };
      }
      if (method === "GET" && url.includes("/rest/v1/assessment_draft_goals?")) {
        return { ok: true, status: 200, data: [] };
      }
      if (method === "GET" && url.includes("/rest/v1/assessment_structured_sections?")) {
        return {
          ok: true,
          status: 200,
          data: buildStructuredGoalSections(),
        };
      }
      if (method === "POST" && url.includes("/rest/v1/assessment_draft_programs")) {
        return { ok: true, status: 201, data: [{ id: "draft-program-retry-1", name: "Communication Program" }] };
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
    expect(fetchJson).not.toHaveBeenCalledWith(
      expect.stringContaining("/functions/v1/generate-program-goals"),
      expect.anything(),
    );
    const reviewEventCall = vi
      .mocked(fetchJson)
      .mock.calls.find(
        ([url, init]) =>
          typeof url === "string" &&
          url.includes("/rest/v1/assessment_review_events") &&
          (init?.method ?? "").toUpperCase() === "POST",
      );
    expect(reviewEventCall).toBeTruthy();
    const reviewEventPayload = JSON.parse((reviewEventCall?.[1] as RequestInit).body as string) as Record<string, unknown>;
    expect(reviewEventPayload).toMatchObject({
      action: "drafts_generated",
      from_status: "extraction_failed",
      to_status: "drafted",
      actor_id: "user-1",
    });
  });

  it("keeps existing-draft conflict messaging for drafted assessments", async () => {
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
      if (method === "GET" && url.includes("/rest/v1/assessment_documents?")) {
        return {
          ok: true,
          status: 200,
          data: [{ id: "doc-1", organization_id: "org-1", client_id: "client-1", status: "drafted" }],
        };
      }
      if (method === "GET" && url.includes("/rest/v1/assessment_draft_programs?")) {
        return { ok: true, status: 200, data: [{ id: "draft-program-1" }] };
      }
      if (method === "GET" && url.includes("/rest/v1/assessment_draft_goals?")) {
        return { ok: true, status: 200, data: [] };
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

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Drafts already exist for this assessment. Review existing drafts instead of regenerating.",
    });
    expect(fetchJson).not.toHaveBeenCalledWith(
      expect.stringContaining("/functions/v1/generate-program-goals"),
      expect.anything(),
    );
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
