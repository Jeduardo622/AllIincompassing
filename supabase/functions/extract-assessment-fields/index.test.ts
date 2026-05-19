import { expect } from "jsr:@std/expect";

import { __TESTING__ } from "./index.ts";

const asSections = (template: "iehp_fba" | "caloptima_fba", text: string) =>
  __TESTING__.extractStructuredSections(text, template);

Deno.test("extractStructuredSections parses IEHP target and skill goal subsections as child goals", () => {
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
  expect(targetSections.every((section) => section.payload.goal_type === "child")).toBe(true);
  expect(targetSections.map((section) => section.payload.subsection)).toEqual([
    "short",
    "intermediate",
    "progress",
  ]);

  expect(schoolSections).toHaveLength(3);
  expect(schoolSections.every((section) => section.payload.goal_type === "child")).toBe(true);
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
  expect(parentEducationSections.every((section) => section.payload.goal_type === "parent")).toBe(true);
  expect(parentEducationSections.every((section) => section.payload.program_name === "Parent Education")).toBe(true);
});

Deno.test("extractStructuredSections preserves parent goal type for Parent Education fallback subsections", () => {
  const sections = asSections(
    "iehp_fba",
    `
      BEHAVIOR INTERVENTION PLAN
      Short term: reduce elopement from five episodes to one episode.
      Intermediate: use a break card across settings.
      Progress: maintain reduced elopement for four weeks.
      Safety Procedure
      Parent Education
      Short term: identify prevention steps with 80% accuracy.
      Intermediate: model replacement prompting across three routines.
      Progress: generalize the plan at home for four consecutive weeks.
      Coordination of Care
    `,
  );

  const parentEducationSections = sections.filter((section) =>
    section.field_key === "IEHP_FBA_SKILL_AND_SCHOOL_GOAL_BLOCKS" &&
    section.payload.program_name === "Parent Education"
  );

  expect(parentEducationSections).toHaveLength(3);
  expect(parentEducationSections.map((section) => section.payload.subsection)).toEqual([
    "short",
    "intermediate",
    "progress",
  ]);
  expect(parentEducationSections.every((section) => section.payload.goal_type === "parent")).toBe(true);
});

