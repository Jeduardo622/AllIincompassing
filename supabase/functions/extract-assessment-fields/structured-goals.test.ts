import { expect } from "jsr:@std/expect";

import {
  extractStructuredGoalSections,
  summarizeStructuredGoalSections,
} from "./structured-goals.ts";

Deno.test("extractStructuredGoalSections parses embedded CalOptima goal headings", () => {
  const text = `
    XIV. TARGET AND REPLACEMENT BEHAVIOR GOALS intro text Replacement Behavior Goal 1 - Long-term By August 2026, the client will request access using functional communication in 80% of opportunities. Program: Behavior Treatment Baseline: 0% of opportunities Objective data point: date: 07/01/2025 | value: 8 | unit: episodes Measurement Type: Percent opportunities Target Criteria: 80% across 4 consecutive weeks.
    N/A 2. Skill Acquisition Goal 2: Long-term By December 2026, the client will point to pictures in a book in 80% of opportunities. Program: Skill Acquisition Baseline Data with dates: 0% of opportunities Measurement Type: Percent opportunities Target Criteria: 80% across 4 consecutive weeks.
    XVI. PARENT/CAREGIVER GOALS A. Parent/Caregiver Goal 1: Long-term by August 2026, caregiver will prompt functional communication in 90% of opportunities. Program: Parent Training Baseline Data and Date: 0% of opportunities Measurement Type: Percent opportunities Target Criteria: 90% across 4 consecutive weeks.
  `;

  const sections = extractStructuredGoalSections(text);
  expect(sections.length).toBe(3);
  expect(sections.map((section) => section.field_key)).toEqual([
    "CALOPTIMA_FBA_TARGET_REPLACEMENT_GOALS",
    "CALOPTIMA_FBA_SKILL_ACQUISITION_GOALS",
    "CALOPTIMA_FBA_PARENT_GOALS",
  ]);
  expect(sections[0].payload.goal_type).toBe("child");
  expect(sections[0].payload.program_name).toBe("Behavior Treatment");
  expect(sections[1].payload.program_name).toBe("Skill Acquisition");
  expect(sections[2].payload.goal_type).toBe("parent");
  expect(sections[2].payload.program_name).toBe("Parent Training");
  expect(sections[0].payload.baseline_data).toContain("0%");
  expect(sections[0].payload.objective_data_points).toEqual(["date: 07/01/2025", "value: 8", "unit: episodes"]);
  expect(sections[0].payload.measurement_type).toContain("Percent");
});

Deno.test("summarizeStructuredGoalSections counts child and parent sections", () => {
  const sections = extractStructuredGoalSections(`
    Replacement Behavior Goal 1: Child target with enough narrative detail for extraction.
    Skill Acquisition Goal 1: Child skill with enough narrative detail for extraction.
    Parent/Caregiver Goal 1: Parent training with enough narrative detail for extraction.
  `);

  expect(summarizeStructuredGoalSections(sections)).toEqual({
    childGoalCount: 2,
    parentGoalCount: 1,
  });
});
