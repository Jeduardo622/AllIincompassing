import { beforeEach, describe, expect, it, vi } from "vitest";
import { assessmentPlanPdfHandler } from "../api/assessment-plan-pdf";

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
}));

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

vi.mock("../assessmentPlanPdf", () => ({
  loadCalOptimaPdfRenderMap: vi.fn(),
  buildCalOptimaTemplatePayload: vi.fn(),
}));

vi.mock("../iehpAssessmentDocx", () => ({
  buildIehpDocxPayload: vi.fn(),
}));

import { readFile } from "node:fs/promises";
import { fetchJson, getAccessToken, getAccessTokenSubject, getSupabaseConfig, resolveOrgAndRole } from "../api/shared";
import { buildCalOptimaTemplatePayload, loadCalOptimaPdfRenderMap } from "../assessmentPlanPdf";
import { buildIehpDocxPayload } from "../iehpAssessmentDocx";

describe("assessmentPlanPdfHandler", () => {
  beforeEach(() => {
    vi.resetAllMocks();
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
    vi.mocked(readFile).mockResolvedValue(Buffer.from("fake-pdf"));
    vi.mocked(loadCalOptimaPdfRenderMap).mockResolvedValue([
      {
        placeholder_key: "CALOPTIMA_FBA_MEMBER_NAME",
        form_field_candidates: ["Member Name"],
        fallback: { page: 1, x: 10, y: 10, font_size: 10, max_width: 100, height: 14, line_height: 12, max_lines: 1 },
      },
    ]);
  });

  it("blocks generation when required checklist items are not approved", async () => {
    vi.mocked(fetchJson)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: [
          {
            id: "doc-1",
            organization_id: "org-1",
            client_id: "client-1",
            status: "uploaded",
            template_type: "caloptima_fba",
          },
        ],
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: [
          {
            placeholder_key: "CALOPTIMA_FBA_MEMBER_NAME",
            required: true,
            status: "drafted",
            value_text: null,
            value_json: null,
          },
        ],
      })
      .mockResolvedValueOnce({ ok: true, status: 200, data: [] })
      .mockResolvedValueOnce({ ok: true, status: 200, data: [] })
      .mockResolvedValueOnce({ ok: true, status: 200, data: [] })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: [{ full_name: "Client One" }],
      });

    const response = await assessmentPlanPdfHandler(
      new Request("http://localhost/api/assessment-plan-pdf", {
        method: "POST",
        headers: { Authorization: "Bearer token" },
        body: JSON.stringify({ assessment_document_id: "11111111-1111-1111-1111-111111111111" }),
      }),
    );

    expect(response.status).toBe(409);
    expect(buildCalOptimaTemplatePayload).not.toHaveBeenCalled();
  });

  it("generates plan PDF and returns download metadata", async () => {
    vi.mocked(buildCalOptimaTemplatePayload).mockResolvedValue({
      values: { CALOPTIMA_FBA_MEMBER_NAME: "Client One" },
      missing_required_keys: [],
    });

    vi.mocked(fetchJson)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: [
          {
            id: "doc-1",
            organization_id: "org-1",
            client_id: "client-1",
            status: "drafted",
            template_type: "caloptima_fba",
          },
        ],
      })
      .mockResolvedValueOnce({ ok: true, status: 200, data: [] })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: [
          {
            placeholder_key: "CALOPTIMA_FBA_MEMBER_NAME",
            required: true,
            status: "approved",
            value_text: "Client One",
            value_json: null,
          },
        ],
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: [{ id: "draft-program-1", name: "Program A", description: "Desc", accept_state: "accepted" }],
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: [{ id: "goal-1", title: "Goal A", description: "Desc", original_text: "Original", accept_state: "accepted" }],
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: [{ full_name: "Client One" }],
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: [{ full_name: "Therapist One", title: "BCBA" }],
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: {
          fill_mode: "overlay",
          bucket_id: "client-documents",
          object_path: "clients/client-1/assessments/generated.pdf",
          signed_url: "https://example.com/generated.pdf",
          layout_warnings: [
            {
              placeholder_key: "CALOPTIMA_FBA_CHIEF_COMPLAINT",
              page: 2,
              reason: "overflow",
              rendered_line_count: 3,
              total_line_count: 5,
              max_lines: 3,
            },
          ],
          overflow_keys: ["CALOPTIMA_FBA_CHIEF_COMPLAINT"],
          filled_pages: [2],
        },
      })
      .mockResolvedValueOnce({ ok: true, status: 201, data: null });

    const response = await assessmentPlanPdfHandler(
      new Request("http://localhost/api/assessment-plan-pdf", {
        method: "POST",
        headers: { Authorization: "Bearer token" },
        body: JSON.stringify({ assessment_document_id: "11111111-1111-1111-1111-111111111111" }),
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.signed_url).toBe("https://example.com/generated.pdf");
    expect(body.fill_mode).toBe("overlay");
    expect(body.overflow_keys).toEqual(["CALOPTIMA_FBA_CHIEF_COMPLAINT"]);
    expect(body.layout_warnings).toHaveLength(1);
    expect(body.filled_pages).toEqual([2]);
    expect(fetchJson).toHaveBeenLastCalledWith(
      "https://example.supabase.co/rest/v1/assessment_review_events",
      expect.objectContaining({
        body: expect.stringContaining("layout_warning_count"),
      }),
    );
  });

  it("derives filled_pages when an older edge function omits them", async () => {
    vi.mocked(buildCalOptimaTemplatePayload).mockResolvedValue({
      values: { CALOPTIMA_FBA_MEMBER_NAME: "Client One" },
      missing_required_keys: [],
    });

    vi.mocked(fetchJson)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: [
          {
            id: "doc-1",
            organization_id: "org-1",
            client_id: "client-1",
            status: "drafted",
            template_type: "caloptima_fba",
          },
        ],
      })
      .mockResolvedValueOnce({ ok: true, status: 200, data: [] })
      .mockResolvedValueOnce({ ok: true, status: 200, data: [] })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: [{ id: "draft-program-1", name: "Program A", description: "Desc", accept_state: "accepted" }],
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: [{ id: "goal-1", title: "Goal A", description: "Desc", original_text: "Original", accept_state: "accepted" }],
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: [{ full_name: "Client One" }],
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: [{ full_name: "Therapist One", title: "BCBA" }],
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: {
          fill_mode: "overlay",
          bucket_id: "client-documents",
          object_path: "clients/client-1/assessments/generated.pdf",
          signed_url: "https://example.com/generated.pdf",
          layout_warnings: [],
          overflow_keys: [],
        },
      })
      .mockResolvedValueOnce({ ok: true, status: 201, data: null });

    const response = await assessmentPlanPdfHandler(
      new Request("http://localhost/api/assessment-plan-pdf", {
        method: "POST",
        headers: { Authorization: "Bearer token" },
        body: JSON.stringify({ assessment_document_id: "11111111-1111-1111-1111-111111111111" }),
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.filled_pages).toEqual([1]);
  });

  it("preserves explicit edge filled_pages even when the array is empty", async () => {
    vi.mocked(buildCalOptimaTemplatePayload).mockResolvedValue({
      values: { CALOPTIMA_FBA_MEMBER_NAME: "Client One" },
      missing_required_keys: [],
    });

    vi.mocked(fetchJson)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: [
          {
            id: "doc-1",
            organization_id: "org-1",
            client_id: "client-1",
            status: "drafted",
            template_type: "caloptima_fba",
          },
        ],
      })
      .mockResolvedValueOnce({ ok: true, status: 200, data: [] })
      .mockResolvedValueOnce({ ok: true, status: 200, data: [] })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: [{ id: "draft-program-1", name: "Program A", description: "Desc", accept_state: "accepted" }],
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: [{ id: "goal-1", title: "Goal A", description: "Desc", original_text: "Original", accept_state: "accepted" }],
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: [{ full_name: "Client One" }],
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: [{ full_name: "Therapist One", title: "BCBA" }],
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: {
          fill_mode: "overlay",
          bucket_id: "client-documents",
          object_path: "clients/client-1/assessments/generated.pdf",
          signed_url: "https://example.com/generated.pdf",
          layout_warnings: [],
          overflow_keys: [],
          filled_pages: [],
        },
      })
      .mockResolvedValueOnce({ ok: true, status: 201, data: null });

    const response = await assessmentPlanPdfHandler(
      new Request("http://localhost/api/assessment-plan-pdf", {
        method: "POST",
        headers: { Authorization: "Bearer token" },
        body: JSON.stringify({ assessment_document_id: "11111111-1111-1111-1111-111111111111" }),
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.filled_pages).toEqual([]);
  });

  it("returns IEHP preflight blockers without calling the DOCX generator", async () => {
    vi.mocked(buildIehpDocxPayload).mockReturnValue({
      values: {},
      preflight: {
        ready: false,
        blockers: [
          { code: "unapproved_required_checklist", key: "IEHP_FBA_REASON_FOR_REFERRAL", message: "Required field is not approved." },
          { code: "pending_draft_goals", count: 1, message: "Draft goals are still pending review." },
        ],
        warnings: [],
      },
    });

    vi.mocked(fetchJson)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: [
          {
            id: "11111111-1111-1111-1111-111111111111",
            organization_id: "org-1",
            client_id: "client-1",
            status: "drafted",
            template_type: "iehp_fba",
            template_version_id: "template-1",
          },
        ],
      })
      .mockResolvedValueOnce({ ok: true, status: 200, data: [] })
      .mockResolvedValueOnce({ ok: true, status: 200, data: [] })
      .mockResolvedValueOnce({ ok: true, status: 200, data: [{ id: "program-1", name: "Program", description: null, accept_state: "accepted" }] })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: [{ id: "goal-1", title: "Goal", description: "Desc", original_text: "Original", goal_type: "child", accept_state: "pending" }],
      })
      .mockResolvedValueOnce({ ok: true, status: 200, data: [{ full_name: "Client One" }] })
      .mockResolvedValueOnce({ ok: true, status: 200, data: [{ full_name: "Therapist One", title: "BCBA" }] })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: [{ field_key: "IEHP_FBA_REASON_FOR_REFERRAL", required: true }],
      })
      .mockResolvedValueOnce({ ok: true, status: 200, data: [] });

    const response = await assessmentPlanPdfHandler(
      new Request("http://localhost/api/assessment-plan-pdf", {
        method: "POST",
        headers: { Authorization: "Bearer token" },
        body: JSON.stringify({
          assessment_document_id: "11111111-1111-1111-1111-111111111111",
          preflight_only: true,
        }),
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.generated_file_type).toBe("docx");
    expect(body.preflight.ready).toBe(false);
    expect(body.preflight.blockers).toHaveLength(2);
    expect(fetchJson).not.toHaveBeenCalledWith(
      "https://example.supabase.co/functions/v1/generate-assessment-plan-docx",
      expect.anything(),
    );
  });

  it("generates IEHP DOCX, returns download metadata, and records a generation event", async () => {
    vi.mocked(buildIehpDocxPayload).mockReturnValue({
      values: {
        IEHP_FBA_FIRST_NAME: "Client",
        IEHP_FBA_LAST_NAME: "One",
      },
      preflight: {
        ready: true,
        blockers: [],
        warnings: [],
      },
    });

    vi.mocked(fetchJson)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: [
          {
            id: "11111111-1111-1111-1111-111111111111",
            organization_id: "org-1",
            client_id: "client-1",
            status: "drafted",
            template_type: "iehp_fba",
            template_version_id: "template-1",
          },
        ],
      })
      .mockResolvedValueOnce({ ok: true, status: 200, data: [] })
      .mockResolvedValueOnce({ ok: true, status: 200, data: [] })
      .mockResolvedValueOnce({ ok: true, status: 200, data: [{ id: "program-1", name: "Program", description: null, accept_state: "accepted" }] })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: [
          {
            id: "goal-1",
            title: "Child goal",
            description: "Desc",
            original_text: "Original",
            goal_type: "child",
            accept_state: "accepted",
          },
          {
            id: "goal-2",
            title: "Parent goal",
            description: "Desc",
            original_text: "Original",
            goal_type: "parent",
            accept_state: "edited",
          },
        ],
      })
      .mockResolvedValueOnce({ ok: true, status: 200, data: [{ full_name: "Client One" }] })
      .mockResolvedValueOnce({ ok: true, status: 200, data: [{ full_name: "Therapist One", title: "BCBA" }] })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: [
          { field_key: "IEHP_FBA_FIRST_NAME", required: true, layout_json: { table_index: 0, row: 0, column: 1 } },
          { field_key: "IEHP_FBA_LAST_NAME", required: true, layout_json: { table_index: 0, row: 0, column: 3 } },
        ],
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: [
          { member_id: "OTHER-MEMBER-111", insurance_provider: { name: "Other Payer" } },
          { member_id: "AUTH-MEMBER-999", insurance_provider: { name: "Inland Empire Health Plan" } },
        ],
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: {
          bucket_id: "client-documents",
          object_path: "clients/client-1/assessments/generated-iehp-fba-11111111-1111-1111-1111-111111111111-1778712054626.docx",
          signed_url: "https://example.com/generated.docx",
          filename: "generated-iehp-fba-11111111-1111-1111-1111-111111111111-1778712054626.docx",
          content_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          unresolved_placeholder_count: 0,
        },
      })
      .mockResolvedValueOnce({ ok: true, status: 201, data: null });

    const response = await assessmentPlanPdfHandler(
      new Request("http://localhost/api/assessment-plan-pdf", {
        method: "POST",
        headers: { Authorization: "Bearer token" },
        body: JSON.stringify({ assessment_document_id: "11111111-1111-1111-1111-111111111111" }),
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.generated_file_type).toBe("docx");
    expect(body.content_type).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(body.signed_url).toBe("https://example.com/generated.docx");
    expect(fetchJson).toHaveBeenCalledWith(
      "https://example.supabase.co/functions/v1/generate-assessment-plan-docx",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"field_layouts"'),
      }),
    );
    expect(buildIehpDocxPayload).toHaveBeenCalledWith(
      expect.objectContaining({
        authorizationMemberId: "AUTH-MEMBER-999",
      }),
    );
    expect(fetchJson).toHaveBeenLastCalledWith(
      "https://example.supabase.co/rest/v1/assessment_review_events",
      expect.objectContaining({
        body: expect.stringContaining('"action":"plan_docx_generated"'),
      }),
    );
  });
});
