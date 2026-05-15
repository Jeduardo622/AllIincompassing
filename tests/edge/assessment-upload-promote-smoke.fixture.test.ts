import { describe, expect, it } from "vitest";

import {
  buildSyntheticAssessmentFixtureText,
  EXPECTED_CHILD_GOALS,
  EXPECTED_PARENT_GOALS,
} from "../../scripts/playwright-assessment-upload-promote-smoke";
import {
  extractStructuredGoalSections,
  summarizeStructuredGoalSections,
} from "../../supabase/functions/extract-assessment-fields/structured-goals";

describe("assessment upload promote smoke fixture structured goals", () => {
  it("produces every above-cap child and parent goal section from synthetic CalOptima text", () => {
    const sections = extractStructuredGoalSections(buildSyntheticAssessmentFixtureText());
    const summary = summarizeStructuredGoalSections(sections);

    expect(summary.childGoalCount).toBe(EXPECTED_CHILD_GOALS);
    expect(summary.parentGoalCount).toBe(EXPECTED_PARENT_GOALS);
    expect(summary.childGoalCount).toBeGreaterThan(20);
    expect(summary.parentGoalCount).toBeGreaterThan(6);
    expect(sections).toHaveLength(EXPECTED_CHILD_GOALS + EXPECTED_PARENT_GOALS);
    expect(
      sections.filter((section) => section.field_key === "CALOPTIMA_FBA_TARGET_REPLACEMENT_GOALS"),
    ).toHaveLength(10);
    expect(
      sections.filter((section) => section.field_key === "CALOPTIMA_FBA_SKILL_ACQUISITION_GOALS"),
    ).toHaveLength(11);
    expect(sections.filter((section) => section.field_key === "CALOPTIMA_FBA_PARENT_GOALS")).toHaveLength(7);
    expect(sections.every((section) => section.payload.program_name)).toBe(true);
    expect(sections.every((section) => section.payload.original_text)).toBe(true);
  });
});
