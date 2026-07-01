import { expect } from "jsr:@std/expect";

import { __TESTING__ } from "./index.ts";

const asSections = (template: "iehp_fba" | "caloptima_fba", text: string) =>
  __TESTING__.extractStructuredSections(text, template);

const asIeHpCoverageReport = (text: string) =>
  __TESTING__.buildStructuredExtractionCoverageReport(asSections("iehp_fba", text), "iehp_fba");

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

const calOptimaHostedPreviewStyleExcerpt = `
  CalOptima Health Functional Behavior Assessment / Initial Treatment Plan
  Diagnoses/with ICD Code: Autism F 84.0
  Guardian Name: Phone: XXXX 123456789
  Primary Care Provider: Known Allergies: Dr. Mostoufi Sayed 714-550-0110 N/A
  Current Medications/Dosage: Dietary Restrictions: N/A N/A
  Service Initiation Date Date ABA first began 7/1/2025 NA
  Date of the current IEP/equivalent Pending
  IX. DIAGNOSTIC INFORMATION
  Current diagnosis code Diagnosis description Date of diagnosis/report Diagnosed by (Full Name & credential) F84.0 Autism 6 Doe Jhon CIN# 12345678A
  X. FUNCTIONAL ASSESSMENT
`;

const iehpCompleteTemplateStyleExcerpt = `
  Header: Inland Empire Health Plan Functional Behavioral Assessment Report
  Page 1 of 30
  Report Date: MM/DD/YYYY
  IEHP Member ID#: XXXXXXXXXXXX
  I. IDENTIFICATION
  First Name: XXXXXXXXXXXX Last Name: XXXXXXXXXXXX Birth Date: MM/DD/YYYY
  II. BEHAVIORS
  The behaviors and functional skills to be addressed are:
  ☐ Aggression ☒ Functional Communication ☐ Self-injury
  Fillable target label: XXXXXXXXXXXX
  III. BACKGROUND INFORMATION
  Persons in Household and Relationship to IEHP Member
  Name Relationship
  XXXXXXXXXXXX Parent
  School Information
  School: XXXXXXXXXXXX
  IV. BHT School Hours
  M Tu W Th F Total
  8:00 AM 8:00 AM 8:00 AM 8:00 AM 8:00 AM 10 hours
  Member's last visit to the Primary Care Provider (PCP): MM/DD/YYYY
  If the visit was more than one year ago, would the Member like assistance from IEHP in accessing care to their PCP?
  ☒ Yes ☐ No
  Health and Medical
  Template instruction: summarize relevant medical history without inventing clinical data.
  Current Services and Activities
  Service Schedule
  Speech Weekly
  Intervention History
  Provider Dates Outcome
  XXXXXXXXXXXX MM/DD/YYYY Unknown
  V. BHT Availability
  Monday Tuesday Wednesday Thursday Friday Saturday Sunday
  After 3:30 PM After 3:30 PM After 3:30 PM After 3:30 PM After 3:30 PM Starting 9:00 AM Starting 9:00 AM
  VI. MEMBER'S ENVIRONMENTAL ANALYSIS:
  Availability and access to reinforcers: ☒ Yes ☐ No
  Level of noise/Environmental Distractions: ☐ None ☒ Fair ☐ High
  VII. DESCRIPTION OF ASSESSMENT PROCEDURES:
  Procedures: Date and Location: Person involved (indicate credentials):
  Records Reviewed: MM/DD/YYYY Telehealth BCBA
  Clinical Interview: MM/DD/YYYY Home BCBA
  Records reviewed included:
  Diagnostic Report (MM/DD/YYYY)
  Clinical Interview narrative placeholder.
  First Member Observation narrative placeholder.
  Second Member Observation narrative placeholder.
  Preference Assessment
  Preference Areas
  Social: praise
  Sensory: fidgets
  VIII. Adaptive and Functional Measure Summaries
  VB-MAPP Assessment Summary: Preserve as assessment block.
  Vineland Adaptive Behavior Scales, 3rd Edition Date Administered: MM/DD/YYYY Name of Interviewer: XXXXXXXXXXXX Name of Respondent: XXXXXXXXXXXX Assessment Summary: Placeholder summary.
  AFLS Assessment Summary: Preserve as assessment block.
  ABAS-3 Assessment Summary: Preserve as assessment block.
  Skill / Data Collected / Baseline / Location
  Insert Behavior Name Data Collected/Baseline: placeholder baseline at Home
  IX. Target Behaviors
  TARGET BEHAVIORS:
  Program Name: Insert Behavior Name
  Instrumental Goal: Placeholder target-behavior goal.
  Data Collection: Frequency
  Mastery Criteria: placeholder mastery
  Baseline: placeholder baseline
  REPLACEMENT BEHAVIORS:
  Program Name: Functional Communication
  Instrumental Goal: Placeholder replacement goal.
  Data Collection: Percent opportunities
  Mastery Criteria: placeholder mastery
  Baseline: placeholder baseline
  X. Behavior Intervention Plan
  Behavior Intervention Plan
  Antecedent Strategies: visual schedule.
  Replacement Behavior: request break.
  Consequence Strategies: differential reinforcement.
  Safety/Crisis Procedure
  Crisis plan placeholder.
  XI. Parent Education
  Program Name: Parent Coaching
  Instrumental Goal: Placeholder parent-education goal.
  Data Collection: Percent opportunities
  Mastery Criteria: placeholder mastery
  Baseline: placeholder baseline
  XII. Location of Service
  Home, school, community.
  Coordination of Care:
  Coordinate with parent, school, PCP, and service providers.
  XIII. Discharge Criteria:
  Exit plan criteria placeholder.
  Transition of Care:
  Transition plan placeholder.
  XIV. Recommendations:
  Clinical Recommendations
  CPT Description Units Requested
  H2019 Therapeutic Behavioral Services, per 15 minutes 10 units
  H0032 Mental Health Service Plan Development by Non-Physician, per 15 minutes 4 units
  Report completed by:
  _________________________________ MM/DD/YYYY
  XXXXXXXXXXXX Date:
  [GRAPH PLACEHOLDER: Behavior graph near target behavior block]
  Footer: Inland Empire Health Plan Functional Behavioral Assessment Report
`;

