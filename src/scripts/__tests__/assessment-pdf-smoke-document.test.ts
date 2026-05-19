import { describe, expect, it } from "vitest";

import {
  evaluatePdfSmokeAssessmentReadiness,
  isCompletedPdfSmokeExtractionStatus,
  isDraftAlreadyExistsResponse,
  isPendingPdfSmokeExtractionStatus,
} from "../../../scripts/lib/assessment-pdf-smoke-document";

describe("assessment pdf smoke document readiness", () => {
  it("accepts an extracted CalOptima assessment with approved required rows and accepted drafts", () => {
    expect(
      evaluatePdfSmokeAssessmentReadiness({
        document: {
          id: "doc-1",
          client_id: "client-1",
          file_name: "fixture.pdf",
          object_path: "clients/client-1/assessments/fixture.pdf",
          status: "extracted",
          template_type: "caloptima_fba",
        },
        checklist: {
          items: [
            {
              id: "item-1",
              label: "Member Name",
              placeholder_key: "MEMBER_NAME",
              required: true,
              status: "approved",
              value_text: "Redacted Client",
              value_json: null,
            },
          ],
          structured_sections: [
            {
              id: "section-1",
              field_key: "CALOPTIMA_FBA_TARGET_REPLACEMENT_GOALS",
              section_key: "goals",
              section_index: 0,
              payload: { goal_type: "child" },
              required: true,
              status: "approved",
            },
          ],
        },
        drafts: {
          programs: [{ id: "program-1", name: "Program", description: null, accept_state: "accepted" }],
          goals: [
            {
              id: "goal-1",
              title: "Goal",
              description: "Goal description",
              original_text: "Goal description",
              goal_type: "child",
              accept_state: "accepted",
            },
          ],
        },
      }),
    ).toEqual({
      ready: true,
      reasons: [],
    });
  });

  it("reports pending required rows and missing accepted drafts", () => {
    expect(
      evaluatePdfSmokeAssessmentReadiness({
        document: {
          id: "doc-1",
          client_id: "client-1",
          file_name: "fixture.pdf",
          object_path: "clients/client-1/assessments/fixture.pdf",
          status: "extracting",
          template_type: "caloptima_fba",
        },
        checklist: {
          items: [
            {
              id: "item-1",
              label: "Member Name",
              placeholder_key: "MEMBER_NAME",
              required: true,
              status: "drafted",
              value_text: "Redacted Client",
              value_json: null,
            },
          ],
          structured_sections: [
            {
              id: "section-1",
              field_key: "CALOPTIMA_FBA_TARGET_REPLACEMENT_GOALS",
              section_key: "goals",
              section_index: 0,
              payload: { goal_type: "child" },
              required: true,
              status: "not_started",
            },
          ],
        },
        drafts: {
          programs: [{ id: "program-1", name: "Program", description: null, accept_state: "pending" }],
          goals: [
            {
              id: "goal-1",
              title: "Goal",
              description: "Goal description",
              original_text: "Goal description",
              goal_type: "child",
              accept_state: "pending",
            },
          ],
        },
      }),
    ).toEqual({
      ready: false,
      reasons: [
        "document_status_extracting",
        "required_checklist_pending",
        "required_structured_sections_pending",
        "accepted_program_missing",
        "accepted_goal_missing",
      ],
    });
  });

  it("treats extraction_running as an in-progress smoke extraction status", () => {
    expect(isPendingPdfSmokeExtractionStatus("uploaded")).toBe(true);
    expect(isPendingPdfSmokeExtractionStatus("extracting")).toBe(true);
    expect(isPendingPdfSmokeExtractionStatus("extraction_running")).toBe(true);
    expect(isPendingPdfSmokeExtractionStatus("drafted")).toBe(false);
    expect(isPendingPdfSmokeExtractionStatus("extraction_failed")).toBe(false);
  });

  it("treats drafted as a completed smoke extraction status", () => {
    expect(isCompletedPdfSmokeExtractionStatus("extracted")).toBe(true);
    expect(isCompletedPdfSmokeExtractionStatus("drafted")).toBe(true);
    expect(isCompletedPdfSmokeExtractionStatus("approved")).toBe(true);
    expect(isCompletedPdfSmokeExtractionStatus("extraction_running")).toBe(false);
    expect(isCompletedPdfSmokeExtractionStatus("extraction_failed")).toBe(false);
  });

  it("recognizes the existing-drafts response as safe to continue", () => {
    expect(isDraftAlreadyExistsResponse(409, '{"error":"Drafts already exist for this assessment. Review existing drafts instead of regenerating."}')).toBe(true);
    expect(isDraftAlreadyExistsResponse(409, '{"error":"Accepted draft program and goals are required"}')).toBe(false);
    expect(isDraftAlreadyExistsResponse(500, '{"error":"Drafts already exist for this assessment."}')).toBe(false);
  });

  it("rejects non-CalOptima templates even when the rest of the fixture looks ready", () => {
    expect(
      evaluatePdfSmokeAssessmentReadiness({
        document: {
          id: "doc-1",
          client_id: "client-1",
          file_name: "fixture.pdf",
          object_path: "clients/client-1/assessments/fixture.pdf",
          status: "approved",
          template_type: "iehp_fba",
        },
        checklist: {
          items: [],
          structured_sections: [],
        },
        drafts: {
          programs: [{ id: "program-1", name: "Program", description: null, accept_state: "edited" }],
          goals: [
            {
              id: "goal-1",
              title: "Goal",
              description: "Goal description",
              original_text: "Goal description",
              goal_type: "child",
              accept_state: "edited",
            },
          ],
        },
      }),
    ).toEqual({
      ready: false,
      reasons: ["template_type_not_caloptima"],
    });
  });

  it("rejects approved required checklist rows when text and json values are empty", () => {
    expect(
      evaluatePdfSmokeAssessmentReadiness({
        document: {
          id: "doc-1",
          client_id: "client-1",
          file_name: "fixture.pdf",
          object_path: "clients/client-1/assessments/fixture.pdf",
          status: "extracted",
          template_type: "caloptima_fba",
        },
        checklist: {
          items: [
            {
              id: "item-1",
              label: "Chief Complaint",
              placeholder_key: "CALOPTIMA_FBA_CHIEF_COMPLAINT",
              required: true,
              status: "approved",
              value_text: "   ",
              value_json: {},
            },
          ],
          structured_sections: [],
        },
        drafts: {
          programs: [{ id: "program-1", name: "Program", description: null, accept_state: "accepted" }],
          goals: [
            {
              id: "goal-1",
              title: "Goal",
              description: "Goal description",
              original_text: "Goal description",
              goal_type: "child",
              accept_state: "accepted",
            },
          ],
        },
      }),
    ).toEqual({
      ready: false,
      reasons: ["required_checklist_value_missing"],
    });
  });

  it("accepts approved required checklist rows backed by structured json values", () => {
    expect(
      evaluatePdfSmokeAssessmentReadiness({
        document: {
          id: "doc-1",
          client_id: "client-1",
          file_name: "fixture.pdf",
          object_path: "clients/client-1/assessments/fixture.pdf",
          status: "extracted",
          template_type: "caloptima_fba",
        },
        checklist: {
          items: [
            {
              id: "item-1",
              label: "Prior ABA",
              placeholder_key: "CALOPTIMA_FBA_PRIOR_ABA_AGENCIES",
              required: true,
              status: "approved",
              value_text: null,
              value_json: { provider: "Prior provider" },
            },
          ],
          structured_sections: [],
        },
        drafts: {
          programs: [{ id: "program-1", name: "Program", description: null, accept_state: "accepted" }],
          goals: [
            {
              id: "goal-1",
              title: "Goal",
              description: "Goal description",
              original_text: "Goal description",
              goal_type: "child",
              accept_state: "accepted",
            },
          ],
        },
      }),
    ).toEqual({
      ready: true,
      reasons: [],
    });
  });
});