Deno.test("extractStructuredSections maps LE-style IEHP headings into normalized structured payloads", () => {
  const sections = asSections(
    "iehp_fba",
    `
      BEHAVIORS
      The behaviors and functional skills to be addressed are:
      Physical Aggression
      Functional Communication
      BACKGROUND INFORMATION:
      Living Situation
      Member lives with two caregivers and needs supervision.
      School Information
      Member attends a local high school.
      Health and Medical
      Medical summary narrative.
      Current Services and Activities
      School-based services only.
      Intervention History
      Prior ABA ended last year.
      Availability for Behavior Health Treatment Services
      Monday Tuesday Wednesday Thursday Friday Saturday
      After 3:30 PM After 3:30 PM After 3:30 PM After 3:30 PM After 3:30 PM Starting 9:00 AM
      MEMBER’S ENVIRONMENTAL ANALYSIS:
      Availability and Access to reinforcers: Yes No
      Availability of developmental toys/materials: Yes No
      Level of noise/Environmental Distractions: None Fair High
      DESCRIPTION OF ASSESSMENT PROCEDURES:
      Procedures: Date and Location: Person involved (indicate credentials):
      Records Reviewed: 12/05/2025 Telehealth BCBA
      Clinical Interview: 12/01/2025 Telehealth BCBA
      Records reviewed included:
      Psychoeducational evaluation by Test District (04/10/2025)
      Preference Assessment
      Preference Areas: Potential Reinforcers:
      Social praise
      Sensory fidgets
      ASSESSMENT MEAURES:
      Vineland Adaptive Behavior Scales, 3rd Edition
      Date Administered:12/01/2025
      Name of Interviewer:Test BCBA
      Name of Respondent:Caregiver One
      Assessment Summary: Adaptive functioning summary.
      Target Behaviors
      TARGET BEHAVIORS:
      Program Name: Physical aggression
      Instrumental Goal: By December 2027, member will reduce aggression from 3x per hour to 0x per hour.
      Data Collection: Rate.
      Mastery Criteria: 0x per hour across 4 consecutive weeks.
      Generalization Criteria: Across home and school.
      Baseline: 3x per hour.
      REPLACEMENT BEHAVIORS:
      Program Name: Mand for wants and needs
      Instrumental Goal: By December 2027, member will request help across 5 targets.
      Data Collection: Percentage of opportunities.
      Mastery Criteria: 80% across 4 consecutive weeks.
      Generalization Criteria: Across home and school.
      Baseline: 0% independent.
      Behavior Intervention Plan
      Antecedent and consequence strategies narrative.
      Safety/Crisis Procedure
      Crisis safety narrative.
      E. PARENT EDUCATION:
      Program Name: Identifying ABC data
      Instrumental Goal: By December 2027, caregiver will identify ABC data.
      Data Collection: Percentage of opportunities
      Mastery Criteria: 80% across 4 consecutive weeks.
      Baseline: 0% independent
      Location of Service:
      Home and school.
      Coordination of Care:
      Coordination narrative.
      Discharge Criteria:
      Discharge criteria narrative.
      Transition of Care:
      Transition narrative.
      Recommendations:
      Clinical Recommendations
      CPT Description Units Requested
      H2019 Therapeutic Behavioral Services, per 15 minutes 2080 units
      H0032 Mental Health Service Plan Development by Non-Physician, per 15 minutes 936 units
      H0032-HO Top-Tier Supervision by BCBA 208 units
      S5111 Home Care Training, Family; per session N/A
      Report completed by:
      _____________________________________ 12/12/2025
      Test BCBA Date:
      Board Certified Behavior Analyst, 1-24-00000
      Test Agency
    `,
  );

  const byKey = new Map(sections.map((section) => [section.field_key, section]));
  [
    "IEHP_FBA_BEHAVIOR_SKILL_TARGETS",
    "IEHP_FBA_BHT_AVAILABILITY_GRID",
    "IEHP_FBA_ENVIRONMENTAL_ANALYSIS",
    "IEHP_FBA_ASSESSMENT_PROCEDURES_TABLE",
    "IEHP_FBA_RECORDS_REVIEWED_TABLE",
    "IEHP_FBA_PREFERENCE_ASSESSMENT_SUMMARY",
    "IEHP_FBA_ADAPTIVE_MEASURE_SUMMARIES",
    "IEHP_FBA_CRISIS_PLAN",
    "IEHP_FBA_COORDINATION_OF_CARE",
    "IEHP_FBA_DISCHARGE_TRANSITION_EXIT_PLAN",
    "IEHP_FBA_RECOMMENDATIONS_HCPCS_ROWS",
    "IEHP_FBA_SIGNATURE_BLOCK",
  ].forEach((fieldKey) => expect(byKey.has(fieldKey)).toBe(true));

  expect((byKey.get("IEHP_FBA_BHT_AVAILABILITY_GRID")?.payload.rows as unknown[]).length).toBeGreaterThan(4);
  expect(byKey.get("IEHP_FBA_BEHAVIOR_SKILL_TARGETS")?.payload.targets).toEqual([
    "Physical Aggression",
    "Functional Communication",
  ]);
  expect((byKey.get("IEHP_FBA_RECOMMENDATIONS_HCPCS_ROWS")?.payload.rows as unknown[]).length).toBeGreaterThan(2);
  expect(byKey.get("IEHP_FBA_SIGNATURE_BLOCK")?.payload.report_completed_date).toBe("12/12/2025");
  expect(byKey.get("IEHP_FBA_DISCHARGE_TRANSITION_EXIT_PLAN")?.payload.transition_of_care).toContain("Transition");

  const behaviorGoals = sections.filter((section) => section.field_key === "IEHP_FBA_TARGET_BEHAVIOR_INTERVENTION_BLOCKS");
  const skillAndParentGoals = sections.filter((section) => section.field_key === "IEHP_FBA_SKILL_AND_SCHOOL_GOAL_BLOCKS");
  expect(behaviorGoals.some((section) => section.payload.goal_type === "child" && section.payload.program_name === "Physical aggression")).toBe(true);
  expect(skillAndParentGoals.some((section) => section.payload.goal_type === "child" && section.payload.program_name === "Mand for wants and needs")).toBe(true);
  expect(skillAndParentGoals.some((section) => section.payload.goal_type === "parent" && section.payload.program_name === "Identifying ABC data")).toBe(true);
  expect(skillAndParentGoals.filter((section) => section.payload.goal_type === "parent")).toHaveLength(1);
});