Deno.test("extractStructuredSections preserves IEHP complete DOCX template structure and coverage metadata", () => {
  const sections = asSections("iehp_fba", iehpCompleteTemplateStyleExcerpt);
  const byKey = new Map(sections.map((section) => [section.field_key, section]));
  const report = asIeHpCoverageReport(iehpCompleteTemplateStyleExcerpt);

  expect(report.found_major_sections).toEqual([
    "I",
    "II",
    "III",
    "IV",
    "V",
    "VI",
    "VII",
    "VIII",
    "IX",
    "X",
    "XI",
    "XII",
    "XIII",
    "XIV",
  ]);
  expect(report.missing_major_sections).toEqual([]);
  expect(report.table_count).toBeGreaterThanOrEqual(5);
  expect(report.checkbox_group_count).toBeGreaterThanOrEqual(2);
  expect(report.target_behavior_block_count).toBeGreaterThanOrEqual(1);
  expect(report.program_goal_block_count).toBeGreaterThanOrEqual(2);
  expect(report.visual_placeholder_count).toBeGreaterThanOrEqual(1);
  expect(report.unmapped_ambiguous_count).toBeGreaterThanOrEqual(1);

  const environmental = byKey.get("IEHP_FBA_ENVIRONMENTAL_ANALYSIS")?.payload.rows as Array<Record<string, unknown>>;
  expect(environmental.some((row) => Array.isArray(row.options))).toBe(true);
  expect(environmental.some((row) => row.selected === "yes")).toBe(true);
  expect(environmental.some((row) => row.selected === "fair")).toBe(true);

  const recommendations = byKey.get("IEHP_FBA_RECOMMENDATIONS_HCPCS_ROWS")?.payload.rows as Array<Record<string, unknown>>;
  expect(recommendations).toEqual([
    expect.objectContaining({ cpt: "H2019", units_requested: "10" }),
    expect.objectContaining({ cpt: "H0032", units_requested: "4" }),
  ]);

  expect(byKey.get("IEHP_FBA_ADAPTIVE_MEASURE_SUMMARIES")?.payload.assessment_blocks).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ assessment_type: "VB-MAPP" }),
      expect.objectContaining({ assessment_type: "Vineland" }),
      expect.objectContaining({ assessment_type: "AFLS" }),
      expect.objectContaining({ assessment_type: "ABAS-3" }),
    ]),
  );
  expect(byKey.get("IEHP_FBA_SIGNATURE_BLOCK")?.payload.placeholders).toContain("MM/DD/YYYY");
  expect(byKey.get("IEHP_FBA_BEHAVIOR_SKILL_TARGETS")?.payload.fields).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: "fillable_placeholder",
        value: "XXXXXXXXXXXX",
      }),
    ]),
  );
  expect(byKey.get("IEHP_FBA_VISUAL_ASSETS")?.payload.assets).toEqual([
    expect.objectContaining({
      asset_type: "placeholder",
      nearby_context: expect.stringContaining("Behavior graph"),
    }),
  ]);
});

Deno.test("decodeDocxStructured parses the committed IEHP FBA DOCX fixture without dropping structural metadata", async () => {
  const bytes = await Deno.readFile("docs/fill_docs/Updated FBA - IEHP.docx");
  const decoded = await __TESTING__.decodeDocxStructured(bytes);
  const sections = __TESTING__.extractStructuredSections(decoded.text, "iehp_fba", decoded);
  const report = __TESTING__.buildStructuredExtractionCoverageReport(sections, "iehp_fba");
  const docxStructure = sections.find((section) => section.field_key === "IEHP_FBA_DOCX_STRUCTURE");

  expect(decoded.text.length).toBeGreaterThan(500);
  expect(decoded.tables.length).toBeGreaterThan(10);
  expect(decoded.headers_footers.length).toBeGreaterThan(0);
  expect(decoded.visual_assets.length).toBeGreaterThanOrEqual(0);
  expect(report.found_major_sections.length).toBeGreaterThanOrEqual(10);
  expect(report.table_count).toBeGreaterThanOrEqual(10);
  expect(docxStructure?.payload.headers_footers).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ path: expect.stringContaining("word/header") }),
    ]),
  );
  expect(docxStructure?.payload.tables).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        table_index: 0,
        rows: expect.any(Array),
      }),
    ]),
  );
  expect(docxStructure?.source_span).toMatchObject({
    method: "docx_openxml_structure",
    document_path: "word/document.xml",
    table_count: decoded.tables.length,
    header_footer_count: decoded.headers_footers.length,
  });
});

Deno.test("extractStructuredSections preserves unrecognized IEHP text as unmapped items even when metadata is present", () => {
  const sections = asSections(
    "iehp_fba",
    "Header: Inland Empire Health Plan Functional Behavioral Assessment Report\nUnrecognized clinical narrative requiring manual review.",
  );
  const unmapped = sections.find((section) => section.field_key === "IEHP_FBA_UNMAPPED_ITEMS");

  expect(sections.some((section) => section.field_key === "IEHP_FBA_TEMPLATE_METADATA")).toBe(true);
  expect(unmapped?.payload.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        item_type: "unmapped_document_text",
        raw_text: expect.stringContaining("Unrecognized clinical narrative"),
      }),
    ]),
  );
});

Deno.test("extractStructuredSections preserves explicit ambiguous IEHP text even when mapped sections exist", () => {
  const sections = asSections(
    "iehp_fba",
    `
      I. GENERAL INFORMATION
      BEHAVIORS: Functional communication
      III. BACKGROUND INFORMATION
      Unrecognized clinical narrative requiring manual review.
    `,
  );
  const unmapped = sections.find((section) => section.field_key === "IEHP_FBA_UNMAPPED_ITEMS");

  expect(sections.some((section) => section.field_key === "IEHP_FBA_BEHAVIOR_SKILL_TARGETS")).toBe(true);
  expect(unmapped?.payload.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        item_type: "ambiguous_document_text",
        raw_text: expect.stringContaining("Unrecognized clinical narrative"),
      }),
    ]),
  );
});

Deno.test("decodeDocxStructured handles minimal DOCX archives without document.xml safely", async () => {
  const { default: JSZip } = await import("npm:jszip@3.10.1");
  const zip = new JSZip();
  zip.file("word/header1.xml", "<w:hdr><w:p><w:r><w:t>Header only</w:t></w:r></w:p></w:hdr>");
  const bytes = new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
  const decoded = await __TESTING__.decodeDocxStructured(bytes);

  expect(decoded).toEqual({
    text: "",
    tables: [],
    headers_footers: [],
    visual_assets: [],
  });
});

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
      BHT School Hours
      M Tu W Th F Total
      3:30 PM 3:30 PM 3:30 PM 3:30 PM 3:30 PM 10 hours
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
    "IEHP_FBA_HOUSEHOLD_MEMBERS",
    "IEHP_FBA_SCHOOL_INFORMATION_BLOCK",
    "IEHP_FBA_BHT_SCHOOL_HOURS_MATRIX",
    "IEHP_FBA_HEALTH_MEDICAL_SUMMARY",
    "IEHP_FBA_CURRENT_SERVICES_ACTIVITIES",
    "IEHP_FBA_INTERVENTION_HISTORY",
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
  expect(byKey.get("IEHP_FBA_HEALTH_MEDICAL_SUMMARY")?.payload.raw_text).toContain("Medical summary narrative");
  expect(byKey.get("IEHP_FBA_CURRENT_SERVICES_ACTIVITIES")?.payload.raw_text).toContain("School-based services");
  expect(byKey.get("IEHP_FBA_INTERVENTION_HISTORY")?.payload.raw_text).toContain("Prior ABA ended last year");
  expect(byKey.get("IEHP_FBA_BEHAVIOR_SKILL_TARGETS")?.payload.targets).toEqual([
    "Physical Aggression",
    "Functional Communication",
  ]);
  expect(byKey.get("IEHP_FBA_HOUSEHOLD_MEMBERS")?.payload.raw_text).toContain("Member lives with two caregivers");
  expect(byKey.get("IEHP_FBA_HOUSEHOLD_MEMBERS")?.payload.raw_text).not.toContain("The behaviors and functional skills to be addressed");
  expect(byKey.get("IEHP_FBA_SCHOOL_INFORMATION_BLOCK")?.payload.raw_text).toContain("Member attends a local high school");
  expect(byKey.get("IEHP_FBA_SCHOOL_INFORMATION_BLOCK")?.payload.raw_text).not.toContain("Medical summary narrative");
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

