import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, renderWithProviders, screen, waitFor } from "../../test/utils";
import { callApi } from "../../lib/api";
import { IehpFbaLayoutReview } from "../ClientDetails/IehpFbaLayoutReview";
import type { AssessmentDocumentRecord } from "../../lib/assessment-documents";

vi.mock("../../lib/api", () => ({
  callApi: vi.fn(),
}));

vi.mock("../../lib/toast", () => ({
  showError: vi.fn(),
  showSuccess: vi.fn(),
}));

const assessmentDocument: AssessmentDocumentRecord = {
  id: "11111111-1111-4111-8111-111111111111",
  organization_id: "org-1",
  client_id: "client-1",
  template_type: "iehp_fba",
  template_version_id: "template-1",
  file_name: "synthetic-iehp.docx",
  mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  file_size: 1234,
  bucket_id: "client-documents",
  object_path: "clients/client-1/assessments/synthetic-iehp.docx",
  status: "drafted",
  created_at: "2026-05-20T00:00:00.000Z",
};

describe("IehpFbaLayoutReview", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("renders IEHP page layout metadata without CalOptima copy and saves checklist values", async () => {
    vi.mocked(callApi).mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.startsWith("/api/assessment-template-layout?")) {
        return new Response(JSON.stringify({
          template_version: {
            version_key: "iehp_fba_updated_fba_11_2026_05",
            source_document_name: "Updated FBA -IEHP (11).docx",
            page_count: 30,
          },
          pages: [
            { page_number: 1, title: "General Information", layout_json: {} },
            { page_number: 30, title: "Signature Block", layout_json: {} },
          ],
          fields: [
            {
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
            {
              page_number: 30,
              section_key: "treatment_coordination_recommendations",
              field_key: "IEHP_FBA_SIGNATURE_BLOCK",
              label: "Signature Block",
              field_type: "signature",
              mode: "ASSISTED",
              required: true,
              source: "uploaded_assessment_document",
              layout_json: {},
            },
          ],
          values: {
            checklist_items: [
              {
                id: "item-1",
                placeholder_key: "IEHP_FBA_FIRST_NAME",
                section_key: "identification_admin",
                label: "First Name",
                mode: "AUTO",
                required: true,
                status: "drafted",
                value_text: "Synthetic",
                value_json: null,
                review_notes: null,
              },
              {
                id: "item-2",
                placeholder_key: "IEHP_FBA_SIGNATURE_BLOCK",
                section_key: "treatment_coordination_recommendations",
                label: "Signature Block",
                mode: "ASSISTED",
                required: true,
                status: "not_started",
                value_text: null,
                value_json: null,
                review_notes: null,
              },
            ],
            structured_sections: [
              {
                id: "22222222-2222-4222-8222-222222222222",
                field_key: "IEHP_FBA_SIGNATURE_BLOCK",
                section_index: 0,
                payload: { completed_by: "Jane Clinician" },
                status: "drafted",
                required: true,
                review_notes: null,
              },
            ],
          },
          unresolved_required_count: 2,
          extracted_value_count: 1,
        }), { status: 200 });
      }
      if (path === "/api/assessment-checklist" && (init?.method ?? "").toUpperCase() === "PATCH") {
        return new Response(JSON.stringify({ id: "item-1", status: "verified" }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "unexpected request" }), { status: 500 });
    });

    renderWithProviders(
      <IehpFbaLayoutReview assessmentDocument={assessmentDocument} organizationId="org-1" />,
    );

    expect(await screen.findByText("IEHP FBA document-style review")).toBeInTheDocument();
    expect(screen.getByText("Page 1: General Information")).toBeInTheDocument();
    expect(screen.queryByText(/CalOptima/i)).not.toBeInTheDocument();

    await screen.findByLabelText("First Name");
    screen.getByRole("button", { name: "Save" }).click();

    await waitFor(() => {
      expect(callApi).toHaveBeenCalledWith(
        "/api/assessment-checklist",
        expect.objectContaining({
          method: "PATCH",
          body: expect.stringContaining("\"item_id\":\"item-1\""),
        }),
      );
    });
  });

  it("saves required IEHP structured sections so reviewers can clear publish blockers", async () => {
    vi.mocked(callApi).mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.startsWith("/api/assessment-template-layout?")) {
        return new Response(JSON.stringify({
          template_version: {
            version_key: "iehp_fba_updated_fba_11_2026_05",
            source_document_name: "Updated FBA -IEHP (11).docx",
            page_count: 30,
          },
          pages: [{ page_number: 30, title: "Signature Block", layout_json: {} }],
          fields: [
            {
              page_number: 30,
              section_key: "treatment_coordination_recommendations",
              field_key: "IEHP_FBA_SIGNATURE_BLOCK",
              label: "Signature Block",
              field_type: "signature",
              mode: "ASSISTED",
              required: true,
              source: "uploaded_assessment_document",
              layout_json: {},
            },
          ],
          values: {
            checklist_items: [
              {
                id: "item-2",
                placeholder_key: "IEHP_FBA_SIGNATURE_BLOCK",
                section_key: "treatment_coordination_recommendations",
                label: "Signature Block",
                mode: "ASSISTED",
                required: true,
                status: "drafted",
                value_text: "Signature summary",
                value_json: null,
                review_notes: null,
              },
            ],
            structured_sections: [
              {
                id: "22222222-2222-4222-8222-222222222222",
                field_key: "IEHP_FBA_SIGNATURE_BLOCK",
                section_index: 0,
                payload: { completed_by: "Jane Clinician" },
                status: "drafted",
                required: true,
                review_notes: null,
              },
            ],
          },
          unresolved_required_count: 2,
          extracted_value_count: 1,
        }), { status: 200 });
      }
      if (path === "/api/assessment-checklist" && (init?.method ?? "").toUpperCase() === "PATCH") {
        return new Response(JSON.stringify({ id: "22222222-2222-4222-8222-222222222222", status: "approved" }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "unexpected request" }), { status: 500 });
    });

    renderWithProviders(
      <IehpFbaLayoutReview assessmentDocument={assessmentDocument} organizationId="org-1" />,
    );

    fireEvent.click(await screen.findByRole("button", { name: /Page 30/i }));
    const status = await screen.findByLabelText("Signature Block structured section 1 status");
    fireEvent.change(status, { target: { value: "approved" } });
    screen.getByRole("button", { name: "Save section" }).click();

    await waitFor(() => {
      expect(callApi).toHaveBeenCalledWith(
        "/api/assessment-checklist",
        expect.objectContaining({
          method: "PATCH",
          body: expect.stringContaining("\"structured_section_id\":\"22222222-2222-4222-8222-222222222222\""),
        }),
      );
      expect(callApi).toHaveBeenCalledWith(
        "/api/assessment-checklist",
        expect.objectContaining({
          method: "PATCH",
          body: expect.stringContaining("\"status\":\"approved\""),
        }),
      );
    });
  });
});
