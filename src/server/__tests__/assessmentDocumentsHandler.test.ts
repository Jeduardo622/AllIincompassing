import { beforeEach, describe, expect, it, vi } from "vitest";
import { assessmentDocumentsHandler } from "../api/assessment-documents";

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

vi.mock("../assessmentChecklistTemplate", () => ({
  loadChecklistTemplateRows: vi.fn(),
}));

import {
  fetchJson,
  getAccessToken,
  getAccessTokenSubject,
  getSupabaseConfig,
  resolveOrgAndRole,
} from "../api/shared";
import { loadChecklistTemplateRows } from "../assessmentChecklistTemplate";

describe("assessmentDocumentsHandler", () => {
  beforeEach(() => {
    vi.resetAllMocks();
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

  const expectExtractionFailedActorStatusInvariants = (
    payload: Record<string, unknown>,
    expectedDocumentId: string,
  ) => {
    expect(payload.action).toBe("extraction_failed");
    expect(payload.from_status).toBe("extracting");
    expect(payload.to_status).toBe("extraction_failed");
    expect(payload.actor_id).toBe("user-1");
    expect(payload.item_type).toBe("document");
    expect(payload.assessment_document_id).toBe(expectedDocumentId);
    expect(payload.item_id).toBe(expectedDocumentId);
    expect(payload.organization_id).toBe("org-1");
    expect(payload.client_id).toBe("11111111-1111-1111-1111-111111111111");
  };

  const expectExtractionFailedIdLinkageInvariants = (
    payload: Record<string, unknown>,
    expectedDocumentId: string,
  ) => {
    expect(payload.assessment_document_id).toBe(expectedDocumentId);
    expect(payload.item_id).toBe(expectedDocumentId);
    expect(payload.assessment_document_id).toBe(payload.item_id);
  };

  const expectExtractionFailedOrgClientLinkageInvariants = (
    payload: Record<string, unknown>,
    expectedOrganizationId: string,
    expectedClientId: string,
  ) => {
    expect(payload.organization_id).toBe(expectedOrganizationId);
    expect(payload.client_id).toBe(expectedClientId);
    expect(payload.organization_id).toEqual(expect.any(String));
    expect(payload.client_id).toEqual(expect.any(String));
  };

  const expectExtractionFailedLifecycleTransitionInvariants = (payload: Record<string, unknown>) => {
    expect(payload.from_status).toBe("extracting");
    expect(payload.to_status).toBe("extraction_failed");
    expect(payload.from_status).not.toBe(payload.to_status);
  };

  const expectExtractionFailedStatusWriteInvariants = (
    payload: Record<string, unknown>,
    expectedError: string,
  ) => {
    expect(payload).toMatchObject({
      status: "extraction_failed",
      extraction_error: expectedError,
    });
    expect(payload.updated_at).toEqual(expect.any(String));
  };

  const expectExtractionFailedActorDocumentTypeInvariants = (
    payload: Record<string, unknown>,
    expectedActorId: string,
  ) => {
    expect(payload.actor_id).toBe(expectedActorId);
    expect(payload.item_type).toBe("document");
    expect(payload.actor_id).toEqual(expect.any(String));
  };

  const mockUploadFlowResponses = (documentId: string) => {
    vi.mocked(fetchJson).mockImplementation(async (url: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && url.includes("/rest/v1/clients?select=id")) {
        return { ok: true, status: 200, data: [{ id: "client-1" }] };
      }
      if (method === "POST" && url.includes("/rest/v1/assessment_documents")) {
        return {
          ok: true,
          status: 201,
          data: [{ id: documentId, organization_id: "org-1", client_id: "11111111-1111-1111-1111-111111111111" }],
        };
      }
      if (method === "POST" && url.includes("/rest/v1/assessment_checklist_items")) {
        return { ok: true, status: 201, data: null };
      }
      if (method === "POST" && url.includes("/rest/v1/assessment_extractions")) {
        return { ok: true, status: 201, data: null };
      }
      if (method === "GET" && url.includes("/rest/v1/clients?select=full_name")) {
        return { ok: true, status: 200, data: [{ full_name: "Client One", date_of_birth: "2017-05-01" }] };
      }
      if (method === "POST" && url.includes("/functions/v1/extract-assessment-fields")) {
        return {
          ok: true,
          status: 200,
          data: {
            fields: [
              {
                placeholder_key: "CALOPTIMA_FBA_MEMBER_NAME",
                value_text: "Client One",
                value_json: null,
                confidence: 0.99,
                mode: "AUTO",
                status: "drafted",
                source_span: { method: "client_snapshot" },
                review_notes: "Auto-filled from client snapshot.",
              },
            ],
            unresolved_keys: [],
            extracted_count: 1,
            unresolved_count: 0,
          },
        };
      }
      if (method === "PATCH" && url.includes("/rest/v1/assessment_documents")) {
        return { ok: true, status: 200, data: null };
      }
      if (method === "PATCH" && url.includes("/rest/v1/assessment_checklist_items")) {
        return { ok: true, status: 200, data: null };
      }
      if (method === "PATCH" && url.includes("/rest/v1/assessment_extractions")) {
        return { ok: true, status: 200, data: null };
      }
      if (method === "POST" && url.includes("/rest/v1/assessment_review_events")) {
        return { ok: true, status: 201, data: null };
      }
      return { ok: true, status: 200, data: null };
    });
  };

  it("returns 401 when authorization is missing", async () => {
    const response = await assessmentDocumentsHandler(
      new Request("http://localhost/api/assessment-documents?client_id=11111111-1111-1111-1111-111111111111", {
        headers: { Origin: "http://localhost:5173" },
      }),
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:5173");
  });

  it("responds to OPTIONS with request-scoped CORS headers", async () => {
    const response = await assessmentDocumentsHandler(
      new Request("http://localhost/api/assessment-documents", {
        method: "OPTIONS",
        headers: { Origin: "http://localhost:5173" },
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:5173");
    expect(response.headers.get("Access-Control-Allow-Methods")).toContain("DELETE");
  });

  it("creates assessment document and seeds checklist rows", async () => {
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
    vi.mocked(getAccessTokenSubject).mockReturnValue("user-1");
    vi.mocked(loadChecklistTemplateRows).mockResolvedValue([
      {
        section: "identification_admin",
        label: "Member Name",
        placeholder_key: "CALOPTIMA_FBA_MEMBER_NAME",
        mode: "AUTO",
        source: "clients.full_name",
        required: true,
        extraction_method: "database_prefill",
        validation_rule: "non_empty_text",
        status: "not_started",
      },
    ]);

    mockUploadFlowResponses("doc-1");

    const response = await assessmentDocumentsHandler(
      new Request("http://localhost/api/assessment-documents", {
        method: "POST",
        headers: { Authorization: "Bearer token" },
        body: JSON.stringify({
          client_id: "11111111-1111-1111-1111-111111111111",
          file_name: "fba.pdf",
          mime_type: "application/pdf",
          file_size: 1234,
          object_path: "clients/client-1/assessments/fba.pdf",
        }),
      }),
    );

    expect(response.status).toBe(201);
    expect(fetchJson).toHaveBeenCalledWith(
      expect.stringContaining("/assessment_checklist_items"),
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchJson).toHaveBeenCalledWith(
      expect.stringContaining("/assessment_extractions"),
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchJson).toHaveBeenCalledWith(
      expect.stringContaining("/functions/v1/extract-assessment-fields"),
      expect.objectContaining({ method: "POST" }),
    );
    expect(loadChecklistTemplateRows).toHaveBeenCalledWith("caloptima_fba");
  });

  it("creates assessment document with IEHP template rows", async () => {
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
    vi.mocked(getAccessTokenSubject).mockReturnValue("user-1");
    vi.mocked(loadChecklistTemplateRows).mockResolvedValue([
      {
        section: "identification_admin",
        label: "IEHP Member ID#",
        placeholder_key: "IEHP_FBA_MEMBER_ID",
        mode: "AUTO",
        source: "authorizations.member_id",
        required: true,
        extraction_method: "database_prefill",
        validation_rule: "non_empty_identifier",
        status: "not_started",
      },
    ]);

    mockUploadFlowResponses("doc-2");

    const response = await assessmentDocumentsHandler(
      new Request("http://localhost/api/assessment-documents", {
        method: "POST",
        headers: { Authorization: "Bearer token" },
        body: JSON.stringify({
          client_id: "11111111-1111-1111-1111-111111111111",
          file_name: "iehp-fba.docx",
          mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          file_size: 2200,
          object_path: "clients/client-1/assessments/iehp-fba.docx",
          template_type: "iehp_fba",
        }),
      }),
    );

    expect(response.status).toBe(201);
    expect(loadChecklistTemplateRows).toHaveBeenCalledWith("iehp_fba");
  });

  it("rejects unsupported template_type", async () => {
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

    const response = await assessmentDocumentsHandler(
      new Request("http://localhost/api/assessment-documents", {
        method: "POST",
        headers: { Authorization: "Bearer token" },
        body: JSON.stringify({
          client_id: "11111111-1111-1111-1111-111111111111",
          file_name: "fba.pdf",
          mime_type: "application/pdf",
          file_size: 1234,
          object_path: "clients/client-1/assessments/fba.pdf",
          template_type: "unknown_template",
        }),
      }),
    );

    expect(response.status).toBe(400);
  });

  it.each(roleMatrix)("returns 403 for out-of-org assessment document POST as $label without side effects", async ({ role }) => {
    vi.mocked(getAccessToken).mockReturnValue("token");
    vi.mocked(resolveOrgAndRole).mockResolvedValue({
      organizationId: "org-1",
      ...role,
    });
    vi.mocked(getSupabaseConfig).mockReturnValue({
      supabaseUrl: "https://example.supabase.co",
      anonKey: "anon",
    });

    vi.mocked(fetchJson).mockImplementation(async (url: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && url.includes("/rest/v1/clients?select=id")) {
        return { ok: true, status: 200, data: [] };
      }
      return { ok: false, status: 500, data: null };
    });

    const response = await assessmentDocumentsHandler(
      new Request("http://localhost/api/assessment-documents", {
        method: "POST",
        headers: { Authorization: "Bearer token" },
        body: JSON.stringify({
          client_id: "11111111-1111-1111-1111-111111111111",
          file_name: "fba.pdf",
          mime_type: "application/pdf",
          file_size: 1234,
          object_path: "clients/client-1/assessments/fba.pdf",
        }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "client_id is not in scope for this organization",
    });
    expect(fetchJson).toHaveBeenCalledWith(
      expect.stringContaining("/rest/v1/clients?select=id"),
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchJson).toHaveBeenCalledTimes(1);
    expect(loadChecklistTemplateRows).not.toHaveBeenCalled();

    const sideEffectCalls = vi.mocked(fetchJson).mock.calls.filter(([url, init]) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (typeof url !== "string") return false;
      if (method !== "POST" && method !== "PATCH") return false;
      return (
        url.includes("/rest/v1/assessment_documents") ||
        url.includes("/rest/v1/assessment_checklist_items") ||
        url.includes("/rest/v1/assessment_extractions") ||
        url.includes("/rest/v1/assessment_review_events") ||
        url.includes("/functions/v1/extract-assessment-fields")
      );
    });
    expect(sideEffectCalls).toHaveLength(0);
  });

  it.each(roleMatrix)(
    "returns 403 for out-of-org assessment document GET by assessment_document_id as $label",
    async ({ role }) => {
      vi.mocked(getAccessToken).mockReturnValue("token");
      vi.mocked(resolveOrgAndRole).mockResolvedValue({
        organizationId: "org-1",
        ...role,
      });
      vi.mocked(getSupabaseConfig).mockReturnValue({
        supabaseUrl: "https://example.supabase.co",
        anonKey: "anon",
      });

      vi.mocked(fetchJson).mockImplementation(async (url: string, init?: RequestInit) => {
        const method = (init?.method ?? "GET").toUpperCase();
        if (method === "GET" && url.includes("/rest/v1/assessment_documents?select=*&organization_id=eq.org-1&id=eq.")) {
          return { ok: true, status: 200, data: [] };
        }
        return { ok: false, status: 500, data: null };
      });

      const response = await assessmentDocumentsHandler(
        new Request(
          "http://localhost/api/assessment-documents?assessment_document_id=11111111-1111-4111-8111-111111111111",
          {
            method: "GET",
            headers: { Authorization: "Bearer token" },
          },
        ),
      );

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({
        error: "assessment_document_id is not in scope for this organization",
      });
      expect(fetchJson).toHaveBeenCalledWith(
        expect.stringContaining("/rest/v1/assessment_documents?select=*&organization_id=eq.org-1&id=eq."),
        expect.objectContaining({ method: "GET" }),
      );
      expect(fetchJson).toHaveBeenCalledTimes(1);
    },
  );

  it.each(roleMatrix)(
    "returns 403 for out-of-org assessment document GET by client_id as $label without side effects",
    async ({ role }) => {
      vi.mocked(getAccessToken).mockReturnValue("token");
      vi.mocked(resolveOrgAndRole).mockResolvedValue({
        organizationId: "org-1",
        ...role,
      });
      vi.mocked(getSupabaseConfig).mockReturnValue({
        supabaseUrl: "https://example.supabase.co",
        anonKey: "anon",
      });

      vi.mocked(fetchJson).mockImplementation(async (url: string, init?: RequestInit) => {
        const method = (init?.method ?? "GET").toUpperCase();
        if (method === "GET" && url.includes("/rest/v1/clients?select=id")) {
          return { ok: true, status: 200, data: [] };
        }
        return { ok: false, status: 500, data: null };
      });

      const response = await assessmentDocumentsHandler(
        new Request("http://localhost/api/assessment-documents?client_id=11111111-1111-1111-1111-111111111111", {
          method: "GET",
          headers: { Authorization: "Bearer token" },
        }),
      );

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({
        error: "client_id is not in scope for this organization",
      });
      expect(fetchJson).toHaveBeenCalledWith(
        expect.stringContaining("/rest/v1/clients?select=id"),
        expect.objectContaining({ method: "GET" }),
      );
      expect(fetchJson).toHaveBeenCalledTimes(1);
      const nonGetCalls = vi
        .mocked(fetchJson)
        .mock.calls.filter(([, init]) => (init?.method ?? "GET").toUpperCase() !== "GET");
      expect(nonGetCalls).toHaveLength(0);
    },
  );

  it("auto-generates staged drafts with structured payload and no live publish", async () => {
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
    vi.mocked(getAccessTokenSubject).mockReturnValue("user-1");
    vi.mocked(loadChecklistTemplateRows).mockResolvedValue([
      {
        section: "goals_treatment_planning",
        label: "Skill Acquisition Goal 1",
        placeholder_key: "CALOPTIMA_FBA_SKILL_ACQUISITION_GOALS",
        mode: "AUTO",
        source: "uploaded_fba",
        required: true,
        extraction_method: "ai_extract",
        validation_rule: "non_empty_text",
        status: "not_started",
      },
    ]);

    vi.mocked(fetchJson).mockImplementation(async (url: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && url.includes("/rest/v1/clients?select=id")) {
        return { ok: true, status: 200, data: [{ id: "client-1" }] };
      }
      if (method === "POST" && url.includes("/rest/v1/assessment_documents")) {
        return {
          ok: true,
          status: 201,
          data: [{ id: "doc-auto-1", organization_id: "org-1", client_id: "11111111-1111-1111-1111-111111111111" }],
        };
      }
      if (method === "POST" && url.includes("/rest/v1/assessment_checklist_items")) {
        return { ok: true, status: 201, data: null };
      }
      if (method === "POST" && url.includes("/rest/v1/assessment_extractions")) {
        return { ok: true, status: 201, data: null };
      }
      if (method === "POST" && url.includes("/functions/v1/extract-assessment-fields")) {
        return {
          ok: true,
          status: 200,
          data: {
            fields: [
              {
                placeholder_key: "CALOPTIMA_FBA_SKILL_ACQUISITION_GOALS",
                value_text: "Client will follow one-step directions.",
                value_json: null,
                confidence: 0.95,
                mode: "AUTO",
                status: "approved",
                source_span: { page: 4, line: "Skill acquisition evidence" },
                review_notes: "Extracted.",
              },
            ],
            unresolved_keys: [],
            extracted_count: 1,
            unresolved_count: 0,
          },
        };
      }
      if (method === "PATCH" && url.includes("/rest/v1/assessment_checklist_items")) {
        return { ok: true, status: 200, data: null };
      }
      if (method === "PATCH" && url.includes("/rest/v1/assessment_extractions")) {
        return { ok: true, status: 200, data: null };
      }
      if (method === "GET" && url.includes("/rest/v1/assessment_draft_programs?select=id")) {
        return { ok: true, status: 200, data: [] };
      }
      if (method === "GET" && url.includes("/rest/v1/assessment_checklist_items?select=section_key")) {
        return {
          ok: true,
          status: 200,
          data: [
            {
              section_key: "goals_treatment_planning",
              label: "Skill Acquisition Goal 1",
              placeholder_key: "CALOPTIMA_FBA_SKILL_ACQUISITION_GOALS",
              value_text: "Client will follow one-step directions.",
              value_json: null,
              status: "approved",
            },
          ],
        };
      }
      if (method === "GET" && url.includes("/rest/v1/assessment_extractions?select=section_key")) {
        return {
          ok: true,
          status: 200,
          data: [
            {
              section_key: "goals_treatment_planning",
              field_key: "CALOPTIMA_FBA_SKILL_ACQUISITION_GOALS",
              label: "Skill Acquisition Goal 1",
              value_text: "Client will follow one-step directions.",
              value_json: null,
              source_span: { page: 4, line: "Skill acquisition evidence" },
              status: "approved",
            },
          ],
        };
      }
      if (method === "GET" && url.includes("/rest/v1/clients?select=full_name")) {
        return { ok: true, status: 200, data: [{ full_name: "Client One" }] };
      }
      if (method === "GET" && url.includes("/rest/v1/ai_guidance_documents?")) {
        return { ok: true, status: 200, data: [{ guidance_text: "Use objective ABA language." }] };
      }
      if (method === "POST" && url.includes("/functions/v1/generate-program-goals")) {
        return {
          ok: true,
          status: 200,
          data: {
            programs: [
              {
                name: "Communication Program",
                description: "Improve communication.",
                rationale: "Rationale text",
                evidence_refs: [{ section_key: "assessment_summary", source_span: "Program evidence" }],
                review_flags: [],
              },
            ],
            goals: [
              ...Array.from({ length: 20 }, (_, index) => ({
                program_name: "Communication Program",
                title: `Child Goal ${index + 1}`,
                description: "Child description",
                original_text: "Child original text",
                goal_type: "child",
                target_behavior: "Functional communication",
                measurement_type: "Frequency",
                baseline_data: "Baseline",
                target_criteria: "Target",
                mastery_criteria: "Mastery",
                maintenance_criteria: "Maintenance",
                generalization_criteria: "Generalization",
                objective_data_points: ["Track independent responses"],
                rationale: "Goal rationale",
                evidence_refs: [{ section_key: "assessment_summary", source_span: "Goal evidence" }],
                review_flags: [],
              })),
              ...Array.from({ length: 6 }, (_, index) => ({
                program_name: "Communication Program",
                title: `Parent Goal ${index + 1}`,
                description: "Parent description",
                original_text: "Parent original text",
                goal_type: "parent",
                target_behavior: "Caregiver fidelity",
                measurement_type: "Percent fidelity",
                baseline_data: "Baseline",
                target_criteria: "Target",
                mastery_criteria: "Mastery",
                maintenance_criteria: "Maintenance",
                generalization_criteria: "Generalization",
                objective_data_points: ["Track caregiver steps completed"],
                rationale: "Goal rationale",
                evidence_refs: [{ section_key: "parent_training", source_span: "Parent evidence" }],
                review_flags: [],
              })),
            ],
            summary_rationale: "Summary rationale",
            confidence: "medium",
          },
        };
      }
      if (method === "POST" && url.includes("/rest/v1/assessment_draft_programs")) {
        return { ok: true, status: 201, data: [{ id: "draft-program-1", name: "Communication Program" }] };
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

    const response = await assessmentDocumentsHandler(
      new Request("http://localhost/api/assessment-documents", {
        method: "POST",
        headers: { Authorization: "Bearer token" },
        body: JSON.stringify({
          client_id: "11111111-1111-1111-1111-111111111111",
          file_name: "fba.pdf",
          mime_type: "application/pdf",
          file_size: 1234,
          object_path: "clients/client-1/assessments/fba.pdf",
        }),
      }),
    );

    expect(response.status).toBe(201);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const generationCall = vi
      .mocked(fetchJson)
      .mock.calls.find(
        ([url, init]) =>
          typeof url === "string" &&
          url.includes("/functions/v1/generate-program-goals") &&
          (init?.method ?? "").toUpperCase() === "POST",
      );
    expect(generationCall).toBeTruthy();
    const generationPayload = JSON.parse((generationCall?.[1] as RequestInit).body as string) as {
      approved_checklist_rows?: Array<{ section_key: string }>;
      assessment_summary?: string;
      source_evidence_snippets?: Array<{ section_key: string; snippet: string }>;
    };
    expect(Array.isArray(generationPayload.approved_checklist_rows)).toBe(true);
    expect(typeof generationPayload.assessment_summary).toBe("string");
    expect(Array.isArray(generationPayload.source_evidence_snippets)).toBe(true);
    const stagedGoalCreateCall = vi
      .mocked(fetchJson)
      .mock.calls.find(
        ([url, init]) =>
          typeof url === "string" &&
          url.includes("/rest/v1/assessment_draft_goals") &&
          (init?.method ?? "").toUpperCase() === "POST",
      );
    const stagedGoalPayload = JSON.parse((stagedGoalCreateCall?.[1] as RequestInit).body as string) as Array<Record<string, unknown>>;
    expect(Array.isArray(stagedGoalPayload[0]?.evidence_refs)).toBe(true);
    expect(Array.isArray(stagedGoalPayload[0]?.review_flags)).toBe(true);

    const liveProgramWrite = vi
      .mocked(fetchJson)
      .mock.calls.find(([url]) => typeof url === "string" && url.includes("/rest/v1/programs"));
    const liveGoalWrite = vi
      .mocked(fetchJson)
      .mock.calls.find(([url]) => typeof url === "string" && url.includes("/rest/v1/goals"));
    expect(liveProgramWrite).toBeUndefined();
    expect(liveGoalWrite).toBeUndefined();
  });

  it("records extraction_failed audit event when extraction API returns non-ok", async () => {
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
    vi.mocked(getAccessTokenSubject).mockReturnValue("user-1");
    vi.mocked(loadChecklistTemplateRows).mockResolvedValue([]);

    vi.mocked(fetchJson).mockImplementation(async (url: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && url.includes("/rest/v1/clients?select=id")) {
        return { ok: true, status: 200, data: [{ id: "client-1" }] };
      }
      if (method === "POST" && url.includes("/rest/v1/assessment_documents")) {
        return {
          ok: true,
          status: 201,
          data: [{ id: "doc-extract-non-ok", organization_id: "org-1", client_id: "11111111-1111-1111-1111-111111111111" }],
        };
      }
      if (method === "POST" && url.includes("/rest/v1/assessment_checklist_items")) {
        return { ok: true, status: 201, data: null };
      }
      if (method === "POST" && url.includes("/rest/v1/assessment_extractions")) {
        return { ok: true, status: 201, data: null };
      }
      if (method === "POST" && url.includes("/functions/v1/extract-assessment-fields")) {
        return { ok: false, status: 502, data: null };
      }
      if (method === "PATCH" && url.includes("/rest/v1/assessment_documents?id=eq.doc-extract-non-ok")) {
        return { ok: true, status: 200, data: null };
      }
      if (method === "POST" && url.includes("/rest/v1/assessment_review_events")) {
        return { ok: true, status: 201, data: null };
      }
      return { ok: true, status: 200, data: null };
    });

    const response = await assessmentDocumentsHandler(
      new Request("http://localhost/api/assessment-documents", {
        method: "POST",
        headers: { Authorization: "Bearer token" },
        body: JSON.stringify({
          client_id: "11111111-1111-1111-1111-111111111111",
          file_name: "fba.pdf",
          mime_type: "application/pdf",
          file_size: 1234,
          object_path: "clients/client-1/assessments/fba.pdf",
        }),
      }),
    );

    expect(response.status).toBe(201);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchJson).toHaveBeenCalledWith(
      expect.stringContaining("/rest/v1/assessment_documents?id=eq.doc-extract-non-ok"),
      expect.objectContaining({
        method: "PATCH",
        body: expect.stringContaining("extraction_failed"),
      }),
    );
    const extractionFailedDocumentPatchCall = vi
      .mocked(fetchJson)
      .mock.calls.find(([url, init]) => {
        const method = (init?.method ?? "GET").toUpperCase();
        const body = typeof init?.body === "string" ? init.body : "";
        return (
          typeof url === "string" &&
          method === "PATCH" &&
          url.includes("/rest/v1/assessment_documents?id=eq.doc-extract-non-ok") &&
          body.includes("\"status\":\"extraction_failed\"")
        );
      });
    expect(extractionFailedDocumentPatchCall).toBeDefined();
    const extractionFailedDocumentPatchPayload = JSON.parse(
      ((extractionFailedDocumentPatchCall?.[1] as RequestInit).body ?? "{}") as string,
    ) as Record<string, unknown>;
    expectExtractionFailedStatusWriteInvariants(
      extractionFailedDocumentPatchPayload,
      "Field extraction failed. Review checklist manually.",
    );
    const extractionFailedReviewEventCalls = vi
      .mocked(fetchJson)
      .mock.calls.filter(([url, init]) => {
        const method = (init?.method ?? "GET").toUpperCase();
        if (typeof url !== "string" || method !== "POST") return false;
        if (!url.includes("/rest/v1/assessment_review_events")) return false;
        const body = typeof init?.body === "string" ? init.body : "";
        return body.includes("\"action\":\"extraction_failed\"");
      });
    expect(extractionFailedReviewEventCalls).toHaveLength(1);
    const extractionFailedReviewEventPayload = JSON.parse(
      (extractionFailedReviewEventCalls[0]?.[1] as RequestInit).body as string,
    ) as Record<string, unknown>;
    expectExtractionFailedActorStatusInvariants(extractionFailedReviewEventPayload, "doc-extract-non-ok");
    expectExtractionFailedIdLinkageInvariants(extractionFailedReviewEventPayload, "doc-extract-non-ok");
    expectExtractionFailedOrgClientLinkageInvariants(
      extractionFailedReviewEventPayload,
      "org-1",
      "11111111-1111-1111-1111-111111111111",
    );
    expectExtractionFailedLifecycleTransitionInvariants(extractionFailedReviewEventPayload);
    expectExtractionFailedActorDocumentTypeInvariants(extractionFailedReviewEventPayload, "user-1");
    expect(extractionFailedReviewEventPayload).toStrictEqual({
      assessment_document_id: "doc-extract-non-ok",
      organization_id: "org-1",
      client_id: "11111111-1111-1111-1111-111111111111",
      item_type: "document",
      item_id: "doc-extract-non-ok",
      action: "extraction_failed",
      from_status: "extracting",
      to_status: "extraction_failed",
      actor_id: "user-1",
    });
    expect(extractionFailedReviewEventPayload).not.toHaveProperty("notes");
    expect(extractionFailedReviewEventPayload).not.toHaveProperty("event_payload");
    expect(extractionFailedReviewEventPayload).not.toHaveProperty("extracted_count");
    expect(extractionFailedReviewEventPayload).not.toHaveProperty("unresolved_count");
    expect(extractionFailedReviewEventPayload).not.toHaveProperty("unresolved_keys");
    const reviewEventCalls = vi
      .mocked(fetchJson)
      .mock.calls.filter(([url, init]) => {
        const method = (init?.method ?? "GET").toUpperCase();
        return typeof url === "string" && method === "POST" && url.includes("/rest/v1/assessment_review_events");
      });
    expect(reviewEventCalls).toHaveLength(2);
    const uploadedEventCalls = reviewEventCalls.filter(([, init]) => {
      const body = typeof init?.body === "string" ? init.body : "";
      return body.includes("\"action\":\"uploaded\"");
    });
    expect(uploadedEventCalls).toHaveLength(1);
    const extractionCompletedEventCalls = vi
      .mocked(fetchJson)
      .mock.calls.filter(([url, init]) => {
        const method = (init?.method ?? "GET").toUpperCase();
        if (typeof url !== "string" || method !== "POST") return false;
        if (!url.includes("/rest/v1/assessment_review_events")) return false;
        const body = typeof init?.body === "string" ? init.body : "";
        return body.includes("\"action\":\"extraction_completed\"");
      });
    expect(extractionCompletedEventCalls).toHaveLength(0);
    const generateCalls = vi
      .mocked(fetchJson)
      .mock.calls.filter(([url]) => typeof url === "string" && url.includes("/functions/v1/generate-program-goals"));
    expect(generateCalls).toHaveLength(0);
    const draftWriteCalls = vi.mocked(fetchJson).mock.calls.filter(([url, init]) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (typeof url !== "string") return false;
      if (method !== "POST") return false;
      return url.includes("/rest/v1/assessment_draft_programs") || url.includes("/rest/v1/assessment_draft_goals");
    });
    expect(draftWriteCalls).toHaveLength(0);
  });

  it("records extraction_failed audit event when extraction workflow throws", async () => {
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
    vi.mocked(getAccessTokenSubject).mockReturnValue("user-1");
    vi.mocked(loadChecklistTemplateRows).mockResolvedValue([]);

    vi.mocked(fetchJson).mockImplementation(async (url: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && url.includes("/rest/v1/clients?select=id")) {
        return { ok: true, status: 200, data: [{ id: "client-1" }] };
      }
      if (method === "POST" && url.includes("/rest/v1/assessment_documents")) {
        return {
          ok: true,
          status: 201,
          data: [{ id: "doc-extract-throw", organization_id: "org-1", client_id: "11111111-1111-1111-1111-111111111111" }],
        };
      }
      if (method === "POST" && url.includes("/rest/v1/assessment_checklist_items")) {
        return { ok: true, status: 201, data: null };
      }
      if (method === "POST" && url.includes("/rest/v1/assessment_extractions")) {
        return { ok: true, status: 201, data: null };
      }
      if (method === "POST" && url.includes("/functions/v1/extract-assessment-fields")) {
        throw new Error("extract boom");
      }
      if (method === "PATCH" && url.includes("/rest/v1/assessment_documents?id=eq.doc-extract-throw")) {
        return { ok: true, status: 200, data: null };
      }
      if (method === "POST" && url.includes("/rest/v1/assessment_review_events")) {
        return { ok: true, status: 201, data: null };
      }
      return { ok: true, status: 200, data: null };
    });

    const response = await assessmentDocumentsHandler(
      new Request("http://localhost/api/assessment-documents", {
        method: "POST",
        headers: { Authorization: "Bearer token" },
        body: JSON.stringify({
          client_id: "11111111-1111-1111-1111-111111111111",
          file_name: "fba.pdf",
          mime_type: "application/pdf",
          file_size: 1234,
          object_path: "clients/client-1/assessments/fba.pdf",
        }),
      }),
    );

    expect(response.status).toBe(201);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchJson).toHaveBeenCalledWith(
      expect.stringContaining("/rest/v1/assessment_documents?id=eq.doc-extract-throw"),
      expect.objectContaining({
        method: "PATCH",
        body: expect.stringContaining("extraction_failed"),
      }),
    );
    const extractionFailedDocumentPatchCall = vi
      .mocked(fetchJson)
      .mock.calls.find(([url, init]) => {
        const method = (init?.method ?? "GET").toUpperCase();
        const body = typeof init?.body === "string" ? init.body : "";
        return (
          typeof url === "string" &&
          method === "PATCH" &&
          url.includes("/rest/v1/assessment_documents?id=eq.doc-extract-throw") &&
          body.includes("\"status\":\"extraction_failed\"")
        );
      });
    expect(extractionFailedDocumentPatchCall).toBeDefined();
    const extractionFailedDocumentPatchPayload = JSON.parse(
      ((extractionFailedDocumentPatchCall?.[1] as RequestInit).body ?? "{}") as string,
    ) as Record<string, unknown>;
    expectExtractionFailedStatusWriteInvariants(
      extractionFailedDocumentPatchPayload,
      "Field extraction failed. Review checklist manually.",
    );
    const extractionFailedReviewEventCalls = vi
      .mocked(fetchJson)
      .mock.calls.filter(([url, init]) => {
        const method = (init?.method ?? "GET").toUpperCase();
        if (typeof url !== "string" || method !== "POST") return false;
        if (!url.includes("/rest/v1/assessment_review_events")) return false;
        const body = typeof init?.body === "string" ? init.body : "";
        return body.includes("\"action\":\"extraction_failed\"");
      });
    expect(extractionFailedReviewEventCalls).toHaveLength(1);
    const extractionFailedReviewEventPayload = JSON.parse(
      (extractionFailedReviewEventCalls[0]?.[1] as RequestInit).body as string,
    ) as Record<string, unknown>;
    expectExtractionFailedActorStatusInvariants(extractionFailedReviewEventPayload, "doc-extract-throw");
    expectExtractionFailedIdLinkageInvariants(extractionFailedReviewEventPayload, "doc-extract-throw");
    expectExtractionFailedOrgClientLinkageInvariants(
      extractionFailedReviewEventPayload,
      "org-1",
      "11111111-1111-1111-1111-111111111111",
    );
    expectExtractionFailedLifecycleTransitionInvariants(extractionFailedReviewEventPayload);
    expectExtractionFailedActorDocumentTypeInvariants(extractionFailedReviewEventPayload, "user-1");
    expect(extractionFailedReviewEventPayload).toStrictEqual({
      assessment_document_id: "doc-extract-throw",
      organization_id: "org-1",
      client_id: "11111111-1111-1111-1111-111111111111",
      item_type: "document",
      item_id: "doc-extract-throw",
      action: "extraction_failed",
      from_status: "extracting",
      to_status: "extraction_failed",
      actor_id: "user-1",
    });
    expect(extractionFailedReviewEventPayload).not.toHaveProperty("notes");
    expect(extractionFailedReviewEventPayload).not.toHaveProperty("event_payload");
    expect(extractionFailedReviewEventPayload).not.toHaveProperty("extracted_count");
    expect(extractionFailedReviewEventPayload).not.toHaveProperty("unresolved_count");
    expect(extractionFailedReviewEventPayload).not.toHaveProperty("unresolved_keys");
    const reviewEventCalls = vi
      .mocked(fetchJson)
      .mock.calls.filter(([url, init]) => {
        const method = (init?.method ?? "GET").toUpperCase();
        return typeof url === "string" && method === "POST" && url.includes("/rest/v1/assessment_review_events");
      });
    expect(reviewEventCalls).toHaveLength(2);
    const uploadedEventCalls = reviewEventCalls.filter(([, init]) => {
      const body = typeof init?.body === "string" ? init.body : "";
      return body.includes("\"action\":\"uploaded\"");
    });
    expect(uploadedEventCalls).toHaveLength(1);
    const extractionCompletedEventCalls = vi
      .mocked(fetchJson)
      .mock.calls.filter(([url, init]) => {
        const method = (init?.method ?? "GET").toUpperCase();
        if (typeof url !== "string" || method !== "POST") return false;
        if (!url.includes("/rest/v1/assessment_review_events")) return false;
        const body = typeof init?.body === "string" ? init.body : "";
        return body.includes("\"action\":\"extraction_completed\"");
      });
    expect(extractionCompletedEventCalls).toHaveLength(0);
    const generateCalls = vi
      .mocked(fetchJson)
      .mock.calls.filter(([url]) => typeof url === "string" && url.includes("/functions/v1/generate-program-goals"));
    expect(generateCalls).toHaveLength(0);
    const draftWriteCalls = vi.mocked(fetchJson).mock.calls.filter(([url, init]) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (typeof url !== "string") return false;
      if (method !== "POST") return false;
      return url.includes("/rest/v1/assessment_draft_programs") || url.includes("/rest/v1/assessment_draft_goals");
    });
    expect(draftWriteCalls).toHaveLength(0);
  });

  it("marks extraction failure and cleans staged programs on missing_program_match", async () => {
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
    vi.mocked(getAccessTokenSubject).mockReturnValue("user-1");
    vi.mocked(loadChecklistTemplateRows).mockResolvedValue([
      {
        section: "goals_treatment_planning",
        label: "Skill Acquisition Goal 1",
        placeholder_key: "CALOPTIMA_FBA_SKILL_ACQUISITION_GOALS",
        mode: "AUTO",
        source: "uploaded_fba",
        required: true,
        extraction_method: "ai_extract",
        validation_rule: "non_empty_text",
        status: "not_started",
      },
    ]);

    vi.mocked(fetchJson).mockImplementation(async (url: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && url.includes("/rest/v1/clients?select=id")) {
        return { ok: true, status: 200, data: [{ id: "client-1" }] };
      }
      if (method === "POST" && url.includes("/rest/v1/assessment_documents")) {
        return {
          ok: true,
          status: 201,
          data: [{ id: "doc-auto-2", organization_id: "org-1", client_id: "11111111-1111-1111-1111-111111111111" }],
        };
      }
      if (method === "POST" && url.includes("/rest/v1/assessment_checklist_items")) {
        return { ok: true, status: 201, data: null };
      }
      if (method === "POST" && url.includes("/rest/v1/assessment_extractions")) {
        return { ok: true, status: 201, data: null };
      }
      if (method === "POST" && url.includes("/functions/v1/extract-assessment-fields")) {
        return {
          ok: true,
          status: 200,
          data: {
            fields: [
              {
                placeholder_key: "CALOPTIMA_FBA_SKILL_ACQUISITION_GOALS",
                value_text: "Client will follow one-step directions.",
                value_json: null,
                confidence: 0.95,
                mode: "AUTO",
                status: "approved",
                source_span: { page: 4, line: "Skill acquisition evidence" },
                review_notes: "Extracted.",
              },
            ],
            unresolved_keys: [],
            extracted_count: 1,
            unresolved_count: 0,
          },
        };
      }
      if (method === "PATCH" && url.includes("/rest/v1/assessment_checklist_items")) {
        return { ok: true, status: 200, data: null };
      }
      if (method === "PATCH" && url.includes("/rest/v1/assessment_extractions")) {
        return { ok: true, status: 200, data: null };
      }
      if (method === "GET" && url.includes("/rest/v1/assessment_draft_programs?select=id")) {
        return { ok: true, status: 200, data: [] };
      }
      if (method === "GET" && url.includes("/rest/v1/assessment_checklist_items?select=section_key")) {
        return {
          ok: true,
          status: 200,
          data: [
            {
              section_key: "goals_treatment_planning",
              label: "Skill Acquisition Goal 1",
              placeholder_key: "CALOPTIMA_FBA_SKILL_ACQUISITION_GOALS",
              value_text: "Client will follow one-step directions.",
              value_json: null,
              status: "approved",
            },
          ],
        };
      }
      if (method === "GET" && url.includes("/rest/v1/assessment_extractions?select=section_key")) {
        return {
          ok: true,
          status: 200,
          data: [
            {
              section_key: "goals_treatment_planning",
              field_key: "CALOPTIMA_FBA_SKILL_ACQUISITION_GOALS",
              label: "Skill Acquisition Goal 1",
              value_text: "Client will follow one-step directions.",
              value_json: null,
              source_span: { page: 4, line: "Skill acquisition evidence" },
              status: "approved",
            },
          ],
        };
      }
      if (method === "GET" && url.includes("/rest/v1/clients?select=full_name")) {
        return { ok: true, status: 200, data: [{ full_name: "Client One" }] };
      }
      if (method === "GET" && url.includes("/rest/v1/ai_guidance_documents?")) {
        return { ok: true, status: 200, data: [{ guidance_text: "Use objective ABA language." }] };
      }
      if (method === "POST" && url.includes("/functions/v1/generate-program-goals")) {
        return {
          ok: true,
          status: 200,
          data: {
            programs: [
              {
                name: "Communication Program",
                description: "Improve communication.",
                rationale: "Rationale text",
                evidence_refs: [{ section_key: "assessment_summary", source_span: "Program evidence" }],
                review_flags: [],
              },
            ],
            goals: [
              ...Array.from({ length: 20 }, (_, index) => ({
                program_name: index === 0 ? "Unknown Program" : "Communication Program",
                title: `Child Goal ${index + 1}`,
                description: "Child description",
                original_text: "Child original text",
                goal_type: "child",
                target_behavior: "Functional communication",
                measurement_type: "Frequency",
                baseline_data: "Baseline",
                target_criteria: "Target",
                mastery_criteria: "Mastery",
                maintenance_criteria: "Maintenance",
                generalization_criteria: "Generalization",
                objective_data_points: ["Track independent responses"],
                rationale: "Goal rationale",
                evidence_refs: [{ section_key: "assessment_summary", source_span: "Goal evidence" }],
                review_flags: [],
              })),
              ...Array.from({ length: 6 }, (_, index) => ({
                program_name: "Communication Program",
                title: `Parent Goal ${index + 1}`,
                description: "Parent description",
                original_text: "Parent original text",
                goal_type: "parent",
                target_behavior: "Caregiver fidelity",
                measurement_type: "Percent fidelity",
                baseline_data: "Baseline",
                target_criteria: "Target",
                mastery_criteria: "Mastery",
                maintenance_criteria: "Maintenance",
                generalization_criteria: "Generalization",
                objective_data_points: ["Track caregiver steps completed"],
                rationale: "Goal rationale",
                evidence_refs: [{ section_key: "parent_training", source_span: "Parent evidence" }],
                review_flags: [],
              })),
            ],
            summary_rationale: "Summary rationale",
            confidence: "medium",
          },
        };
      }
      if (method === "POST" && url.includes("/rest/v1/assessment_draft_programs")) {
        return { ok: true, status: 201, data: [{ id: "draft-program-mismatch-2", name: "Communication Program" }] };
      }
      if (method === "DELETE" && url.includes("/rest/v1/assessment_draft_programs?id=in.(draft-program-mismatch-2)")) {
        return { ok: true, status: 200, data: null };
      }
      if (method === "PATCH" && url.includes("/rest/v1/assessment_documents")) {
        return { ok: true, status: 200, data: null };
      }
      if (method === "POST" && url.includes("/rest/v1/assessment_review_events")) {
        return { ok: true, status: 201, data: null };
      }
      return { ok: true, status: 200, data: null };
    });

    const response = await assessmentDocumentsHandler(
      new Request("http://localhost/api/assessment-documents", {
        method: "POST",
        headers: { Authorization: "Bearer token" },
        body: JSON.stringify({
          client_id: "11111111-1111-1111-1111-111111111111",
          file_name: "fba.pdf",
          mime_type: "application/pdf",
          file_size: 1234,
          object_path: "clients/client-1/assessments/fba.pdf",
        }),
      }),
    );

    expect(response.status).toBe(201);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchJson).toHaveBeenCalledWith(
      expect.stringContaining("/rest/v1/assessment_draft_programs?id=in.(draft-program-mismatch-2)"),
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(fetchJson).toHaveBeenCalledWith(
      expect.stringContaining("/rest/v1/assessment_documents?id=eq.doc-auto-2"),
      expect.objectContaining({
        method: "PATCH",
        body: expect.stringContaining("missing_program_match"),
      }),
    );
    const liveProgramWrite = vi
      .mocked(fetchJson)
      .mock.calls.find(([url]) => typeof url === "string" && url.includes("/rest/v1/programs"));
    const liveGoalWrite = vi
      .mocked(fetchJson)
      .mock.calls.find(([url]) => typeof url === "string" && url.includes("/rest/v1/goals"));
    expect(liveProgramWrite).toBeUndefined();
    expect(liveGoalWrite).toBeUndefined();
  });

  it.each(roleMatrix)("returns 403 for out-of-org assessment document delete as $label without side effects", async ({ role }) => {
    vi.mocked(getAccessToken).mockReturnValue("token");
    vi.mocked(resolveOrgAndRole).mockResolvedValue({
      organizationId: "org-1",
      ...role,
    });
    vi.mocked(getSupabaseConfig).mockReturnValue({
      supabaseUrl: "https://example.supabase.co",
      anonKey: "anon",
    });

    vi.mocked(fetchJson).mockImplementation(async (url: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && url.includes("/rest/v1/assessment_documents?select=id,organization_id,client_id,bucket_id,object_path")) {
        return { ok: true, status: 200, data: [] };
      }
      return { ok: false, status: 500, data: null };
    });

    const response = await assessmentDocumentsHandler(
      new Request(
        "http://localhost/api/assessment-documents?assessment_document_id=11111111-1111-4111-8111-111111111111",
        {
          method: "DELETE",
          headers: { Authorization: "Bearer token" },
        },
      ),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "assessment_document_id is not in scope for this organization",
    });
    expect(fetchJson).toHaveBeenCalledWith(
      expect.stringContaining("/rest/v1/assessment_documents?select=id,organization_id,client_id,bucket_id,object_path"),
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchJson).toHaveBeenCalledTimes(1);
    const deleteCalls = vi
      .mocked(fetchJson)
      .mock.calls.filter(([, init]) => (init?.method ?? "GET").toUpperCase() === "DELETE");
    expect(deleteCalls).toHaveLength(0);
  });

  it("deletes an assessment document and dependent rows", async () => {
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
      if (method === "GET" && url.includes("/rest/v1/assessment_documents?select=id,organization_id,client_id,bucket_id,object_path")) {
        return {
          ok: true,
          status: 200,
          data: [
            {
              id: "11111111-1111-4111-8111-111111111111",
              organization_id: "org-1",
              client_id: "client-1",
              bucket_id: "client-documents",
              object_path: "clients/client-1/assessments/fba.pdf",
            },
          ],
        };
      }
      if (
        method === "DELETE" &&
        (url.includes("/rest/v1/assessment_review_events") ||
          url.includes("/rest/v1/assessment_draft_goals") ||
          url.includes("/rest/v1/assessment_draft_programs") ||
          url.includes("/rest/v1/assessment_checklist_items") ||
          url.includes("/rest/v1/assessment_extractions") ||
          url.includes("/rest/v1/assessment_documents?"))
      ) {
        return { ok: true, status: 200, data: null };
      }
      return { ok: false, status: 500, data: null };
    });

    const response = await assessmentDocumentsHandler(
      new Request(
        "http://localhost/api/assessment-documents?assessment_document_id=11111111-1111-4111-8111-111111111111",
        {
          method: "DELETE",
          headers: { Authorization: "Bearer token" },
        },
      ),
    );

    expect(response.status).toBe(200);
    expect(fetchJson).toHaveBeenCalledWith(
      expect.stringContaining("/rest/v1/assessment_draft_goals"),
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(fetchJson).toHaveBeenCalledWith(
      expect.stringContaining("/rest/v1/assessment_documents?id=eq.11111111-1111-4111-8111-111111111111"),
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});
