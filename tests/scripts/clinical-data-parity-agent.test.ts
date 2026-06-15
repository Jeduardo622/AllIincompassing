import { describe, expect, it } from "vitest";

import {
  assertBrowserOnlyTarget,
  assertRedactedQaFixture,
  assertSupportedClinicalQaSourceTextFixture,
  buildClinicalQaRoute,
  buildClinicalQaReportMarkdown,
  deriveClinicalQaExpectationsFromSourceText,
  evaluateClinicalQaChecklist,
  evaluateClinicalDataParity,
  parseClinicalQaExpectations,
  requireClinicalQaClientId,
  selectClinicalQaCredentials,
} from "../../scripts/lib/clinical-data-parity-agent";
import { routeMatchesPathname } from "../../scripts/lib/playwright-smoke";

describe("clinical data parity agent helpers", () => {
  it("selects dedicated clinical QA credentials before admin fallback", () => {
    const credentials = selectClinicalQaCredentials([
      {
        email: " qa@example.com ",
        password: "qa-password",
        label: "clinical",
      },
      {
        email: "admin@example.com",
        password: "admin-password",
        label: "admin",
      },
    ]);

    expect(credentials).toEqual({
      email: "qa@example.com",
      password: "qa-password",
      label: "clinical",
    });
  });

  it("rejects missing and placeholder credentials", () => {
    expect(() => selectClinicalQaCredentials([{ label: "clinical" }])).toThrow(
      "Missing clinical QA browser credentials",
    );
    expect(() =>
      selectClinicalQaCredentials([
        {
          email: "qa@example.com",
          password: "****",
          label: "clinical",
        },
      ]),
    ).toThrow('cannot use placeholder password "****"');
  });

  it("keeps the browser target constrained to app routes", () => {
    expect(assertBrowserOnlyTarget("/clients/client-1?tab=programs-goals")).toBe(
      "/clients/client-1?tab=programs-goals",
    );
    expect(() => assertBrowserOnlyTarget("clients/client-1")).toThrow("starts with '/'");
    expect(() => assertBrowserOnlyTarget("/api/assessment-documents")).toThrow("not an API route");
    expect(() => assertBrowserOnlyTarget("/admin/users")).toThrow("must not target admin-only routes");
  });

  it("builds the default client programs/goals route when a smoke client is configured", () => {
    expect(buildClinicalQaRoute({ clientId: "client id" })).toBe(
      "/clients/client%20id?tab=programs-goals",
    );
    expect(buildClinicalQaRoute({ routePath: "/dashboard", clientId: "client id" })).toBe("/dashboard");
    expect(buildClinicalQaRoute({})).toBe("/");
  });

  it("matches route reachability by pathname when the expected route includes a query string", () => {
    expect(routeMatchesPathname("/clients/client%20id", "/clients/client%20id?tab=programs-goals")).toBe(true);
  });

  it("requires redacted or synthetic fixture names for document comparisons", () => {
    expect(assertRedactedQaFixture(undefined, "fixture")).toBeNull();
    expect(assertRedactedQaFixture("fixtures/redacted-iehp-fba.docx", "fixture")).toBe(
      "fixtures/redacted-iehp-fba.docx",
    );
    expect(() => assertRedactedQaFixture("fixtures/real-client-iehp-fba.docx", "fixture")).toThrow(
      "clearly redacted",
    );
  });

  it("allows only text fixtures for source-derived expectations", () => {
    expect(assertSupportedClinicalQaSourceTextFixture("fixtures/redacted-iehp-source.txt")).toBe(
      "fixtures/redacted-iehp-source.txt",
    );
    expect(assertSupportedClinicalQaSourceTextFixture("fixtures/synthetic-iehp-source.md")).toBe(
      "fixtures/synthetic-iehp-source.md",
    );
    expect(() =>
      assertSupportedClinicalQaSourceTextFixture("fixtures/redacted-iehp-source.docx"),
    ).toThrow("text extraction currently supports .txt or .md fixtures");
  });

  it("normalizes optional client IDs", () => {
    expect(requireClinicalQaClientId(undefined)).toBeNull();
    expect(requireClinicalQaClientId("  client-1  ")).toBe("client-1");
  });

  it("evaluates required visible data surfaces from page text", () => {
    const results = evaluateClinicalQaChecklist(
      "Client assessment page with FBA upload and program goal review",
    );

    expect(results.every((result) => result.status === "pass")).toBe(true);
    expect(evaluateClinicalQaChecklist("Dashboard only").filter((result) => result.status === "fail")).toHaveLength(3);
  });

  it("parses redacted parity expectations and flags missing clinically important terms", () => {
    const expectations = parseClinicalQaExpectations(
      JSON.stringify({
        expectations: [
          {
            key: "target_behaviors",
            label: "Target behaviors",
            sourceSection: "Behavioral Observations",
            expectedTerms: ["elopement", "property destruction"],
            observedSectionTerms: ["Programs and Goals"],
            severity: "high",
            humanReviewBlocker: true,
          },
          {
            key: "replacement_behavior",
            label: "Replacement behavior",
            expectedTerms: ["functional communication"],
          },
        ],
      }),
      "fixtures/redacted-iehp-expectations.json",
    );

    const findings = evaluateClinicalDataParity(
      "Programs and goals include elopement and functional communication. Logged in as qa@example.com.",
      expectations,
    );

    expect(findings).toEqual([
      {
        key: "target_behaviors",
        label: "Target behaviors",
        status: "fail",
        mismatchType: "partial",
        sourceSection: "Behavioral Observations",
        severity: "high",
        expectedTerms: ["elopement", "property destruction"],
        matchedTerms: ["elopement"],
        missingTerms: ["property destruction"],
        observedSectionTerms: ["Programs and Goals"],
        observedSectionMatchedTerms: ["Programs and Goals"],
        observedSectionMissingTerms: [],
        observedTextSnippet:
          "Programs and goals include elopement and functional communication. Logged in as [redacted-email].",
        humanReviewBlocker: true,
      },
      {
        key: "replacement_behavior",
        label: "Replacement behavior",
        status: "pass",
        mismatchType: "match",
        sourceSection: null,
        severity: "medium",
        expectedTerms: ["functional communication"],
        matchedTerms: ["functional communication"],
        missingTerms: [],
        observedSectionTerms: [],
        observedSectionMatchedTerms: [],
        observedSectionMissingTerms: [],
        observedTextSnippet:
          "Programs and goals include elopement and functional communication. Logged in as [redacted-email].",
        humanReviewBlocker: false,
      },
    ]);
  });

  it("derives parity expectations from redacted source text sections", () => {
    const expectations = deriveClinicalQaExpectationsFromSourceText(`
      FBA target behavior summary
      Target behaviors: elopement; property destruction

      Replacement behavior plan
      Replacement behavior: functional communication

      Goals and measurement criteria
      Measurement terms: baseline, mastery, maintenance, generalization
    `);

    expect(expectations).toEqual([
      {
        key: "target_behaviors",
        label: "Target behaviors",
        sourceSection: "FBA target behavior summary",
        expectedTerms: ["elopement", "property destruction"],
        observedSectionTerms: ["Programs", "Goals"],
        severity: "high",
        humanReviewBlocker: true,
      },
      {
        key: "replacement_behavior",
        label: "Replacement behavior",
        sourceSection: "Replacement behavior plan",
        expectedTerms: ["functional communication"],
        observedSectionTerms: ["Programs", "Goals"],
        severity: "medium",
        humanReviewBlocker: false,
      },
      {
        key: "program_goal_measurement",
        label: "Program goal measurement",
        sourceSection: "Goals and measurement criteria",
        expectedTerms: ["baseline", "mastery", "maintenance", "generalization"],
        observedSectionTerms: ["Programs", "Goals"],
        severity: "medium",
        humanReviewBlocker: false,
      },
    ]);
  });

  it("builds a durable markdown report without leaking browser-visible emails", () => {
    const markdown = buildClinicalQaReportMarkdown({
      generatedAt: "2026-06-15T17:30:00.000Z",
      baseUrl: "https://app.example.test",
      routePath: "/clients/test-client?tab=programs-goals",
      credentialLabel: "PW_CLINICAL_QA_EMAIL + PW_CLINICAL_QA_PASSWORD",
      screenshotPath: "artifacts/latest/clinical-data-parity-agent-test.png",
      checklist: [
        {
          key: "program_goal_surface",
          label: "Programs/goals review surface is visible",
          status: "pass",
          missingTerms: [],
        },
      ],
      dataParityFindings: [
        {
          key: "target_behaviors",
          label: "Target behaviors",
          sourceSection: "Behavioral Observations",
          expectedTerms: ["elopement", "property destruction"],
          observedSectionTerms: ["Programs and Goals"],
          severity: "high",
          humanReviewBlocker: true,
          status: "fail",
          mismatchType: "partial",
          matchedTerms: ["elopement"],
          missingTerms: ["property destruction"],
          observedSectionMatchedTerms: ["Programs and Goals"],
          observedSectionMissingTerms: [],
          observedTextSnippet: "Observed by qa@example.com near Programs and Goals.",
        },
      ],
      disclaimer: "QA evidence only. This is not BCBA approval or clinical sign-off.",
    });

    expect(markdown).toContain("# Clinical Data Parity Agent Report");
    expect(markdown).toContain("target route: `/clients/test-client?tab=programs-goals`");
    expect(markdown).toContain("screenshot: `artifacts/latest/clinical-data-parity-agent-test.png`");
    expect(markdown).toContain("Target behaviors");
    expect(markdown).toContain("missing: property destruction");
    expect(markdown).toContain("human review blocker: yes");
    expect(markdown).toContain("[redacted-email]");
    expect(markdown).not.toContain("qa@example.com");
  });
});