Deno.test("extractStructuredSections preserves IEHP adaptive measure block slots when source content is missing", () => {
  const sections = asSections(
    "iehp_fba",
    `
      DESCRIPTION OF ASSESSMENT PROCEDURES:
      Procedures: Date and Location: Person involved (indicate credentials):
      Records Reviewed: 12/05/2025 Telehealth BCBA
      Preference Assessment
      Preference Areas: Potential Reinforcers:
      Social praise
      ASSESSMENT MEAURES:
      Vineland Adaptive Behavior Scales, 3rd Edition
      Date Administered: 12/01/2025
      Name of Interviewer: Test BCBA
      Name of Respondent: Caregiver One
      Assessment Summary: Adaptive functioning summary.
      Target Behaviors
      TARGET BEHAVIORS:
      Program Name: Physical aggression
      Instrumental Goal: Reduce aggression.
      Data Collection: Rate.
      Mastery Criteria: 0x per hour.
      Baseline: 3x per hour.
    `,
  );

  const adaptivePayload = sections.find((section) => section.field_key === "IEHP_FBA_ADAPTIVE_MEASURE_SUMMARIES")?.payload;
  expect(adaptivePayload?.assessment_blocks).toEqual([
    {
      assessment_type: "VB-MAPP",
      raw_text: null,
      manual_review_required: true,
      review_note: "VB-MAPP content was not found in the source document text; clinician review is required.",
    },
    expect.objectContaining({
      assessment_type: "Vineland",
      raw_text: expect.stringContaining("Vineland Adaptive Behavior Scales"),
    }),
    {
      assessment_type: "AFLS",
      raw_text: null,
      manual_review_required: true,
      review_note: "AFLS content was not found in the source document text; clinician review is required.",
    },
    {
      assessment_type: "ABAS-3",
      raw_text: null,
      manual_review_required: true,
      review_note: "ABAS-3 content was not found in the source document text; clinician review is required.",
    },
  ]);
});

Deno.test("extractStructuredSections transfers LE-style IEHP adaptive metadata and signature fields cleanly", () => {
  const sections = asSections(
    "iehp_fba",
    `
      DESCRIPTION OF ASSESSMENT PROCEDURES:
      Assessment Measures Administered:
      Vineland Adaptive Behavior Scales, 3 rd Edition 12 /01/2025
      ASSESSMENT MEAURES:
      Vineland Adaptive Behavior Scales, 3 rd Edition
      Date Administered: 12 / 01 /2025
      Name of Interview er : Hailey Huynh, BCBA
      Name of Respondent: Chau Luu (Mother)
      Assessment Summary: Adaptive functioning summary.
      Recommendations:
      Clinical Recommendations
      CPT Description Units Requested
      H2019 Therapeutic Behavioral Services, per 15 minutes 2080 units
      Report completed by:
      -114300 80810 0 0 825420 -135035 _____________________________________ 12/ 12 /2025
      Hailey Huynh Date :
      Board Certified Behavior Analyst , 1-24-72584
      West Co a s t ABA
    `,
  );

  const adaptivePayload = sections.find((section) =>
    section.field_key === "IEHP_FBA_ADAPTIVE_MEASURE_SUMMARIES"
  )?.payload;
  expect(adaptivePayload?.measure_name).toBe("Vineland Adaptive Behavior Scales, 3rd Edition");
  expect(adaptivePayload?.date_administered).toBe("12/01/2025");
  expect(adaptivePayload?.interviewer).toBe("Hailey Huynh, BCBA");
  expect(adaptivePayload?.respondent).toBe("Chau Luu (Mother)");

  const signaturePayload = sections.find((section) => section.field_key === "IEHP_FBA_SIGNATURE_BLOCK")?.payload;
  expect(signaturePayload?.completed_by).toBe("Hailey Huynh");
  expect(signaturePayload?.report_completed_date).toBe("12/12/2025");
  expect(signaturePayload?.credentials).toBe("Board Certified Behavior Analyst, 1-24-72584");
  expect(signaturePayload?.agency).toBe("West Coast ABA");
});

Deno.test("extractStructuredSections normalizes narrow LE-style OCR spacing in program names", () => {
  const sections = asSections(
    "iehp_fba",
    `
      REPLACEMENT BEHAVIORS:
      Program Name: Identify ing daily objects/items
      Instrumental Goal: By December 2026, Kim will identify objects.
      Data Collection: Percentage of opportunities.
      Mastery Criteria: 80% of opportunities.
      Generalization Criteria: Across home and school.
      Baseline: Accuracy in 0% of opportunities.
      Behavior Intervention Plan
    `,
  );

  const goal = sections.find((section) => section.field_key === "IEHP_FBA_SKILL_AND_SCHOOL_GOAL_BLOCKS");
  expect(goal?.payload.program_name).toBe("Identifying daily objects/items");
  expect(goal?.payload.title).toBe("Identifying daily objects/items");
  expect(goal?.payload.target_behavior).toBe("Identifying daily objects/items");
});

Deno.test("extractStructuredSections leaves ordinary IEHP program title punctuation unchanged", () => {
  const sections = asSections(
    "iehp_fba",
    `
      REPLACEMENT BEHAVIORS:
      Program Name: Request help / break
      Instrumental Goal: By December 2026, Kim will request help or a break.
      Data Collection: Percentage of opportunities.
      Mastery Criteria: 80% of opportunities.
      Generalization Criteria: Across home and school.
      Baseline: Independent in 0% of opportunities.
      Behavior Intervention Plan
    `,
  );

  const goal = sections.find((section) => section.field_key === "IEHP_FBA_SKILL_AND_SCHOOL_GOAL_BLOCKS");
  expect(goal?.payload.program_name).toBe("Request help / break");
  expect(goal?.payload.title).toBe("Request help / break");
  expect(goal?.payload.target_behavior).toBe("Request help / break");
});

