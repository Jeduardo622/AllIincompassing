import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, renderWithProviders, screen, waitFor, within } from "../../test/utils";
import { callApi, callEdgeFunctionHttp } from "../../lib/api";
import { __TESTING__, IehpFbaLayoutReview } from "../ClientDetails/IehpFbaLayoutReview";
import type { AssessmentDocumentRecord } from "../../lib/assessment-documents";

vi.mock("../../lib/api", () => ({
  callApi: vi.fn(),
  callEdgeFunctionHttp: vi.fn(),
}));

vi.mock("../../lib/toast", () => ({
  showError: vi.fn(),
  showSuccess: vi.fn(),
}));

describe("IEHP skills and behaviors payload validation", () => {
  it("rejects unsupported reconciliation payload versions", () => {
    expect(__TESTING__.skillsBehaviorsPreviewItemsFromPayload({
      skills_behaviors: {
        version: 2,
        items: [
          {
            name: "Synthetic Skill",
            clinical_goal_type: "skill",
            reconciliation_status: "matched",
          },
        ],
      },
    })).toBe("invalid");
  });
});

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

const assessmentChecklistPatchBodies = () =>
  vi.mocked(callApi).mock.calls
    .filter(([path, init]) => path === "/api/assessment-checklist" && ((init as RequestInit | undefined)?.method ?? "").toUpperCase() === "PATCH")
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>);

