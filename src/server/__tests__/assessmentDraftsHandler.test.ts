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
              title: "Goal A",
              description: "Description A",
              original_text: "Original A",
              mastery_criteria: "80% across 2 sessions",
              maintenance_criteria: "80% across 2 maintenance checks",
              generalization_criteria: "Across home and clinic",
              objective_data_points: [{ objective: "Identify 4 emotions", data_settings: "Opportunity based with prompts" }],
            },
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
            goals: [
              {
                title: "Requesting with two-word phrases",
                description: "Client requests preferred items with two-word phrases.",
                original_text: "Client will request preferred items with two-word phrases.",
              },
            ],
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
  });
});
