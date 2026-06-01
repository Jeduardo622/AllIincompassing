import { describe, expect, it } from "vitest";
import { buildIehpDocxPayload } from "../iehpAssessmentDocx";

const templateFields = [
  { field_key: "IEHP_FBA_FIRST_NAME", required: true },
  { field_key: "IEHP_FBA_LAST_NAME", required: true },
  { field_key: "IEHP_FBA_BIRTH_DATE", required: true },
  { field_key: "IEHP_FBA_MEMBER_ID", required: true },
  { field_key: "IEHP_FBA_PRESENT_ADDRESS", required: true },
  { field_key: "IEHP_FBA_PARENT_GUARDIAN", required: true },
  { field_key: "IEHP_FBA_CONTACT_PHONE", required: true },
  { field_key: "IEHP_FBA_LANGUAGE", required: true },
  { field_key: "IEHP_FBA_REPORT_DATE", required: true },
  { field_key: "IEHP_FBA_ASSESSOR_CERTIFICATION", required: true },
  { field_key: "IEHP_FBA_ASSESSOR_PHONE", required: true },
  { field_key: "IEHP_FBA_ADAPTIVE_MEASURE_SUMMARIES", required: true },
  { field_key: "IEHP_FBA_TARGET_BEHAVIOR_INTERVENTION_BLOCKS", required: true },
  { field_key: "IEHP_FBA_SKILL_AND_SCHOOL_GOAL_BLOCKS", required: true },
  { field_key: "IEHP_FBA_SIGNATURE_BLOCK", required: true },
  { field_key: "IEHP_FBA_ADDITIONAL_NOTES", required: false },
] as const;

const approvedChecklist = templateFields.map((field) => ({
  placeholder_key: field.field_key,
  required: field.required,
  status: "approved" as const,
  value_text: `${field.field_key} checklist value`,
  value_json: null,
}));

const baseArgs = {
  templateFields: [...templateFields],
  checklistItems: approvedChecklist,
  structuredSections: [
    {
      field_key: "IEHP_FBA_ADAPTIVE_MEASURE_SUMMARIES",
      section_key: "assessment_procedures_testing",
      section_index: 0,
      payload: {
        assessment_blocks: [
          { label: "VB-MAPP", raw_text: "VB-MAPP summary" },
          { label: "Vineland", raw_text: "Vineland summary" },
          { label: "AFLS", raw_text: "AFLS summary" },
          { label: "ABAS-3", raw_text: "ABAS-3 summary" },
        ],
      },
      status: "approved" as const,
      required: true,
    },
  ],
  client: {
    full_name: "Synthetic Client",
    first_name: "Synthetic",
    last_name: "Client",
    date_of_birth: "2018-03-04",
    cin_number: "MEM-123",
    phone: "555-0100",
    parent1_first_name: "Care",
    parent1_last_name: "Giver",
    parent1_phone: "555-0101",
    preferred_language: "English",
    address_line1: "123 Test St",
    city: "Riverside",
    state: "CA",
    zip_code: "92501",
  },
  writer: {
    full_name: "Synthetic Writer",
    title: "BCBA",
    license_number: "L-123",
    phone: "555-0102",
  },
  acceptedPrograms: [{ name: "Behavior Support", description: "Reduce unsafe behavior." }],
  acceptedGoals: [
    {
      title: "Reduce elopement",
      description: "Client remains with caregiver during transitions.",
      original_text: "Original behavior goal.",
      goal_type: "child" as const,
      target_behavior: "elopement",
      measurement_type: "frequency",
      baseline_data: "4 incidents per week",
      target_criteria: "1 incident or fewer per week",
      mastery_criteria: "Three consecutive weeks",
      maintenance_criteria: "Monthly probe",
      generalization_criteria: "Across two settings",
      objective_data_points: [{ measure: "incident count" }],
    },
    {
      title: "Caregiver uses transition routine",
      description: "Caregiver implements transition routine.",
      original_text: "Original parent goal.",
      goal_type: "parent" as const,
      target_behavior: null,
      measurement_type: "percent opportunities",
      baseline_data: "20%",
      target_criteria: "80%",
      mastery_criteria: "Three sessions",
      maintenance_criteria: "Monthly probe",
      generalization_criteria: "Home and community",
      objective_data_points: [],
    },
  ],
};

