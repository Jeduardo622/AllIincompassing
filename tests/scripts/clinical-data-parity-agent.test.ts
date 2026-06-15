import { describe, expect, it } from "vitest";

import {
  assertBrowserOnlyTarget,
  assertRedactedQaFixture,
  buildClinicalQaRoute,
  evaluateClinicalQaChecklist,
  requireClinicalQaClientId,
  selectClinicalQaCredentials,
} from "../../scripts/lib/clinical-data-parity-agent";

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

  it("requires redacted or synthetic fixture names for document comparisons", () => {
    expect(assertRedactedQaFixture(undefined, "fixture")).toBeNull();
    expect(assertRedactedQaFixture("fixtures/redacted-iehp-fba.docx", "fixture")).toBe(
      "fixtures/redacted-iehp-fba.docx",
    );
    expect(() => assertRedactedQaFixture("fixtures/real-client-iehp-fba.docx", "fixture")).toThrow(
      "clearly redacted",
    );
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
});