Deno.test("extractStructuredSections parses IEHP signature agency fallback without over-capturing absent agency", () => {
  const withAgency = asSections(
    "iehp_fba",
    `
      Recommendations:
      Report completed by:
      _____________________________________ 12/12/2025
      Test BCBA Date:
      Board Certified Behavior Analyst, 1-24-00000
      Test Agency
    `,
  ).find((section) => section.field_key === "IEHP_FBA_SIGNATURE_BLOCK")?.payload;

  expect(withAgency?.completed_by).toBe("Test BCBA");
  expect(withAgency?.report_completed_date).toBe("12/12/2025");
  expect(withAgency?.credentials).toBe("Board Certified Behavior Analyst, 1-24-00000");
  expect(withAgency?.agency).toBe("Test Agency");

  const withoutAgency = asSections(
    "iehp_fba",
    `
      Recommendations:
      Report completed by:
      _____________________________________ 12/12/2025
      Test BCBA Date:
      Board Certified Behavior Analyst, 1-24-00000
    `,
  ).find((section) => section.field_key === "IEHP_FBA_SIGNATURE_BLOCK")?.payload;

  expect(withoutAgency?.completed_by).toBe("Test BCBA");
  expect(withoutAgency?.report_completed_date).toBe("12/12/2025");
  expect(withoutAgency?.credentials).toBe("Board Certified Behavior Analyst, 1-24-00000");
  expect(withoutAgency?.agency).toBe("");
});

Deno.test("extractStructuredSections preserves intentional slash spacing in IEHP metadata values", () => {
  const sections = asSections(
    "iehp_fba",
    `
      DESCRIPTION OF ASSESSMENT PROCEDURES:
      ASSESSMENT MEAURES:
      Vineland Adaptive Behavior Scales, 3 rd Edition
      Date Administered: 12 / 01 /2025
      Name of Interview er : Test BCBA
      Name of Respondent: Mother / Father
      Assessment Summary: Adaptive functioning summary.
      Recommendations:
      Report completed by:
      _____________________________________ 12/12/2025
      Test BCBA Date:
      Board Certified Behavior Analyst, 1-24-00000
      Clinic A / Clinic B
    `,
  );

  const adaptivePayload = sections.find((section) =>
    section.field_key === "IEHP_FBA_ADAPTIVE_MEASURE_SUMMARIES"
  )?.payload;
  const signaturePayload = sections.find((section) => section.field_key === "IEHP_FBA_SIGNATURE_BLOCK")?.payload;

  expect(adaptivePayload?.date_administered).toBe("12/01/2025");
  expect(adaptivePayload?.respondent).toBe("Mother / Father");
  expect(signaturePayload?.agency).toBe("Clinic A / Clinic B");
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
  const procedures = (byKey.get("IEHP_FBA_ASSESSMENT_PROCEDURES_TABLE")?.payload.rows as Array<Record<string, string>>).map(
    (row) => row.procedure,
  );
  expect(procedures.length).toBeGreaterThanOrEqual(3);
  expect(procedures).toContain("Record s Reviewed");
  expect(procedures).toContain("1 st Member Observation");
  expect(procedures).toContain("Brief Functional Analysis");
  expect(byKey.get("IEHP_FBA_CRISIS_PLAN")?.payload.raw_text).toContain("Safety Procedure");
  expect(byKey.get("IEHP_FBA_DISCHARGE_TRANSITION_EXIT_PLAN")?.payload.raw_text).toContain("Transition Planning");
  expect((byKey.get("IEHP_FBA_RECOMMENDATIONS_HCPCS_ROWS")?.payload.rows as unknown[]).length).toBe(1);
});

Deno.test("extractStructuredSections handles LE-style DOCX run-split IEHP headings and school-hours fallback", () => {
  const sections = asSections(
    "iehp_fba",
    `
      BACKGROUND INFORMATION:
      Living Situation
      Member lives with caregivers.
      School Information
      Member attends Arlington High School. Her daily schedule runs from 8:30 AM to 3:00 PM,
      with an early release time of 2:00 PM on Wednesdays.
      Health and Medica l
      Member takes prescribed medications and wears corrective glasses.
      Current Services and Activitie s
      School-based services only; no community-based therapies are currently reported.
      Intervention Histor y
      Prior ABA services ended in 2020 and briefly resumed in 2023.
      Availability for Behavior Health Treatment Services
      Monday Tuesday Wednesday Thursday Friday Saturday
      After 3:30 PM After 3:30 PM After 3:30 PM After 3:30 PM After 3:30 PM Starting 9:00 AM
      MEMBER’S ENVIRONMENTAL ANALYSIS:
    `,
  );

  const byKey = new Map(sections.map((section) => [section.field_key, section]));
  expect(byKey.get("IEHP_FBA_HEALTH_MEDICAL_SUMMARY")?.payload.raw_text).toContain("prescribed medications");
  expect(byKey.get("IEHP_FBA_CURRENT_SERVICES_ACTIVITIES")?.payload.raw_text).toContain("School-based services");
  expect(byKey.get("IEHP_FBA_INTERVENTION_HISTORY")?.payload.raw_text).toContain("briefly resumed in 2023");

  const schoolHours = byKey.get("IEHP_FBA_BHT_SCHOOL_HOURS_MATRIX")?.payload.rows as Array<Record<string, string>>;
  expect(schoolHours).toHaveLength(5);
  expect(schoolHours.find((row) => row.day === "Monday")?.end_time).toBe("3:00 PM");
  expect(schoolHours.find((row) => row.day === "Wednesday")?.end_time).toBe("2:00 PM");
});