describe("buildIehpDocxPayload", () => {
  it("maps approved checklist, adaptive blocks, child goals, parent goals, and signature fields", () => {
    const result = buildIehpDocxPayload(baseArgs);

    expect(result.preflight.ready).toBe(true);
    expect(Object.keys(result.values)).toEqual(templateFields.map((field) => field.field_key));
    expect(result.values.IEHP_FBA_FIRST_NAME).toBe("Synthetic");
    expect(result.values.IEHP_FBA_BIRTH_DATE).toBe("03/04/2018");
    expect(result.values.IEHP_FBA_ADAPTIVE_MEASURE_SUMMARIES).toContain("VB-MAPP: VB-MAPP summary");
    expect(result.values.IEHP_FBA_ADAPTIVE_MEASURE_SUMMARIES).toContain("Vineland: Vineland summary");
    expect(result.values.IEHP_FBA_TARGET_BEHAVIOR_INTERVENTION_BLOCKS).toContain("Reduce elopement");
    expect(result.values.IEHP_FBA_SKILL_AND_SCHOOL_GOAL_BLOCKS).toContain("Caregiver uses transition routine");
    expect(result.values.IEHP_FBA_SIGNATURE_BLOCK).toContain("Synthetic Writer");
  });

  it("prefers active authorization member id over client CIN for IEHP member id", () => {
    const result = buildIehpDocxPayload({
      ...baseArgs,
      authorizationMemberId: "AUTH-MEMBER-999",
    });

    expect(result.values.IEHP_FBA_MEMBER_ID).toBe("AUTH-MEMBER-999");
  });

  it("blocks unresolved manual-review adaptive blocks instead of inventing clinical content", () => {
    const result = buildIehpDocxPayload({
      ...baseArgs,
      structuredSections: [
        {
          field_key: "IEHP_FBA_ADAPTIVE_MEASURE_SUMMARIES",
          section_key: "assessment_procedures_testing",
          section_index: 0,
          payload: {
            assessment_blocks: [
              { label: "VB-MAPP", raw_text: null, manual_review_required: true },
              { label: "Vineland", raw_text: "Vineland summary" },
            ],
          },
          status: "approved",
          required: true,
        },
      ],
    });

    expect(result.preflight.ready).toBe(false);
    expect(result.preflight.blockers).toContainEqual(
      expect.objectContaining({
        code: "manual_review_required",
        key: "IEHP_FBA_ADAPTIVE_MEASURE_SUMMARIES",
      }),
    );
  });

  it("ignores staged draft review state and blocks only unresolved required output values", () => {
    const result = buildIehpDocxPayload({
      ...baseArgs,
      client: {
        ...baseArgs.client,
        preferred_language: null,
      },
      checklistItems: approvedChecklist.filter((item) => item.placeholder_key !== "IEHP_FBA_LANGUAGE"),
      acceptedGoals: baseArgs.acceptedGoals.slice(0, 1),
      pendingDraftGoalCount: 2,
    });

    expect(result.preflight.ready).toBe(false);
    expect(result.preflight.blockers).not.toContainEqual(expect.objectContaining({ code: "pending_draft_goals" }));
    expect(result.preflight.blockers).not.toContainEqual(expect.objectContaining({ code: "missing_parent_goal" }));
    expect(result.preflight.blockers).toContainEqual(
      expect.objectContaining({ code: "missing_required_output", key: "IEHP_FBA_LANGUAGE" }),
    );
  });
});