Deno.test("extractStructuredSections recognizes blank-template IEHP heading aliases", () => {
  const sections = asSections(
    "iehp_fba",
    `
      Intervention History -
      Prior services narrative.
      Availability for BHT Services -
      BHT Availability
      M Tu W Th F Sat Sun Total
      Session Time (e.g. 10am-12pm): After 3:30 PM After 3:30 PM After 3:30 PM Starting 9:00 AM
      MEMBER’S ENVIRONMENTAL ANALYSIS:
      Availability and a ccess to reinforcers: FORMCHECKBOX Yes FORMCHECKBOX No
      Availability of visual schedules/timers: FORMCHECKBOX Yes FORMCHECKBOX No
      Environment c onducive to QASP p olicy on c leanliness? FORMCHECKBOX Yes FORMCHECKBOX No
      Level of noise/ e nvironmental d istractions: FORMCHECKBOX None FORMCHECKBOX Fair FORMCHECKBOX High
      DESCRIPTION OF ASSESSMENT PROCEDURES:
      Procedures: Date and Location: Person involved (indicate credentials):
      Record s Reviewed: 01/02/2026 Telehealth BCBA
      1 st Member Observation: 01/03/2026 Home BCBA
      Brief Functional Analysis: 01/04/2026 Clinic BCBA
      Records reviewed included:
      Template-only record title (01/05/2026)
      Preference Assessment-
      Preference Areas: Potential Reinforcers:
      Social praise
      ASSESSMENT MEAURES:
      Assessment Summary: Template adaptive summary.
      Target Behaviors
      Safety Procedure/Crisis Plan-
      Template safety narrative.
      Coordination of Care:
      Template coordination narrative.
      Discharge, Transition and Exit Plans:
      Exit Plan (formerly Discharge/Graduation)
      Discharge criteria narrative.
      Transition Planning:
      Transition planning narrative.
      Recommendations:
      Clinical Recommendations
      CPT Description Units Requested
      H2019 Therapeutic Behavioral Services, per 15 minutes 10 units
      Report completed by:
      Template BCBA Date:
    `,
  );

  const byKey = new Map(sections.map((section) => [section.field_key, section]));
  expect(byKey.has("IEHP_FBA_BHT_AVAILABILITY_GRID")).toBe(true);
  expect((byKey.get("IEHP_FBA_ENVIRONMENTAL_ANALYSIS")?.payload.rows as unknown[]).length).toBeGreaterThanOrEqual(4);
  expect((byKey.get("IEHP_FBA_ASSESSMENT_PROCEDURES_TABLE")?.payload.rows as unknown[]).length).toBeGreaterThanOrEqual(3);
  expect(byKey.get("IEHP_FBA_CRISIS_PLAN")?.payload.raw_text).toContain("Safety Procedure");
  expect(byKey.get("IEHP_FBA_DISCHARGE_TRANSITION_EXIT_PLAN")?.payload.raw_text).toContain("Transition Planning");
  expect((byKey.get("IEHP_FBA_RECOMMENDATIONS_HCPCS_ROWS")?.payload.rows as unknown[]).length).toBe(1);
});

Deno.test("deterministicValueForRow keeps manual and assisted IEHP rows honest when text is extracted", () => {
  const assisted = __TESTING__.deterministicValueForRow(
    {
      section: "behavior_background_services",
      label: "Language",
      placeholder_key: "IEHP_FBA_LANGUAGE",
      required: true,
      mode: "ASSISTED",
    },
    "Language:\nVietnamese\nReferral Date:\n10/03/2025",
  );
  const manual = __TESTING__.deterministicValueForRow(
    {
      section: "identification_admin",
      label: "Reason for Referral",
      placeholder_key: "IEHP_FBA_REASON_FOR_REFERRAL",
      required: true,
      mode: "MANUAL",
    },
    "Reason for Referral:\nCaregiver requested ABA assessment.\nBEHAVIORS",
  );

  expect(assisted.mode).toBe("ASSISTED");
  expect(assisted.confidence ?? 1).toBeLessThan(0.8);
  expect(manual.mode).toBe("MANUAL");
  expect(manual.confidence ?? 1).toBeLessThan(0.6);
});
