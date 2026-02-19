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

  it("returns 401 when authorization is missing", async () => {
    const response = await assessmentDocumentsHandler(
      new Request("http://localhost/api/assessment-documents?client_id=11111111-1111-1111-1111-111111111111"),
    );
    expect(response.status).toBe(401);
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

    vi.mocked(fetchJson)
      .mockResolvedValueOnce({ ok: true, status: 200, data: [{ id: "client-1" }] })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        data: [{ id: "doc-1", organization_id: "org-1", client_id: "11111111-1111-1111-1111-111111111111" }],
      })
      .mockResolvedValueOnce({ ok: true, status: 201, data: null })
      .mockResolvedValueOnce({ ok: true, status: 201, data: null })
      .mockResolvedValueOnce({ ok: true, status: 201, data: null });

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

    vi.mocked(fetchJson)
      .mockResolvedValueOnce({ ok: true, status: 200, data: [{ id: "client-1" }] })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        data: [{ id: "doc-2", organization_id: "org-1", client_id: "11111111-1111-1111-1111-111111111111" }],
      })
      .mockResolvedValueOnce({ ok: true, status: 201, data: null })
      .mockResolvedValueOnce({ ok: true, status: 201, data: null })
      .mockResolvedValueOnce({ ok: true, status: 201, data: null });

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
});