describe("IehpFbaLayoutReview", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  it("preserves the existing IEHP review and hides the ledger panel when runtime mode is disabled", async () => {
    vi.mocked(callApi).mockImplementation(async (path: string) => {
      if (path.startsWith("/api/assessment-template-layout?")) {
        return new Response(JSON.stringify({
          template_version: {
            version_key: "iehp_fba_updated_fba_11_2026_05",
            source_document_name: "Updated FBA -IEHP (11).docx",
            page_count: 30,
          },
          pages: [{ page_number: 1, title: "General Information", layout_json: {} }],
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
    vi.mocked(callEdgeFunctionHttp).mockResolvedValue(
      new Response(
        JSON.stringify({
          success: false,
          error: "Runtime mode disabled",
          code: "runtime_mode_disabled",
        }),
        { status: 403 },
      ),
    );

    renderWithProviders(
      <IehpFbaLayoutReview assessmentDocument={assessmentDocument} organizationId="org-1" />,
    );

    expect(await screen.findByText("IEHP FBA document-style review")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText("Advisory work ledger")).not.toBeInTheDocument();
    });
  });

  it("preserves the existing IEHP review when the advisory ledger API is unavailable", async () => {
    vi.mocked(callApi).mockResolvedValue(
      new Response(JSON.stringify({
        template_version: {
          version_key: "iehp_fba_updated_fba_11_2026_05",
          source_document_name: "Updated FBA -IEHP (11).docx",
          page_count: 30,
        },
        pages: [{ page_number: 1, title: "General Information", layout_json: {} }],
        fields: [],
        values: {
          checklist_items: [],
          structured_sections: [],
        },
        unresolved_required_count: 0,
        extracted_value_count: 0,
      }), { status: 200 }),
    );
    vi.mocked(callEdgeFunctionHttp).mockRejectedValue(new TypeError("local edge unavailable"));

    renderWithProviders(
      <IehpFbaLayoutReview assessmentDocument={assessmentDocument} organizationId="org-1" />,
    );

    expect(await screen.findByText(/Advisory work ledger is currently unavailable/i)).toBeInTheDocument();
    expect(screen.getByText("IEHP FBA document-style review")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "IEHP FBA page navigation" })).toBeInTheDocument();
  });

  it("renders the advisory work ledger above the existing IEHP review when read-only data is available", async () => {
    vi.mocked(callApi).mockImplementation(async (path: string) => {
      if (path.startsWith("/api/assessment-template-layout?")) {
        return new Response(JSON.stringify({
          template_version: {
            version_key: "iehp_fba_updated_fba_11_2026_05",
            source_document_name: "Updated FBA -IEHP (11).docx",
            page_count: 30,
          },
          pages: [{ page_number: 1, title: "General Information", layout_json: {} }],
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
    vi.mocked(callEdgeFunctionHttp).mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: [
            {
              id: "55555555-5555-4555-8555-555555555555",
              workflowKey: "assessment.iehp.prepare_for_clinical_review",
              workflowVersion: 1,
              objective: "Prepare this assessment for clinical review",
              status: "waiting",
              risk: "clinical",
              ownerUserId: "11111111-1111-4111-8111-111111111111",
              dueAt: null,
              blockers: [
                {
                  code: "missing_required_evidence",
                  stepKey: "request_clinical_review",
                  action: "resolve_required_evidence",
                },
              ],
              steps: [
                {
                  id: "66666666-6666-4666-8666-666666666666",
                  key: "await_extraction",
                  status: "waiting",
                  executionMode: "deterministic",
                  evidenceCount: 2,
                  lastReasonCode: "waiting_for_extraction",
                },
              ],
              approvals: [],
              updatedAt: "2026-08-02T12:00:00.000Z",
            },
          ],
          meta: { runtimeMode: "advisory" },
        }),
        { status: 200 },
      ),
    );

    renderWithProviders(
      <IehpFbaLayoutReview assessmentDocument={assessmentDocument} organizationId="org-1" />,
    );

    expect(await screen.findByText("Prepare this assessment for clinical review")).toBeInTheDocument();
    expect(screen.getByText("Advisory work ledger")).toBeInTheDocument();
    expect(screen.getByText("IEHP FBA document-style review")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open current IEHP review section/i })).toHaveAttribute(
      "href",
      "#iehp-current-review-section",
    );
    expect(document.querySelector("#iehp-current-review-section")).toBeInTheDocument();
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

    await screen.findByText("First Name");
    expect(screen.queryByLabelText("First Name")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Expand First Name" }));
    await screen.findByLabelText("First Name");
    screen.getByRole("button", { name: "Save field" }).click();

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

  it("shows final-output optional IEHP fields as optional even when template metadata is required", async () => {
    vi.mocked(callApi).mockImplementation(async (path: string) => {
      if (path.startsWith("/api/assessment-template-layout?")) {
        return new Response(JSON.stringify({
          template_version: {
            version_key: "iehp_fba_updated_fba_11_2026_05",
            source_document_name: "Updated FBA -IEHP (11).docx",
            page_count: 30,
          },
          pages: [{ page_number: 1, title: "General Information", layout_json: {} }],
          fields: [
            {
              page_number: 1,
              section_key: "identification_admin",
              field_key: "IEHP_FBA_ASSESSOR_PHONE",
              label: "Assessor's phone number",
              field_type: "text",
              mode: "ASSISTED",
              required: true,
              source: "therapists.phone || company_settings.phone",
              layout_json: {},
            },
          ],
          values: {
            checklist_items: [
              {
                id: "assessor-phone-item",
                placeholder_key: "IEHP_FBA_ASSESSOR_PHONE",
                section_key: "identification_admin",
                label: "Assessor's phone number",
                mode: "ASSISTED",
                required: true,
                status: "verified",
                value_text: "",
                value_json: null,
                review_notes: "No extracted field value was found in the source document.",
              },
            ],
            structured_sections: [
              {
                id: "assessor-phone-section",
                field_key: "IEHP_FBA_ASSESSOR_PHONE",
                section_index: 0,
                payload: {
                  label: "Assessor's phone number",
                  raw_text: "No extracted field value was found in the source document.",
                },
                status: "drafted",
                required: true,
                review_notes: "Template field preserved as optional for final export.",
              },
            ],
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

    const card = await screen.findByTestId("review-attention-target-field-IEHP_FBA_ASSESSOR_PHONE");
    expect(within(card).getByText("Optional")).toBeInTheDocument();
    expect(within(card).queryByText("Required")).not.toBeInTheDocument();
    expect(within(card).getByText(/Optional for final IEHP DOCX export/)).toBeInTheDocument();
    expect(within(card).queryByText("Manual review required")).not.toBeInTheDocument();
    expect(screen.getByText("No fields need attention")).toBeInTheDocument();
    expect(card).not.toHaveClass("ring-2");

    fireEvent.click(within(card).getByRole("button", { name: "Expand Assessor's phone number" }));

    await waitFor(() => {
      expect(
        within(card).getAllByText(/required for final DOCX: false \(template metadata: true\)/),
      ).toHaveLength(2);
    });
    expect(
      within(card).getByText((content) =>
        content.includes("Section 1") && content.includes("required for final DOCX: false")
      ),
    ).toBeInTheDocument();
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
    fireEvent.click(await screen.findByRole("button", { name: "Expand Signature Block" }));
    const status = await screen.findByLabelText("Signature Block structured section 1 status");
    fireEvent.change(status, { target: { value: "approved" } });
    screen.getByRole("button", { name: "Save extracted section" }).click();

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
    expect(screen.getAllByText(/School goal narrative/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Expand IEHP_FBA_SKILL_AND_SCHOOL_GOAL_BLOCKS section 1" }));
    fireEvent.change(screen.getByLabelText("IEHP_FBA_SKILL_AND_SCHOOL_GOAL_BLOCKS structured section 1 status"), {
      target: { value: "verified" },
    });
    screen.getByRole("button", { name: "Save extracted section" }).click();
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
    expect(screen.getAllByText(/Parent education goal narrative/).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: /Page 24/i }));
    expect((await screen.findAllByText("Recommendation Notes")).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Expand Recommendation Notes" }));
    expect(await screen.findByLabelText("Recommendation Notes")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Page 25/i }));
    expect((await screen.findAllByText("Caregiver Participation")).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /Page 26/i }));
    expect((await screen.findAllByText("Treatment Plan Review")).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /Page 27/i }));
    expect((await screen.findAllByText("Additional Notes")).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /Page 28/i }));
    expect((await screen.findAllByText("Appendix and Supporting Information")).length).toBeGreaterThan(0);
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
          pages: [
            { page_number: 1, title: "General Information", layout_json: {} },
            { page_number: 2, title: "Referral Information", layout_json: {} },
          ],
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
            {
              page_number: 2,
              section_key: "identification_admin",
              field_key: "IEHP_FBA_VERIFIED_UNANCHORED_SECTION",
              label: "Verified Field with Unanchored Section",
              field_type: "textarea",
              mode: "ASSISTED",
              required: true,
              source: "uploaded_assessment_document",
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
              {
                id: "item-verified-unanchored-section",
                placeholder_key: "IEHP_FBA_VERIFIED_UNANCHORED_SECTION",
                section_key: "identification_admin",
                label: "Verified Field with Unanchored Section",
                mode: "ASSISTED",
                required: true,
                status: "verified",
                value_text: "Checklist field is reviewed, but structured extraction still needs attention.",
                value_json: null,
                review_notes: null,
              },
            ],
            structured_sections: [
              {
                id: "verified-unanchored-structured",
                field_key: "IEHP_FBA_VERIFIED_UNANCHORED_SECTION",
                section_index: 0,
                payload: { raw_text: "Needs staff review from unanchored extraction." },
                status: "not_started",
                required: true,
                review_notes: null,
              },
            ],
          },
          unresolved_required_count: 1,
          extracted_value_count: 0,
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "unexpected request" }), { status: 500 });
    });

    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });

    renderWithProviders(
      <IehpFbaLayoutReview assessmentDocument={assessmentDocument} organizationId="org-1" />,
    );

    expect(await screen.findByText("Page 1 review summary")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Jump to next page needing attention" }));
    expect(await screen.findByText("Page 2 review summary")).toBeInTheDocument();
    const pageSummary = screen.getByText("Page 2 review summary").closest("div")?.parentElement?.parentElement;
    expect(pageSummary).not.toBeNull();
    expect(within(pageSummary as HTMLElement).getByText("Needs attention")).toBeInTheDocument();
    expect(within(pageSummary as HTMLElement).getByText("2")).toBeInTheDocument();
    expect(within(pageSummary as HTMLElement).getByText(/4 rows on this page/)).toBeInTheDocument();
    expect(within(pageSummary as HTMLElement).getByText("In draft / review")).toBeInTheDocument();
    const attentionTarget = await screen.findByTestId("review-attention-target-field-IEHP_FBA_MISSING_MANUAL_FIELD");
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith({ block: "center", behavior: "smooth" }));
    expect(document.activeElement).toBe(attentionTarget);
    expect(attentionTarget).toHaveClass("ring-2");
    expect(await screen.findByText("Missing Manual Field")).toBeInTheDocument();
    expect(screen.getAllByText("Manual review required").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/This required IEHP field is intentionally manual/).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Approve Missing Manual Field" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Review Missing Manual Field" }));
    expect(await screen.findByLabelText("Missing Manual Field")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /Page 1/i }));
    expect(await screen.findByText("Reason for Referral")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Expand Reason for Referral" }));
    expect(await screen.findByLabelText("Reason for Referral")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Reviewed referral reason")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Page 2/i }));
    expect(screen.getAllByText("Not started").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Manual review required")).toHaveLength(1);
  });

  it("renders mapped fields as collapsed triage cards and quick-approves the field with attached structured sections", async () => {
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
                id: "item-signature",
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
                id: "signature-structured-1",
                field_key: "IEHP_FBA_SIGNATURE_BLOCK",
                section_index: 0,
                payload: { completed_by: "Jane Clinician" },
                status: "drafted",
                required: true,
                review_notes: "review note",
              },
            ],
          },
          unresolved_required_count: 1,
          extracted_value_count: 1,
        }), { status: 200 });
      }
      if (path === "/api/assessment-checklist" && (init?.method ?? "").toUpperCase() === "PATCH") {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "unexpected request" }), { status: 500 });
    });

    renderWithProviders(
      <IehpFbaLayoutReview assessmentDocument={assessmentDocument} organizationId="org-1" />,
    );

    expect((await screen.findAllByText("Signature Block")).length).toBeGreaterThan(0);
    expect(screen.getByText("Signature summary")).toBeInTheDocument();
    expect(screen.getByText("1 extracted section")).toBeInTheDocument();
    expect(screen.queryByLabelText("Signature Block")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Signature Block structured section 1 payload")).not.toBeInTheDocument();
    expect(screen.queryByText(/IEHP_FBA_SIGNATURE_BLOCK/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Approve Signature Block" }));

    await waitFor(() => {
      const patchBodies = assessmentChecklistPatchBodies();
      expect(patchBodies).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ item_id: "item-signature", status: "approved", value_text: "Signature summary" }),
          expect.objectContaining({
            structured_section_id: "signature-structured-1",
            status: "approved",
            review_notes: "review note",
            payload: { completed_by: "Jane Clinician" },
          }),
        ]),
      );
    });
  });

  it("lets reviewers mark extracted fields as needing review from the collapsed triage card", async () => {
    vi.mocked(callApi).mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.startsWith("/api/assessment-template-layout?")) {
        return new Response(JSON.stringify({
          template_version: {
            version_key: "iehp_fba_updated_fba_11_2026_05",
            source_document_name: "Updated FBA -IEHP (11).docx",
            page_count: 30,
          },
          pages: [{ page_number: 5, title: "Current Services", layout_json: {} }],
          fields: [
            {
              page_number: 5,
              section_key: "behavior_background_services",
              field_key: "IEHP_FBA_CURRENT_SERVICES_ACTIVITIES",
              label: "Current Services and Activities",
              field_type: "repeatable_table",
              mode: "ASSISTED",
              required: true,
              source: "uploaded_assessment_document",
              layout_json: {},
            },
          ],
          values: {
            checklist_items: [
              {
                id: "item-current-services",
                placeholder_key: "IEHP_FBA_CURRENT_SERVICES_ACTIVITIES",
                section_key: "behavior_background_services",
                label: "Current Services and Activities",
                mode: "ASSISTED",
                required: true,
                status: "verified",
                value_text: "Current services extracted wording.",
                value_json: null,
                review_notes: null,
              },
            ],
            structured_sections: [],
          },
          unresolved_required_count: 0,
          extracted_value_count: 1,
        }), { status: 200 });
      }
      if (path === "/api/assessment-checklist" && (init?.method ?? "").toUpperCase() === "PATCH") {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "unexpected request" }), { status: 500 });
    });

    renderWithProviders(
      <IehpFbaLayoutReview assessmentDocument={assessmentDocument} organizationId="org-1" />,
    );

    expect((await screen.findAllByText("Current Services and Activities")).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Needs review Current Services and Activities" }));

    await waitFor(() => {
      expect(assessmentChecklistPatchBodies()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            item_id: "item-current-services",
            status: "verified",
            value_text: "Current services extracted wording.",
          }),
        ]),
      );
    });
  });

  it("marks loose structured sections as rejected when reviewers flag them for review", async () => {
    vi.mocked(callApi).mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.startsWith("/api/assessment-template-layout?")) {
        return new Response(JSON.stringify({
          template_version: {
            version_key: "iehp_fba_updated_fba_11_2026_05",
            source_document_name: "Updated FBA -IEHP (11).docx",
            page_count: 30,
          },
          pages: [{ page_number: 5, title: "Current Services", layout_json: {} }],
          fields: [],
          values: {
            checklist_items: [],
            structured_sections: [
              {
                id: "current-services-structured-1",
                field_key: "IEHP_FBA_CURRENT_SERVICES_ACTIVITIES",
                section_index: 0,
                payload: {
                  label: "Current Services and Activities",
                  raw_text: "Current services extracted wording.",
                },
                source_span: { page_number: 5, method: "iehp_section_anchor" },
                status: "verified",
                required: true,
                review_notes: "keep this note",
              },
            ],
          },
          unresolved_required_count: 0,
          extracted_value_count: 1,
        }), { status: 200 });
      }
      if (path === "/api/assessment-checklist" && (init?.method ?? "").toUpperCase() === "PATCH") {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "unexpected request" }), { status: 500 });
    });

    renderWithProviders(
      <IehpFbaLayoutReview assessmentDocument={assessmentDocument} organizationId="org-1" />,
    );

    fireEvent.click(await screen.findByRole("button", { name: /Page 5/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Needs review Current Services and Activities" }));

    await waitFor(() => {
      expect(assessmentChecklistPatchBodies()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            structured_section_id: "current-services-structured-1",
            status: "rejected",
            review_notes: "keep this note",
            payload: {
              label: "Current Services and Activities",
              raw_text: "Current services extracted wording.",
            },
          }),
        ]),
      );
    });
  });

  it("renders reconciled skills and behaviors", async () => {
    vi.mocked(callApi).mockImplementation(async (path: string) => {
      if (path.startsWith("/api/assessment-template-layout?")) {
        return new Response(JSON.stringify({
          template_version: {
            version_key: "iehp_fba_updated_fba_11_2026_05",
            source_document_name: "Updated FBA -IEHP (11).docx",
            page_count: 30,
          },
          pages: [{ page_number: 3, title: "Behaviors", layout_json: {} }],
          fields: [
            {
              page_number: 3,
              section_key: "behavior_background_services",
              field_key: "IEHP_FBA_BEHAVIOR_SKILL_TARGETS",
              label: "Behaviors and Functional Skills to be Addressed",
              field_type: "checkbox_grid",
              mode: "ASSISTED",
              required: true,
              source: "uploaded_assessment_document",
              layout_json: {},
            },
          ],
          values: {
            checklist_items: [
              {
                id: "item-behavior",
                placeholder_key: "IEHP_FBA_BEHAVIOR_SKILL_TARGETS",
                section_key: "behavior_background_services",
                label: "Behaviors and Functional Skills to be Addressed",
                mode: "ASSISTED",
                required: true,
                status: "drafted",
                value_text: null,
                value_json: null,
                review_notes: null,
              },
            ],
            structured_sections: [
              {
                id: "behavior-structured-1",
                field_key: "IEHP_FBA_BEHAVIOR_SKILL_TARGETS",
                section_index: 0,
                payload: {
                  raw_text: "The behaviors and functional skills to be addressed are: Physical Aggression, Requesting Help, Transition Delay",
                  skills_behaviors: {
                    version: 1,
                    items: [
                      {
                        name: "Physical Aggression",
                        clinical_goal_type: "behavior",
                        reconciliation_status: "matched",
                        matched_summary_refs: ["behavior-summary-1"],
                        matched_detailed_refs: ["detailed-goal-1"],
                      },
                      {
                        name: "Requesting Help",
                        clinical_goal_type: "skill",
                        reconciliation_status: "matched",
                      },
                      {
                        name: "Property Destruction",
                        clinical_goal_type: "behavior",
                        reconciliation_status: "detailed_only",
                      },
                      {
                        name: "Functional Communication",
                        clinical_goal_type: "skill",
                        reconciliation_status: "detailed_only",
                      },
                      {
                        name: "Transition Delay",
                        clinical_goal_type: null,
                        reconciliation_status: "ambiguous",
                      },
                    ],
                  },
                  targets: ["Legacy target should stay hidden when reconciliation is valid"],
                },
                source_span: { page_number: 3, method: "iehp_section_anchor" },
                status: "drafted",
                required: true,
                review_notes: null,
              },
            ],
          },
          unresolved_required_count: 1,
          extracted_value_count: 1,
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "unexpected request" }), { status: 500 });
    });

    renderWithProviders(
      <IehpFbaLayoutReview assessmentDocument={assessmentDocument} organizationId="org-1" />,
    );

    fireEvent.click(await screen.findByRole("button", { name: /Page 3/i }));
    expect(await screen.findByText("Behavior Reduction")).toBeInTheDocument();
    expect(screen.getByText("Skill Acquisition")).toBeInTheDocument();
    expect(screen.getByText("Needs Review")).toBeInTheDocument();
    expect(screen.getByText("Physical Aggression")).toBeInTheDocument();
    expect(screen.getByText("Requesting Help")).toBeInTheDocument();
    expect(screen.getByText("Property Destruction")).toBeInTheDocument();
    expect(screen.getByText("Functional Communication")).toBeInTheDocument();
    expect(screen.getByText("Transition Delay")).toBeInTheDocument();
    expect(screen.queryByText("behavior-summary-1")).not.toBeInTheDocument();
    expect(screen.queryByText("detailed-goal-1")).not.toBeInTheDocument();
    expect(screen.queryByText("Legacy target should stay hidden when reconciliation is valid")).not.toBeInTheDocument();

    const behaviorSection = screen.getByText("Behavior Reduction").parentElement;
    const skillSection = screen.getByText("Skill Acquisition").parentElement;
    const reviewSection = screen.getByText("Needs Review").parentElement;
    expect(behaviorSection).not.toBeNull();
    expect(skillSection).not.toBeNull();
    expect(reviewSection).not.toBeNull();
    expect(within(behaviorSection as HTMLElement).getByText("Property Destruction")).toBeInTheDocument();
    expect(within(skillSection as HTMLElement).getByText("Functional Communication")).toBeInTheDocument();
    expect(within(reviewSection as HTMLElement).queryByText("Property Destruction")).not.toBeInTheDocument();
    expect(within(reviewSection as HTMLElement).queryByText("Functional Communication")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Expand Behaviors and Functional Skills to be Addressed" }));
    fireEvent.click(screen.getByRole("button", { name: "Copy extracted" }));
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        "Behaviors and Functional Skills to be Addressed\nBehavior Reduction\n- Physical Aggression\n- Property Destruction\nSkill Acquisition\n- Requesting Help\n- Functional Communication\nNeeds Review\n- Transition Delay",
      );
    });
  });

  it("falls back to legacy behavior targets when skills_behaviors is absent", async () => {
    vi.mocked(callApi).mockImplementation(async (path: string) => {
      if (path.startsWith("/api/assessment-template-layout?")) {
        return new Response(JSON.stringify({
          template_version: {
            version_key: "iehp_fba_updated_fba_11_2026_05",
            source_document_name: "Updated FBA -IEHP (11).docx",
            page_count: 30,
          },
          pages: [{ page_number: 3, title: "Behaviors", layout_json: {} }],
          fields: [
            {
              page_number: 3,
              section_key: "behavior_background_services",
              field_key: "IEHP_FBA_BEHAVIOR_SKILL_TARGETS",
              label: "Behaviors and Functional Skills to be Addressed",
              field_type: "checkbox_grid",
              mode: "ASSISTED",
              required: true,
              source: "uploaded_assessment_document",
              layout_json: {},
            },
          ],
          values: {
            checklist_items: [
              {
                id: "item-behavior-legacy",
                placeholder_key: "IEHP_FBA_BEHAVIOR_SKILL_TARGETS",
                section_key: "behavior_background_services",
                label: "Behaviors and Functional Skills to be Addressed",
                mode: "ASSISTED",
                required: true,
                status: "drafted",
                value_text: null,
                value_json: null,
                review_notes: null,
              },
            ],
            structured_sections: [
              {
                id: "behavior-structured-legacy",
                field_key: "IEHP_FBA_BEHAVIOR_SKILL_TARGETS",
                section_index: 0,
                payload: {
                  raw_text: "Legacy target list remains available.",
                  targets: ["Physical Aggression", "Self-Injury"],
                },
                source_span: { page_number: 3, method: "iehp_section_anchor" },
                status: "drafted",
                required: true,
                review_notes: null,
              },
            ],
          },
          unresolved_required_count: 1,
          extracted_value_count: 1,
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "unexpected request" }), { status: 500 });
    });

    renderWithProviders(
      <IehpFbaLayoutReview assessmentDocument={assessmentDocument} organizationId="org-1" />,
    );

    fireEvent.click(await screen.findByRole("button", { name: /Page 3/i }));
    expect(await screen.findByText("Selected Behavior Targets")).toBeInTheDocument();
    expect(screen.getByText("Physical Aggression")).toBeInTheDocument();
    expect(screen.getByText("Self-Injury")).toBeInTheDocument();
    expect(screen.queryByText("Behavior Reduction")).not.toBeInTheDocument();
  });

  it("treats an empty skills_behaviors result as a valid empty state without falling back", async () => {
    vi.mocked(callApi).mockImplementation(async (path: string) => {
      if (path.startsWith("/api/assessment-template-layout?")) {
        return new Response(JSON.stringify({
          template_version: {
            version_key: "iehp_fba_updated_fba_11_2026_05",
            source_document_name: "Updated FBA -IEHP (11).docx",
            page_count: 30,
          },
          pages: [{ page_number: 3, title: "Behaviors", layout_json: {} }],
          fields: [
            {
              page_number: 3,
              section_key: "behavior_background_services",
              field_key: "IEHP_FBA_BEHAVIOR_SKILL_TARGETS",
              label: "Behaviors and Functional Skills to be Addressed",
              field_type: "checkbox_grid",
              mode: "ASSISTED",
              required: true,
              source: "uploaded_assessment_document",
              layout_json: {},
            },
          ],
          values: {
            checklist_items: [
              {
                id: "item-behavior-empty",
                placeholder_key: "IEHP_FBA_BEHAVIOR_SKILL_TARGETS",
                section_key: "behavior_background_services",
                label: "Behaviors and Functional Skills to be Addressed",
                mode: "ASSISTED",
                required: true,
                status: "drafted",
                value_text: null,
                value_json: null,
                review_notes: null,
              },
            ],
            structured_sections: [
              {
                id: "behavior-structured-empty",
                field_key: "IEHP_FBA_BEHAVIOR_SKILL_TARGETS",
                section_index: 0,
                payload: {
                  raw_text: "Valid empty reconciliation payload should render an empty grouped state.",
                  skills_behaviors: {
                    version: 1,
                    items: [],
                    counts: {
                      total: 0,
                      behavior: 0,
                      skill: 0,
                      summary_only: 0,
                      detailed_only: 0,
                      ambiguous: 0,
                    },
                  },
                  targets: ["Legacy target should not render"],
                },
                source_span: { page_number: 3, method: "iehp_section_anchor" },
                status: "drafted",
                required: true,
                review_notes: null,
              },
            ],
          },
          unresolved_required_count: 1,
          extracted_value_count: 1,
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "unexpected request" }), { status: 500 });
    });

    renderWithProviders(
      <IehpFbaLayoutReview assessmentDocument={assessmentDocument} organizationId="org-1" />,
    );

    fireEvent.click(await screen.findByRole("button", { name: /Page 3/i }));
    expect(await screen.findByText("Behavior Reduction")).toBeInTheDocument();
    expect(screen.getByText("Skill Acquisition")).toBeInTheDocument();
    expect(screen.getByText("Needs Review")).toBeInTheDocument();
    expect(screen.getAllByText("None reconciled.")).toHaveLength(2);
    expect(screen.getByText("No review items.")).toBeInTheDocument();
    expect(screen.queryByText(/Invalid reconciliation data/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Selected Behavior Targets")).not.toBeInTheDocument();
    expect(screen.queryByText("Legacy target should not render")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Expand Behaviors and Functional Skills to be Addressed" }));
    fireEvent.click(screen.getByRole("button", { name: "Show technical details" }));
    expect(await screen.findByTestId("raw-json-behavior-structured-empty")).toBeInTheDocument();
    expect(screen.getByLabelText("Behaviors and Functional Skills to be Addressed structured section 1 payload")).toBeInTheDocument();
  });

  it("shows an explicit warning when skills_behaviors is present but malformed", async () => {
    vi.mocked(callApi).mockImplementation(async (path: string) => {
      if (path.startsWith("/api/assessment-template-layout?")) {
        return new Response(JSON.stringify({
          template_version: {
            version_key: "iehp_fba_updated_fba_11_2026_05",
            source_document_name: "Updated FBA -IEHP (11).docx",
            page_count: 30,
          },
          pages: [{ page_number: 3, title: "Behaviors", layout_json: {} }],
          fields: [
            {
              page_number: 3,
              section_key: "behavior_background_services",
              field_key: "IEHP_FBA_BEHAVIOR_SKILL_TARGETS",
              label: "Behaviors and Functional Skills to be Addressed",
              field_type: "checkbox_grid",
              mode: "ASSISTED",
              required: true,
              source: "uploaded_assessment_document",
              layout_json: {},
            },
          ],
          values: {
            checklist_items: [
              {
                id: "item-behavior-invalid",
                placeholder_key: "IEHP_FBA_BEHAVIOR_SKILL_TARGETS",
                section_key: "behavior_background_services",
                label: "Behaviors and Functional Skills to be Addressed",
                mode: "ASSISTED",
                required: true,
                status: "drafted",
                value_text: null,
                value_json: null,
                review_notes: null,
              },
            ],
            structured_sections: [
              {
                id: "behavior-structured-invalid",
                field_key: "IEHP_FBA_BEHAVIOR_SKILL_TARGETS",
                section_index: 0,
                payload: {
                  raw_text: "Malformed reconciliation payload should block silent fallback.",
                  skills_behaviors: {
                    items: [
                      {
                        name: "Requesting Help",
                        clinical_goal_type: "skill",
                        reconciliation_status: "matched",
                      },
                      {
                        name: "Physical Aggression",
                        clinical_goal_type: "behavior",
                        reconciliation_status: "matched",
                      },
                      {
                        name: "Untyped Matched Item",
                        clinical_goal_type: null,
                        reconciliation_status: "matched",
                      },
                      {
                        name: "Malformed Candidate",
                        clinical_goal_type: "unsupported",
                        reconciliation_status: "matched",
                      },
                    ],
                  },
                  targets: ["Physical Aggression", "Requesting Help", "Self-Injury"],
                },
                source_span: { page_number: 3, method: "iehp_section_anchor" },
                status: "drafted",
                required: true,
                review_notes: null,
              },
            ],
          },
          unresolved_required_count: 1,
          extracted_value_count: 1,
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "unexpected request" }), { status: 500 });
    });

    renderWithProviders(
      <IehpFbaLayoutReview assessmentDocument={assessmentDocument} organizationId="org-1" />,
    );

    fireEvent.click(await screen.findByRole("button", { name: /Page 3/i }));
    expect(await screen.findByText(/Invalid reconciliation data/i)).toBeInTheDocument();
    expect(screen.getByText("Needs Review")).toBeInTheDocument();
    expect(screen.queryByText("Behavior Reduction")).not.toBeInTheDocument();
    expect(screen.queryByText("Skill Acquisition")).not.toBeInTheDocument();
    expect(screen.queryByText("Selected Behavior Targets")).not.toBeInTheDocument();
    expect(screen.queryByText("Physical Aggression")).not.toBeInTheDocument();
    expect(screen.queryByText("Requesting Help")).not.toBeInTheDocument();
    expect(screen.queryByText("Untyped Matched Item")).not.toBeInTheDocument();
    expect(screen.queryByText("Malformed Candidate")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Expand Behaviors and Functional Skills to be Addressed" }));
    expect(screen.queryByTestId("raw-json-behavior-structured-invalid")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show technical details" }));
    expect(await screen.findByTestId("raw-json-behavior-structured-invalid")).toBeInTheDocument();
    expect(screen.getByLabelText("Behaviors and Functional Skills to be Addressed structured section 1 payload")).toBeInTheDocument();
  });

  it("renders checkbox-grid structured payloads with accessible checked and unchecked tokens", async () => {
    vi.mocked(callApi).mockImplementation(async (path: string) => {
      if (path.startsWith("/api/assessment-template-layout?")) {
        return new Response(JSON.stringify({
          template_version: {
            version_key: "iehp_fba_updated_fba_11_2026_05",
            source_document_name: "Updated FBA -IEHP (11).docx",
            page_count: 30,
          },
          pages: [{ page_number: 7, title: "Environmental Analysis", layout_json: {} }],
          fields: [
            {
              page_number: 7,
              section_key: "behavior_background_services",
              field_key: "IEHP_FBA_ENVIRONMENTAL_ANALYSIS",
              label: "Member Environmental Analysis",
              field_type: "checkbox_grid",
              mode: "ASSISTED",
              required: true,
              source: "uploaded_assessment_document",
              layout_json: {},
            },
          ],
          values: {
            checklist_items: [
              {
                id: "item-env",
                placeholder_key: "IEHP_FBA_ENVIRONMENTAL_ANALYSIS",
                section_key: "behavior_background_services",
                label: "Member Environmental Analysis",
                mode: "ASSISTED",
                required: true,
                status: "approved",
                value_text: "1 structured section extracted",
                value_json: null,
                review_notes: null,
              },
            ],
            structured_sections: [
              {
                id: "section-env",
                field_key: "IEHP_FBA_ENVIRONMENTAL_ANALYSIS",
                section_index: 0,
                payload: {
                  rows: [
                    { label: "Unsafe items secured", checked: true },
                    { label: "Pets present", checked: false },
                    { label: "Community hazards reviewed", checked: null },
                  ],
                },
                source_span: { page_number: 7, method: "iehp_section_anchor" },
                status: "approved",
                required: true,
                review_notes: null,
              },
            ],
          },
          unresolved_required_count: 0,
          extracted_value_count: 1,
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "unexpected request" }), { status: 500 });
    });

    renderWithProviders(
      <IehpFbaLayoutReview assessmentDocument={assessmentDocument} organizationId="org-1" />,
    );

    fireEvent.click(await screen.findByRole("button", { name: /Page 7/i }));
    expect(await screen.findByText("Checkbox Review")).toBeInTheDocument();
    expect(screen.getByLabelText("Unsafe items secured selected")).toHaveTextContent("✓");
    expect(screen.getByLabelText("Pets present not selected")).toHaveTextContent("☐");
    expect(screen.getByLabelText("Community hazards reviewed unknown")).toHaveTextContent("-");
  });

  it("renders readable assessment procedures preview with optional technical details toggle and readable copy output", async () => {
    vi.mocked(callApi).mockImplementation(async (path: string) => {
      if (path.startsWith("/api/assessment-template-layout?")) {
        return new Response(JSON.stringify({
          template_version: {
            version_key: "iehp_fba_updated_fba_11_2026_05",
            source_document_name: "Updated FBA -IEHP (11).docx",
            page_count: 30,
          },
          pages: [{ page_number: 7, title: "Assessment Procedures", layout_json: {} }],
          fields: [
            {
              page_number: 7,
              section_key: "assessment_procedures",
              field_key: "IEHP_FBA_ASSESSMENT_PROCEDURES_TABLE",
              label: "Description of Assessment Procedures",
              field_type: "repeatable_table",
              mode: "ASSISTED",
              required: true,
              source: "uploaded_assessment_document",
              layout_json: {},
            },
          ],
          values: {
            checklist_items: [
              {
                id: "item-procedures",
                placeholder_key: "IEHP_FBA_ASSESSMENT_PROCEDURES_TABLE",
                section_key: "assessment_procedures",
                label: "Description of Assessment Procedures",
                mode: "ASSISTED",
                required: true,
                status: "drafted",
                value_text: "1 structured section extracted",
                value_json: null,
                review_notes: null,
              },
            ],
            structured_sections: [
              {
                id: "procedures-structured-1",
                field_key: "IEHP_FBA_ASSESSMENT_PROCEDURES_TABLE",
                section_index: 0,
                payload: {
                  rows: [
                    { procedure: "Record s Reviewed", raw_text: "12/05/2025 Telehealth BCBA" },
                    { procedure: "Clinical Interview", raw_text: "12/01/2025 Telehealth BCBA" },
                  ],
                  raw_text: "DESCRIPTION OF ASSESSMENT PROCEDURES...",
                },
                source_span: { page_number: 7, method: "iehp_section_anchor" },
                status: "drafted",
                required: true,
                review_notes: null,
              },
            ],
          },
          unresolved_required_count: 1,
          extracted_value_count: 1,
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "unexpected request" }), { status: 500 });
    });

    renderWithProviders(
      <IehpFbaLayoutReview assessmentDocument={assessmentDocument} organizationId="org-1" />,
    );

    fireEvent.click(await screen.findByRole("button", { name: /Page 7/i }));
    expect(await screen.findByText(/Page 7:\s*Assessment Procedures/i)).toBeInTheDocument();
    expect(screen.getByText("Record s Reviewed")).toBeInTheDocument();
    expect(screen.getByText("Clinical Interview")).toBeInTheDocument();

    expect(screen.queryByTestId("raw-json-procedures-structured-1")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Description of Assessment Procedures structured section 1 payload")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Expand Description of Assessment Procedures" }));
    expect(screen.queryByTestId("raw-json-procedures-structured-1")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show technical details" }));
    expect(await screen.findByTestId("raw-json-procedures-structured-1")).toBeInTheDocument();
    expect(screen.getByLabelText("Description of Assessment Procedures structured section 1 payload")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hide technical details" }));

    fireEvent.click(screen.getByRole("button", { name: "Copy extracted" }));
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        "Assessment Procedures\n- Record s Reviewed: 12/05/2025 Telehealth BCBA\n- Clinical Interview: 12/01/2025 Telehealth BCBA",
      );
    });
  });

  it("renders adaptive measure assessment blocks separately and preserves missing block slots", async () => {
    vi.mocked(callApi).mockImplementation(async (path: string) => {
      if (path.startsWith("/api/assessment-template-layout?")) {
        return new Response(JSON.stringify({
          template_version: {
            version_key: "iehp_fba_updated_fba_11_2026_05",
            source_document_name: "Updated FBA -IEHP (11).docx",
            page_count: 30,
          },
          pages: [{ page_number: 10, title: "Adaptive Measures", layout_json: {} }],
          fields: [
            {
              page_number: 10,
              section_key: "assessment_procedures_testing",
              field_key: "IEHP_FBA_ADAPTIVE_MEASURE_SUMMARIES",
              label: "Adaptive and Functional Measure Summaries",
              field_type: "textarea",
              mode: "ASSISTED",
              required: true,
              source: "uploaded_assessment_document",
              layout_json: {},
            },
          ],
          values: {
            checklist_items: [
              {
                id: "item-adaptive-measures",
                placeholder_key: "IEHP_FBA_ADAPTIVE_MEASURE_SUMMARIES",
                section_key: "assessment_procedures_testing",
                label: "Adaptive and Functional Measure Summaries",
                mode: "ASSISTED",
                required: true,
                status: "drafted",
                value_text: "1 structured section extracted",
                value_json: null,
                review_notes: null,
              },
            ],
            structured_sections: [
              {
                id: "adaptive-measures-structured-1",
                field_key: "IEHP_FBA_ADAPTIVE_MEASURE_SUMMARIES",
                section_index: 0,
                payload: {
                  raw_text: "Combined adaptive measure narrative.",
                  assessment_blocks: [
                    { assessment_type: "VB-MAPP", raw_text: "VB-MAPP Assessment Summary: Preserve as assessment block." },
                    { assessment_type: "Vineland", raw_text: "Vineland Assessment Summary: Preserve as assessment block." },
                    { assessment_type: "AFLS", raw_text: "AFLS Assessment Summary: Preserve as assessment block." },
                    { assessment_type: "ABAS-3", raw_text: null },
                  ],
                },
                source_span: { page_number: 10, method: "iehp_section_anchor" },
                status: "drafted",
                required: true,
                review_notes: null,
              },
            ],
          },
          unresolved_required_count: 1,
          extracted_value_count: 1,
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "unexpected request" }), { status: 500 });
    });

    renderWithProviders(
      <IehpFbaLayoutReview assessmentDocument={assessmentDocument} organizationId="org-1" />,
    );

    fireEvent.click(await screen.findByRole("button", { name: /Page 10/i }));
    expect(await screen.findByText("Adaptive Measure Blocks")).toBeInTheDocument();
    expect(screen.getByText("VB-MAPP")).toBeInTheDocument();
    expect(screen.getByText("Vineland")).toBeInTheDocument();
    expect(screen.getByText("AFLS")).toBeInTheDocument();
    expect(screen.getByText("ABAS-3")).toBeInTheDocument();
    expect(screen.getByText("ABAS-3 content was not found in the source document text; clinician review is required.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Expand Adaptive and Functional Measure Summaries" }));
    fireEvent.click(screen.getByRole("button", { name: "Copy extracted" }));
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        "Adaptive Measure Summaries\n- VB-MAPP: VB-MAPP Assessment Summary: Preserve as assessment block.\n- Vineland: Vineland Assessment Summary: Preserve as assessment block.\n- AFLS: AFLS Assessment Summary: Preserve as assessment block.\n- ABAS-3: ABAS-3 content was not found in the source document text; clinician review is required.",
      );
    });
  });

  it("renders generic structured placeholders as staff-readable copy instead of raw JSON", async () => {
    vi.mocked(callApi).mockImplementation(async (path: string) => {
      if (path.startsWith("/api/assessment-template-layout?")) {
        return new Response(JSON.stringify({
          template_version: {
            version_key: "iehp_fba_updated_fba_11_2026_05",
            source_document_name: "Updated FBA -IEHP (11).docx",
            page_count: 30,
          },
          pages: [{ page_number: 2, title: "Referral Information", layout_json: {} }],
          fields: [],
          values: {
            checklist_items: [],
            structured_sections: [
              {
                id: "referral-placeholder-structured",
                field_key: "IEHP_FBA_REASON_FOR_REFERRAL",
                section_index: 0,
                payload: {
                  mode: "MANUAL",
                  label: "Reason for Referral",
                  source: "clinician_manual_entry unless present in uploaded document",
                  raw_text: "",
                  required: true,
                  field_key: "IEHP_FBA_REASON_FOR_REFERRAL",
                  field_type: "textarea",
                  page_number: 2,
                  template_placeholder: true,
                  entered_value_present: false,
                },
                source_span: { page_number: 2, method: "iehp_section_anchor" },
                status: "drafted",
                required: true,
                review_notes: null,
              },
            ],
          },
          unresolved_required_count: 1,
          extracted_value_count: 1,
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "unexpected request" }), { status: 500 });
    });

    renderWithProviders(
      <IehpFbaLayoutReview assessmentDocument={assessmentDocument} organizationId="org-1" />,
    );

    fireEvent.click(await screen.findByRole("button", { name: /Page 2/i }));
    expect(await screen.findByText("Page-specific structured sections")).toBeInTheDocument();
    expect(screen.getAllByText(/Reason for Referral/).length).toBeGreaterThan(0);
    expect(screen.getByText(/No extracted field value was found in the source document\./)).toBeInTheDocument();
    expect(screen.queryByText(/Field type: textarea/)).not.toBeInTheDocument();
    expect(screen.queryByText(/"mode"/)).not.toBeInTheDocument();
    expect(screen.queryByTestId("raw-json-referral-placeholder-structured")).not.toBeInTheDocument();
  });

  it("preserves assessment procedures raw text when rows are not parsed", async () => {
    vi.mocked(callApi).mockImplementation(async (path: string) => {
      if (path.startsWith("/api/assessment-template-layout?")) {
        return new Response(JSON.stringify({
          template_version: {
            version_key: "iehp_fba_updated_fba_11_2026_05",
            source_document_name: "Updated FBA -IEHP (11).docx",
            page_count: 30,
          },
          pages: [{ page_number: 7, title: "Assessment Procedures", layout_json: {} }],
          fields: [
            {
              page_number: 7,
              section_key: "assessment_procedures",
              field_key: "IEHP_FBA_ASSESSMENT_PROCEDURES_TABLE",
              label: "Description of Assessment Procedures",
              field_type: "repeatable_table",
              mode: "ASSISTED",
              required: true,
              source: "uploaded_assessment_document",
              layout_json: {},
            },
          ],
          values: {
            checklist_items: [
              {
                id: "item-procedures-raw",
                placeholder_key: "IEHP_FBA_ASSESSMENT_PROCEDURES_TABLE",
                section_key: "assessment_procedures",
                label: "Description of Assessment Procedures",
                mode: "ASSISTED",
                required: true,
                status: "drafted",
                value_text: "1 structured section extracted",
                value_json: null,
                review_notes: null,
              },
            ],
            structured_sections: [
              {
                id: "procedures-structured-raw-fallback",
                field_key: "IEHP_FBA_ASSESSMENT_PROCEDURES_TABLE",
                section_index: 0,
                payload: {
                  rows: [],
                  raw_text: "Procedures completed in narrative format without labeled row markers.",
                },
                source_span: { page_number: 7, method: "iehp_section_anchor" },
                status: "drafted",
                required: true,
                review_notes: null,
              },
            ],
          },
          unresolved_required_count: 1,
          extracted_value_count: 1,
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "unexpected request" }), { status: 500 });
    });

    renderWithProviders(
      <IehpFbaLayoutReview assessmentDocument={assessmentDocument} organizationId="org-1" />,
    );

    fireEvent.click(await screen.findByRole("button", { name: /Page 7/i }));
    expect(await screen.findByText("Procedures completed in narrative format without labeled row markers.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Expand Description of Assessment Procedures" }));
    fireEvent.click(screen.getByRole("button", { name: "Copy extracted" }));
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        "Assessment Procedures\nProcedures completed in narrative format without labeled row markers.",
      );
    });
  });
});
