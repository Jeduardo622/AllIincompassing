import { describe, expect, it } from "vitest";

import { payrollAdministrationRouteFixture } from "../../../cypress/support/routeScenarios";

describe("routeScenarios payroll administration fixture", () => {
  it("keeps canExportPeriod fail-closed in the payroll administration fixture", () => {
    expect(payrollAdministrationRouteFixture.body.capabilities).toEqual(
      expect.objectContaining({
        canExportPeriod: false,
      }),
    );
  });
});