Deno.test("extractStructuredSections maps next-slice IEHP narratives, checkboxes, reinforcers, and page-aware goals", () => {
  const sections = asSections(
    "iehp_fba",
    `
      BHT (School Hours)
      M Tu W Th F Total
      8:00 AM 8:00 AM 8:00 AM 8:00 AM 8:00 AM
      Member's last visit to the Primary Care Provider (PCP):
      02/01/2026 with Sample PCP.
      If the visit was more than one year ago, would the Member like assistance from IEHP in accessing care to their PCP?
      ☒ Yes ☐ No
      Health and Medical
      Medical narrative.
      Current Services and Activities
      Services narrative.
      Intervention History
      Intervention narrative.
      Availability for Behavior Health Treatment Services
      Monday After 3:30 PM
      MEMBER'S ENVIRONMENTAL ANALYSIS:
      Availability and access to reinforcers: ☒ Yes ☐ No Available in home.
      Availability of developmental toys/materials: ☐ Yes ☒ No Limited materials.
      Appropriate space available for conducting sessions? FORMCHECKBOX Yes FORMCHECKBOX No
      DESCRIPTION OF ASSESSMENT PROCEDURES:
      Procedures: Date and Location: Person involved (indicate credentials):
      Clinical Interview: 01/01/2026 home guardian interview.
      1st Member Observation: 01/02/2026 home observation narrative.
      2nd Member Observation: 01/03/2026 school observation narrative.
      Records reviewed included:
      Diagnostic Report (01/01/2026)
      Preference Assessment
      Caregiver reported interests and reinforcers.
      Preference Areas
      Social: praise, high fives
      Sensory: rubber bands
      Toys or Activities: music
      Food: preferred snacks
      Adaptive and Functional Measure Summaries
      Assessment Summary: Adaptive summary.
      Skill / Data Collected / Baseline / Location
      Functional Communication Data Collected/Baseline: 20% independent at home
      BEHAVIOR INTERVENTION PLAN
      behavior intervention plan. All
      School Goals:
      Short term: Member will participate in class routines with prompting.
      Parent Education:
      Short term: Caregiver will identify ABC data.
      Safety/Crisis Procedure
      Safety narrative.
      Coordination of Care:
      Coordination narrative.
      Discharge Criteria:
      Discharge narrative.
      Transition of Care:
      Transition narrative.
      Teaching Intervention Strategies
      Use modeling, prompting, and reinforcement.
      Family Involvement
      Caregiver will participate during sessions.
      Clinical Recommendations
      CPT Description Units Requested
      H2019 Therapeutic Behavioral Services, per 15 minutes 10 units
      Report completed by:
      Sample BCBA Date:
    `,
  );

  const byKey = new Map(sections.map((section) => [section.field_key, section]));
  expect(byKey.get("IEHP_FBA_PCP_VISIT_SUMMARY")?.payload.raw_text).toContain("Sample PCP");
  expect(byKey.get("IEHP_FBA_PCP_VISIT_SUMMARY")?.required).toBe(false);
  expect(byKey.get("IEHP_FBA_PCP_ASSISTANCE_REQUEST")?.payload.selected).toBe("yes");
  expect(byKey.get("IEHP_FBA_PCP_ASSISTANCE_REQUEST")?.required).toBe(false);
  expect(byKey.get("IEHP_FBA_CLINICAL_INTERVIEW_NARRATIVE")?.payload.raw_text).toContain("guardian interview");
  expect(byKey.get("IEHP_FBA_FIRST_MEMBER_OBSERVATION")?.payload.raw_text).toContain("home observation");
  expect(byKey.get("IEHP_FBA_SECOND_MEMBER_OBSERVATION")?.payload.raw_text).toContain("school observation");
  expect((byKey.get("IEHP_FBA_PREFERENCE_REINFORCERS_TABLE")?.payload.rows as unknown[])).toHaveLength(4);
  expect(byKey.get("IEHP_FBA_SKILL_BASELINE_LOCATION_TABLE")?.required).toBe(false);
  expect(byKey.get("IEHP_FBA_TEACHING_INTERVENTION_STRATEGIES")?.payload.raw_text).toContain("modeling");
  expect(byKey.get("IEHP_FBA_FAMILY_INVOLVEMENT")?.payload.raw_text).toContain("Caregiver");

  const environmentalRows = byKey.get("IEHP_FBA_ENVIRONMENTAL_ANALYSIS")?.payload.rows as Array<Record<string, unknown>>;
  expect(environmentalRows.some((row) => row.selected === "yes")).toBe(true);
  expect(environmentalRows.some((row) => row.selected === "no")).toBe(true);
  expect(environmentalRows.some((row) => row.selected === "unknown")).toBe(true);

  expect(
    sections.some((section) =>
      section.field_key === "IEHP_FBA_TARGET_BEHAVIOR_INTERVENTION_BLOCKS" &&
      String(section.payload.raw_text ?? "").includes("behavior intervention plan. All")
    ),
  ).toBe(false);

  const schoolGoal = sections.find((section) =>
    section.field_key === "IEHP_FBA_SKILL_AND_SCHOOL_GOAL_BLOCKS" &&
    String(section.payload.raw_text ?? "").includes("class routines")
  );
  const parentGoal = sections.find((section) =>
    section.field_key === "IEHP_FBA_SKILL_AND_SCHOOL_GOAL_BLOCKS" &&
    section.payload.goal_type === "parent"
  );
  expect(schoolGoal?.source_span?.page_number).toBe(16);
  expect(parentGoal?.source_span?.page_number).toBe(17);
});

Deno.test("extractStructuredSections emits traceable IEHP placeholders for blank required and optional unresolved fields", () => {
  const sections = asSections(
    "iehp_fba",
    `
      I. GENERAL INFORMATION
      II. REASON FOR REFERRAL
      III. BACKGROUND INFORMATION
      IV. SCHOOL INFORMATION
      Current Services and Activities
      Intervention History
      BHT Availability
      VI. MEMBER'S ENVIRONMENTAL ANALYSIS
      VII. DESCRIPTION OF ASSESSMENT PROCEDURES
      VIII. ASSESSMENT MEASURES
      IX. Target Behaviors
      X. Behavior Intervention Plan
      XI. Parent Education
      XII. Coordination of Care
      XIII. Discharge Criteria
      XIV. Recommendations
    `,
  );
  const byKey = new Map(sections.map((section) => [section.field_key, section]));

  [
    ["IEHP_FBA_ASSESSOR_PHONE", 1, true],
    ["IEHP_FBA_REFERRING_PROVIDER", 2, true],
    ["IEHP_FBA_REASON_FOR_REFERRAL", 2, true],
    ["IEHP_FBA_PCP_VISIT_SUMMARY", 4, false],
    ["IEHP_FBA_PCP_ASSISTANCE_REQUEST", 4, false],
    ["IEHP_FBA_SKILL_BASELINE_LOCATION_TABLE", 10, false],
    ["IEHP_FBA_RECOMMENDATION_NOTES", 24, false],
    ["IEHP_FBA_CAREGIVER_PARTICIPATION", 25, false],
    ["IEHP_FBA_TREATMENT_PLAN_REVIEW", 26, false],
    ["IEHP_FBA_ADDITIONAL_NOTES", 27, false],
    ["IEHP_FBA_APPENDIX_SUPPORTING_INFORMATION", 28, false],
  ].forEach(([fieldKey, pageNumber, required]) => {
    const section = byKey.get(String(fieldKey));
    expect(section?.status).toBe("drafted");
    expect(section?.required).toBe(required);
    expect(section?.payload).toMatchObject({
      field_key: fieldKey,
      entered_value_present: false,
      clinical_value: null,
      template_placeholder: true,
      page_number: pageNumber,
    });
    expect(section?.source_span).toMatchObject({
      method: "iehp_template_layout_placeholder",
      page_number: pageNumber,
      field_key: fieldKey,
    });
  });

  expect(byKey.get("IEHP_FBA_PCP_ASSISTANCE_REQUEST")?.payload.options).toEqual([
    { label: "Yes", selected: false },
    { label: "No", selected: false },
  ]);
  expect(byKey.get("IEHP_FBA_SKILL_BASELINE_LOCATION_TABLE")?.payload.rows).toEqual([]);
});

Deno.test("IEHP coverage metadata recognizes Current Services as major section V", () => {
  const report = asIeHpCoverageReport(`
    I. GENERAL INFORMATION
    II. REASON FOR REFERRAL
    III. BACKGROUND INFORMATION
    IV. SCHOOL INFORMATION
    Current Services and Activities
    VI. MEMBER'S ENVIRONMENTAL ANALYSIS
    VII. DESCRIPTION OF ASSESSMENT PROCEDURES
    VIII. ASSESSMENT MEASURES
    IX. Target Behaviors
    X. Behavior Intervention Plan
    XI. Parent Education
    XII. Coordination of Care
    XIII. Discharge Criteria
    XIV. Recommendations
  `);

  expect(report.found_major_sections).toContain("V");
  expect(report.missing_major_sections).not.toContain("V");
});

