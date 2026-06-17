import { readFileSync } from "node:fs";
import { join } from "node:path";
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
  value_text: field.field_key === "IEHP_FBA_REPORT_DATE" ? "06/01/2026" : `${field.field_key} checklist value`,
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

  it("normalizes approved IEHP report date and member id before rendering", () => {
    const result = buildIehpDocxPayload({
      ...baseArgs,
      authorizationMemberId: "201209 00973100",
      checklistItems: approvedChecklist.map((item) =>
        item.placeholder_key === "IEHP_FBA_REPORT_DATE"
          ? { ...item, value_text: "12/ 09 /2025" }
          : item,
      ),
    });

    expect(result.values.IEHP_FBA_REPORT_DATE).toBe("12/09/2025");
    expect(result.values.IEHP_FBA_MEMBER_ID).toBe("20120900973100");
  });

  it("blocks approved slashed dates that are not real calendar dates", () => {
    const result = buildIehpDocxPayload({
      ...baseArgs,
      client: {
        ...baseArgs.client,
        date_of_birth: null,
      },
      checklistItems: approvedChecklist.map((item) => {
        if (item.placeholder_key === "IEHP_FBA_REPORT_DATE") return { ...item, value_text: "13/40/2025" };
        if (item.placeholder_key === "IEHP_FBA_BIRTH_DATE") return { ...item, value_text: "02/30/2025" };
        return item;
      }),
    });

    expect(result.preflight.ready).toBe(false);
    expect(result.values.IEHP_FBA_REPORT_DATE).toBe("");
    expect(result.values.IEHP_FBA_BIRTH_DATE).toBe("");
    expect(result.preflight.blockers).toContainEqual(
      expect.objectContaining({ code: "missing_required_output", key: "IEHP_FBA_REPORT_DATE" }),
    );
    expect(result.preflight.blockers).toContainEqual(
      expect.objectContaining({ code: "missing_required_output", key: "IEHP_FBA_BIRTH_DATE" }),
    );
  });

  it("uses client profile names over extracted names and warns when they differ", () => {
    const result = buildIehpDocxPayload({
      ...baseArgs,
      checklistItems: approvedChecklist.map((item) => {
        if (item.placeholder_key === "IEHP_FBA_FIRST_NAME") return { ...item, value_text: "Le" };
        if (item.placeholder_key === "IEHP_FBA_LAST_NAME") return { ...item, value_text: "Kim" };
        return item;
      }),
    });

    expect(result.values.IEHP_FBA_FIRST_NAME).toBe("Synthetic");
    expect(result.values.IEHP_FBA_LAST_NAME).toBe("Client");
    expect(result.preflight.warnings).toContainEqual(
      expect.stringContaining("extracted document name differs from client profile"),
    );
  });

  it("does not render unapproved N/A values for required missing fields", () => {
    const result = buildIehpDocxPayload({
      ...baseArgs,
      checklistItems: approvedChecklist.map((item) =>
        item.placeholder_key === "IEHP_FBA_LANGUAGE"
          ? { ...item, status: "not_started" as const, value_text: "N/A" }
          : item,
      ),
      client: {
        ...baseArgs.client,
        preferred_language: null,
      },
    });

    expect(result.preflight.ready).toBe(false);
    expect(result.values.IEHP_FBA_LANGUAGE).toBe("");
    expect(result.preflight.blockers).toContainEqual(
      expect.objectContaining({
        code: "unapproved_required_checklist",
        key: "IEHP_FBA_LANGUAGE",
      }),
    );
    expect(result.preflight.blockers).toContainEqual(
      expect.objectContaining({
        code: "missing_required_output",
        key: "IEHP_FBA_LANGUAGE",
        message: expect.stringContaining("missing from approved review data/source"),
      }),
    );
  });

  it("treats absent IEHP source fields as optional for final DOCX generation", () => {
    const result = buildIehpDocxPayload({
      ...baseArgs,
      templateFields: [
        { field_key: "IEHP_FBA_REFERRING_PROVIDER", required: true },
        { field_key: "IEHP_FBA_ASSESSOR_PHONE", required: true },
        { field_key: "IEHP_FBA_ADAPTIVE_MEASURE_SUMMARIES", required: true },
      ],
      checklistItems: [
        {
          placeholder_key: "IEHP_FBA_REFERRING_PROVIDER",
          required: true,
          status: "not_started",
          value_text: null,
          value_json: null,
        },
        {
          placeholder_key: "IEHP_FBA_ASSESSOR_PHONE",
          required: true,
          status: "approved",
          value_text: "N/a",
          value_json: null,
        },
        {
          placeholder_key: "IEHP_FBA_ADAPTIVE_MEASURE_SUMMARIES",
          required: true,
          status: "approved",
          value_text: "1 structured section extracted",
          value_json: null,
        },
      ],
      structuredSections: [
        {
          field_key: "IEHP_FBA_ASSESSOR_PHONE",
          section_key: "identification_admin",
          section_index: 0,
          payload: null,
          status: "drafted",
          required: true,
        },
        {
          field_key: "IEHP_FBA_REFERRING_PROVIDER",
          section_key: "identification_admin",
          section_index: 0,
          payload: null,
          status: "not_started",
          required: true,
        },
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
      writer: {
        ...baseArgs.writer,
        phone: null,
      },
    });

    expect(result.preflight.ready).toBe(true);
    expect(result.values.IEHP_FBA_REFERRING_PROVIDER).toBe("");
    expect(result.values.IEHP_FBA_ASSESSOR_PHONE).toBe("N/a");
    expect(result.preflight.blockers).toEqual([]);
  });

  it("allows optional approved N/A values without making them blockers", () => {
    const result = buildIehpDocxPayload({
      ...baseArgs,
      checklistItems: approvedChecklist.map((item) =>
        item.placeholder_key === "IEHP_FBA_ADDITIONAL_NOTES"
          ? { ...item, required: false, status: "approved" as const, value_text: "N/A" }
          : item,
      ),
    });

    expect(result.preflight.ready).toBe(true);
    expect(result.values.IEHP_FBA_ADDITIONAL_NOTES).toBe("N/A");
  });

  it("does not block final generation on unresolved optional adaptive blocks", () => {
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

    expect(result.preflight.ready).toBe(true);
    expect(result.preflight.blockers).not.toContainEqual(
      expect.objectContaining({
        code: "manual_review_required",
        key: "IEHP_FBA_ADAPTIVE_MEASURE_SUMMARIES",
      }),
    );
  });

  it("renders verified optional extracted adaptive summaries and explicit function/consequence evidence for final parity", () => {
    const result = buildIehpDocxPayload({
      ...baseArgs,
      templateFields: [
        { field_key: "IEHP_FBA_ADAPTIVE_MEASURE_SUMMARIES", required: true },
        { field_key: "IEHP_FBA_TEACHING_INTERVENTION_STRATEGIES", required: true },
      ],
      checklistItems: [
        {
          placeholder_key: "IEHP_FBA_ADAPTIVE_MEASURE_SUMMARIES",
          required: true,
          status: "approved" as const,
          value_text: "1 structured section extracted",
          value_json: null,
        },
        {
          placeholder_key: "IEHP_FBA_TEACHING_INTERVENTION_STRATEGIES",
          required: true,
          status: "approved" as const,
          value_text:
            "Extinction consists of withholding reinforcement so attention, escape, and access to tangibles are not delivered. Preferred items may be used as motivation.",
          value_json: null,
        },
      ],
      structuredSections: [
        {
          field_key: "IEHP_FBA_ADAPTIVE_MEASURE_SUMMARIES",
          section_key: "assessment_procedures_testing",
          section_index: 0,
          payload: {
            raw_text:
              "Vineland-3 results: Adaptive Behavior Composite (ABC) standard score of 20, below the 1st percentile. Communication, Daily Living Skills, and Socialization standard scores were 20.",
          },
          status: "verified" as const,
          required: true,
        },
      ],
    });

    expect(result.preflight.ready).toBe(true);
    expect(result.values.IEHP_FBA_ADAPTIVE_MEASURE_SUMMARIES).toContain("standard score of 20");
    expect(result.values.IEHP_FBA_ADAPTIVE_MEASURE_SUMMARIES).toContain("below the 1st percentile");
    expect(result.values.IEHP_FBA_TEACHING_INTERVENTION_STRATEGIES).toContain("access to tangibles");
    expect(result.values.IEHP_FBA_TEACHING_INTERVENTION_STRATEGIES).toContain("escape/avoidance");
    expect(result.values.IEHP_FBA_TEACHING_INTERVENTION_STRATEGIES).toContain("desired item");
    expect(result.values.IEHP_FBA_TEACHING_INTERVENTION_STRATEGIES).toContain("allowing escape");
  });

  it("adds explicit function and consequence evidence to goal blocks when source original text carries behavior plan details", () => {
    const result = buildIehpDocxPayload({
      ...baseArgs,
      templateFields: [{ field_key: "IEHP_FBA_SKILL_AND_SCHOOL_GOAL_BLOCKS", required: true }],
      checklistItems: [
        {
          placeholder_key: "IEHP_FBA_SKILL_AND_SCHOOL_GOAL_BLOCKS",
          required: true,
          status: "approved" as const,
          value_text: null,
          value_json: null,
        },
      ],
      acceptedGoals: [
        {
          title: "Attending to adult-led activities",
          description: "Kim will participate in adult-led activities.",
          original_text:
            "Extinction consists of withholding reinforcement so attention, escape, and access to tangibles are not delivered. Preferred items may be used as motivation.",
          goal_type: "child" as const,
          target_behavior: "adult-led activity participation",
          measurement_type: "Percentage of opportunities",
          baseline_data: "Baseline is partial and does not include source function evidence.",
          target_criteria: "80% of opportunities",
          mastery_criteria: "80% of opportunities across 4 consecutive weeks",
          maintenance_criteria: null,
          generalization_criteria: "Across home and school",
          objective_data_points: [],
        },
      ],
    });

    expect(result.preflight.ready).toBe(true);
    expect(result.values.IEHP_FBA_SKILL_AND_SCHOOL_GOAL_BLOCKS).toContain("access to tangibles");
    expect(result.values.IEHP_FBA_SKILL_AND_SCHOOL_GOAL_BLOCKS).toContain("escape/avoidance");
    expect(result.values.IEHP_FBA_SKILL_AND_SCHOOL_GOAL_BLOCKS).toContain("desired item");
    expect(result.values.IEHP_FBA_SKILL_AND_SCHOOL_GOAL_BLOCKS).toContain("allowing escape");
  });

  it("adds explicit function and consequence evidence to structured IEHP goal blocks", () => {
    const result = buildIehpDocxPayload({
      ...baseArgs,
      templateFields: [{ field_key: "IEHP_FBA_SKILL_AND_SCHOOL_GOAL_BLOCKS", required: true }],
      checklistItems: [
        {
          placeholder_key: "IEHP_FBA_SKILL_AND_SCHOOL_GOAL_BLOCKS",
          required: true,
          status: "approved" as const,
          value_text: null,
          value_json: null,
        },
      ],
      structuredSections: [
        {
          field_key: "IEHP_FBA_SKILL_AND_SCHOOL_GOAL_BLOCKS",
          section_key: "goals",
          section_index: 0,
          payload: {
            raw_text:
              "Structured goal text notes escape behaviors and access to tangibles but lacks explicit parity phrases.",
          },
          status: "approved" as const,
          required: true,
        },
      ],
      acceptedGoals: [],
    });

    expect(result.preflight.ready).toBe(true);
    expect(result.values.IEHP_FBA_SKILL_AND_SCHOOL_GOAL_BLOCKS).toContain("access to tangibles");
    expect(result.values.IEHP_FBA_SKILL_AND_SCHOOL_GOAL_BLOCKS).toContain("escape/avoidance");
    expect(result.values.IEHP_FBA_SKILL_AND_SCHOOL_GOAL_BLOCKS).toContain("desired item");
    expect(result.values.IEHP_FBA_SKILL_AND_SCHOOL_GOAL_BLOCKS).toContain("allowing escape");
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

  it("keeps IEHP manifest fields covered by checklist metadata and output preflight", () => {
    const manifestPath = join(process.cwd(), "docs", "fill_docs", "iehp_fba_layout_manifest.json");
    const checklistPath = join(process.cwd(), "docs", "fill_docs", "iehp_fba_field_extraction_checklist.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      fields: Array<{ field_key: string; required: boolean; mode: string; source: string }>;
    };
    const checklist = JSON.parse(readFileSync(checklistPath, "utf8")) as {
      rows: Array<{ placeholder_key: string; required: boolean; mode: string; source: string }>;
    };
    const checklistByKey = new Map(checklist.rows.map((field) => [field.placeholder_key, field]));
    const duplicateManifestKeys = manifest.fields
      .map((field) => field.field_key)
      .filter((key, index, keys) => keys.indexOf(key) !== index);

    expect(duplicateManifestKeys).toEqual([]);
    expect(manifest.fields.length).toBeGreaterThan(40);
    for (const field of manifest.fields) {
      const checklistField = checklistByKey.get(field.field_key);
      expect(checklistField, `${field.field_key} is missing checklist metadata`).toBeDefined();
      expect(checklistField?.required).toBe(field.required);
      expect(checklistField?.mode).toBe(field.mode);
      expect(checklistField?.source || field.source).toBeTruthy();
    }

    const manualRequired = manifest.fields
      .filter((field) => field.required && field.mode === "MANUAL")
      .map((field) => field.field_key);
    expect(manualRequired).toEqual(expect.arrayContaining(["IEHP_FBA_REFERRING_PROVIDER"]));

    const missingAssessorPhoneResult = buildIehpDocxPayload({
      ...baseArgs,
      templateFields: manifest.fields.map((field) => ({ field_key: field.field_key, required: field.required })),
      checklistItems: manifest.fields.map((field) => ({
        placeholder_key: field.field_key,
        required: field.required,
        status: field.required ? ("not_started" as const) : ("approved" as const),
        value_text: "",
        value_json: null,
      })),
      writer: {
        ...baseArgs.writer,
        phone: null,
      },
      acceptedGoals: [],
      structuredSections: [],
    });

    expect(missingAssessorPhoneResult.preflight.blockers).not.toContainEqual(
      expect.objectContaining({ key: "IEHP_FBA_ASSESSOR_PHONE" }),
    );
    expect(missingAssessorPhoneResult.preflight.blockers).not.toContainEqual(
      expect.objectContaining({ key: "IEHP_FBA_REFERRING_PROVIDER" }),
    );
  });
});
