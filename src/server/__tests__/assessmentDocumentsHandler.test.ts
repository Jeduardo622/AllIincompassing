import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assessmentDocumentsExtractionBackgroundHandler, assessmentDocumentsHandler } from "../api/assessment-documents";
import { handler as assessmentDocumentsNetlifyHandler } from "../../../netlify/functions/assessment-documents";

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

const ORIGINAL_SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ORIGINAL_FETCH = globalThis.fetch;

describe("assessmentDocumentsHandler", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    if (typeof ORIGINAL_SUPABASE_SERVICE_ROLE_KEY === "string") {
      process.env.SUPABASE_SERVICE_ROLE_KEY = ORIGINAL_SUPABASE_SERVICE_ROLE_KEY;
    } else {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    }
    globalThis.fetch = ORIGINAL_FETCH;
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
      if (method === "GET" && url.includes("/rest/v1/assessment_template_versions?select=id")) {
        return { ok: true, status: 200, data: [{ id: "template-version-1" }] };
      }
      if (method === "GET" && url.includes("/rest/v1/assessment_template_fields?select=")) {
        return {
          ok: true,
          status: 200,
          data: [{
            section_key: "behavior_background_services",
            field_key: "IEHP_FBA_BHT_AVAILABILITY_GRID",
            label: "BHT Availability Grid",
            field_type: "checkbox_grid",
            mode: "ASSISTED",
            required: true,
            source: "uploaded_assessment_document",
          }],
        };
      }
      if (
        method === "GET" &&
        url.includes(
          `/rest/v1/assessment_documents?select=status&id=eq.${encodeURIComponent(
            documentId,
          )}&organization_id=eq.org-1&limit=1`,
        )
      ) {
        return { ok: true, status: 200, data: [{ status: "extracting" }] };
      }
      if (
        method === "GET" &&
        url.includes(`/rest/v1/assessment_documents?select=status&id=eq.${encodeURIComponent(documentId)}`)
      ) {
        return { ok: true, status: 200, data: [{ status: "extracting" }] };
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
            extraction_provider: "adobe_pdf_extract",
            adobe_element_count: 42,
            adobe_table_count: 3,
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

  const mockNetlifyWrapperFlowResponses = (
    documentId: string,
    mode: "success" | "lookup-empty" | "lookup-fails" | "lookup-status-throws" = "success",
  ) => {
    const clientId = "11111111-1111-1111-1111-111111111111";
    const backgroundDocument = {
      id: documentId,
      organization_id: "org-1",
      client_id: clientId,
      status: "extracting",
      template_type: "caloptima_fba",
      bucket_id: "client-documents",
      object_path: `clients/${clientId}/assessments/fba.pdf`,
      updated_at: "2026-05-17T00:00:00.000Z",
    };

    vi.mocked(fetchJson).mockImplementation(async (url: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && url.includes("/rest/v1/clients?select=id")) {
        return { ok: true, status: 200, data: [{ id: "client-1" }] };
      }
      if (
        method === "GET" &&
        url.includes(
          `/rest/v1/assessment_documents?select=status&id=eq.${encodeURIComponent(documentId)}&organization_id=eq.org-1&limit=1`,
        )
      ) {
        if (mode === "lookup-fails") {
          return { ok: true, status: 200, data: [{ status: "extraction_failed" }] };
        }
        if (mode === "lookup-status-throws") {
          throw new Error("temporary status lookup failure");
        }
        return { ok: true, status: 200, data: [{ status: "extracting" }] };
      }
      if (method === "GET" && url.includes(`/rest/v1/assessment_documents?select=status&id=eq.${encodeURIComponent(documentId)}`)) {
        if (mode === "lookup-fails") {
          return { ok: true, status: 200, data: [{ status: "extraction_failed" }] };
        }
        if (mode === "lookup-status-throws") {
          throw new Error("temporary status lookup failure");
        }
        return { ok: true, status: 200, data: [{ status: "extracting" }] };
      }
      if (method === "POST" && url.includes("/rest/v1/assessment_documents")) {
        return {
          ok: true,
          status: 201,
          data: [{ id: documentId, organization_id: "org-1", client_id: clientId }],
        };
      }
      if (method === "POST" && url.includes("/rest/v1/assessment_checklist_items")) {
        return { ok: true, status: 201, data: null };
      }
      if (method === "POST" && url.includes("/rest/v1/assessment_extractions")) {
        return { ok: true, status: 201, data: null };
      }
      if (
        method === "GET" &&
        url.includes("/rest/v1/assessment_documents?select=id,organization_id,client_id,status,template_type,template_version_id,bucket_id,object_path,updated_at")
      ) {
        if (mode === "lookup-fails") {
          return { ok: false, status: 500, data: null };
        }
        if (mode === "lookup-empty") {
          return { ok: true, status: 200, data: [] };
        }
        return { ok: true, status: 200, data: [backgroundDocument] };
      }
      if (
        method === "PATCH" &&
        url.includes(`/rest/v1/assessment_documents?id=eq.${encodeURIComponent(documentId)}`) &&
        url.includes("&status=eq.extracting")
      ) {
        return {
          ok: true,
          status: 200,
          data: [{ ...backgroundDocument, status: "extraction_running" }],
        };
      }
      if (method === "GET" && url.includes("/rest/v1/clients?select=full_name")) {
        return { ok: true, status: 200, data: [{ full_name: "Client One", date_of_birth: "2017-05-01" }] };
      }
      if (method === "POST" && url.includes("/functions/v1/extract-assessment-fields")) {
        return {
          ok: true,
          status: 200,
          data: {
            extraction_provider: "adobe_pdf_extract",
            adobe_element_count: 42,
            adobe_table_count: 3,
            fields: [],
            unresolved_keys: [],
            extracted_count: 0,
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
        extraction_aliases: ["Member full legal name"],
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
          object_path: "clients/11111111-1111-1111-1111-111111111111/assessments/fba.pdf",
        }),
      }),
    );

    expect(response.status).toBe(201);
    await expect(response.clone().json()).resolves.toMatchObject({
      id: "doc-1",
      status: "extracting",
      extraction_error: null,
    });
    expect(fetchJson).toHaveBeenCalledWith(
      expect.stringContaining("/assessment_checklist_items"),
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchJson).toHaveBeenCalledWith(
      expect.stringContaining("/assessment_extractions"),
      expect.objectContaining({ method: "POST" }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const extractionCall = vi
      .mocked(fetchJson)
      .mock.calls.find(([url]) => typeof url === "string" && url.includes("/functions/v1/extract-assessment-fields"));
    expect(extractionCall).toBeDefined();
    const extractionPayload = JSON.parse(String((extractionCall?.[1] as RequestInit | undefined)?.body ?? "{}")) as {
      checklist_rows?: Array<{ extraction_aliases?: string[] }>;
    };
    expect(extractionPayload.checklist_rows?.[0]?.extraction_aliases).toEqual(["Member full legal name"]);
    expect(loadChecklistTemplateRows).toHaveBeenCalledWith("caloptima_fba");
    const completedEventCall = vi.mocked(fetchJson).mock.calls.find(([url, init]) => {
      const body = String((init as RequestInit | undefined)?.body ?? "");
      return typeof url === "string" && url.includes("/assessment_review_events") && body.includes("extraction_completed");
    });
    const completedEventPayload = JSON.parse(String((completedEventCall?.[1] as RequestInit | undefined)?.body ?? "{}"));
    expect(completedEventPayload.event_payload).toMatchObject({
      extraction_provider: "adobe_pdf_extract",
      adobe_element_count: 42,
      adobe_table_count: 3,
    });
  });

  it("returns upload response before starting the scheduled CalOptima extraction workflow", async () => {
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
    mockUploadFlowResponses("doc-scheduled");

    const scheduled: string[] = [];
    const response = await assessmentDocumentsHandler(
      new Request("http://localhost/api/assessment-documents", {
        method: "POST",
        headers: { Authorization: "Bearer token" },
        body: JSON.stringify({
          client_id: "11111111-1111-1111-1111-111111111111",
          file_name: "fba.pdf",
          mime_type: "application/pdf",
          file_size: 1234,
          object_path: "clients/11111111-1111-1111-1111-111111111111/assessments/fba.pdf",
        }),
      }),
      {
        scheduleCaloptimaExtraction: async ({ createdDocumentId }) => {
          scheduled.push(createdDocumentId);
          return { ok: true, status: 202 };
        },
      },
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      id: "doc-scheduled",
      status: "extracting",
      extraction_error: null,
    });
    expect(scheduled).toEqual(["doc-scheduled"]);
    expect(fetchJson).not.toHaveBeenCalledWith(
      expect.stringContaining("/functions/v1/extract-assessment-fields"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("links IEHP uploads to the active template layout version before extraction", async () => {
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
      if (method === "GET" && url.includes("/rest/v1/assessment_template_versions?select=id")) {
        return { ok: true, status: 200, data: [{ id: "template-version-1" }] };
      }
      if (method === "GET" && url.includes("/rest/v1/assessment_template_fields?select=")) {
        return {
          ok: true,
          status: 200,
          data: [
            {
              section_key: "identification_admin",
              field_key: "IEHP_FBA_FIRST_NAME",
              label: "First Name",
              field_type: "text",
              mode: "AUTO",
              required: true,
              source: "clients.first_name",
            },
            {
              section_key: "behavior_background_services",
              field_key: "IEHP_FBA_PCP_ASSISTANCE_REQUEST",
              label: "IEHP Assistance Accessing PCP",
              field_type: "checkbox_grid",
              mode: "MANUAL",
              required: false,
              source: "uploaded_assessment_document when present; otherwise clinician_manual_entry",
            },
            {
              section_key: "assessment_observations",
              field_key: "IEHP_FBA_CLINICAL_INTERVIEW_NARRATIVE",
              label: "Clinical Interview Narrative",
              field_type: "textarea",
              mode: "ASSISTED",
              required: true,
              source: "uploaded_assessment_document",
            },
            {
              section_key: "preference_assessment",
              field_key: "IEHP_FBA_PREFERENCE_REINFORCERS_TABLE",
              label: "Preference Reinforcers Table",
              field_type: "repeatable_table",
              mode: "ASSISTED",
              required: true,
              source: "uploaded_assessment_document",
            },
            {
              section_key: "signature_block",
              field_key: "IEHP_FBA_SIGNATURE_BLOCK",
              label: "Report completed by / signature and date",
              field_type: "signature_block",
              mode: "ASSISTED",
              required: true,
              source: "uploaded_assessment_document",
            },
          ],
        };
      }
      if (method === "POST" && url.includes("/rest/v1/assessment_documents")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        expect(body).toMatchObject({
          template_type: "iehp_fba",
          template_version_id: "template-version-1",
        });
        return {
          ok: true,
          status: 201,
          data: [{
            id: "doc-iehp-template",
            organization_id: "org-1",
            client_id: "11111111-1111-1111-1111-111111111111",
            template_version_id: "template-version-1",
          }],
        };
      }
      if (method === "POST" && url.includes("/rest/v1/assessment_checklist_items")) {
        const body = JSON.parse(String(init?.body ?? "[]")) as Array<Record<string, unknown>>;
        expect(body.map((row) => row.placeholder_key)).toEqual([
          "IEHP_FBA_FIRST_NAME",
          "IEHP_FBA_PCP_ASSISTANCE_REQUEST",
          "IEHP_FBA_CLINICAL_INTERVIEW_NARRATIVE",
          "IEHP_FBA_PREFERENCE_REINFORCERS_TABLE",
          "IEHP_FBA_SIGNATURE_BLOCK",
        ]);
        expect(body.find((row) => row.placeholder_key === "IEHP_FBA_FIRST_NAME")).toMatchObject({
          mode: "AUTO",
          extraction_owner: "IntakeCoordinator",
          review_owner: "ClinicalReviewer",
        });
        expect(body.find((row) => row.placeholder_key === "IEHP_FBA_PCP_ASSISTANCE_REQUEST")).toMatchObject({
          mode: "MANUAL",
          validation_rule: "optional_yes_no",
        });
        expect(body.find((row) => row.placeholder_key === "IEHP_FBA_CLINICAL_INTERVIEW_NARRATIVE")).toMatchObject({
          mode: "ASSISTED",
          extraction_method: "deterministic_docx_or_pdf_structured_extract",
          validation_rule: "non_empty_text",
        });
        expect(body.find((row) => row.placeholder_key === "IEHP_FBA_PREFERENCE_REINFORCERS_TABLE")).toMatchObject({
          mode: "ASSISTED",
          validation_rule: "structured_payload_required",
        });
        expect(body.find((row) => row.placeholder_key === "IEHP_FBA_SIGNATURE_BLOCK")).toMatchObject({
          mode: "ASSISTED",
          validation_rule: "signature_and_date_present",
        });
        return { ok: true, status: 201, data: null };
      }
      if (method === "POST" && url.includes("/rest/v1/assessment_extractions")) {
        const body = JSON.parse(String(init?.body ?? "[]")) as Array<Record<string, unknown>>;
        expect(body.map((row) => row.field_key)).toEqual([
          "IEHP_FBA_FIRST_NAME",
          "IEHP_FBA_PCP_ASSISTANCE_REQUEST",
          "IEHP_FBA_CLINICAL_INTERVIEW_NARRATIVE",
          "IEHP_FBA_PREFERENCE_REINFORCERS_TABLE",
          "IEHP_FBA_SIGNATURE_BLOCK",
        ]);
        return { ok: true, status: 201, data: null };
      }
      if (method === "POST" && url.includes("/rest/v1/assessment_review_events")) return { ok: true, status: 201, data: null };
      if (method === "PATCH" && url.includes("/rest/v1/assessment_documents")) return { ok: true, status: 200, data: null };
      return { ok: false, status: 500, data: null };
    });

    const scheduled: string[] = [];
    const scheduledChecklistFieldKeys: string[] = [];
    const response = await assessmentDocumentsHandler(
      new Request("http://localhost/api/assessment-documents", {
        method: "POST",
        headers: { Authorization: "Bearer token" },
        body: JSON.stringify({
          client_id: "11111111-1111-1111-1111-111111111111",
          file_name: "iehp.docx",
          mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          file_size: 1234,
          object_path: "clients/11111111-1111-1111-1111-111111111111/assessments/iehp.docx",
          template_type: "iehp_fba",
        }),
      }),
      {
        scheduleCaloptimaExtraction: async ({ createdDocumentId, checklistRows }) => {
          scheduled.push(createdDocumentId);
          scheduledChecklistFieldKeys.push(...checklistRows.map((row) => row.placeholder_key));
          return { ok: true, status: 202 };
        },
      },
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      id: "doc-iehp-template",
      status: "extracting",
      template_version_id: "template-version-1",
    });
    expect(scheduled).toEqual(["doc-iehp-template"]);
    expect(scheduledChecklistFieldKeys).toEqual([
      "IEHP_FBA_FIRST_NAME",
      "IEHP_FBA_PCP_ASSISTANCE_REQUEST",
      "IEHP_FBA_CLINICAL_INTERVIEW_NARRATIVE",
      "IEHP_FBA_PREFERENCE_REINFORCERS_TABLE",
      "IEHP_FBA_SIGNATURE_BLOCK",
    ]);
    expect(loadChecklistTemplateRows).not.toHaveBeenCalled();
  });

  it("fails IEHP upload before document creation when template field metadata cannot be loaded", async () => {
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
      if (method === "GET" && url.includes("/rest/v1/assessment_template_versions?select=id")) {
        return { ok: true, status: 200, data: [{ id: "template-version-1" }] };
      }
      if (method === "GET" && url.includes("/rest/v1/assessment_template_fields?select=")) {
        return { ok: false, status: 503, data: null };
      }
      if (method === "POST" && url.includes("/rest/v1/assessment_documents")) {
        throw new Error("assessment document should not be created when IEHP template metadata fails");
      }
      return { ok: false, status: 500, data: null };
    });

    const response = await assessmentDocumentsHandler(
      new Request("http://localhost/api/assessment-documents", {
        method: "POST",
        headers: { Authorization: "Bearer token" },
        body: JSON.stringify({
          client_id: "11111111-1111-1111-1111-111111111111",
          file_name: "iehp.docx",
          mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          file_size: 1234,
          object_path: "clients/11111111-1111-1111-1111-111111111111/assessments/iehp.docx",
          template_type: "iehp_fba",
        }),
      }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "Unable to load IEHP template field metadata." });
    expect(loadChecklistTemplateRows).not.toHaveBeenCalled();
  });

  it("fails closed when scheduling CalOptima extraction throws after marking the document extracting", async () => {
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
    mockUploadFlowResponses("doc-schedule-throw");

    const response = await assessmentDocumentsHandler(
      new Request("http://localhost/api/assessment-documents", {
        method: "POST",
        headers: { Authorization: "Bearer token" },
        body: JSON.stringify({
          client_id: "11111111-1111-1111-1111-111111111111",
          file_name: "fba.pdf",
          mime_type: "application/pdf",
          file_size: 1234,
          object_path: "clients/11111111-1111-1111-1111-111111111111/assessments/fba.pdf",
        }),
      }),
      {
        scheduleCaloptimaExtraction: async () => {
          throw new Error("trigger failed");
        },
      },
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: "Unable to start extraction. Retry the upload or contact support.",
    });
    const documentStatusBodies = vi
      .mocked(fetchJson)
      .mock.calls.filter(([url]) => typeof url === "string" && url.includes("/rest/v1/assessment_documents?id=eq.doc-schedule-throw"))
      .map(([, init]) => String((init as RequestInit | undefined)?.body ?? ""));
    expect(documentStatusBodies.some((body) => body.includes("\"status\":\"extracting\""))).toBe(true);
    expect(documentStatusBodies.some((body) => body.includes("\"status\":\"extraction_failed\""))).toBe(true);
  });

  it("Netlify upload wrapper enqueues the background extraction endpoint over fetch", async () => {
    const documentId = "71111111-1111-4111-8111-111111111111";
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
    mockNetlifyWrapperFlowResponses(documentId);
    globalThis.fetch = vi.fn(async () => new Response(null, { status: 202 })) as typeof fetch;

    const response = await assessmentDocumentsNetlifyHandler(
      {
        httpMethod: "POST",
        headers: {
          host: "app.example.com",
          authorization: "Bearer token",
        },
        path: "/api/assessment-documents",
        rawUrl: "https://app.example.com/api/assessment-documents",
        body: JSON.stringify({
          client_id: "11111111-1111-1111-1111-111111111111",
          file_name: "fba.pdf",
          mime_type: "application/pdf",
          file_size: 1234,
          object_path: "clients/11111111-1111-1111-1111-111111111111/assessments/fba.pdf",
        }),
        isBase64Encoded: false,
      } as never,
      {} as never,
      undefined as never,
    );

    expect(response.statusCode).toBe(201);
    expect(JSON.parse(response.body)).toMatchObject({
      id: documentId,
      status: "extracting",
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://app.example.com/.netlify/functions/assessment-documents-extract-background",
      expect.objectContaining({
        method: "POST",
        headers: expect.any(Headers),
      }),
    );
    const [, init] = vi.mocked(globalThis.fetch).mock.calls[0] ?? [];
    const headers = init?.headers instanceof Headers ? init.headers : new Headers(init?.headers);
    expect(headers.get("authorization")).toBe("Bearer token");
    expect(JSON.parse(String(init?.body ?? "{}"))).toMatchObject({
      assessment_document_id: documentId,
      client_id: "11111111-1111-1111-1111-111111111111",
    });
  });

  it("Netlify upload wrapper no longer depends on waitUntil being available", async () => {
    const documentId = "75555555-5555-4555-8555-555555555555";
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
    mockNetlifyWrapperFlowResponses(documentId);
    globalThis.fetch = vi.fn(async () => new Response(null, { status: 202 })) as typeof fetch;

    const response = await assessmentDocumentsNetlifyHandler(
      {
        httpMethod: "POST",
        headers: {
          host: "app.example.com",
          authorization: "Bearer token",
        },
        path: "/api/assessment-documents",
        rawUrl: "https://app.example.com/api/assessment-documents",
        body: JSON.stringify({
          client_id: "11111111-1111-1111-1111-111111111111",
          file_name: "fba.pdf",
          mime_type: "application/pdf",
          file_size: 1234,
          object_path: "clients/11111111-1111-1111-1111-111111111111/assessments/fba.pdf",
        }),
        isBase64Encoded: false,
      } as never,
      {} as never,
      undefined as never,
    );

    expect(response.statusCode).toBe(201);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const documentStatusBodies = vi
      .mocked(fetchJson)
      .mock.calls.filter(
        ([url]) => typeof url === "string" && url.includes(`/rest/v1/assessment_documents?id=eq.${documentId}`),
      )
      .map(([, init]) => String((init as RequestInit | undefined)?.body ?? ""));
    expect(documentStatusBodies.some((body) => body.includes("\"status\":\"extracting\""))).toBe(true);
    expect(documentStatusBodies.some((body) => body.includes("\"status\":\"extraction_failed\""))).toBe(false);
  });

  it("Netlify upload wrapper persists extraction_background_schedule_failed when enqueue returns non-ok", async () => {
    const documentId = "73333333-3333-4333-8333-333333333333";
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
    mockNetlifyWrapperFlowResponses(documentId);
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ error: "enqueue failed" }), { status: 500 })) as typeof fetch;

    const response = await assessmentDocumentsNetlifyHandler(
      {
        httpMethod: "POST",
        headers: {
          host: "app.example.com",
          authorization: "Bearer token",
        },
        path: "/api/assessment-documents",
        rawUrl: "https://app.example.com/api/assessment-documents",
        body: JSON.stringify({
          client_id: "11111111-1111-1111-1111-111111111111",
          file_name: "fba.pdf",
          mime_type: "application/pdf",
          file_size: 1234,
          object_path: "clients/11111111-1111-1111-1111-111111111111/assessments/fba.pdf",
        }),
        isBase64Encoded: false,
      } as never,
      {} as never,
      undefined as never,
    );

    expect(response.statusCode).toBe(500);
    const documentStatusBodies = vi
      .mocked(fetchJson)
      .mock.calls.filter(([url]) => typeof url === "string" && url.includes(`/rest/v1/assessment_documents?id=eq.${documentId}`))
      .map(([, init]) => String((init as RequestInit | undefined)?.body ?? ""));
    expect(documentStatusBodies.some((body) => body.includes("\"status\":\"extracting\""))).toBe(true);
    expect(documentStatusBodies.some((body) => body.includes("\"status\":\"extraction_failed\""))).toBe(true);
    const failureEventCall = vi.mocked(fetchJson).mock.calls.find(([url, init]) => {
      const body = String((init as RequestInit | undefined)?.body ?? "");
      return typeof url === "string" && url.includes("/rest/v1/assessment_review_events") && body.includes(documentId) && body.includes("extraction_background_schedule_failed");
    });
    expect(failureEventCall).toBeDefined();
  });

  it("Netlify upload wrapper preserves in-flight extraction when enqueue transport fails after the worker already advanced status", async () => {
    const documentId = "73333333-3333-4333-8333-333333333334";
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
    mockNetlifyWrapperFlowResponses(documentId, "lookup-fails");
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ error: "enqueue failed" }), { status: 500 })) as typeof fetch;

    const response = await assessmentDocumentsNetlifyHandler(
      {
        httpMethod: "POST",
        headers: {
          host: "app.example.com",
          authorization: "Bearer token",
        },
        path: "/api/assessment-documents",
        rawUrl: "https://app.example.com/api/assessment-documents",
        body: JSON.stringify({
          client_id: "11111111-1111-1111-1111-111111111111",
          file_name: "fba.pdf",
          mime_type: "application/pdf",
          file_size: 1234,
          object_path: "clients/11111111-1111-1111-1111-111111111111/assessments/fba.pdf",
        }),
        isBase64Encoded: false,
      } as never,
      {} as never,
      undefined as never,
    );

    expect(response.statusCode).toBe(201);
    const failureEventCall = vi.mocked(fetchJson).mock.calls.find(([url, init]) => {
      const body = String((init as RequestInit | undefined)?.body ?? "");
      return typeof url === "string" && url.includes("/rest/v1/assessment_review_events") && body.includes(documentId) && body.includes("extraction_background_schedule_failed");
    });
    expect(failureEventCall).toBeUndefined();
  });

  it("Netlify upload wrapper persists schedule failure when lifecycle status probe throws", async () => {
    const documentId = "73333333-3333-4333-8333-333333333335";
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
    mockNetlifyWrapperFlowResponses(documentId, "lookup-status-throws");
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ error: "enqueue failed" }), { status: 500 })) as typeof fetch;

    const response = await assessmentDocumentsNetlifyHandler(
      {
        httpMethod: "POST",
        headers: {
          host: "app.example.com",
          authorization: "Bearer token",
        },
        path: "/api/assessment-documents",
        rawUrl: "https://app.example.com/api/assessment-documents",
        body: JSON.stringify({
          client_id: "11111111-1111-1111-1111-111111111111",
          file_name: "fba.pdf",
          mime_type: "application/pdf",
          file_size: 1234,
          object_path: "clients/11111111-1111-1111-1111-111111111111/assessments/fba.pdf",
        }),
        isBase64Encoded: false,
      } as never,
      {} as never,
      undefined as never,
    );

    expect(response.statusCode).toBe(500);
    const documentStatusBodies = vi
      .mocked(fetchJson)
      .mock.calls.filter(([url]) => typeof url === "string" && url.includes(`/rest/v1/assessment_documents?id=eq.${documentId}`))
      .map(([, init]) => String((init as RequestInit | undefined)?.body ?? ""));
    expect(documentStatusBodies.some((body) => body.includes("\"status\":\"extraction_failed\""))).toBe(true);
    const failureEventCall = vi.mocked(fetchJson).mock.calls.find(([url, init]) => {
      const body = String((init as RequestInit | undefined)?.body ?? "");
      return typeof url === "string" && url.includes("/rest/v1/assessment_review_events") && body.includes(documentId) && body.includes("extraction_background_schedule_failed");
    });
    expect(failureEventCall).toBeDefined();
  });

  it("Netlify upload wrapper persists extraction_background_schedule_failed when enqueue throws", async () => {
    const documentId = "73444444-4444-4344-8344-444444444444";
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
    mockNetlifyWrapperFlowResponses(documentId);
    globalThis.fetch = vi.fn(async () => {
      throw new Error("network enqueue failure");
    }) as typeof fetch;

    const response = await assessmentDocumentsNetlifyHandler(
      {
        httpMethod: "POST",
        headers: {
          host: "app.example.com",
          authorization: "Bearer token",
        },
        path: "/api/assessment-documents",
        rawUrl: "https://app.example.com/api/assessment-documents",
        body: JSON.stringify({
          client_id: "11111111-1111-1111-1111-111111111111",
          file_name: "fba.pdf",
          mime_type: "application/pdf",
          file_size: 1234,
          object_path: "clients/11111111-1111-1111-1111-111111111111/assessments/fba.pdf",
        }),
        isBase64Encoded: false,
      } as never,
      {} as never,
      undefined as never,
    );

    expect(response.statusCode).toBe(500);
    const failureEventCalls = vi.mocked(fetchJson).mock.calls.filter(([url, init]) => {
      const body = String((init as RequestInit | undefined)?.body ?? "");
      return (
        typeof url === "string" &&
        url.includes("/rest/v1/assessment_review_events") &&
        body.includes(documentId) &&
        body.includes("extraction_background_schedule_failed")
      );
    });
    expect(failureEventCalls).toHaveLength(1);
  });

  it("runs CalOptima extraction from the background worker only for scoped extracting documents", async () => {
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
    vi.mocked(fetchJson).mockImplementation(async (url: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && url.includes("/rest/v1/assessment_documents?select=id,organization_id,client_id,status,template_type,template_version_id,bucket_id,object_path")) {
        return {
          ok: true,
          status: 200,
          data: [
            {
              id: "11111111-1111-4111-8111-111111111111",
              organization_id: "org-1",
              client_id: "22222222-2222-4222-8222-222222222222",
              status: "extracting",
              template_type: "caloptima_fba",
              bucket_id: "client-documents",
              object_path: "clients/22222222-2222-4222-8222-222222222222/assessments/fba.pdf",
              updated_at: "2026-05-15T20:00:00.000Z",
            },
          ],
        };
      }
      if (
        method === "PATCH" &&
        url.includes("/rest/v1/assessment_documents?id=eq.11111111-1111-4111-8111-111111111111") &&
        url.includes("status=eq.extracting")
      ) {
        return {
          ok: true,
          status: 200,
          data: [
            {
              id: "11111111-1111-4111-8111-111111111111",
              organization_id: "org-1",
              client_id: "22222222-2222-4222-8222-222222222222",
              status: "extraction_running",
              template_type: "caloptima_fba",
              bucket_id: "client-documents",
              object_path: "clients/22222222-2222-4222-8222-222222222222/assessments/fba.pdf",
              updated_at: "2026-05-15T20:00:01.000Z",
            },
          ],
        };
      }
      if (method === "GET" && url.includes("/rest/v1/clients?select=full_name")) {
        return { ok: true, status: 200, data: [{ full_name: "Client One" }] };
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
                source_span: null,
                review_notes: null,
              },
            ],
            structured_sections: [],
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
      if (method === "PATCH" && url.includes("/rest/v1/assessment_documents?id=eq.11111111-1111-4111-8111-111111111111")) {
        return { ok: true, status: 200, data: null };
      }
      if (method === "POST" && url.includes("/rest/v1/assessment_review_events")) {
        return { ok: true, status: 201, data: null };
      }
      return { ok: false, status: 500, data: null };
    });

    const response = await assessmentDocumentsExtractionBackgroundHandler(
      new Request("http://localhost/.netlify/functions/assessment-documents-extract-background", {
        method: "POST",
        headers: { Authorization: "Bearer token" },
        body: JSON.stringify({ assessment_document_id: "11111111-1111-4111-8111-111111111111" }),
      }),
    );

    expect(response.status).toBe(202);
    expect(fetchJson).toHaveBeenCalledWith(
      expect.stringContaining("/functions/v1/extract-assessment-fields"),
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchJson).toHaveBeenCalledWith(
      expect.stringContaining("status=eq.extracting"),
      expect.objectContaining({
        method: "PATCH",
        body: expect.stringContaining("\"status\":\"extraction_running\""),
      }),
    );
    expect(fetchJson).toHaveBeenCalledWith(
      expect.stringContaining("/rest/v1/assessment_documents?id=eq.11111111-1111-4111-8111-111111111111"),
      expect.objectContaining({
        method: "PATCH",
        body: expect.stringContaining("\"status\":\"extracted\""),
      }),
    );
  });

  it("skips background extraction when the atomic claim returns no document", async () => {
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
      if (method === "GET" && url.includes("/rest/v1/assessment_documents?select=id,organization_id,client_id,status,template_type,template_version_id,bucket_id,object_path")) {
        return {
          ok: true,
          status: 200,
          data: [
            {
              id: "11111111-1111-4111-8111-111111111111",
              organization_id: "org-1",
              client_id: "22222222-2222-4222-8222-222222222222",
              status: "extracting",
              template_type: "caloptima_fba",
              bucket_id: "client-documents",
              object_path: "clients/22222222-2222-4222-8222-222222222222/assessments/fba.pdf",
              updated_at: "2026-05-15T20:00:00.000Z",
            },
          ],
        };
      }
      if (method === "PATCH" && url.includes("status=eq.extracting")) {
        return { ok: true, status: 200, data: [] };
      }
      return { ok: false, status: 500, data: null };
    });

    const response = await assessmentDocumentsExtractionBackgroundHandler(
      new Request("http://localhost/.netlify/functions/assessment-documents-extract-background", {
        method: "POST",
        headers: { Authorization: "Bearer token" },
        body: JSON.stringify({ assessment_document_id: "11111111-1111-4111-8111-111111111111" }),
      }),
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({ skipped: true, status: "extracting" });
    expect(fetchJson).not.toHaveBeenCalledWith(
      expect.stringContaining("/functions/v1/extract-assessment-fields"),
      expect.anything(),
    );
  });

  it("skips fresh extraction_running documents but reclaims stale extraction_running documents", async () => {
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
    let documentLoadCount = 0;
    vi.mocked(fetchJson).mockImplementation(async (url: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && url.includes("/rest/v1/assessment_documents?select=id,organization_id,client_id,status,template_type,template_version_id,bucket_id,object_path")) {
        documentLoadCount += 1;
        return {
          ok: true,
          status: 200,
          data: [
            {
              id: "11111111-1111-4111-8111-111111111111",
              organization_id: "org-1",
              client_id: "22222222-2222-4222-8222-222222222222",
              status: "extraction_running",
              template_type: "caloptima_fba",
              bucket_id: "client-documents",
              object_path: "clients/22222222-2222-4222-8222-222222222222/assessments/fba.pdf",
              updated_at: documentLoadCount === 1 ? new Date().toISOString() : "2020-01-01T00:00:00.000Z",
            },
          ],
        };
      }
      if (method === "PATCH" && url.includes("status=eq.extraction_running")) {
        return {
          ok: true,
          status: 200,
          data: [
            {
              id: "11111111-1111-4111-8111-111111111111",
              organization_id: "org-1",
              client_id: "22222222-2222-4222-8222-222222222222",
              status: "extraction_running",
              template_type: "caloptima_fba",
              bucket_id: "client-documents",
              object_path: "clients/22222222-2222-4222-8222-222222222222/assessments/fba.pdf",
              updated_at: "2026-05-15T20:00:01.000Z",
            },
          ],
        };
      }
      if (method === "GET" && url.includes("/rest/v1/clients?select=full_name")) {
        return { ok: true, status: 200, data: [{ full_name: "Client One" }] };
      }
      if (method === "POST" && url.includes("/functions/v1/extract-assessment-fields")) {
        return {
          ok: true,
          status: 200,
          data: {
            fields: [],
            structured_sections: [],
            unresolved_keys: [],
            extracted_count: 0,
            unresolved_count: 0,
          },
        };
      }
      if (method === "PATCH" && url.includes("/rest/v1/assessment_documents?id=eq.11111111-1111-4111-8111-111111111111")) {
        return { ok: true, status: 200, data: null };
      }
      if (method === "POST" && url.includes("/rest/v1/assessment_review_events")) {
        return { ok: true, status: 201, data: null };
      }
      return { ok: false, status: 500, data: null };
    });

    const freshResponse = await assessmentDocumentsExtractionBackgroundHandler(
      new Request("http://localhost/.netlify/functions/assessment-documents-extract-background", {
        method: "POST",
        headers: { Authorization: "Bearer token" },
        body: JSON.stringify({ assessment_document_id: "11111111-1111-4111-8111-111111111111" }),
      }),
    );
    expect(freshResponse.status).toBe(202);
    await expect(freshResponse.json()).resolves.toMatchObject({ skipped: true, status: "extraction_running" });

    const staleResponse = await assessmentDocumentsExtractionBackgroundHandler(
      new Request("http://localhost/.netlify/functions/assessment-documents-extract-background", {
        method: "POST",
        headers: { Authorization: "Bearer token" },
        body: JSON.stringify({ assessment_document_id: "11111111-1111-4111-8111-111111111111" }),
      }),
    );
    expect(staleResponse.status).toBe(202);
    const extractionCalls = vi
      .mocked(fetchJson)
      .mock.calls.filter(([url]) => typeof url === "string" && url.includes("/functions/v1/extract-assessment-fields"));
    expect(extractionCalls).toHaveLength(1);
  });

  it("marks extraction failed when the background worker cannot load the document after enqueue", async () => {
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
    vi.mocked(fetchJson).mockImplementation(async (url: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && url.includes("/rest/v1/assessment_documents?select=id,organization_id,client_id,status,template_type,template_version_id,bucket_id,object_path")) {
        return { ok: false, status: 503, data: null };
      }
      if (
        method === "GET" &&
        url.includes(
          "/rest/v1/assessment_documents?select=status&id=eq.11111111-1111-4111-8111-111111111111&organization_id=eq.org-1&limit=1",
        )
      ) {
        return { ok: true, status: 200, data: [{ status: "extracting" }] };
      }
      if (
        method === "GET" &&
        url.includes("/rest/v1/assessment_documents?select=status&id=eq.11111111-1111-4111-8111-111111111111")
      ) {
        return { ok: true, status: 200, data: [{ status: "extracting" }] };
      }
      if (method === "PATCH" && url.includes("/rest/v1/assessment_documents?id=eq.11111111-1111-4111-8111-111111111111")) {
        return { ok: true, status: 200, data: null };
      }
      if (method === "POST" && url.includes("/rest/v1/assessment_review_events")) {
        return { ok: true, status: 201, data: null };
      }
      return { ok: false, status: 500, data: null };
    });

    const response = await assessmentDocumentsExtractionBackgroundHandler(
      new Request("http://localhost/.netlify/functions/assessment-documents-extract-background", {
        method: "POST",
        headers: { Authorization: "Bearer token" },
        body: JSON.stringify({
          assessment_document_id: "11111111-1111-4111-8111-111111111111",
          client_id: "22222222-2222-4222-8222-222222222222",
        }),
      }),
    );

    expect(response.status).toBe(202);
    expect(fetchJson).toHaveBeenCalledWith(
      expect.stringContaining("/rest/v1/assessment_documents?id=eq.11111111-1111-4111-8111-111111111111"),
      expect.objectContaining({
        method: "PATCH",
        body: expect.stringContaining("\"status\":\"extraction_failed\""),
      }),
    );
    expect(fetchJson).not.toHaveBeenCalledWith(
      expect.stringContaining("/functions/v1/extract-assessment-fields"),
      expect.anything(),
    );
  });

  it("marks extraction failed when the background worker cannot claim the document", async () => {
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
    vi.mocked(fetchJson).mockImplementation(async (url: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      const body = String(init?.body ?? "");
      if (method === "GET" && url.includes("/rest/v1/assessment_documents?select=id,organization_id,client_id,status,template_type,template_version_id,bucket_id,object_path")) {
        return {
          ok: true,
          status: 200,
          data: [
            {
              id: "11111111-1111-4111-8111-111111111111",
              organization_id: "org-1",
              client_id: "22222222-2222-4222-8222-222222222222",
              status: "extracting",
              template_type: "caloptima_fba",
              bucket_id: "client-documents",
              object_path: "clients/22222222-2222-4222-8222-222222222222/assessments/fba.pdf",
              updated_at: "2026-05-15T20:00:00.000Z",
            },
          ],
        };
      }
      if (
        method === "GET" &&
        url.includes(
          "/rest/v1/assessment_documents?select=status&id=eq.11111111-1111-4111-8111-111111111111&organization_id=eq.org-1&limit=1",
        )
      ) {
        return { ok: true, status: 200, data: [{ status: "extracting" }] };
      }
      if (
        method === "GET" &&
        url.includes("/rest/v1/assessment_documents?select=status&id=eq.11111111-1111-4111-8111-111111111111")
      ) {
        return { ok: true, status: 200, data: [{ status: "extracting" }] };
      }
      if (method === "PATCH" && url.includes("status=eq.extracting")) {
        return { ok: false, status: 503, data: null };
      }
      if (
        method === "PATCH" &&
        url.includes("/rest/v1/assessment_documents?id=eq.11111111-1111-4111-8111-111111111111") &&
        body.includes("\"status\":\"extraction_failed\"")
      ) {
        return { ok: true, status: 200, data: null };
      }
      if (method === "POST" && url.includes("/rest/v1/assessment_review_events")) {
        return { ok: true, status: 201, data: null };
      }
      return { ok: false, status: 500, data: null };
    });

    const response = await assessmentDocumentsExtractionBackgroundHandler(
      new Request("http://localhost/.netlify/functions/assessment-documents-extract-background", {
        method: "POST",
        headers: { Authorization: "Bearer token" },
        body: JSON.stringify({ assessment_document_id: "11111111-1111-4111-8111-111111111111" }),
      }),
    );

    expect(response.status).toBe(202);
    expect(fetchJson).not.toHaveBeenCalledWith(
      expect.stringContaining("/functions/v1/extract-assessment-fields"),
      expect.anything(),
    );
    const failedEvent = vi.mocked(fetchJson).mock.calls.find(([url, init]) => {
      const body = String((init as RequestInit | undefined)?.body ?? "");
      return typeof url === "string" && url.includes("/rest/v1/assessment_review_events") && body.includes("extraction_claim_failed");
    });
    expect(failedEvent).toBeDefined();
  });

  it("runs extraction once when duplicate background workers race for the same document", async () => {
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
    let claimAttempts = 0;
    vi.mocked(fetchJson).mockImplementation(async (url: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && url.includes("/rest/v1/assessment_documents?select=id,organization_id,client_id,status,template_type,template_version_id,bucket_id,object_path")) {
        return {
          ok: true,
          status: 200,
          data: [
            {
              id: "11111111-1111-4111-8111-111111111111",
              organization_id: "org-1",
              client_id: "22222222-2222-4222-8222-222222222222",
              status: "extracting",
              template_type: "caloptima_fba",
              bucket_id: "client-documents",
              object_path: "clients/22222222-2222-4222-8222-222222222222/assessments/fba.pdf",
              updated_at: "2026-05-15T20:00:00.000Z",
            },
          ],
        };
      }
      if (method === "PATCH" && url.includes("status=eq.extracting")) {
        claimAttempts += 1;
        return claimAttempts === 1
          ? {
              ok: true,
              status: 200,
              data: [
                {
                  id: "11111111-1111-4111-8111-111111111111",
                  organization_id: "org-1",
                  client_id: "22222222-2222-4222-8222-222222222222",
                  status: "extraction_running",
                  template_type: "caloptima_fba",
                  bucket_id: "client-documents",
                  object_path: "clients/22222222-2222-4222-8222-222222222222/assessments/fba.pdf",
                  updated_at: "2026-05-15T20:00:01.000Z",
                },
              ],
            }
          : { ok: true, status: 200, data: [] };
      }
      if (method === "GET" && url.includes("/rest/v1/clients?select=full_name")) {
        return { ok: true, status: 200, data: [{ full_name: "Client One" }] };
      }
      if (method === "POST" && url.includes("/functions/v1/extract-assessment-fields")) {
        return {
          ok: true,
          status: 200,
          data: {
            fields: [],
            structured_sections: [],
            unresolved_keys: [],
            extracted_count: 0,
            unresolved_count: 0,
          },
        };
      }
      if (method === "PATCH" && url.includes("/rest/v1/assessment_documents?id=eq.11111111-1111-4111-8111-111111111111")) {
        return { ok: true, status: 200, data: null };
      }
      if (method === "POST" && url.includes("/rest/v1/assessment_review_events")) {
        return { ok: true, status: 201, data: null };
      }
      return { ok: false, status: 500, data: null };
    });

    const requests = Array.from({ length: 2 }, () =>
      assessmentDocumentsExtractionBackgroundHandler(
        new Request("http://localhost/.netlify/functions/assessment-documents-extract-background", {
          method: "POST",
          headers: { Authorization: "Bearer token" },
          body: JSON.stringify({ assessment_document_id: "11111111-1111-4111-8111-111111111111" }),
        }),
      ),
    );
    const responses = await Promise.all(requests);

    expect(responses.map((response) => response.status)).toEqual([202, 202]);
    expect(claimAttempts).toBe(2);
    const extractionCalls = vi
      .mocked(fetchJson)
      .mock.calls.filter(([url]) => typeof url === "string" && url.includes("/functions/v1/extract-assessment-fields"));
    expect(extractionCalls).toHaveLength(1);
    const completedEvents = vi.mocked(fetchJson).mock.calls.filter(([url, init]) => {
      const body = String((init as RequestInit | undefined)?.body ?? "");
      return typeof url === "string" && url.includes("/rest/v1/assessment_review_events") && body.includes("extraction_completed");
    });
    expect(completedEvents).toHaveLength(1);
  });

  it("rejects unauthenticated background extraction requests", async () => {
    const response = await assessmentDocumentsExtractionBackgroundHandler(
      new Request("http://localhost/.netlify/functions/assessment-documents-extract-background", {
        method: "POST",
        body: JSON.stringify({ assessment_document_id: "11111111-1111-4111-8111-111111111111" }),
      }),
    );

    expect(response.status).toBe(401);
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("rejects out-of-org background extraction documents", async () => {
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
    vi.mocked(fetchJson).mockResolvedValueOnce({ ok: true, status: 200, data: [] });

    const response = await assessmentDocumentsExtractionBackgroundHandler(
      new Request("http://localhost/.netlify/functions/assessment-documents-extract-background", {
        method: "POST",
        headers: { Authorization: "Bearer token" },
        body: JSON.stringify({ assessment_document_id: "11111111-1111-4111-8111-111111111111" }),
      }),
    );

    expect(response.status).toBe(403);
    expect(fetchJson).toHaveBeenCalledWith(
      expect.stringContaining("organization_id=eq.org-1"),
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("processes IEHP template documents in the background extraction worker", async () => {
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
      if (method === "GET" && url.includes("/rest/v1/assessment_documents?select=id,organization_id,client_id,status,template_type,template_version_id,bucket_id,object_path")) {
        return {
          ok: true,
          status: 200,
          data: [
            {
              id: "11111111-1111-4111-8111-111111111111",
              organization_id: "org-1",
              client_id: "22222222-2222-4222-8222-222222222222",
              status: "extracting",
              template_type: "iehp_fba",
              bucket_id: "client-documents",
              object_path: "clients/22222222-2222-4222-8222-222222222222/assessments/fba.docx",
              updated_at: "2026-05-15T20:00:00.000Z",
            },
          ],
        };
      }
      if (method === "GET" && url.includes("/rest/v1/clients?select=full_name")) {
        return {
          ok: true,
          status: 200,
          data: [{ full_name: "Client One", date_of_birth: "2017-05-01" }],
        };
      }
      if (
        method === "GET" &&
        url.includes(
          "/rest/v1/assessment_documents?select=status&id=eq.11111111-1111-4111-8111-111111111111&organization_id=eq.org-1&limit=1",
        )
      ) {
        return { ok: true, status: 200, data: [{ status: "extracting" }] };
      }
      if (
        method === "GET" &&
        url.includes("/rest/v1/assessment_documents?select=status&id=eq.11111111-1111-4111-8111-111111111111")
      ) {
        return { ok: true, status: 200, data: [{ status: "extracting" }] };
      }
      if (method === "PATCH" && url.includes("/rest/v1/assessment_documents?id=eq.11111111-1111-4111-8111-111111111111")) {
        return {
          ok: true,
          status: 200,
          data: [
            {
              id: "11111111-1111-4111-8111-111111111111",
              organization_id: "org-1",
              client_id: "22222222-2222-4222-8222-222222222222",
              status: "extracting",
              template_type: "iehp_fba",
              bucket_id: "client-documents",
              object_path: "clients/22222222-2222-4222-8222-222222222222/assessments/fba.docx",
              updated_at: "2026-05-15T20:00:00.000Z",
            },
          ],
        };
      }
      if (method === "POST" && url.includes("/functions/v1/extract-assessment-fields")) {
        return { ok: true, status: 200, data: {
          assessment_document_id: "11111111-1111-4111-8111-111111111111",
          template_type: "iehp_fba",
          fields: [],
          unresolved_keys: [],
          extracted_count: 0,
          unresolved_count: 0,
          extraction_provider: "local_docx",
          structured_section_count: 0,
          structured_child_goal_count: 0,
          structured_parent_goal_count: 0,
          adobe_element_count: null,
          adobe_table_count: null,
        } };
      }
      if (method === "PATCH" && url.includes("/rest/v1/assessment_structured_sections")) {
        return { ok: true, status: 200, data: null };
      }
      if (method === "POST" && url.includes("/rest/v1/assessment_review_events")) {
        return { ok: true, status: 201, data: null };
      }
      return { ok: false, status: 500, data: null };
    });

    const response = await assessmentDocumentsExtractionBackgroundHandler(
      new Request("http://localhost/.netlify/functions/assessment-documents-extract-background", {
        method: "POST",
        headers: { Authorization: "Bearer token" },
        body: JSON.stringify({ assessment_document_id: "11111111-1111-4111-8111-111111111111" }),
      }),
    );

    expect(response.status).toBe(202);
    expect(fetchJson).toHaveBeenCalledWith(
      expect.stringContaining("/functions/v1/extract-assessment-fields"),
      expect.objectContaining({ method: "POST" }),
    );
    await expect(response.json()).resolves.toMatchObject({ accepted: true });
  });

  it("skips background extraction for documents no longer in extracting status", async () => {
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
      data: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          organization_id: "org-1",
          client_id: "22222222-2222-4222-8222-222222222222",
          status: "extracted",
          template_type: "caloptima_fba",
          bucket_id: "client-documents",
          object_path: "clients/22222222-2222-4222-8222-222222222222/assessments/fba.pdf",
        },
      ],
    });

    const response = await assessmentDocumentsExtractionBackgroundHandler(
      new Request("http://localhost/.netlify/functions/assessment-documents-extract-background", {
        method: "POST",
        headers: { Authorization: "Bearer token" },
        body: JSON.stringify({ assessment_document_id: "11111111-1111-4111-8111-111111111111" }),
      }),
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({ skipped: true, status: "extracted" });
    expect(fetchJson).not.toHaveBeenCalledWith(
      expect.stringContaining("/functions/v1/extract-assessment-fields"),
      expect.anything(),
    );
  });

  it("allows IEHP document uploads to enter extraction flow", async () => {
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
          object_path: "clients/11111111-1111-1111-1111-111111111111/assessments/iehp-fba.docx",
          template_type: "iehp_fba",
        }),
      }),
    );

    expect(response.status).toBe(201);
    const json = await response.json();
    expect(json).toMatchObject({
      id: "doc-2",
      status: "extracting",
    });
    expect(json.extraction_error).toBeNull();
    expect(loadChecklistTemplateRows).not.toHaveBeenCalled();
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
          object_path: "clients/11111111-1111-1111-1111-111111111111/assessments/fba.pdf",
          template_type: "unknown_template",
        }),
      }),
    );

    expect(response.status).toBe(400);
  });

  it("rejects assessment uploads outside the approved storage bucket", async () => {
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
      if (method === "GET" && url.includes("/rest/v1/clients?select=id")) {
        return { ok: true, status: 200, data: [{ id: "client-1" }] };
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
          bucket_id: "private-documents",
          object_path: "clients/11111111-1111-1111-1111-111111111111/assessments/fba.pdf",
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(fetchJson).not.toHaveBeenCalledWith(
      expect.stringContaining("/rest/v1/assessment_documents"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("rejects assessment uploads outside the canonical client assessment path", async () => {
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
      if (method === "GET" && url.includes("/rest/v1/clients?select=id")) {
        return { ok: true, status: 200, data: [{ id: "client-1" }] };
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
          object_path: "clients/other-client/assessments/fba.pdf",
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(fetchJson).not.toHaveBeenCalledWith(
      expect.stringContaining("/rest/v1/assessment_documents"),
      expect.objectContaining({ method: "POST" }),
    );
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
          object_path: "clients/11111111-1111-1111-1111-111111111111/assessments/fba.pdf",
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

  it("extracts uploaded CalOptima fields without auto-generating drafts or live publish", async () => {
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
      if (
        method === "GET" &&
        url.includes("/rest/v1/assessment_documents?select=status&id=eq.doc-extract-throw")
      ) {
        return { ok: true, status: 200, data: [{ status: "extracting" }] };
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
          object_path: "clients/11111111-1111-1111-1111-111111111111/assessments/fba.pdf",
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
    expect(generationCall).toBeUndefined();
    const stagedGoalCreateCall = vi
      .mocked(fetchJson)
      .mock.calls.find(
        ([url, init]) =>
          typeof url === "string" &&
          url.includes("/rest/v1/assessment_draft_goals") &&
          (init?.method ?? "").toUpperCase() === "POST",
      );
    expect(stagedGoalCreateCall).toBeUndefined();

    const liveProgramWrite = vi
      .mocked(fetchJson)
      .mock.calls.find(([url]) => typeof url === "string" && url.includes("/rest/v1/programs"));
    const liveGoalWrite = vi
      .mocked(fetchJson)
      .mock.calls.find(([url]) => typeof url === "string" && url.includes("/rest/v1/goals"));
    expect(liveProgramWrite).toBeUndefined();
    expect(liveGoalWrite).toBeUndefined();
  });

  it("passes checklist modes and expanded client snapshot into IEHP extraction workflow", async () => {
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
      if (method === "GET" && url.includes("/rest/v1/clients?select=full_name,first_name,last_name")) {
        return {
          ok: true,
          status: 200,
          data: [{
            full_name: "Synthetic Member",
            first_name: "Synthetic",
            last_name: "Member",
            date_of_birth: "2011-04-19",
            preferred_language: "Vietnamese",
            address_line1: "100 Test Ave",
            city: "Riverside",
            state: "CA",
            zip_code: "92503",
          }],
        };
      }
      if (method === "GET" && url.includes("/rest/v1/assessment_template_versions?select=id")) {
        return { ok: true, status: 200, data: [{ id: "template-version-1" }] };
      }
      if (method === "GET" && url.includes("/rest/v1/assessment_template_fields?select=")) {
        return {
          ok: true,
          status: 200,
          data: [{
            section_key: "behavior_background_services",
            field_key: "IEHP_FBA_BHT_AVAILABILITY_GRID",
            label: "BHT Availability Grid",
            field_type: "checkbox_grid",
            mode: "ASSISTED",
            required: true,
            source: "uploaded_assessment_document",
          }],
        };
      }
      if (method === "POST" && url.includes("/rest/v1/assessment_documents")) {
        return {
          ok: true,
          status: 201,
          data: [{ id: "doc-iehp-modes", organization_id: "org-1", client_id: "11111111-1111-1111-1111-111111111111" }],
        };
      }
      if (method === "POST" && url.includes("/rest/v1/assessment_checklist_items")) return { ok: true, status: 201, data: null };
      if (method === "POST" && url.includes("/rest/v1/assessment_extractions")) return { ok: true, status: 201, data: null };
      if (method === "POST" && url.includes("/functions/v1/extract-assessment-fields")) {
        return {
          ok: true,
          status: 200,
          data: {
            fields: [{
              placeholder_key: "IEHP_FBA_BHT_AVAILABILITY_GRID",
              value_text: "1 structured section extracted",
              value_json: { rows: [{ day: "Monday", availability: "After 3:30 PM" }] },
              confidence: 0.74,
              mode: "ASSISTED",
              status: "drafted",
              source_span: { method: "deterministic_structured_section_summary" },
              review_notes: "Structured content requires clinician review.",
            }],
            structured_sections: [],
            unresolved_keys: [],
            extracted_count: 1,
            unresolved_count: 0,
          },
        };
      }
      if (method === "PATCH" && url.includes("/rest/v1/assessment_checklist_items")) return { ok: true, status: 200, data: null };
      if (method === "PATCH" && url.includes("/rest/v1/assessment_extractions")) return { ok: true, status: 200, data: null };
      if (method === "PATCH" && url.includes("/rest/v1/assessment_documents")) return { ok: true, status: 200, data: null };
      if (method === "POST" && url.includes("/rest/v1/assessment_review_events")) return { ok: true, status: 201, data: null };
      return { ok: true, status: 200, data: null };
    });

    const response = await assessmentDocumentsHandler(
      new Request("http://localhost/api/assessment-documents", {
        method: "POST",
        headers: { Authorization: "Bearer token" },
        body: JSON.stringify({
          client_id: "11111111-1111-1111-1111-111111111111",
          file_name: "iehp-fba.docx",
          mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          file_size: 1234,
          object_path: "clients/11111111-1111-1111-1111-111111111111/assessments/iehp-fba.docx",
          template_type: "iehp_fba",
        }),
      }),
    );

    expect(response.status).toBe(201);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const extractionCall = vi.mocked(fetchJson).mock.calls.find(([url, init]) =>
      typeof url === "string" &&
      url.includes("/functions/v1/extract-assessment-fields") &&
      (init?.method ?? "").toUpperCase() === "POST" &&
      typeof init?.body === "string" &&
      init.body.includes("checklist_rows")
    );
    expect(extractionCall).toBeDefined();
    const payload = JSON.parse((extractionCall?.[1] as RequestInit).body as string) as {
      checklist_rows: Array<{ mode?: string }>;
      client_snapshot?: Record<string, unknown>;
      template_type?: string;
    };
    expect(payload.template_type).toBe("iehp_fba");
    expect(payload.checklist_rows[0]?.mode).toBe("ASSISTED");
    expect(payload.client_snapshot).toMatchObject({
      preferred_language: "Vietnamese",
      address_line1: "100 Test Ave",
      city: "Riverside",
    });
    expect(payload.client_snapshot).not.toHaveProperty("insurance_info");
    expect(payload.client_snapshot).not.toHaveProperty("availability_hours");
    expect(payload.client_snapshot).not.toHaveProperty("parent2_first_name");

    const extractionPatch = vi.mocked(fetchJson).mock.calls.find(([url, init]) =>
      typeof url === "string" &&
      url.includes("/rest/v1/assessment_extractions") &&
      (init?.method ?? "").toUpperCase() === "PATCH"
    );
    expect(String((extractionPatch?.[1] as RequestInit).body)).toContain('"mode":"ASSISTED"');
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
      if (
        method === "GET" &&
        url.includes("/rest/v1/assessment_documents?select=status&id=eq.doc-extract-non-ok&organization_id=eq.org-1&limit=1")
      ) {
        return { ok: true, status: 200, data: [{ status: "extracting" }] };
      }
      if (method === "GET" && url.includes("/rest/v1/assessment_documents?select=status&id=eq.doc-extract-non-ok")) {
        return { ok: true, status: 200, data: [{ status: "extracting" }] };
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
        return {
          ok: false,
          status: 502,
          data: { error: "Adobe PDF extraction failed. Review checklist manually." },
        };
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
          object_path: "clients/11111111-1111-1111-1111-111111111111/assessments/fba.pdf",
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
      event_payload: {
        reason_code: "edge_extraction_failed",
        status: 502,
      },
    });
    expect(extractionFailedReviewEventPayload).not.toHaveProperty("notes");
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

  it("marks extraction failed when structured section persistence fails", async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
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
    vi.mocked(loadChecklistTemplateRows).mockReturnValue([
      {
        section: "goals_treatment_planning",
        label: "Skill Acquisition Goal",
        placeholder_key: "CALOPTIMA_FBA_SKILL_ACQUISITION_GOALS",
        mode: "AUTO",
        source: "uploaded_fba",
        required: true,
        extraction_method: "deterministic_extract",
        validation_rule: "non_empty_text",
        status: "not_started",
        extraction_owner: null,
        review_owner: null,
        review_notes: null,
      },
    ]);
    vi.mocked(fetchJson).mockImplementation(async (url: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && url.includes("/rest/v1/clients?select=id")) {
        return { ok: true, status: 200, data: [{ id: "client-1" }] };
      }
      if (
        method === "GET" &&
        url.includes("/rest/v1/assessment_documents?select=status&id=eq.doc-structured-fail&organization_id=eq.org-1&limit=1")
      ) {
        return { ok: true, status: 200, data: [{ status: "extracting" }] };
      }
      if (
        method === "GET" &&
        url.includes("/rest/v1/assessment_documents?select=status&id=eq.doc-structured-fail")
      ) {
        return { ok: true, status: 200, data: [{ status: "extracting" }] };
      }
      if (method === "POST" && url.includes("/rest/v1/assessment_documents")) {
        return {
          ok: true,
          status: 201,
          data: [{ id: "doc-structured-fail", organization_id: "org-1", client_id: "11111111-1111-1111-1111-111111111111" }],
        };
      }
      if (method === "POST" && url.includes("/rest/v1/assessment_checklist_items")) {
        return { ok: true, status: 201, data: null };
      }
      if (method === "POST" && url.includes("/rest/v1/assessment_extractions")) {
        return { ok: true, status: 201, data: null };
      }
      if (method === "GET" && url.includes("/rest/v1/clients?select=full_name")) {
        return { ok: true, status: 200, data: [{ full_name: "Client One" }] };
      }
      if (method === "POST" && url.includes("/functions/v1/extract-assessment-fields")) {
        return {
          ok: true,
          status: 200,
          data: {
            fields: [],
            structured_sections: [
              {
                section_key: "goals_treatment_planning",
                field_key: "CALOPTIMA_FBA_SKILL_ACQUISITION_GOALS",
                section_index: 0,
                payload: { title: "Goal" },
                source_span: null,
                status: "drafted",
                required: true,
                review_notes: null,
              },
            ],
            unresolved_keys: [],
            extracted_count: 0,
            unresolved_count: 0,
          },
        };
      }
      if (method === "POST" && url.includes("/rest/v1/assessment_structured_sections")) {
        return { ok: false, status: 500, data: null };
      }
      if (method === "PATCH" && url.includes("/rest/v1/assessment_documents?id=eq.doc-structured-fail")) {
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
          object_path: "clients/11111111-1111-1111-1111-111111111111/assessments/fba.pdf",
        }),
      }),
    );

    expect(response.status).toBe(201);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const statusPatch = vi.mocked(fetchJson).mock.calls.find(([url, init]) => {
      const body = typeof init?.body === "string" ? init.body : "";
      return typeof url === "string" && url.includes("/rest/v1/assessment_documents?id=eq.doc-structured-fail") && body.includes("extraction_failed");
    });
    expect(statusPatch).toBeDefined();
    const structuredInsert = vi.mocked(fetchJson).mock.calls.find(([url, init]) =>
      typeof url === "string" &&
      url.includes("/rest/v1/assessment_structured_sections") &&
      init?.method === "POST"
    );
    expect(structuredInsert?.[1]?.headers).toMatchObject({
      apikey: "anon",
      Authorization: "Bearer token",
    });
    const successEvent = vi.mocked(fetchJson).mock.calls.find(([url, init]) => {
      const body = typeof init?.body === "string" ? init.body : "";
      return typeof url === "string" && url.includes("/rest/v1/assessment_review_events") && body.includes("extraction_completed");
    });
    expect(successEvent).toBeUndefined();
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
      if (
        method === "GET" &&
        url.includes("/rest/v1/assessment_documents?select=status&id=eq.doc-extract-throw&organization_id=eq.org-1&limit=1")
      ) {
        return { ok: true, status: 200, data: [{ status: "extracting" }] };
      }
      if (method === "GET" && url.includes("/rest/v1/assessment_documents?select=status&id=eq.doc-extract-throw")) {
        return { ok: true, status: 200, data: [{ status: "extracting" }] };
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
          object_path: "clients/11111111-1111-1111-1111-111111111111/assessments/fba.pdf",
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
      event_payload: {
        reason_code: "extraction_workflow_failed",
        status: null,
      },
    });
    expect(extractionFailedReviewEventPayload).not.toHaveProperty("notes");
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

  it("aborts bounded extraction on timeout and does not later mark the document extracted", async () => {
    vi.useFakeTimers();
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
      if (
        method === "GET" &&
        url.includes("/rest/v1/assessment_documents?select=status&id=eq.doc-timeout&organization_id=eq.org-1&limit=1")
      ) {
        return { ok: true, status: 200, data: [{ status: "extracting" }] };
      }
      if (method === "GET" && url.includes("/rest/v1/assessment_documents?select=status&id=eq.doc-timeout")) {
        return { ok: true, status: 200, data: [{ status: "extracting" }] };
      }
      if (method === "POST" && url.includes("/rest/v1/assessment_documents")) {
        return {
          ok: true,
          status: 201,
          data: [{ id: "doc-timeout", organization_id: "org-1", client_id: "11111111-1111-1111-1111-111111111111" }],
        };
      }
      if (method === "POST" && url.includes("/rest/v1/assessment_checklist_items")) {
        return { ok: true, status: 201, data: null };
      }
      if (method === "POST" && url.includes("/rest/v1/assessment_extractions")) {
        return { ok: true, status: 201, data: null };
      }
      if (method === "GET" && url.includes("/rest/v1/clients?select=full_name")) {
        return { ok: true, status: 200, data: [] };
      }
      if (method === "POST" && url.includes("/functions/v1/extract-assessment-fields")) {
        return new Promise((_, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        });
      }
      if (method === "PATCH" && url.includes("/rest/v1/assessment_documents?id=eq.doc-timeout")) {
        return { ok: true, status: 200, data: null };
      }
      if (method === "POST" && url.includes("/rest/v1/assessment_review_events")) {
        return { ok: true, status: 201, data: null };
      }
      return { ok: true, status: 200, data: null };
    });

    const responsePromise = assessmentDocumentsHandler(
      new Request("http://localhost/api/assessment-documents", {
        method: "POST",
        headers: { Authorization: "Bearer token" },
        body: JSON.stringify({
          client_id: "11111111-1111-1111-1111-111111111111",
          file_name: "fba.pdf",
          mime_type: "application/pdf",
          file_size: 1234,
          object_path: "clients/11111111-1111-1111-1111-111111111111/assessments/fba.pdf",
        }),
      }),
    );

    const response = await responsePromise;

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      status: "extracting",
      extraction_error: null,
    });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(55_000);
    const documentStatusBodies = vi
      .mocked(fetchJson)
      .mock.calls.filter(([url]) => typeof url === "string" && url.includes("/rest/v1/assessment_documents?id=eq.doc-timeout"))
      .map(([, init]) => String((init as RequestInit | undefined)?.body ?? ""));
    expect(documentStatusBodies.some((body) => body.includes("\"status\":\"extraction_failed\""))).toBe(true);
    expect(documentStatusBodies.some((body) => body.includes("\"status\":\"extracted\""))).toBe(false);
  });


  it("auto-persists every extracted structured Program and Goal as pending drafts after Adobe extraction", async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
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

    const programNames = Array.from({ length: 7 }, (_, index) => `Program ${index + 1}`);
    const structuredSections = [
      ...Array.from({ length: 21 }, (_, index) => ({
        section_key: "goals_treatment_planning",
        field_key: index % 2 === 0 ? "CALOPTIMA_FBA_SKILL_ACQUISITION_GOALS" : "CALOPTIMA_FBA_TARGET_REPLACEMENT_GOALS",
        section_index: index,
        payload: {
          program_name: programNames[index % programNames.length],
          title: `Child Goal ${index + 1}`,
          description: `Child description ${index + 1}`,
          original_text: `Child original text ${index + 1}`,
          goal_type: "child",
          target_behavior: "Functional communication",
          measurement_type: "Frequency",
          baseline_data: "Baseline",
          target_criteria: "Target",
          mastery_criteria: "Mastery",
          maintenance_criteria: "Maintenance",
          generalization_criteria: "Generalization",
          objective_data_points: [{ metric_name: "independent_response", metric_value: index + 1 }],
          rationale: "Goal rationale",
        },
        source_span: { method: "adobe_pdf_extract", index },
        status: "drafted",
        required: true,
        review_notes: null,
      })),
      ...Array.from({ length: 7 }, (_, index) => ({
        section_key: "goals_treatment_planning",
        field_key: "CALOPTIMA_FBA_PARENT_GOALS",
        section_index: 100 + index,
        payload: {
          program_name: programNames[index],
          title: `Parent Goal ${index + 1}`,
          description: `Parent description ${index + 1}`,
          original_text: `Parent original text ${index + 1}`,
          goal_type: "parent",
          target_behavior: "Caregiver fidelity",
          measurement_type: "Percent fidelity",
          baseline_data: "Baseline",
          target_criteria: "Target",
          mastery_criteria: "Mastery",
          maintenance_criteria: "Maintenance",
          generalization_criteria: "Generalization",
          objective_data_points: [{ metric_name: "fidelity", metric_value: index + 1 }],
          rationale: "Goal rationale",
        },
        source_span: { method: "adobe_pdf_extract", index: 100 + index },
        status: "drafted",
        required: true,
        review_notes: null,
      })),
      {
        section_key: "background_school_history",
        field_key: "CALOPTIMA_FBA_LIVING_ARRANGEMENTS",
        section_index: 0,
        payload: { raw_text: "Client lives with caregivers and siblings." },
        source_span: { method: "deterministic_section_anchor" },
        status: "drafted",
        required: true,
        review_notes: "Deterministic anchored section extracted from CalOptima document text.",
      },
      {
        section_key: "diagnostic_behavior_analysis",
        field_key: "CALOPTIMA_FBA_CRISIS_PLAN",
        section_index: 0,
        payload: { raw_text: "Caregivers will call emergency services for immediate danger." },
        source_span: { method: "deterministic_section_anchor" },
        status: "drafted",
        required: true,
        review_notes: "Deterministic anchored section extracted from CalOptima document text.",
      },
      {
        section_key: "summary_recommendations_signatures",
        field_key: "CALOPTIMA_FBA_HCPCS_RECOMMENDATION_ROWS",
        section_index: 0,
        payload: { rows: [{ hcpcs_code: "H2019", raw_text: "H2019 Therapeutic Behavioral Services 160 units" }] },
        source_span: { method: "deterministic_hcpcs_section", row_count: 1 },
        status: "drafted",
        required: true,
        review_notes: "Deterministic HCPCS recommendation section extracted from CalOptima document text.",
      },
    ];

    vi.mocked(fetchJson).mockImplementation(async (url: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && url.includes("/rest/v1/clients?select=id")) {
        return { ok: true, status: 200, data: [{ id: "client-1" }] };
      }
      if (method === "GET" && url.includes("/rest/v1/clients?select=full_name")) {
        return { ok: true, status: 200, data: [{ full_name: "Client One" }] };
      }
      if (method === "POST" && url.includes("/rest/v1/assessment_documents")) {
        return {
          ok: true,
          status: 201,
          data: [{ id: "doc-full-workflow", organization_id: "org-1", client_id: "11111111-1111-1111-1111-111111111111" }],
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
            extraction_provider: "adobe_pdf_extract",
            adobe_element_count: 250,
            adobe_table_count: 4,
            fields: [],
            structured_sections: structuredSections,
            unresolved_keys: [],
            extracted_count: 0,
            unresolved_count: 0,
          },
        };
      }
      if (method === "POST" && url.includes("/rest/v1/assessment_structured_sections")) {
        return { ok: true, status: 201, data: null };
      }
      if (method === "POST" && url.includes("/rest/v1/assessment_draft_programs")) {
        const body = JSON.parse(String(init?.body)) as Array<{ name: string }>;
        return {
          ok: true,
          status: 201,
          data: body.map((program, index) => ({ id: `draft-program-${index + 1}`, name: program.name })),
        };
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
          object_path: "clients/11111111-1111-1111-1111-111111111111/assessments/fba.pdf",
        }),
      }),
    );

    expect(response.status).toBe(201);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const programCreateCall = vi.mocked(fetchJson).mock.calls.find(([url, init]) =>
      typeof url === "string" &&
      url.includes("/rest/v1/assessment_draft_programs") &&
      (init?.method ?? "").toUpperCase() === "POST"
    );
    const goalCreateCall = vi.mocked(fetchJson).mock.calls.find(([url, init]) =>
      typeof url === "string" &&
      url.includes("/rest/v1/assessment_draft_goals") &&
      (init?.method ?? "").toUpperCase() === "POST"
    );
    expect(programCreateCall).toBeDefined();
    expect(goalCreateCall).toBeDefined();
    const structuredSectionCall = vi.mocked(fetchJson).mock.calls.find(([url, init]) =>
      typeof url === "string" &&
      url.includes("/rest/v1/assessment_structured_sections") &&
      (init?.method ?? "").toUpperCase() === "POST"
    );
    expect(structuredSectionCall).toBeDefined();

    const programPayload = JSON.parse((programCreateCall?.[1] as RequestInit).body as string) as Array<Record<string, unknown>>;
    const goalPayload = JSON.parse((goalCreateCall?.[1] as RequestInit).body as string) as Array<Record<string, unknown>>;
    const structuredPayload = JSON.parse((structuredSectionCall?.[1] as RequestInit).body as string) as Array<Record<string, unknown>>;
    expect(programPayload).toHaveLength(7);
    expect(goalPayload).toHaveLength(28);
    expect(structuredPayload.map((section) => section.field_key)).toEqual(expect.arrayContaining([
      "CALOPTIMA_FBA_LIVING_ARRANGEMENTS",
      "CALOPTIMA_FBA_CRISIS_PLAN",
      "CALOPTIMA_FBA_HCPCS_RECOMMENDATION_ROWS",
    ]));
    expect(structuredPayload.find((section) => section.field_key === "CALOPTIMA_FBA_CRISIS_PLAN")?.payload).toEqual({
      raw_text: "Caregivers will call emergency services for immediate danger.",
    });
    expect(programPayload.every((program) => program.accept_state === "pending")).toBe(true);
    expect(goalPayload.every((goal) => goal.accept_state === "pending")).toBe(true);
    expect(goalPayload.filter((goal) => goal.goal_type === "child")).toHaveLength(21);
    expect(goalPayload.filter((goal) => goal.goal_type === "parent")).toHaveLength(7);
    expect(new Set(goalPayload.map((goal) => goal.draft_program_id)).size).toBe(7);

    const draftedStatusPatchCall = vi.mocked(fetchJson).mock.calls.find(([url, init]) => {
      const body = typeof init?.body === "string" ? init.body : "";
      return typeof url === "string" && url.includes("/rest/v1/assessment_documents?id=eq.doc-full-workflow") && body.includes('"status":"drafted"');
    });
    expect(draftedStatusPatchCall).toBeDefined();

    const draftGeneratedEventCall = vi.mocked(fetchJson).mock.calls.find(([url, init]) => {
      const body = typeof init?.body === "string" ? init.body : "";
      return typeof url === "string" && url.includes("/rest/v1/assessment_review_events") && body.includes('"action":"drafts_generated"');
    });
    const extractionFunctionCall = vi.mocked(fetchJson).mock.calls.find(([url, init]) =>
      typeof url === "string" &&
      url.includes("/functions/v1/extract-assessment-fields") &&
      (init?.method ?? "").toUpperCase() === "POST"
    );
    const extractionSignal = (extractionFunctionCall?.[1] as RequestInit | undefined)?.signal;
    expect(extractionSignal).toBeInstanceOf(AbortSignal);
    const draftPersistenceCalls = [programCreateCall, goalCreateCall, draftedStatusPatchCall, draftGeneratedEventCall];
    const draftPersistenceSignals = draftPersistenceCalls.map((call) => (call?.[1] as RequestInit | undefined)?.signal);
    expect(draftPersistenceSignals.every((signal) => signal === extractionSignal)).toBe(true);
  });

  it("preserves drafted status when extraction completion event recording fails after auto-draft persistence", async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    vi.mocked(getAccessToken).mockReturnValue("token");
    vi.mocked(resolveOrgAndRole).mockResolvedValue({
      organizationId: "org-1",
      isTherapist: true,
      isAdmin: false,
      isSuperAdmin: false,
    });
    vi.mocked(getSupabaseConfig).mockReturnValue({ supabaseUrl: "https://example.supabase.co", anonKey: "anon" });
    vi.mocked(getAccessTokenSubject).mockReturnValue("user-1");
    vi.mocked(loadChecklistTemplateRows).mockResolvedValue([]);

    const structuredSections = [
      {
        section_key: "goals_treatment_planning",
        field_key: "CALOPTIMA_FBA_SKILL_ACQUISITION_GOALS",
        section_index: 0,
        payload: {
          program_name: "Communication Program",
          title: "Child Goal 1",
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
          objective_data_points: [{ metric_name: "independent_response", metric_value: 1 }],
          rationale: "Goal rationale",
        },
        source_span: { method: "adobe_pdf_extract", index: 0 },
        status: "drafted",
        required: true,
        review_notes: null,
      },
    ];

    vi.mocked(fetchJson).mockImplementation(async (url: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && url.includes("/rest/v1/clients?select=id")) return { ok: true, status: 200, data: [{ id: "client-1" }] };
      if (method === "GET" && url.includes("/rest/v1/clients?select=full_name")) return { ok: true, status: 200, data: [] };
      if (method === "POST" && url.includes("/rest/v1/assessment_documents")) {
        return { ok: true, status: 201, data: [{ id: "doc-event-fail", organization_id: "org-1", client_id: "11111111-1111-1111-1111-111111111111" }] };
      }
      if (method === "POST" && url.includes("/rest/v1/assessment_checklist_items")) return { ok: true, status: 201, data: null };
      if (method === "POST" && url.includes("/rest/v1/assessment_extractions")) return { ok: true, status: 201, data: null };
      if (method === "POST" && url.includes("/functions/v1/extract-assessment-fields")) {
        return { ok: true, status: 200, data: { fields: [], structured_sections: structuredSections, unresolved_keys: [], extracted_count: 0, unresolved_count: 0 } };
      }
      if (method === "POST" && url.includes("/rest/v1/assessment_structured_sections")) return { ok: true, status: 201, data: null };
      if (method === "POST" && url.includes("/rest/v1/assessment_draft_programs")) {
        return { ok: true, status: 201, data: [{ id: "draft-program-1", name: "Communication Program" }] };
      }
      if (method === "POST" && url.includes("/rest/v1/assessment_draft_goals")) return { ok: true, status: 201, data: null };
      if (method === "PATCH" && url.includes("/rest/v1/assessment_documents")) return { ok: true, status: 200, data: null };
      if (method === "POST" && url.includes("/rest/v1/assessment_review_events")) {
        const body = typeof init?.body === "string" ? init.body : "";
        if (body.includes('"action":"extraction_completed"')) throw new TypeError("review event network failure");
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
          object_path: "clients/11111111-1111-1111-1111-111111111111/assessments/fba.pdf",
        }),
      }),
    );

    expect(response.status).toBe(201);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const documentStatusBodies = vi
      .mocked(fetchJson)
      .mock.calls.filter(([url]) => typeof url === "string" && url.includes("/rest/v1/assessment_documents?id=eq.doc-event-fail"))
      .map(([, init]) => String((init as RequestInit | undefined)?.body ?? ""));
    expect(documentStatusBodies.some((body) => body.includes('"status":"drafted"'))).toBe(true);
    expect(documentStatusBodies.some((body) => body.includes('"status":"extraction_failed"'))).toBe(false);

    const extractionCompletedEventCalls = vi.mocked(fetchJson).mock.calls.filter(([url, init]) => {
      const body = typeof init?.body === "string" ? init.body : "";
      return typeof url === "string" && url.includes("/rest/v1/assessment_review_events") && body.includes('"action":"extraction_completed"');
    });
    expect(extractionCompletedEventCalls).toHaveLength(1);

    const extractionFailedEventCall = vi.mocked(fetchJson).mock.calls.find(([url, init]) => {
      const body = typeof init?.body === "string" ? init.body : "";
      return typeof url === "string" && url.includes("/rest/v1/assessment_review_events") && body.includes('"action":"extraction_failed"');
    });
    expect(extractionFailedEventCall).toBeUndefined();

    const rollbackCalls = vi.mocked(fetchJson).mock.calls.filter(([url, init]) =>
      typeof url === "string" &&
      (url.includes("/rest/v1/assessment_draft_goals?draft_program_id=in.") ||
        url.includes("/rest/v1/assessment_draft_programs?id=in.")) &&
      (init?.method ?? "").toUpperCase() === "DELETE"
    );
    expect(rollbackCalls).toHaveLength(0);
  });

  it("does not record extraction_completed before deterministic draft persistence succeeds", async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    vi.mocked(getAccessToken).mockReturnValue("token");
    vi.mocked(resolveOrgAndRole).mockResolvedValue({
      organizationId: "org-1",
      isTherapist: true,
      isAdmin: false,
      isSuperAdmin: false,
    });
    vi.mocked(getSupabaseConfig).mockReturnValue({ supabaseUrl: "https://example.supabase.co", anonKey: "anon" });
    vi.mocked(getAccessTokenSubject).mockReturnValue("user-1");
    vi.mocked(loadChecklistTemplateRows).mockResolvedValue([]);

    const structuredSections = [
      {
        section_key: "goals_treatment_planning",
        field_key: "CALOPTIMA_FBA_SKILL_ACQUISITION_GOALS",
        section_index: 0,
        payload: {
          program_name: "Communication Program",
          title: "Child Goal 1",
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
          objective_data_points: [{ metric_name: "independent_response", metric_value: 1 }],
          rationale: "Goal rationale",
        },
        source_span: { method: "adobe_pdf_extract", index: 0 },
        status: "drafted",
        required: true,
        review_notes: null,
      },
    ];

    vi.mocked(fetchJson).mockImplementation(async (url: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && url.includes("/rest/v1/clients?select=id")) {
        return { ok: true, status: 200, data: [{ id: "client-1" }] };
      }
      if (
        method === "GET" &&
        url.includes("/rest/v1/assessment_documents?select=status&id=eq.doc-draft-fail&organization_id=eq.org-1&limit=1")
      ) {
        return { ok: true, status: 200, data: [{ status: "extracting" }] };
      }
      if (
        method === "GET" &&
        url.includes("/rest/v1/assessment_documents?select=status&id=eq.doc-draft-fail")
      ) {
        return { ok: true, status: 200, data: [{ status: "extracting" }] };
      }
      if (method === "GET" && url.includes("/rest/v1/clients?select=full_name")) {
        return { ok: true, status: 200, data: [] };
      }
      if (method === "POST" && url.includes("/rest/v1/assessment_documents")) {
        return { ok: true, status: 201, data: [{ id: "doc-draft-fail", organization_id: "org-1", client_id: "11111111-1111-1111-1111-111111111111" }] };
      }
      if (method === "POST" && url.includes("/rest/v1/assessment_checklist_items")) return { ok: true, status: 201, data: null };
      if (method === "POST" && url.includes("/rest/v1/assessment_extractions")) return { ok: true, status: 201, data: null };
      if (method === "POST" && url.includes("/functions/v1/extract-assessment-fields")) {
        return { ok: true, status: 200, data: { fields: [], structured_sections: structuredSections, unresolved_keys: [], extracted_count: 0, unresolved_count: 0 } };
      }
      if (method === "POST" && url.includes("/rest/v1/assessment_structured_sections")) return { ok: true, status: 201, data: null };
      if (method === "POST" && url.includes("/rest/v1/assessment_draft_programs")) return { ok: false, status: 500, data: null };
      if (method === "PATCH" && url.includes("/rest/v1/assessment_documents")) return { ok: true, status: 200, data: null };
      if (method === "POST" && url.includes("/rest/v1/assessment_review_events")) return { ok: true, status: 201, data: null };
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
          object_path: "clients/11111111-1111-1111-1111-111111111111/assessments/fba.pdf",
        }),
      }),
    );

    expect(response.status).toBe(201);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const extractionCompletedEventCalls = vi.mocked(fetchJson).mock.calls.filter(([url, init]) => {
      const body = typeof init?.body === "string" ? init.body : "";
      return typeof url === "string" && url.includes("/rest/v1/assessment_review_events") && body.includes('"action":"extraction_completed"');
    });
    expect(extractionCompletedEventCalls).toHaveLength(0);

    const draftedPatchCall = vi.mocked(fetchJson).mock.calls.find(([url, init]) => {
      const body = typeof init?.body === "string" ? init.body : "";
      return typeof url === "string" && url.includes("/rest/v1/assessment_documents?id=eq.doc-draft-fail") && body.includes('"status":"drafted"');
    });
    expect(draftedPatchCall).toBeUndefined();

    const failedPatchCall = vi.mocked(fetchJson).mock.calls.find(([url, init]) => {
      const body = typeof init?.body === "string" ? init.body : "";
      return typeof url === "string" && url.includes("/rest/v1/assessment_documents?id=eq.doc-draft-fail") && body.includes('"status":"extraction_failed"');
    });
    expect(failedPatchCall).toBeDefined();
  });

  it("keeps the document extracted and does not run legacy draft generation on extraction completion", async () => {
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
          object_path: "clients/11111111-1111-1111-1111-111111111111/assessments/fba.pdf",
        }),
      }),
    );

    expect(response.status).toBe(201);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchJson).not.toHaveBeenCalledWith(
      expect.stringContaining("/functions/v1/generate-program-goals"),
      expect.anything(),
    );
    expect(fetchJson).not.toHaveBeenCalledWith(
      expect.stringContaining("/rest/v1/assessment_draft_programs"),
      expect.objectContaining({ method: "POST" }),
    );
    const liveProgramWrite = vi
      .mocked(fetchJson)
      .mock.calls.find(([url]) => typeof url === "string" && url.includes("/rest/v1/programs"));
    const liveGoalWrite = vi
      .mocked(fetchJson)
      .mock.calls.find(([url]) => typeof url === "string" && url.includes("/rest/v1/goals"));
    expect(liveProgramWrite).toBeUndefined();
    expect(liveGoalWrite).toBeUndefined();

    const extractedStatusPatchCall = vi
      .mocked(fetchJson)
      .mock.calls.find(([url, init]) => {
        const method = (init?.method ?? "GET").toUpperCase();
        const body = typeof init?.body === "string" ? init.body : "";
        return (
          typeof url === "string" &&
          method === "PATCH" &&
          url.includes("/rest/v1/assessment_documents?id=eq.doc-auto-2") &&
          body.includes("\"status\":\"extracted\"")
        );
      });
    expect(extractedStatusPatchCall).toBeDefined();
    const extractedStatusPatchPayload = JSON.parse(
      ((extractedStatusPatchCall?.[1] as RequestInit).body ?? "{}") as string,
    ) as Record<string, unknown>;
    expect(extractedStatusPatchPayload).toMatchObject({
      status: "extracted",
    });

    const draftGenerationFailedEventCalls = vi
      .mocked(fetchJson)
      .mock.calls.filter(([url, init]) => {
        const method = (init?.method ?? "GET").toUpperCase();
        if (typeof url !== "string" || method !== "POST") return false;
        if (!url.includes("/rest/v1/assessment_review_events")) return false;
        const body = typeof init?.body === "string" ? init.body : "";
        return body.includes("\"action\":\"draft_generation_failed\"");
    });
    expect(draftGenerationFailedEventCalls).toHaveLength(0);
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
              object_path: "clients/11111111-1111-1111-1111-111111111111/assessments/fba.pdf",
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
