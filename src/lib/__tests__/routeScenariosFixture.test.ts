import { describe, expect, it } from "vitest";

import { payrollAdministrationRouteFixture } from "../../../cypress/support/routeScenarios";

describe("routeScenarios payroll administration fixture", () => {
  it("includes the required boolean canExportPeriod capability", () => {
    expect(payrollAdministrationRouteFixture.body.capabilities).toEqual(
      expect.objectContaining({
        canExportPeriod: expect.any(Boolean),
      }),
    );
  });
});
