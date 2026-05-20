import { beforeEach, describe, expect, it, vi } from "vitest";
import { assessmentTemplateLayoutHandler } from "../api/assessment-template-layout";

vi.mock("../api/shared", async () => {
  const actual = await vi.importActual<typeof import("../api/shared")>("../api/shared");
  return {
    ...actual,
    getAccessToken: vi.fn(),
    resolveOrgAndRole: vi.fn(),
    getSupabaseConfig: vi.fn(),
    fetchJson: vi.fn(),
  };
});

import {
  fetchJson,
  getAccessToken,
  getSupabaseConfig,
  resolveOrgAndRole,
} from "../api/shared";

describe("assessmentTemplateLayoutHandler", () => {
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
  });

  it("returns IEHP layout metadata with scoped checklist and structured values", async () => {
    vi.mocked(fetchJson).mockImplementation(async (url: string) => {
      if (url.includes("/rest/v1/assessment_documents?")) {
        return {
          ok: true,
          status: 200,
          data: [{
            id: "11111111-1111-4111-8111-111111111111",
            organization_id: "org-1",
            client_id: "client-1",
            template_type: "iehp_fba",
            template_version_id: "template-1",
            status: "drafted",
            file_name: "synthetic-iehp.docx",
          }],
        };
      }
      if (url.includes("/rest/v1/assessment_checklist_items?")) {
        return {
          ok: true,
          status: 200,
          data: [{
            id: "item-1",
            placeholder_key: "IEHP_FBA_FIRST_NAME",
            section_key: "identification_admin",
            label: "First Name",
            mode: "AUTO",
            required: true,
            status: "approved",
            value_text: "Synthetic",
            value_json: null,
            review_notes: null,
          }],
        };
      }
      if (url.includes("/rest/v1/assessment_structured_sections?")) {
        return { ok: true, status: 200, data: [] };
      }
      if (url.includes("/rest/v1/assessment_template_versions?")) {
        return {
          ok: true,
          status: 200,
          data: [{
            id: "template-1",
            template_type: "iehp_fba",
            version_key: "iehp_fba_updated_fba_11_2026_05",
            source_document_name: "Updated FBA -IEHP (11).docx",
            page_count: 30,
            source_sha256: "hash",
            status: "active",
          }],
        };
      }
      if (url.includes("/rest/v1/assessment_template_pages?")) {
        return {
          ok: true,
          status: 200,
          data: [
            { id: "page-1", template_version_id: "template-1", page_number: 1, title: "General Information", layout_json: {} },
            { id: "page-30", template_version_id: "template-1", page_number: 30, title: "Signature Block", layout_json: {} },
          ],
        };
      }
      if (url.includes("/rest/v1/assessment_template_fields?")) {
        return {
          ok: true,
          status: 200,
          data: [
            {
              id: "field-1",
              template_version_id: "template-1",
              page_number: 1,
              section_key: "identification_admin",
              field_key: "IEHP_FBA_FIRST_NAME",
              label: "First Name",
              field_type: "text",
              mode: "AUTO",
              required: true,
              source: "clients.first_name",
              layout_json: {},
            },
          ],
        };
      }
      return { ok: false, status: 500, data: null };
    });

    const response = await assessmentTemplateLayoutHandler(
      new Request("http://localhost/api/assessment-template-layout?assessment_document_id=11111111-1111-4111-8111-111111111111", {
        headers: { Authorization: "Bearer token" },
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.template_version.version_key).toBe("iehp_fba_updated_fba_11_2026_05");
    expect(body.pages).toHaveLength(2);
    expect(body.fields[0].field_key).toBe("IEHP_FBA_FIRST_NAME");
    expect(body.values.checklist_items[0].value_text).toBe("Synthetic");
    expect(body.unresolved_required_count).toBe(0);
  });

  it("rejects non-IEHP documents", async () => {
    vi.mocked(fetchJson).mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: [{
        id: "11111111-1111-4111-8111-111111111111",
        organization_id: "org-1",
        client_id: "client-1",
        template_type: "caloptima_fba",
        status: "drafted",
        file_name: "caloptima.pdf",
      }],
    });

    const response = await assessmentTemplateLayoutHandler(
      new Request("http://localhost/api/assessment-template-layout?assessment_document_id=11111111-1111-4111-8111-111111111111", {
        headers: { Authorization: "Bearer token" },
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Template layout review is currently available only for IEHP FBA documents.",
    });
  });

  it("denies layout access when the assessment document is outside the caller organization", async () => {
    vi.mocked(fetchJson).mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: [],
    });

    const response = await assessmentTemplateLayoutHandler(
      new Request("http://localhost/api/assessment-template-layout?assessment_document_id=11111111-1111-4111-8111-111111111111", {
        headers: { Authorization: "Bearer token" },
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "assessment_document_id is not in scope for this organization",
    });
  });

  it("resolves legacy IEHP documents without a linked version to the seeded manifest version key", async () => {
    const seenUrls: string[] = [];
    vi.mocked(fetchJson).mockImplementation(async (url: string) => {
      seenUrls.push(url);
      if (url.includes("/rest/v1/assessment_documents?")) {
        return {
          ok: true,
          status: 200,
          data: [{
            id: "11111111-1111-4111-8111-111111111111",
            organization_id: "org-1",
            client_id: "client-1",
            template_type: "iehp_fba",
            template_version_id: null,
            status: "drafted",
            file_name: "legacy-iehp.docx",
          }],
        };
      }
      if (url.includes("/rest/v1/assessment_checklist_items?")) {
        return { ok: true, status: 200, data: [] };
      }
      if (url.includes("/rest/v1/assessment_structured_sections?")) {
        return { ok: true, status: 200, data: [] };
      }
      if (url.includes("/rest/v1/assessment_template_versions?")) {
        return {
          ok: true,
          status: 200,
          data: [{
            id: "template-1",
            template_type: "iehp_fba",
            version_key: "iehp_fba_updated_fba_11_2026_05",
            source_document_name: "Updated FBA -IEHP (11).docx",
            page_count: 30,
            source_sha256: "hash",
            status: "active",
          }],
        };
      }
      if (url.includes("/rest/v1/assessment_template_pages?")) {
        return {
          ok: true,
          status: 200,
          data: [{ id: "page-1", template_version_id: "template-1", page_number: 1, title: "General Information", layout_json: {} }],
        };
      }
      if (url.includes("/rest/v1/assessment_template_fields?")) {
        return {
          ok: true,
          status: 200,
          data: [{
            id: "field-1",
            template_version_id: "template-1",
            page_number: 1,
            section_key: "identification_admin",
            field_key: "IEHP_FBA_FIRST_NAME",
            label: "First Name",
            field_type: "text",
            mode: "AUTO",
            required: true,
            source: "clients.first_name",
            layout_json: {},
          }],
        };
      }
      return { ok: false, status: 500, data: null };
    });

    const response = await assessmentTemplateLayoutHandler(
      new Request("http://localhost/api/assessment-template-layout?assessment_document_id=11111111-1111-4111-8111-111111111111", {
        headers: { Authorization: "Bearer token" },
      }),
    );

    expect(response.status).toBe(200);
    expect(seenUrls.some((url) => url.includes("version_key=eq.iehp_fba_updated_fba_11_2026_05"))).toBe(true);
    expect(seenUrls.some((url) => url.includes("status=eq.active"))).toBe(false);
  });

  it("fails closed when a pinned IEHP template version has no page metadata", async () => {
    vi.mocked(fetchJson).mockImplementation(async (url: string) => {
      if (url.includes("/rest/v1/assessment_documents?")) {
        return {
          ok: true,
          status: 200,
          data: [{
            id: "11111111-1111-4111-8111-111111111111",
            organization_id: "org-1",
            client_id: "client-1",
            template_type: "iehp_fba",
            template_version_id: "template-1",
            status: "drafted",
            file_name: "synthetic-iehp.docx",
          }],
        };
      }
      if (url.includes("/rest/v1/assessment_checklist_items?")) {
        return { ok: true, status: 200, data: [] };
      }
      if (url.includes("/rest/v1/assessment_structured_sections?")) {
        return { ok: true, status: 200, data: [] };
      }
      if (url.includes("/rest/v1/assessment_template_versions?")) {
        return {
          ok: true,
          status: 200,
          data: [{
            id: "template-1",
            template_type: "iehp_fba",
            version_key: "iehp_fba_updated_fba_11_2026_05",
            source_document_name: "Updated FBA -IEHP (11).docx",
            page_count: 30,
            source_sha256: "hash",
            status: "active",
          }],
        };
      }
      if (url.includes("/rest/v1/assessment_template_pages?")) {
        return { ok: true, status: 200, data: [] };
      }
      if (url.includes("/rest/v1/assessment_template_fields?")) {
        return {
          ok: true,
          status: 200,
          data: [{
            id: "field-1",
            template_version_id: "template-1",
            page_number: 1,
            section_key: "identification_admin",
            field_key: "IEHP_FBA_FIRST_NAME",
            label: "First Name",
            field_type: "text",
            mode: "AUTO",
            required: true,
            source: "clients.first_name",
            layout_json: {},
          }],
        };
      }
      return { ok: false, status: 500, data: null };
    });

    const response = await assessmentTemplateLayoutHandler(
      new Request("http://localhost/api/assessment-template-layout?assessment_document_id=11111111-1111-4111-8111-111111111111", {
        headers: { Authorization: "Bearer token" },
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "IEHP template layout metadata is incomplete for this document version.",
    });
  });

  it("fails closed when a legacy IEHP document cannot resolve the seeded template version", async () => {
    vi.mocked(fetchJson).mockImplementation(async (url: string) => {
      if (url.includes("/rest/v1/assessment_documents?")) {
        return {
          ok: true,
          status: 200,
          data: [{
            id: "11111111-1111-4111-8111-111111111111",
            organization_id: "org-1",
            client_id: "client-1",
            template_type: "iehp_fba",
            template_version_id: null,
            status: "drafted",
            file_name: "legacy-iehp.docx",
          }],
        };
      }
      if (url.includes("/rest/v1/assessment_checklist_items?")) {
        return { ok: true, status: 200, data: [] };
      }
      if (url.includes("/rest/v1/assessment_structured_sections?")) {
        return { ok: true, status: 200, data: [] };
      }
      if (url.includes("/rest/v1/assessment_template_versions?")) {
        return { ok: true, status: 200, data: [] };
      }
      return { ok: false, status: 500, data: null };
    });

    const response = await assessmentTemplateLayoutHandler(
      new Request("http://localhost/api/assessment-template-layout?assessment_document_id=11111111-1111-4111-8111-111111111111", {
        headers: { Authorization: "Bearer token" },
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Seeded IEHP template version metadata is unavailable.",
    });
  });
});
