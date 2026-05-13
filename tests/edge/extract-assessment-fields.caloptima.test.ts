import { describe, expect, it } from "vitest";

import { __TESTING__ } from "../../supabase/functions/extract-assessment-fields/index.ts";

describe("extract-assessment-fields CalOptima parser", () => {
  const inlineRows = [
    {
      section: "identification_admin",
      label: "Administrative Contact Full Name and Title",
      placeholder_key: "CALOPTIMA_FBA_ADMIN_CONTACT_NAME_TITLE",
      required: true,
      extraction_aliases: ["Full Name and Title"],
    },
    {
      section: "identification_admin",
      label: "Administrative Contact Phone Number",
      placeholder_key: "CALOPTIMA_FBA_ADMIN_CONTACT_PHONE",
      required: true,
      extraction_aliases: ["Phone Number"],
    },
    {
      section: "identification_admin",
      label: "Administrative Contact Fax Number",
      placeholder_key: "CALOPTIMA_FBA_ADMIN_CONTACT_FAX",
      required: true,
      extraction_aliases: ["Fax Number"],
    },
    {
      section: "identification_admin",
      label: "Chief Complaint/Reason for Seeking ABA Treatment",
      placeholder_key: "CALOPTIMA_FBA_CHIEF_COMPLAINT",
      required: true,
      extraction_aliases: ["Chief Complaint/Reason for Seeking Applied Behavior Analysis (ABA) Treatment"],
    },
  ];

  it("uses registry aliases for scalar extraction from redacted-template labels", () => {
    const result = __TESTING__.deterministicValueForRow(
      {
        section: "Client Information",
        label: "Client name",
        placeholder_key: "CALOPTIMA_FBA_CLIENT_NAME",
        required: true,
        extraction_aliases: ["Member full legal name"],
      },
      "Member full legal name: Redacted Client\nDate of birth: 01/01/2015",
    );

    expect(result.status).toBe("drafted");
    expect(result.value_text).toBe("Redacted Client");
    expect(result.source_span).toMatchObject({ method: "label_regex", label: "Member full legal name" });
  });

  it("smoke-tests inline redacted-PDF label boundaries for admin contact fields", () => {
    const text = [
      "Administrative Contact for Current Authorization Request Full Name and Title Example Reviewer BCBA Phone Number (951) 706-0028 Fax Number (714) 494-8028",
      "Chief Complaint/Reason for Seeking Applied Behavior Analysis (ABA) Treatment: The family is seeking ABA support across home and community settings.",
      "II. DATA SOURCES Records Reviewed Record Type Author of Record Date of Record",
    ].join(" ");

    const byKey = new Map(
      inlineRows.map((row) => [
        row.placeholder_key,
        __TESTING__.deterministicValueForRow(row, text, undefined, inlineRows),
      ]),
    );

    expect(byKey.get("CALOPTIMA_FBA_ADMIN_CONTACT_NAME_TITLE")?.value_text).toBe("Example Reviewer BCBA");
    expect(byKey.get("CALOPTIMA_FBA_ADMIN_CONTACT_PHONE")?.value_text).toBe("(951) 706-0028");
    expect(byKey.get("CALOPTIMA_FBA_ADMIN_CONTACT_FAX")?.value_text).toBe("(714) 494-8028");
    expect(byKey.get("CALOPTIMA_FBA_CHIEF_COMPLAINT")?.value_text).toBe(
      "The family is seeking ABA support across home and community settings",
    );
  });

  it("does not truncate narrative scalar content on ordinary date or signature words", () => {
    const result = __TESTING__.deterministicValueForRow(
      {
        section: "identification_admin",
        label: "Prior Applied Behavioral Health Agencies",
        placeholder_key: "CALOPTIMA_FBA_PRIOR_ABA_AGENCIES",
        required: true,
        extraction_aliases: [],
      },
      "Prior Applied Behavioral Health Agencies: No prior services. Parent will sign a release at a later date if needed. Full Name and Title Reviewer",
      undefined,
      inlineRows,
    );

    expect(result.value_text).toBe(
      "No prior services. Parent will sign a release at a later date if needed",
    );
  });

  it("extracts checkbox yes/no values and leaves strict transition plan fields manual when no heading exists", () => {
    const text = [
      "2. Does the member have a current Individualized Educational Plan (IEP/equivalent)?",
      "☐ Yes      ☒ No If No, please explain:",
      "XXI. PARENT/CAREGIVER OR LEGAL GUARDIAN INVOLVEMENT",
      "1. Was the Parent/guardian involved in the development of the treatment plan?",
      "☒ Yes      ☐ No",
      "2. Is the parent/guardian in agreement with the submitted treatment plan? ☒ Yes      ☐ No",
      "XVII. PLAN FOR GENERALIZATION (INCLUDING TRANSITION TO NATURAL MEDIATORS) AND MAINTENANCE",
      "This is a generalization plan and must not be treated as the strict transition plan.",
    ].join(" ");

    expect(__TESTING__.deterministicValueForRow(
      {
        section: "background_school_history",
        label: "Current IEP/equivalent",
        placeholder_key: "CALOPTIMA_FBA_HAS_IEP",
        required: true,
        extraction_aliases: ["Does the member have a current Individualized Educational Plan (IEP/equivalent)?"],
      },
      text,
    ).value_text).toBe("No");
    expect(__TESTING__.deterministicValueForRow(
      {
        section: "summary_recommendations_signatures",
        label: "Parent/guardian involvement",
        placeholder_key: "CALOPTIMA_FBA_PARENT_INVOLVEMENT",
        required: true,
        extraction_aliases: [
          "Was the Parent/guardian involved in the development of the treatment plan",
          "Is the parent/guardian in agreement with the submitted treatment plan",
        ],
      },
      text,
    ).value_text).toBe("development: Yes; agreement: Yes");
    expect(__TESTING__.deterministicValueForRow(
      {
        section: "goals_treatment_planning",
        label: "Transition plan and exit criteria",
        placeholder_key: "CALOPTIMA_FBA_TRANSITION_PLAN",
        required: true,
        extraction_aliases: ["Transition to Natural Mediators"],
      },
      text,
    ).status).toBe("not_started");

    expect(__TESTING__.deterministicValueForRow(
      {
        section: "goals_treatment_planning",
        label: "Transition plan and exit criteria",
        placeholder_key: "CALOPTIMA_FBA_TRANSITION_PLAN",
        required: true,
        extraction_aliases: ["XIII. TRANSITION PLAN"],
      },
      "XIII. TRANSITION PLAN Please list exit plan/criteria: Step down when goals are mastered. XIV. TARGET AND REPLACEMENT BEHAVIOR GOALS",
    ).value_text).toContain("Step down when goals are mastered");
  });

  it("extracts redacted-style structured sections without misclassifying goals or over-capturing boundaries", () => {
    const text = [
      "X. FUNCTIONAL ASSESSMENT OR ANALYSIS OF TARGET BEHAVIORS",
      "Aggression occurred during transitions.",
      "XI. BEHAVIOR INTERVENTION PLAN",
      "Antecedent strategies and consequence procedures.",
      "XII. PLAN FOR GENERALIZATION",
      "This section should not be inside the BIP payload.",
      "XIV. TARGET AND REPLACEMENT BEHAVIOR GOALS",
      "Target Behavior Goal: Reduce aggression",
      "Baseline: 8 episodes per day",
      "Objective data point: date: 07/01/2025 | value: 8 | unit: episodes",
      "Replacement Behavior Goal: Request a break",
      "Measurement type: frequency",
      "XV. SKILL ACQUISITION",
      "Skill Acquisition Goal: Follow one-step directions",
      "HCPCS Code and Modifiers Description",
      "H0032-HN Treatment planning 4 units",
      "H2019 Direct therapy 40 units",
      "Telehealth Consent Confirmation",
      "XVIII. SIGNATURES",
      "Provider Signature: Redacted BCBA 07/21/2025",
      "** By signing this report, the provider confirms review.",
      "Do not include this attestation in the signature payload.",
    ].join("\n");

    const sections = __TESTING__.extractStructuredSections(text);
    const byKey = new Map(sections.map((section) => [section.field_key, section]));
    const goalSections = sections.filter((section) => section.field_key === "CALOPTIMA_FBA_TARGET_REPLACEMENT_GOALS");

    expect(byKey.get("CALOPTIMA_FBA_TARGET_BEHAVIOR_BLOCKS")?.payload.raw_text).toContain("Aggression occurred");
    expect(byKey.get("CALOPTIMA_FBA_BIP_BLOCKS")?.payload.raw_text).toContain("Antecedent strategies");
    expect(byKey.get("CALOPTIMA_FBA_BIP_BLOCKS")?.payload.raw_text).not.toContain("PLAN FOR GENERALIZATION");
    expect(byKey.has("CALOPTIMA_FBA_TRANSITION_PLAN")).toBe(false);

    expect(goalSections).toHaveLength(2);
    expect(goalSections.map((section) => section.payload.title)).toEqual([
      "Reduce aggression",
      "Request a break",
    ]);
    expect(sections.some((section) => section.field_key === "CALOPTIMA_FBA_TARGET_BEHAVIOR_BLOCKS" && section.payload.title === "Reduce aggression")).toBe(false);

    const signatures = byKey.get("CALOPTIMA_FBA_SIGNATURES");
    expect(signatures?.payload.raw_text).toContain("Provider Signature");
    expect(signatures?.payload.raw_text).not.toContain("Do not include this attestation");

    const hcpcsRows = byKey.get("CALOPTIMA_FBA_HCPCS_RECOMMENDATION_ROWS")?.payload.rows;
    expect(hcpcsRows).toEqual([
      expect.objectContaining({ hcpcs_code: "H0032-HN" }),
      expect.objectContaining({ hcpcs_code: "H2019" }),
    ]);
  });

  it("extracts schedule raw text and split signature/date payloads for review", () => {
    const text = [
      "Daily schedule of all activities Use the table below excluding school.",
      "Monday Tuesday Wednesday Thursday Friday Saturday Sunday Daycare 7:40am 5:00pm Daycare 7:40am 5:00pm",
      "IV. SCHOOL INFORMATION",
      "Daily School Schedule Anything that pertains to when member is on school premises Monday Tuesday Wednesday Thursday Friday NA NA NA NA Friday",
      "1. Are ABA services being requested for authorization from CalOptima Health at the school setting?",
      "XVIII. SIGNATURES A. Report written by: (printed name, credentials) BCBA/BMC professional level",
      "Example Author M.S., BCBA",
      "Title, License/Certificate #: Behavior Analyst, BACB #:1-00-00000",
      "Date of Report Completed: 07/21/2025 Signature: Date: 07/21/2025",
      "B. Report reviewed by: (printed name, credentials) BCBA/BMC professional level",
      "Example Reviewer BCBA Title, License/Certificate #: Date of Report Completed:",
      "Signature: ** Date:",
      "** By signing, I attest that I have read, reviewed, and approved this proposed treatment plan.",
    ].join("\n");

    const sections = __TESTING__.extractStructuredSections(text);
    const byKey = new Map(sections.map((section) => [section.field_key, section]));

    expect(byKey.get("CALOPTIMA_FBA_DAILY_ACTIVITY_SCHEDULE")?.payload.raw_text).toContain("Daycare 7:40am");
    expect(byKey.get("CALOPTIMA_FBA_SCHOOL_SCHEDULE")?.payload.raw_text).toContain("NA NA NA");
    expect(byKey.get("CALOPTIMA_FBA_SIGNATURES")?.payload).toMatchObject({
      written_by: "Example Author M.S., BCBA",
      report_completed_date: "07/21/2025",
      writer_signature_date: "07/21/2025",
    });
    expect(byKey.get("CALOPTIMA_FBA_SIGNATURES")?.payload.raw_text).not.toContain("By signing");
  });

  it("deduplicates legacy schedule lines and anchored schedule sections by field key", () => {
    const text = [
      "daily activity schedule: Monday: Daycare 7:40am-5:00pm",
      "Daily schedule of all activities Use the table below excluding school.",
      "Monday Tuesday Wednesday Thursday Friday Daycare 7:40am 5:00pm",
      "IV. SCHOOL INFORMATION",
    ].join("\n");

    const sections = __TESTING__.extractStructuredSections(text)
      .filter((section) => section.field_key === "CALOPTIMA_FBA_DAILY_ACTIVITY_SCHEDULE");

    expect(sections).toHaveLength(1);
    expect(sections[0].payload.raw_text).toContain("Daycare 7:40am");
  });
});