Deno.test("extractStructuredSections routes school Program Name goals to the IEHP school page", () => {
  const sections = asSections(
    "iehp_fba",
    `
      REPLACEMENT BEHAVIORS:
      Program Name: School Participation
      Instrumental Goal: Member will participate in school routines with one verbal prompt.
      Data Collection: Percent independent
      Mastery Criteria: 80% across three sessions.
      Generalization Criteria: Across classroom routines.
      Baseline: 20% independent.
      Behavior Intervention Plan
    `,
  );

  const schoolGoal = sections.find((section) =>
    section.field_key === "IEHP_FBA_SKILL_AND_SCHOOL_GOAL_BLOCKS" &&
    section.payload.program_name === "School Participation"
  );
  expect(schoolGoal?.source_span?.page_number).toBe(16);
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

Deno.test("deterministicValueForRow keeps adjacent CalOptima inline labels aligned to source values", () => {
  const rows = [
    {
      section: "identification_admin",
      label: "Guardian Name",
      placeholder_key: "CALOPTIMA_FBA_GUARDIAN_NAME",
      required: true,
      mode: "AUTO" as const,
    },
    {
      section: "identification_admin",
      label: "Phone (guardian/member)",
      placeholder_key: "CALOPTIMA_FBA_CONTACT_PHONE",
      required: true,
      mode: "AUTO" as const,
      extraction_aliases: ["Phone"],
    },
    {
      section: "identification_admin",
      label: "Primary Care Provider",
      placeholder_key: "CALOPTIMA_FBA_PCP",
      required: true,
      mode: "ASSISTED" as const,
    },
    {
      section: "identification_admin",
      label: "Current Medications/Dosage",
      placeholder_key: "CALOPTIMA_FBA_MEDICATIONS",
      required: true,
      mode: "ASSISTED" as const,
    },
    {
      section: "identification_admin",
      label: "Service Initiation Date",
      placeholder_key: "CALOPTIMA_FBA_SERVICE_INITIATION_DATE",
      required: true,
      mode: "AUTO" as const,
    },
    {
      section: "identification_admin",
      label: "Date ABA first began",
      placeholder_key: "CALOPTIMA_FBA_DATE_ABA_FIRST_BEGAN",
      required: true,
      mode: "ASSISTED" as const,
    },
    {
      section: "background_school_history",
      label: "Date of current IEP/equivalent",
      placeholder_key: "CALOPTIMA_FBA_IEP_DATE",
      required: true,
      mode: "ASSISTED" as const,
      extraction_aliases: ["Date of the current IEP/equivalent"],
    },
    {
      section: "identification_admin",
      label: "Diagnoses/with ICD Code",
      placeholder_key: "CALOPTIMA_FBA_DIAGNOSES_ICD",
      required: true,
      mode: "AUTO" as const,
    },
    {
      section: "diagnostic_behavior_analysis",
      label: "Current diagnosis code(s)",
      placeholder_key: "CALOPTIMA_FBA_CURRENT_DIAGNOSIS_CODES",
      required: true,
      mode: "AUTO" as const,
    },
  ];

  const byKey = new Map(rows.map((row) => [
    row.placeholder_key,
    __TESTING__.deterministicValueForRow(row, calOptimaRedactedStyleExcerpt, undefined, rows),
  ]));

  expect(byKey.get("CALOPTIMA_FBA_GUARDIAN_NAME")?.value_text).toBe("Sample Guardian");
  expect(byKey.get("CALOPTIMA_FBA_CONTACT_PHONE")?.value_text).toBe("555-123-4567");
  expect(byKey.get("CALOPTIMA_FBA_PCP")?.value_text).toBe("Dr. Sample Provider");
  expect(byKey.get("CALOPTIMA_FBA_MEDICATIONS")?.value_text).toBe("N/A");
  expect(byKey.get("CALOPTIMA_FBA_SERVICE_INITIATION_DATE")?.value_text).toBe("7/1/2025");
  expect(byKey.get("CALOPTIMA_FBA_DATE_ABA_FIRST_BEGAN")?.value_text).toBe("N/A");
  expect(byKey.get("CALOPTIMA_FBA_IEP_DATE")?.value_text).toBe("6/1/2025");
  expect(byKey.get("CALOPTIMA_FBA_DIAGNOSES_ICD")?.value_text).toBe("Autism F84.0");
  expect(byKey.get("CALOPTIMA_FBA_CURRENT_DIAGNOSIS_CODES")?.value_text).toBe("Autism Spectrum Disorder F84.0");
});

Deno.test("deterministicValueForRow matches hosted CalOptima preview inline scalars from the uploaded PDF layout", () => {
  const rows = [
    {
      section: "identification_admin",
      label: "Guardian Name",
      placeholder_key: "CALOPTIMA_FBA_GUARDIAN_NAME",
      required: true,
      mode: "AUTO" as const,
    },
    {
      section: "identification_admin",
      label: "Phone (guardian/member)",
      placeholder_key: "CALOPTIMA_FBA_CONTACT_PHONE",
      required: true,
      mode: "AUTO" as const,
      extraction_aliases: ["Phone"],
    },
    {
      section: "identification_admin",
      label: "Primary Care Provider",
      placeholder_key: "CALOPTIMA_FBA_PCP",
      required: true,
      mode: "ASSISTED" as const,
    },
    {
      section: "identification_admin",
      label: "Current Medications/Dosage",
      placeholder_key: "CALOPTIMA_FBA_MEDICATIONS",
      required: true,
      mode: "ASSISTED" as const,
    },
    {
      section: "identification_admin",
      label: "Service Initiation Date",
      placeholder_key: "CALOPTIMA_FBA_SERVICE_INITIATION_DATE",
      required: true,
      mode: "AUTO" as const,
    },
    {
      section: "identification_admin",
      label: "Date ABA first began",
      placeholder_key: "CALOPTIMA_FBA_DATE_ABA_FIRST_BEGAN",
      required: true,
      mode: "ASSISTED" as const,
    },
    {
      section: "background_school_history",
      label: "Date of current IEP/equivalent",
      placeholder_key: "CALOPTIMA_FBA_IEP_DATE",
      required: true,
      mode: "ASSISTED" as const,
      extraction_aliases: ["Date of the current IEP/equivalent"],
    },
    {
      section: "identification_admin",
      label: "Diagnoses/with ICD Code",
      placeholder_key: "CALOPTIMA_FBA_DIAGNOSES_ICD",
      required: true,
      mode: "AUTO" as const,
    },
    {
      section: "diagnostic_behavior_analysis",
      label: "Current diagnosis code(s)",
      placeholder_key: "CALOPTIMA_FBA_CURRENT_DIAGNOSIS_CODES",
      required: true,
      mode: "AUTO" as const,
    },
  ];

  const byKey = new Map(rows.map((row) => [
    row.placeholder_key,
    __TESTING__.deterministicValueForRow(row, calOptimaHostedPreviewStyleExcerpt, undefined, rows),
  ]));

  expect(byKey.get("CALOPTIMA_FBA_GUARDIAN_NAME")?.status).toBe("not_started");
  expect(byKey.get("CALOPTIMA_FBA_GUARDIAN_NAME")?.value_text).toBeNull();
  expect(byKey.get("CALOPTIMA_FBA_CONTACT_PHONE")?.value_text).toBe("XXXX 123456789");
  expect(byKey.get("CALOPTIMA_FBA_PCP")?.value_text).toBe("Dr. Mostoufi Sayed");
  expect(byKey.get("CALOPTIMA_FBA_MEDICATIONS")?.value_text).toBe("N/A");
  expect(byKey.get("CALOPTIMA_FBA_SERVICE_INITIATION_DATE")?.value_text).toBe("7/1/2025");
  expect(byKey.get("CALOPTIMA_FBA_DATE_ABA_FIRST_BEGAN")?.value_text).toBe("N/A");
  expect(byKey.get("CALOPTIMA_FBA_IEP_DATE")?.value_text).toBe("Pending");
  expect(byKey.get("CALOPTIMA_FBA_DIAGNOSES_ICD")?.value_text).toBe("Autism F 84.0");
  expect(byKey.get("CALOPTIMA_FBA_CURRENT_DIAGNOSIS_CODES")?.value_text).toBe("F84.0 Autism");
});

Deno.test("deterministicValueForRow preserves title-case parent involvement answer when agreement question is missing", () => {
  const value = __TESTING__.deterministicValueForRow(
    {
      section: "summary_recommendations_signatures",
      label: "Parent/guardian involvement",
      placeholder_key: "CALOPTIMA_FBA_PARENT_INVOLVEMENT",
      required: true,
      mode: "MANUAL" as const,
    },
    `
      XXI. PARENT/CAREGIVER OR LEGAL GUARDIAN INVOLVEMENT
      Was the Parent/guardian involved in the development of the treatment plan? ☒ Yes ☐ No
      XVIII. SIGNATURES
    `,
  );

  expect(value?.value_text).toBe("development: Yes");
  expect(value?.value_text).not.toContain("development: yes");
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
  const assessorPhone = __TESTING__.deterministicValueForRow(
    {
      section: "identification_admin",
      label: "Assessor's phone number",
      placeholder_key: "IEHP_FBA_ASSESSOR_PHONE",
      required: true,
      mode: "ASSISTED",
    },
    "Phone: (951) 224-7934",
    { parent1_phone: "(951) 224-7934" },
  );

  expect(assisted.mode).toBe("ASSISTED");
  expect(assisted.confidence ?? 1).toBeLessThan(0.8);
  expect(manual.mode).toBe("MANUAL");
  expect(manual.confidence ?? 1).toBeLessThan(0.6);
  expect(assessorPhone.value_text).toBeNull();
  expect(assessorPhone.status).toBe("not_started");
  expect(assessorPhone.review_notes).toContain("reliable provider or organization source");
});

Deno.test("deterministicValueForRow maps IEHP presenting concerns narrative into reason for referral", () => {
  const manual = __TESTING__.deterministicValueForRow(
    {
      section: "identification_admin",
      label: "Reason for Referral",
      placeholder_key: "IEHP_FBA_REASON_FOR_REFERRAL",
      required: true,
      mode: "MANUAL",
    },
    `
      II. REASON FOR REFERRAL AND PRESENTING CONCERNS:
      Write a brief description regarding the presenting concerns and why the Member is seeking services from your agency.
      Kim presents with significant communication deficits and frequent maladaptive behaviors that disrupt family routines.
      Name of Referring Provider, Credentials (if applicable):
      Date Referred:
      BEHAVIORS:
      The behaviors and functional skills to be addressed are:
      Physical Aggression
    `,
  );

  expect(manual.mode).toBe("MANUAL");
  expect(manual.status).toBe("drafted");
  expect(manual.source_span).toMatchObject({ method: "iehp_presenting_concerns_anchor" });
  expect(manual.value_text).toContain("Kim presents with significant communication deficits");
  expect(manual.value_text).not.toContain("The behaviors and functional skills to be addressed");
});

Deno.test("deterministicValueForRow stops presenting concerns extraction at colonless BEHAVIORS heading", () => {
  const manual = __TESTING__.deterministicValueForRow(
    {
      section: "identification_admin",
      label: "Reason for Referral",
      placeholder_key: "IEHP_FBA_REASON_FOR_REFERRAL",
      required: true,
      mode: "MANUAL",
    },
    `
      II. REASON FOR REFERRAL AND PRESENTING CONCERNS
      Kim presents with significant communication deficits and frequent maladaptive behaviors that disrupt family routines.
      BEHAVIORS
      The behaviors and functional skills to be addressed are:
      Physical Aggression
      Functional Communication
    `,
  );

  expect(manual.mode).toBe("MANUAL");
  expect(manual.status).toBe("drafted");
  expect(manual.value_text).toContain("Kim presents with significant communication deficits");
  expect(manual.value_text).not.toContain("The behaviors and functional skills to be addressed");
  expect(manual.value_text).not.toContain("Physical Aggression");
});

Deno.test("deterministicValueForRow maps IEHP PRESENTING CONCERNS heading into reason for referral", () => {
  const manual = __TESTING__.deterministicValueForRow(
    {
      section: "identification_admin",
      label: "Reason for Referral",
      placeholder_key: "IEHP_FBA_REASON_FOR_REFERRAL",
      required: true,
      mode: "MANUAL",
    },
    `
      II. PRESENTING CONCERNS
      Kim presents with significant communication deficits and primarily relies on hand-leading to express preferences.
      Additional concerns include recent sleep difficulties and caregiver safety concerns in the community.
      III. BEHAVIORS
      The behaviors and functional skills to be addressed are:
      Tantrums
      Functional Communication
    `,
  );

  expect(manual.mode).toBe("MANUAL");
  expect(manual.status).toBe("drafted");
  expect(manual.value_text).toContain("Kim presents with significant communication deficits");
  expect(manual.value_text).not.toContain("The behaviors and functional skills to be addressed");
  expect(manual.value_text).not.toContain("Functional Communication");
});

Deno.test("hydrateIeHpTemplatePlaceholdersFromFields transfers presenting concerns into reason structured payload", () => {
  const hydrated = __TESTING__.hydrateIeHpTemplatePlaceholdersFromFields(
    [{
      section_key: "identification_admin",
      field_key: "IEHP_FBA_REASON_FOR_REFERRAL",
      section_index: 0,
      payload: {
        field_key: "IEHP_FBA_REASON_FOR_REFERRAL",
        template_placeholder: true,
        entered_value_present: false,
        clinical_value: null,
        raw_text: "",
      },
      source_span: {
        method: "iehp_template_layout_placeholder",
        page_number: 2,
        field_key: "IEHP_FBA_REASON_FOR_REFERRAL",
      },
      status: "drafted",
      required: true,
      review_notes: "Template field preserved as an empty placeholder.",
    }],
    [{
      placeholder_key: "IEHP_FBA_REASON_FOR_REFERRAL",
      value_text:
        "Kim presents with significant communication deficits and primarily relies on hand-leading to express preferences.",
      value_json: null,
      confidence: 0.55,
      mode: "MANUAL",
      status: "drafted",
      source_span: { method: "iehp_presenting_concerns_anchor" },
      review_notes: "Presenting concerns narrative mapped into reason for referral.",
    }],
  );

  const reason = hydrated.find((section) => section.field_key === "IEHP_FBA_REASON_FOR_REFERRAL");
  expect(reason?.payload).toMatchObject({
    field_key: "IEHP_FBA_REASON_FOR_REFERRAL",
    template_placeholder: false,
    entered_value_present: true,
    clinical_value:
      "Kim presents with significant communication deficits and primarily relies on hand-leading to express preferences.",
    raw_text:
      "Kim presents with significant communication deficits and primarily relies on hand-leading to express preferences.",
  });
  expect(reason?.source_span).toMatchObject({
    method: "iehp_template_layout_placeholder",
    hydrated_from: "deterministic_checklist_field",
    field_source_method: "iehp_presenting_concerns_anchor",
  });
});

Deno.test("deterministicValueForRow ignores inline presenting concerns prose before heading", () => {
  const manual = __TESTING__.deterministicValueForRow(
    {
      section: "identification_admin",
      label: "Reason for Referral",
      placeholder_key: "IEHP_FBA_REASON_FOR_REFERRAL",
      required: true,
      mode: "MANUAL",
    },
    `
      General instructions mention presenting concerns and background content before section headers.
      Caregiver stated these presenting concerns should be discussed with the clinician.
      II. PRESENTING CONCERNS
      Kim presents with significant communication deficits and requires close supervision in public settings.
      III. BEHAVIORS
      The behaviors and functional skills to be addressed are:
      Tantrums
      Functional Communication
    `,
  );

  expect(manual.mode).toBe("MANUAL");
  expect(manual.status).toBe("drafted");
  expect(manual.value_text).toContain("Kim presents with significant communication deficits");
  expect(manual.value_text).not.toContain("General instructions mention presenting concerns");
  expect(manual.value_text).not.toContain("The behaviors and functional skills to be addressed");
});

Deno.test("extractStructuredSections keeps presenting concerns out of IEHP behavior skill targets", () => {
  const sections = asSections(
    "iehp_fba",
    `
      II. REASON FOR REFERRAL AND PRESENTING CONCERNS:
      Kim presents with significant communication deficits and maladaptive behavior patterns.
      Name of Referring Provider, Credentials (if applicable):
      Date Referred:
      Reason for Referral:
      III. BEHAVIORS:
      The behaviors and functional skills to be addressed are:
      Physical Aggression
      Functional Communication
      IV. BACKGROUND INFORMATION:
    `,
  );
  const behaviorSection = sections.find((section) => section.field_key === "IEHP_FBA_BEHAVIOR_SKILL_TARGETS");
  const behaviorRawText = String(behaviorSection?.payload.raw_text ?? "");

  expect(behaviorSection).toBeDefined();
  expect(behaviorRawText).toContain("The behaviors and functional skills to be addressed");
  expect(behaviorRawText).not.toContain("Kim presents with significant communication deficits");
});

Deno.test("deterministicValueForRow prefills IEHP assessor phone from primary therapist snapshot", () => {
  const assessorPhone = __TESTING__.deterministicValueForRow(
    {
      section: "identification_admin",
      label: "Assessor's phone number",
      placeholder_key: "IEHP_FBA_ASSESSOR_PHONE",
      required: true,
      mode: "ASSISTED",
    },
    "",
    { primary_therapist_phone: "(951) 555-0101" },
  );

  expect(assessorPhone.value_text).toBe("(951) 555-0101");
  expect(assessorPhone.mode).toBe("ASSISTED");
  expect(assessorPhone.status).toBe("drafted");
  expect(assessorPhone.confidence).toBeLessThan(0.8);
  expect(assessorPhone.source_span).toMatchObject({
    method: "client_snapshot",
    field: "primary_therapist_phone",
  });
  expect(assessorPhone.review_notes).toContain("primary therapist");
});

Deno.test("hasExistingDeterministicValue treats JSON payloads as real extracted values", () => {
  expect(__TESTING__.hasExistingDeterministicValue({
    placeholder_key: "IEHP_FBA_TEST_JSON_VALUE",
    value_text: null,
    value_json: { extracted: true },
    confidence: 0.7,
    mode: "ASSISTED",
    status: "drafted",
    source_span: { method: "deterministic_json" },
    review_notes: "Synthetic JSON extraction.",
  })).toBe(true);

  expect(__TESTING__.hasExistingDeterministicValue({
    placeholder_key: "IEHP_FBA_TEST_EMPTY",
    value_text: null,
    value_json: null,
    confidence: null,
    mode: "MANUAL",
    status: "not_started",
    source_span: null,
    review_notes: null,
  })).toBe(false);
});

Deno.test("mergeDeterministicFieldWithStructuredSummary preserves deterministic JSON when placeholder trace is attached", () => {
  const merged = __TESTING__.mergeDeterministicFieldWithStructuredSummary(
    {
      placeholder_key: "IEHP_FBA_JSON_FIELD",
      value_text: "real extracted value",
      value_json: { structured_value: "real" },
      confidence: 0.74,
      mode: "ASSISTED",
      status: "drafted",
      source_span: { method: "deterministic_json" },
      review_notes: "Synthetic deterministic JSON value.",
    },
    {
      count: 1,
      firstPayload: {
        template_placeholder: true,
        entered_value_present: false,
        clinical_value: null,
      },
    },
  );

  expect(merged.value_text).toBe("real extracted value");
  expect(merged.value_json).toEqual({ structured_value: "real" });
  expect(merged.source_span).toMatchObject({
    placeholder_trace: {
      template_placeholder: true,
      entered_value_present: false,
    },
  });
});

Deno.test("mergeDeterministicFieldWithStructuredSummary keeps empty-only placeholders unresolved", () => {
  const merged = __TESTING__.mergeDeterministicFieldWithStructuredSummary(
    {
      placeholder_key: "IEHP_FBA_REASON_FOR_REFERRAL",
      value_text: null,
      value_json: null,
      confidence: null,
      mode: "MANUAL",
      status: "not_started",
      source_span: null,
      review_notes: null,
    },
    {
      count: 1,
      firstPayload: {
        template_placeholder: true,
        entered_value_present: false,
        clinical_value: null,
        field_key: "IEHP_FBA_REASON_FOR_REFERRAL",
      },
    },
  );

  expect(merged.value_text).toBeNull();
  expect(merged.value_json).toBeNull();
  expect(merged.status).toBe("not_started");
  expect(merged.source_span).toMatchObject({
    method: "empty_template_placeholder_trace",
    placeholder_trace: {
      template_placeholder: true,
      entered_value_present: false,
      field_key: "IEHP_FBA_REASON_FOR_REFERRAL",
    },
  });
  expect(merged.review_notes).toContain("empty template placeholder");
});
