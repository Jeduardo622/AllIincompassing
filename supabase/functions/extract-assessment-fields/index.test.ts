import { expect } from "jsr:@std/expect";

import { __TESTING__ } from "./index.ts";

const asSections = (template: "iehp_fba" | "caloptima_fba", text: string) =>
  __TESTING__.extractStructuredSections(text, template);

Deno.test("extractStructuredSections parses IEHP target and skill goal subsections as parent goals", () => {
  const sections = asSections(
    "iehp_fba",
    `
      BEHAVIOR INTERVENTION PLAN
      Short term: by date increase compliance from 10% to 90%.
      Intermediate: improve across settings.
      Progress: review after 30 days.
      Safety Procedure
      School Goals
      Short term: functional communication at school.
      Intermediate: respond to adult prompts.
      Progress: mastery sustained for 4 weeks.
      Coordination of Care
    `,
  );

  const targetSections = sections.filter((section) =>
    section.field_key === "IEHP_FBA_TARGET_BEHAVIOR_INTERVENTION_BLOCKS",
  );
  const schoolSections = sections.filter((section) =>
    section.field_key === "IEHP_FBA_SKILL_AND_SCHOOL_GOAL_BLOCKS",
  );

  expect(targetSections).toHaveLength(3);
  expect(targetSections.every((section) => section.payload.goal_type === "parent")).toBe(true);
  expect(targetSections.map((section) => section.payload.subsection)).toEqual([
    "short",
    "intermediate",
    "progress",
  ]);

  expect(schoolSections).toHaveLength(3);
  expect(schoolSections.every((section) => section.payload.goal_type === "parent")).toBe(true);
  expect(schoolSections.map((section) => section.payload.subsection)).toEqual([
    "short",
    "intermediate",
    "progress",
  ]);
});

Deno.test("extractStructuredSections parses strict subsection headers only at IEHP subsection lines", () => {
  const sections = asSections(
    "iehp_fba",
    `
      BEHAVIOR INTERVENTION PLAN
      Short-term: the team observed no baseline concerns.
      This line contains short-term in context and should not split.
      Intermediate: one step after baseline.
      Progress: evidence of improvement.
      Safety Procedure
      School Goals
      Short Term: school attendance.
      Intermediate: social initiations.
      Progress: mastery sustained for 6 weeks.
      Coordination of Care
    `,
  );

  const targetSections = sections.filter((section) =>
    section.field_key === "IEHP_FBA_TARGET_BEHAVIOR_INTERVENTION_BLOCKS",
  );
  const schoolSections = sections.filter((section) =>
    section.field_key === "IEHP_FBA_SKILL_AND_SCHOOL_GOAL_BLOCKS",
  );

  expect(targetSections.map((section) => section.payload.subsection)).toEqual([
    "short",
    "intermediate",
    "progress",
  ]);
  expect(schoolSections.map((section) => section.payload.subsection)).toEqual([
    "short",
    "intermediate",
    "progress",
  ]);
});

Deno.test("extractStructuredSections does not duplicate Parent Education goals already inside IEHP treatment span", () => {
  const sections = asSections(
    "iehp_fba",
    `
      BEHAVIOR INTERVENTION PLAN
      Short term: reduce elopement from five episodes to one episode.
      Intermediate: use a break card across settings.
      Progress: maintain reduced elopement for four weeks.
      Parent Education
      Short term: caregiver will identify prevention steps.
      Intermediate: caregiver will model replacement prompting.
      Progress: caregiver will generalize the plan at home.
      Safety Procedure
      Coordination of Care
    `,
  );

  const targetSections = sections.filter((section) =>
    section.field_key === "IEHP_FBA_TARGET_BEHAVIOR_INTERVENTION_BLOCKS",
  );
  const parentEducationSections = targetSections.filter((section) =>
    String(section.payload.raw_text ?? "").includes("caregiver"),
  );
  const uniqueRawTexts = new Set(targetSections.map((section) => section.payload.raw_text));

  expect(targetSections).toHaveLength(6);
  expect(parentEducationSections).toHaveLength(3);
  expect(uniqueRawTexts.size).toBe(6);
  expect(targetSections.map((section) => section.section_index)).toEqual([0, 1, 2, 3, 4, 5]);
});
