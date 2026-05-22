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

  it("renders next-slice IEHP fields and page-aware structured goals on expected pages", async () => {
    vi.mocked(callApi).mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.startsWith("/api/assessment-template-layout?")) {
        return new Response(JSON.stringify({
          template_version: {
            version_key: "iehp_fba_updated_fba_11_2026_05",
            source_document_name: "Updated FBA -IEHP (11).docx",
            page_count: 30,
          },
          pages: [
            { page_number: 16, title: "School Goals", layout_json: {} },
            { page_number: 17, title: "Parent Education Goals", layout_json: {} },
            { page_number: 24, title: "Recommendation Notes", layout_json: {} },
            { page_number: 25, title: "Caregiver Participation", layout_json: {} },
            { page_number: 26, title: "Treatment Plan Review", layout_json: {} },
            { page_number: 27, title: "Additional Notes", layout_json: {} },
            { page_number: 28, title: "Appendix and Supporting Information", layout_json: {} },
          ],
          fields: [
            {
              page_number: 24,
              section_key: "treatment_coordination_recommendations",
              field_key: "IEHP_FBA_RECOMMENDATION_NOTES",
              label: "Recommendation Notes",
              field_type: "textarea",
              mode: "MANUAL",
              required: false,
              source: "clinician_manual_entry when template page is used",
              layout_json: {},
            },
            {
              page_number: 25,
              section_key: "treatment_coordination_recommendations",
              field_key: "IEHP_FBA_CAREGIVER_PARTICIPATION",
              label: "Caregiver Participation",
              field_type: "textarea",
              mode: "MANUAL",
              required: false,
              source: "clinician_manual_entry when template page is used",
              layout_json: {},
            },
            {
              page_number: 26,
              section_key: "treatment_coordination_recommendations",
              field_key: "IEHP_FBA_TREATMENT_PLAN_REVIEW",
              label: "Treatment Plan Review",
              field_type: "textarea",
              mode: "MANUAL",
              required: false,
              source: "clinician_manual_entry when template page is used",
              layout_json: {},
            },
            {
              page_number: 27,
              section_key: "treatment_coordination_recommendations",
              field_key: "IEHP_FBA_ADDITIONAL_NOTES",
              label: "Additional Notes",
              field_type: "textarea",
              mode: "MANUAL",
              required: false,
              source: "clinician_manual_entry when template page is used",
              layout_json: {},
            },
            {
              page_number: 28,
              section_key: "treatment_coordination_recommendations",
              field_key: "IEHP_FBA_APPENDIX_SUPPORTING_INFORMATION",
              label: "Appendix and Supporting Information",
              field_type: "textarea",
              mode: "MANUAL",
              required: false,
              source: "clinician_manual_entry when template page is used",
              layout_json: {},
            },
          ],
          values: {
            checklist_items: [
              {
                id: "item-24",
                placeholder_key: "IEHP_FBA_RECOMMENDATION_NOTES",
                section_key: "treatment_coordination_recommendations",
                label: "Recommendation Notes",
                mode: "MANUAL",
                required: false,
                status: "not_started",
                value_text: null,
                value_json: null,
                review_notes: null,
              },
              {
                id: "item-25",
                placeholder_key: "IEHP_FBA_CAREGIVER_PARTICIPATION",
                section_key: "treatment_coordination_recommendations",
                label: "Caregiver Participation",
                mode: "MANUAL",
                required: false,
                status: "not_started",
                value_text: null,
                value_json: null,
                review_notes: null,
              },
              {
                id: "item-26",
                placeholder_key: "IEHP_FBA_TREATMENT_PLAN_REVIEW",
                section_key: "treatment_coordination_recommendations",
                label: "Treatment Plan Review",
                mode: "MANUAL",
                required: false,
                status: "not_started",
                value_text: null,
                value_json: null,
                review_notes: null,
              },
              {
                id: "item-27",
                placeholder_key: "IEHP_FBA_ADDITIONAL_NOTES",
                section_key: "treatment_coordination_recommendations",
                label: "Additional Notes",
                mode: "MANUAL",
                required: false,
                status: "not_started",
                value_text: null,
                value_json: null,
                review_notes: null,
              },
              {
                id: "item-28",
                placeholder_key: "IEHP_FBA_APPENDIX_SUPPORTING_INFORMATION",
                section_key: "treatment_coordination_recommendations",
                label: "Appendix and Supporting Information",
                mode: "MANUAL",
                required: false,
                status: "not_started",
                value_text: null,
                value_json: null,
                review_notes: null,
              },
            ],
            structured_sections: [
              {
                id: "33333333-3333-4333-8333-333333333333",
                field_key: "IEHP_FBA_SKILL_AND_SCHOOL_GOAL_BLOCKS",
                section_index: 0,
                payload: { raw_text: "School goal narrative" },
                source_span: { page_number: 16 },
                status: "drafted",
                required: true,
                review_notes: null,
              },
              {
                id: "44444444-4444-4444-8444-444444444444",
                field_key: "IEHP_FBA_SKILL_AND_SCHOOL_GOAL_BLOCKS",
                section_index: 1,
                payload: { raw_text: "Parent education goal narrative" },
                source_span: { page_number: 17 },
                status: "drafted",
                required: true,
                review_notes: null,
              },
            ],
          },
          unresolved_required_count: 2,
          extracted_value_count: 0,
        }), { status: 200 });
      }
      if (path === "/api/assessment-checklist" && (init?.method ?? "").toUpperCase() === "PATCH") {
        return new Response(JSON.stringify({ id: "33333333-3333-4333-8333-333333333333", status: "verified" }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "unexpected request" }), { status: 500 });
    });

    renderWithProviders(
      <IehpFbaLayoutReview assessmentDocument={assessmentDocument} organizationId="org-1" />,
    );

    fireEvent.click(await screen.findByRole("button", { name: /Page 16/i }));
    expect(await screen.findByText("Page 16: School Goals")).toBeInTheDocument();
    expect(screen.getByText(/School goal narrative/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("IEHP_FBA_SKILL_AND_SCHOOL_GOAL_BLOCKS structured section 1 status"), {
      target: { value: "verified" },
    });
    screen.getByRole("button", { name: "Save section" }).click();
    await waitFor(() => {
      expect(callApi).toHaveBeenCalledWith(
        "/api/assessment-checklist",
        expect.objectContaining({
          method: "PATCH",
          body: expect.stringContaining("\"structured_section_id\":\"33333333-3333-4333-8333-333333333333\""),
        }),
      );
      expect(callApi).toHaveBeenCalledWith(
        "/api/assessment-checklist",
        expect.objectContaining({
          method: "PATCH",
          body: expect.stringContaining("\"status\":\"verified\""),
        }),
      );
    });

    fireEvent.click(screen.getByRole("button", { name: /Page 17/i }));
    expect(await screen.findByText("Page 17: Parent Education Goals")).toBeInTheDocument();
    expect(screen.getByText(/Parent education goal narrative/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Page 24/i }));
    expect(await screen.findByLabelText("Recommendation Notes")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Page 25/i }));
    expect(await screen.findByLabelText("Caregiver Participation")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Page 26/i }));
    expect(await screen.findByLabelText("Treatment Plan Review")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Page 27/i }));
    expect(await screen.findByLabelText("Additional Notes")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Page 28/i }));
    expect(await screen.findByLabelText("Appendix and Supporting Information")).toBeInTheDocument();
    expect(screen.queryByText(/CalOptima/i)).not.toBeInTheDocument();
  });

  it("renders a school-goals empty state on page 16 when no school goal sections were extracted", async () => {
    vi.mocked(callApi).mockImplementation(async (path: string) => {
      if (path.startsWith("/api/assessment-template-layout?")) {
        return new Response(JSON.stringify({
          template_version: {
            version_key: "iehp_fba_updated_fba_11_2026_05",
            source_document_name: "Updated FBA -IEHP (11).docx",
            page_count: 30,
          },
          pages: [{ page_number: 16, title: "School Goals", layout_json: {} }],
          fields: [],
          values: {
            checklist_items: [],
            structured_sections: [],
          },
          unresolved_required_count: 0,
          extracted_value_count: 0,
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "unexpected request" }), { status: 500 });
    });

    renderWithProviders(
      <IehpFbaLayoutReview assessmentDocument={assessmentDocument} organizationId="org-1" />,
    );

    fireEvent.click(await screen.findByRole("button", { name: /Page 16/i }));
    expect(await screen.findByText("Page 16: School Goals")).toBeInTheDocument();
    expect(screen.getByText("No school-specific goals were extracted for this IEHP document.")).toBeInTheDocument();
    expect(screen.queryByText(/CalOptima/i)).not.toBeInTheDocument();
  });

  it("labels unresolved required manual IEHP rows as manual-required review items", async () => {
    vi.mocked(callApi).mockImplementation(async (path: string) => {
      if (path.startsWith("/api/assessment-template-layout?")) {
        return new Response(JSON.stringify({
          template_version: {
            version_key: "iehp_fba_updated_fba_11_2026_05",
            source_document_name: "Updated FBA -IEHP (11).docx",
            page_count: 30,
          },
          pages: [{ page_number: 2, title: "Referral Information", layout_json: {} }],
          fields: [
            {
              page_number: 2,
              section_key: "identification_admin",
              field_key: "IEHP_FBA_REFERRING_PROVIDER",
              label: "Name of Referring Provider, Credentials",
              field_type: "textarea",
              mode: "MANUAL",
              required: true,
              source: "clinician_manual_entry unless present in uploaded document",
              layout_json: {},
            },
            {
              page_number: 2,
              section_key: "identification_admin",
              field_key: "IEHP_FBA_REASON_FOR_REFERRAL",
              label: "Reason for Referral",
              field_type: "textarea",
              mode: "MANUAL",
              required: true,
              source: "clinician_manual_entry unless present in uploaded document",
              layout_json: {},
            },
            {
              page_number: 2,
              section_key: "identification_admin",
              field_key: "IEHP_FBA_MISSING_MANUAL_FIELD",
              label: "Missing Manual Field",
              field_type: "textarea",
              mode: "MANUAL",
              required: true,
              source: "clinician_manual_entry",
              layout_json: {},
            },
          ],
          values: {
            checklist_items: [
              {
                id: "item-referring-provider",
                placeholder_key: "IEHP_FBA_REFERRING_PROVIDER",
                section_key: "identification_admin",
                label: "Name of Referring Provider, Credentials",
                mode: "MANUAL",
                required: true,
                status: "not_started",
                value_text: null,
                value_json: null,
                review_notes: null,
              },
              {
                id: "item-reason",
                placeholder_key: "IEHP_FBA_REASON_FOR_REFERRAL",
                section_key: "identification_admin",
                label: "Reason for Referral",
                mode: "MANUAL",
                required: true,
                status: "verified",
                value_text: "Reviewed referral reason",
                value_json: null,
                review_notes: null,
              },
            ],
            structured_sections: [],
          },
          unresolved_required_count: 1,
          extracted_value_count: 0,
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "unexpected request" }), { status: 500 });
    });

    renderWithProviders(
      <IehpFbaLayoutReview assessmentDocument={assessmentDocument} organizationId="org-1" />,
    );

    fireEvent.click(await screen.findByRole("button", { name: /Page 2/i }));
    expect(await screen.findByLabelText("Name of Referring Provider, Credentials")).toBeInTheDocument();
    expect(screen.getByText("manual required")).toBeInTheDocument();
    expect(screen.getByText(/This required IEHP field is intentionally manual/)).toBeInTheDocument();
    expect(screen.getByLabelText("Reason for Referral")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Reviewed referral reason")).toBeInTheDocument();
    expect(screen.getByLabelText("Missing Manual Field")).toBeDisabled();
    expect(screen.getByText("missing row")).toBeInTheDocument();
    expect(screen.getAllByText("manual required")).toHaveLength(1);
  });
});
