import { expect } from "jsr:@std/expect";

import {
  buildIehpSkillsBehaviorsResult,
  type IehpSkillsBehaviorsSection,
} from "./iehp-skills-behaviors.ts";

Deno.test("buildIehpSkillsBehaviorsResult reconciles summary and detailed IEHP targets", () => {
  const sections: IehpSkillsBehaviorsSection[] = [
    {
      field_key: "IEHP_FBA_BEHAVIOR_SKILL_TARGETS",
      section_index: 0,
      payload: {
        targets: [
          "Physical Aggression",
          "Functional Communication",
          "Community Safety",
          "Conflicting Target",
        ],
      },
    },
    {
      field_key: "IEHP_FBA_TARGET_BEHAVIOR_INTERVENTION_BLOCKS",
      section_index: 0,
      payload: {
        goal_type: "child",
        program_name: "Physical Aggression",
        target_behavior: "Hit peers",
      },
    },
    {
      field_key: "IEHP_FBA_SKILL_AND_SCHOOL_GOAL_BLOCKS",
      section_index: 0,
      payload: {
        goal_type: "child",
        program_name: "Functional Communication",
      },
    },
    {
      field_key: "IEHP_FBA_TARGET_BEHAVIOR_INTERVENTION_BLOCKS",
      section_index: 1,
      payload: {
        goal_type: "child",
        program_name: "Waiting",
        clinical_goal_type: "skill",
      },
    },
    {
      field_key: "IEHP_FBA_SKILL_AND_SCHOOL_GOAL_BLOCKS",
      section_index: 1,
      payload: {
        goal_type: "parent",
        program_name: "Parent Coaching",
      },
    },
    {
      field_key: "IEHP_FBA_TARGET_BEHAVIOR_INTERVENTION_BLOCKS",
      section_index: 2,
      payload: {
        goal_type: "child",
        program_name: "Conflicting Target",
      },
    },
    {
      field_key: "IEHP_FBA_SKILL_AND_SCHOOL_GOAL_BLOCKS",
      section_index: 2,
      payload: {
        goal_type: "child",
        title: "  conflicting   target!! ",
      },
    },
  ];
  const original = JSON.parse(JSON.stringify(sections));

  const result = buildIehpSkillsBehaviorsResult(sections);

  expect(result?.version).toBe(1);
  expect(
    result?.items.map(({ name, clinical_goal_type, reconciliation_status }) => ({
      name,
      clinical_goal_type,
      reconciliation_status,
    })),
  ).toEqual([
    { name: "Physical Aggression", clinical_goal_type: "behavior", reconciliation_status: "matched" },
    { name: "Functional Communication", clinical_goal_type: "skill", reconciliation_status: "matched" },
    { name: "Community Safety", clinical_goal_type: null, reconciliation_status: "summary_only" },
    { name: "Conflicting Target", clinical_goal_type: null, reconciliation_status: "ambiguous" },
    { name: "Waiting", clinical_goal_type: "skill", reconciliation_status: "detailed_only" },
  ]);
  expect(result?.items[0]).toMatchObject({
    name: "Physical Aggression",
    summary_target_index: 0,
    matched_goal_refs: [{ field_key: "IEHP_FBA_TARGET_BEHAVIOR_INTERVENTION_BLOCKS", section_index: 0 }],
    classification_source: "detailed_goal_field_key",
  });
  expect(result?.items[1]).toMatchObject({
    name: "Functional Communication",
    summary_target_index: 1,
    matched_goal_refs: [{ field_key: "IEHP_FBA_SKILL_AND_SCHOOL_GOAL_BLOCKS", section_index: 0 }],
    classification_source: "detailed_goal_field_key",
  });
  expect(result?.items[2]).toMatchObject({
    name: "Community Safety",
    summary_target_index: 2,
    matched_goal_refs: [],
    classification_source: null,
  });
  expect(result?.items[3]).toMatchObject({
    name: "Conflicting Target",
    summary_target_index: 3,
    matched_goal_refs: [
      { field_key: "IEHP_FBA_TARGET_BEHAVIOR_INTERVENTION_BLOCKS", section_index: 2 },
      { field_key: "IEHP_FBA_SKILL_AND_SCHOOL_GOAL_BLOCKS", section_index: 2 },
    ],
    classification_source: null,
  });
  expect(result?.items[4]).toMatchObject({
    name: "Waiting",
    summary_target_index: null,
    matched_goal_refs: [{ field_key: "IEHP_FBA_TARGET_BEHAVIOR_INTERVENTION_BLOCKS", section_index: 1 }],
    classification_source: "explicit_goal_type",
  });
  expect(result?.items.some((item) => item.name === "Parent Coaching")).toBe(false);
  expect(result?.counts).toEqual({
    total: 5,
    behavior: 1,
    skill: 2,
    summary_only: 1,
    detailed_only: 1,
    ambiguous: 1,
  });
  expect(sections).toEqual(original);
});

Deno.test("buildIehpSkillsBehaviorsResult returns null when the summary section is absent", () => {
  expect(buildIehpSkillsBehaviorsResult([])).toBeNull();
});
