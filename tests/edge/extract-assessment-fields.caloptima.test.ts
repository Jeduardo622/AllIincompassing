import { describe, expect, it } from "vitest";

import { __TESTING__ } from "../../supabase/functions/extract-assessment-fields/index.ts";

describe("extract-assessment-fields CalOptima parser", () => {
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
});
