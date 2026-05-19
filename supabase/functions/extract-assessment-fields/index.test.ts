import { expect } from "jsr:@std/expect";

import { __TESTING__ } from "./index.ts";

const asSections = (template: "iehp_fba" | "caloptima_fba", text: string) =>
  __TESTING__.extractStructuredSections(text, template);

const calOptimaRedactedStyleExcerpt = `
  CalOptima Health Functional Behavior Assessment / Initial Treatment Plan
  I. IDENTIFICATION
  Member Name: Sample Client
  Member DOB: CIN # 1/1/2022 12345678A
  Diagnoses/with ICD Code: Autism F84.0
  Guardian Name: Phone: Sample Guardian 555-123-4567
  Primary Care Provider: Known Allergies: Dr. Sample Provider N/A
  Current Medications/Dosage: Dietary Restrictions: N/A Gluten free
  Service Initiation Date Date ABA first began 7/1/2025 N/A
  Prior Applied Behavioral Health Agencies First time receiving ABA services
  Administrative Contact for Current Authorization Request
  Full Name and Title Sample Admin CEO
  Phone Number (951) 706-0028
  Fax Number (714) 494-8028
  Chief Complaint/Reason for Seeking Applied Behavior Analysis (ABA) Treatment:
  Caregivers are seeking ABA treatment to reduce tantrums and increase functional communication.
  II. DATA SOURCES
  Records Reviewed (e.g., Individualized Education Plan (IEP), therapy plans)
  Record Type Author of Record Date of Record
  Diagnostic Report Sample Psychologist 5/27/2025
  Interviews Conducted
  Initial Interview/Observation: Sample BCBA conducted the first interview at home on 7/7/2025.
  Second Interview/Observation: Sample BCBA conducted the second interview at daycare on 7/17/2025.
  III. BACKGROUND INFORMATION
  Individual Description/Living Arrangements: Sample Client lives with caregivers and siblings.
  Significant Medical History: Sample Client is in good health per caregiver report.
  Functional Communication Skills: Sample Client communicates through gestures and AAC prompts.
  Self-Care and Activities of Daily Living Skills: Sample Client requires support for hygiene and dressing.
  Social and Play Skills: Sample Client participates in parallel play with prompting.
  Mobility Functioning and Restrictions: Sample Client has no mobility restrictions.
  Daily schedule of all activities Monday Tuesday Wednesday Thursday Friday Saturday Sunday
  Daycare Daycare Daycare Daycare Daycare Family Family
  IV. SCHOOL INFORMATION
  Does the member have a current Individualized Educational Plan (IEP/equivalent)? ☒ Yes ☐ No
  Date of the current IEP/equivalent 6/1/2025
  Individualized Educational Plan (IEP/equivalent) Information (services, school hours):
  Speech School classroom 6/1/2025 6/1/2026 Weekly
  PREVIOUS INTERVENTIONS
  Name of Provider Service Provided Service Level Start Date End Date Reason for Termination
  N/A N/A N/A N/A N/A N/A
  IV. COORDINATION OF CARE
  Parent/Caregiver: Coordination will occur weekly with caregivers.
  School: Provider will coordinate with school team as needed.
  Regional Center: No active regional center services.
  Speech/OT/PT: Speech plan will be reviewed quarterly.
  Primary Care Provider/Specialist: Report will be shared with PCP.
  Mental Health Provider: N/A
  VII. ADAPTIVE TESTING
  Vineland Adaptive Behavior Scales, Third Edition
  Domain Raw Score Standard Score Age Equivalent
  Communication 10 55 1:6
  Daily Living Skills 12 60 1:8
  IX. DIAGNOSTIC INFORMATION
  Current diagnosis is Autism Spectrum Disorder F84.0.
  X. FUNCTIONAL ASSESSMENT OR ANALYSIS OF TARGET BEHAVIORS
  Target Behavior 1: Tantrum
  Identifying Behavior Crying, dropping, and screaming.
  Antecedents Denied access to preferred items.
  Consequences Caregiver attention and delayed transitions.
  XI. BEHAVIOR INTERVENTION PLAN
  Target Behavior 1:
  Ecological interventions Use visual schedule and transition warnings.
  Replacement behavior Request more time using AAC.
  Focused intervention Differential reinforcement of communication.
  Reactive strategies Keep client safe and prompt communication.
  Data collection procedures Frequency and ABC data.
  XII. MEDIATOR ANALYSIS
  Caregivers are available and expected to implement behavior plans with coaching.
  XIII. REINFORCER ASSESSMENT
  Reinforcers include bubbles, swings, songs, and snacks.
  XIV. TARGET AND REPLACEMENT BEHAVIOR GOALS
  Target Behavior Goal 1: Long-term By August 2026, Sample Client will reduce tantrums from 8 per week to 0 per day.
  Baseline Data and Date: 7/2025 8 per week
  Measurement Type: Frequency
  Mastery Criteria: 0 per day across 4 consecutive weeks.
  Generalization Criteria: Home and community.
  Replacement Behavior Goal 1: Long-term By August 2026, Sample Client will request preferred items using AAC in 80% of opportunities.
  Baseline Data and Date: 7/2025 0% independent
  Measurement Type: Percent opportunities
  Mastery Criteria: 80% across 4 consecutive weeks.
  XV. SKILL ACQUISITION GOALS
  A. Intervention Area: Communication
  1. Skill Acquisition Goal 1: Long-term By December 2026, Sample Client will use 20 functional words in 80% of opportunities.
  Baseline Data with dates: 7/2025 0% of opportunities
  Measurement Type: Percent opportunities
  Mastery Criteria: 80% across 4 consecutive weeks.
  XVI. PARENT/CAREGIVER GOALS
  A. Parent/Caregiver Goal 1: Long-term by December 2026, caregiver will prompt functional communication in 90% of opportunities.
  Baseline Data and Date: 7/2025 0% of opportunities
  Measurement Type: Percent opportunities
  Mastery Criteria: 90% across 4 consecutive weeks.
  XVII. PLAN FOR GENERALIZATION (INCLUDING TRANSITION TO NATURAL MEDIATORS) AND MAINTENANCE
  Data Collection: Caregivers will collect weekly data.
  Family/Caregiver Training and Monitoring: BCBA will coach caregivers monthly.
  Complete 1-4 below that describe the engagement with family/caregivers in position to affect patient behavior of the Medi-Cal-required exit plan.
  1. Please list exit plan/criteria. Discharge will be considered when goals maintain at 80% accuracy.
  XVIII. CRISIS PLAN
  Define what steps the member, family and provider should take in the event of a crisis.
  Caregivers will call emergency services for immediate danger and notify the BCBA.
  XX. SUMMARY AND RECOMMENDATIONS
  Provide a clinical summary that justifies hours requested for the next period.
  Sample Client meets medical necessity criteria for ABA services.
  HCPCS Code and Modifiers Description Requested Units Total Requested Units Location Parent/Caregiver Goals
  H0032-HN Assessment by QASP 24 24 In-home N/A
  H0032-HO Top-Tier Supervision by BCBA 16 416 In-home N/A
  H2019 Therapeutic Behavioral Services 160 4160 In-home and daycare N/A
  S5110 Home Care Training, Family 24 624 In home and daycare N/A
  Telehealth Consent Confirmation
  Verbal or written consent was obtained and documented from the Member/Member Parent/Guardian for the use of Telehealth ☒ Yes ☐ No ☐ N/A- No services conducted by telehealth
  If yes, please confirm the date consent obtained: 7/7/2025
  XXI. PARENT/CAREGIVER OR LEGAL GUARDIAN INVOLVEMENT
  Was the Parent/guardian involved in the development of the treatment plan? ☒ Yes ☐ No
  Is the parent/guardian in agreement with the submitted treatment plan? ☒ Yes ☐ No
  XVIII. SIGNATURES
  A. Report written by: (printed name, credentials) BCBA professional level Sample Writer, BCBA
  Title, License/Certificate #: BCBA 1-24-00000
  Date of Report Completed: 7/21/2025
  Signature: Date: 7/21/2025
  B. Report reviewed by: BCBA professional level Sample Reviewer, BCBA
  Title, License/Certificate #: BCBA 1-24-11111
  Date of Report Completed: 7/22/2025
  Signature: Date: 7/22/2025
  ** By signing, I attest that I have read, reviewed, and approved this proposed treatment plan.
`;

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

