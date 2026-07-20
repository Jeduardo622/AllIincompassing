import { buildIehpSkillsBehaviorsResult } from "../../supabase/functions/extract-assessment-fields/iehp-skills-behaviors.ts";

export const IEHP_SKILLS_BEHAVIORS_SUMMARY_FIELD_KEY = "IEHP_FBA_BEHAVIOR_SKILL_TARGETS";

export interface IehpSkillsBehaviorsStructuredRow {
  id?: string;
  field_key?: string | null;
  section_index?: number | null;
  payload?: Record<string, unknown> | null;
}

export const withDerivedIehpSkillsBehaviors = <Row extends IehpSkillsBehaviorsStructuredRow>(
  sections: Row[],
): Row[] => {
  const summarySection = sections.find((section) => section.field_key === IEHP_SKILLS_BEHAVIORS_SUMMARY_FIELD_KEY);
  if (!summarySection?.payload) {
    return sections;
  }

  const skillsBehaviors = buildIehpSkillsBehaviorsResult(
    sections
      .filter((section) => typeof section.field_key === "string" && typeof section.section_index === "number" && section.payload)
      .map((section) => ({
        field_key: section.field_key as string,
        section_index: section.section_index as number,
        payload: section.payload as Record<string, unknown>,
      })),
  );

  return sections.map((section) => {
    if (section !== summarySection || !section.payload) {
      return section;
    }

    return {
      ...section,
      payload: {
        ...section.payload,
        skills_behaviors: skillsBehaviors,
      },
    };
  });
};
