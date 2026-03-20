import { describe, expect, it } from "vitest";
import { composeAssessmentTextFromChecklist } from "../api/assessment-text-composer";

describe("composeAssessmentTextFromChecklist", () => {
  it("prioritizes goal-related sections before background sections", () => {
    const output = composeAssessmentTextFromChecklist([
      {
        section_key: "background_school_history",
        label: "Background",
        placeholder_key: "BACKGROUND",
        value_text: "Long background narrative",
        value_json: null,
      },
      {
        section_key: "goals_treatment_planning",
        label: "Skill Acquisition Goal 1",
        placeholder_key: "CALOPTIMA_FBA_SKILL_ACQUISITION_GOALS",
        value_text: "Follow one-step directions in 80% opportunities.",
        value_json: null,
      },
    ]);

    expect(output.startsWith("GOALS TREATMENT PLANNING")).toBe(true);
    expect(output).toContain("BACKGROUND SCHOOL HISTORY");
  });

  it("keeps structured mastery criteria even when value_text exists", () => {
    const output = composeAssessmentTextFromChecklist([
      {
        section_key: "goals_treatment_planning",
        label: "Skill Acquisition Goal 1",
        placeholder_key: "CALOPTIMA_FBA_SKILL_ACQUISITION_GOALS",
        value_text: "Rolando will follow one-step directions.",
        value_json: {
          target_criteria: "60% of opportunities across 4 weeks",
          mastery_criteria: "80% of opportunities across 4 weeks",
          maintenance_criteria: "80% at 2 and 4 weeks",
          generalization_criteria: "Across home and community with 2 adults",
        },
      },
    ]);

    expect(output).toContain("mastery_criteria: 80% of opportunities across 4 weeks");
    expect(output).toContain("maintenance_criteria: 80% at 2 and 4 weeks");
    expect(output).toContain("generalization_criteria: Across home and community with 2 adults");
  });

  it("truncates long string values from value_json", () => {
    const longValue = "x".repeat(500);
    const output = composeAssessmentTextFromChecklist([
      {
        section_key: "goals_treatment_planning",
        label: "Skill Acquisition Goal 1",
        placeholder_key: "CALOPTIMA_FBA_SKILL_ACQUISITION_GOALS",
        value_text: "Rolando will follow one-step directions.",
        value_json: {
          target_criteria: longValue,
        },
      },
    ]);

    expect(output).toContain("target_criteria:");
    expect(output).toContain("...");
    expect(output).not.toContain(`target_criteria: ${longValue}`);
  });
});