Deno.test("extractStructuredSections maps filled CalOptima redacted-report sections", () => {
  const sections = asSections("caloptima_fba", calOptimaRedactedStyleExcerpt);
  const byKey = new Map(sections.map((section) => [section.field_key, section]));

  [
    "CALOPTIMA_FBA_LIVING_ARRANGEMENTS",
    "CALOPTIMA_FBA_SIGNIFICANT_MEDICAL_HISTORY",
    "CALOPTIMA_FBA_FUNCTIONAL_COMMUNICATION_SKILLS",
    "CALOPTIMA_FBA_SELF_CARE_ADL_SKILLS",
    "CALOPTIMA_FBA_SOCIAL_PLAY_SKILLS",
    "CALOPTIMA_FBA_MOBILITY_FUNCTIONING_RESTRICTIONS",
    "CALOPTIMA_FBA_RECORDS_REVIEWED",
    "CALOPTIMA_FBA_DAILY_ACTIVITY_SCHEDULE",
    "CALOPTIMA_FBA_IEP_SERVICES_TABLE",
    "CALOPTIMA_FBA_PREVIOUS_INTERVENTIONS",
    "CALOPTIMA_FBA_COORDINATION_OF_CARE",
    "CALOPTIMA_FBA_VINELAND_DOMAIN_SCORES",
    "CALOPTIMA_FBA_TARGET_BEHAVIOR_BLOCKS",
    "CALOPTIMA_FBA_BIP_BLOCKS",
    "CALOPTIMA_FBA_MEDIATOR_ANALYSIS",
    "CALOPTIMA_FBA_REINFORCER_ASSESSMENT",
    "CALOPTIMA_FBA_TARGET_REPLACEMENT_GOALS",
    "CALOPTIMA_FBA_SKILL_ACQUISITION_GOALS",
    "CALOPTIMA_FBA_PARENT_GOALS",
    "CALOPTIMA_FBA_GENERALIZATION_MAINTENANCE_PLAN",
    "CALOPTIMA_FBA_TRANSITION_PLAN",
    "CALOPTIMA_FBA_CRISIS_PLAN",
    "CALOPTIMA_FBA_SUMMARY_RECOMMENDATIONS",
    "CALOPTIMA_FBA_HCPCS_RECOMMENDATION_ROWS",
    "CALOPTIMA_FBA_SIGNATURES",
  ].forEach((fieldKey) => expect(byKey.has(fieldKey)).toBe(true));

  expect((byKey.get("CALOPTIMA_FBA_HCPCS_RECOMMENDATION_ROWS")?.payload.rows as unknown[]).length).toBe(4);
  expect(byKey.get("CALOPTIMA_FBA_SIGNATURES")?.payload.report_completed_date).toBe("7/21/2025");
  expect(byKey.get("CALOPTIMA_FBA_TRANSITION_PLAN")?.payload.raw_text).toContain("Discharge will be considered");
  expect(byKey.get("CALOPTIMA_FBA_CRISIS_PLAN")?.payload.raw_text).toContain("emergency services");

  const parentGoals = sections.filter((section) => section.field_key === "CALOPTIMA_FBA_PARENT_GOALS");
  const childGoals = sections.filter((section) =>
    section.field_key === "CALOPTIMA_FBA_TARGET_REPLACEMENT_GOALS" ||
    section.field_key === "CALOPTIMA_FBA_SKILL_ACQUISITION_GOALS"
  );
  expect(parentGoals).toHaveLength(1);
  expect(parentGoals[0].payload.goal_type).toBe("parent");
  expect(childGoals.length).toBeGreaterThanOrEqual(3);
});

