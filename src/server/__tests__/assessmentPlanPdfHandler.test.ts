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

import { readFile } from "node:fs/promises";
import { fetchJson, getAccessToken, getAccessTokenSubject, getSupabaseConfig, resolveOrgAndRole } from "../api/shared";
import { buildCalOptimaTemplatePayload, loadCalOptimaPdfRenderMap } from "../assessmentPlanPdf";

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
        fallback: { page: 1, x: 10, y: 10, font_size: 10, max_width: 100 },
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
  });
});
