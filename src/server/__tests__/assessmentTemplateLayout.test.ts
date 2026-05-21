import { describe, expect, it } from "vitest";
import { loadChecklistTemplateRows } from "../assessmentChecklistTemplate";
import { loadIehpLayoutManifest } from "../assessmentTemplateLayout";

describe("IEHP FBA layout manifest", () => {
  it("covers the 30-page DOCX template, 22 DOCX tables, and all checklist keys", async () => {
    const [manifest, checklistRows] = await Promise.all([
      loadIehpLayoutManifest(),
      loadChecklistTemplateRows("iehp_fba"),
    ]);

    expect(manifest.page_count).toBe(30);
    expect(manifest.pages).toHaveLength(30);
    expect(manifest.table_count).toBe(22);

    const fieldKeys = new Set(manifest.fields.map((field) => field.field_key));
    const missingChecklistKeys = checklistRows
      .map((row) => row.placeholder_key)
      .filter((placeholderKey) => !fieldKeys.has(placeholderKey));
    expect(missingChecklistKeys).toEqual([]);

    [
      "IEHP_FBA_PCP_VISIT_SUMMARY",
      "IEHP_FBA_PCP_ASSISTANCE_REQUEST",
      "IEHP_FBA_CLINICAL_INTERVIEW_NARRATIVE",
      "IEHP_FBA_FIRST_MEMBER_OBSERVATION",
      "IEHP_FBA_SECOND_MEMBER_OBSERVATION",
      "IEHP_FBA_PREFERENCE_REINFORCERS_TABLE",
      "IEHP_FBA_SKILL_BASELINE_LOCATION_TABLE",
      "IEHP_FBA_TEACHING_INTERVENTION_STRATEGIES",
      "IEHP_FBA_FAMILY_INVOLVEMENT",
      "IEHP_FBA_RECOMMENDATION_NOTES",
      "IEHP_FBA_CAREGIVER_PARTICIPATION",
      "IEHP_FBA_TREATMENT_PLAN_REVIEW",
      "IEHP_FBA_ADDITIONAL_NOTES",
      "IEHP_FBA_APPENDIX_SUPPORTING_INFORMATION",
    ].forEach((fieldKey) => expect(fieldKeys.has(fieldKey)).toBe(true));

    const fieldPages = new Map(manifest.fields.map((field) => [field.field_key, field.page_number]));
    expect(fieldPages.get("IEHP_FBA_RECOMMENDATION_NOTES")).toBe(24);
    expect(fieldPages.get("IEHP_FBA_CAREGIVER_PARTICIPATION")).toBe(25);
    expect(fieldPages.get("IEHP_FBA_TREATMENT_PLAN_REVIEW")).toBe(26);
    expect(fieldPages.get("IEHP_FBA_ADDITIONAL_NOTES")).toBe(27);
    expect(fieldPages.get("IEHP_FBA_APPENDIX_SUPPORTING_INFORMATION")).toBe(28);
  });
});