Deno.test("deterministicValueForRow extracts CalOptima filled-report scalars without over-promoting manual rows", () => {
  const rows = [
    {
      section: "identification_admin",
      label: "Member Name",
      placeholder_key: "CALOPTIMA_FBA_MEMBER_NAME",
      required: true,
      mode: "AUTO" as const,
    },
    {
      section: "background_school_history",
      label: "Current IEP/equivalent",
      placeholder_key: "CALOPTIMA_FBA_HAS_IEP",
      required: true,
      mode: "MANUAL" as const,
    },
    {
      section: "summary_recommendations_signatures",
      label: "Telehealth consent confirmation",
      placeholder_key: "CALOPTIMA_FBA_TELEHEALTH_CONSENT",
      required: true,
      mode: "MANUAL" as const,
    },
    {
      section: "summary_recommendations_signatures",
      label: "Report written by",
      placeholder_key: "CALOPTIMA_FBA_REPORT_WRITTEN_BY",
      required: true,
      mode: "AUTO" as const,
    },
    {
      section: "summary_recommendations_signatures",
      label: "Date of Report Completed",
      placeholder_key: "CALOPTIMA_FBA_REPORT_COMPLETED_DATE",
      required: true,
      mode: "AUTO" as const,
    },
  ];

  const byKey = new Map(rows.map((row) => [
    row.placeholder_key,
    __TESTING__.deterministicValueForRow(row, calOptimaRedactedStyleExcerpt, undefined, rows),
  ]));

  expect(byKey.get("CALOPTIMA_FBA_MEMBER_NAME")?.value_text).toBe("Sample Client");
  expect(byKey.get("CALOPTIMA_FBA_HAS_IEP")?.value_text).toBe("Yes");
  expect(byKey.get("CALOPTIMA_FBA_HAS_IEP")?.mode).toBe("MANUAL");
  expect(byKey.get("CALOPTIMA_FBA_HAS_IEP")?.confidence ?? 1).toBeLessThan(0.6);
  expect(byKey.get("CALOPTIMA_FBA_TELEHEALTH_CONSENT")?.value_text).toBe("Yes");
  expect(byKey.get("CALOPTIMA_FBA_TELEHEALTH_CONSENT")?.mode).toBe("MANUAL");
  expect(byKey.get("CALOPTIMA_FBA_REPORT_WRITTEN_BY")?.value_text).toContain("Sample Writer");
  expect(byKey.get("CALOPTIMA_FBA_REPORT_COMPLETED_DATE")?.value_text).toBe("7/21/2025");
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
