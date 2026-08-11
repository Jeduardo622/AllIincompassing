import { describe, expect, it } from "vitest";

import {
  canGrantPayrollAdminCapability,
  hasActiveUserRole,
  isFailClosedPayrollJurisdiction,
  profileMatchesPayrollOrg,
} from "../access";

describe("payroll access helpers", () => {
  it("treats CA as the only active v1 jurisdiction and fails closed for others", () => {
    expect(isFailClosedPayrollJurisdiction("CA")).toBe(false);
    expect(isFailClosedPayrollJurisdiction("TX")).toBe(true);
    expect(isFailClosedPayrollJurisdiction("AZ")).toBe(true);
  });

  it("requires active canonical org profile alignment", () => {
    expect(
      profileMatchesPayrollOrg({
        isActive: true,
        organizationId: "org-1",
        resolvedOrganizationId: "org-1",
        targetOrganizationId: "org-1",
      }),
    ).toBe(true);

    expect(
      profileMatchesPayrollOrg({
        isActive: false,
        organizationId: "org-1",
        resolvedOrganizationId: "org-1",
        targetOrganizationId: "org-1",
      }),
    ).toBe(false);

    expect(
      profileMatchesPayrollOrg({
        isActive: true,
        organizationId: "org-2",
        resolvedOrganizationId: "org-1",
        targetOrganizationId: "org-1",
      }),
    ).toBe(false);
  });

  it("rejects inactive or expired user-role authority", () => {
    expect(hasActiveUserRole({ isActive: true, expiresAt: null }, new Date("2026-08-11T12:00:00Z"))).toBe(true);
    expect(hasActiveUserRole({ isActive: false, expiresAt: null }, new Date("2026-08-11T12:00:00Z"))).toBe(false);
    expect(
      hasActiveUserRole(
        { isActive: true, expiresAt: "2026-08-11T11:59:59Z" },
        new Date("2026-08-11T12:00:00Z"),
      ),
    ).toBe(false);
  });

  it("allows payroll-admin grants only for canonical admin membership plus explicit effective grant", () => {
    expect(
      canGrantPayrollAdminCapability({
        hasEligibleRole: true,
        grantIsActive: true,
      }),
    ).toBe(true);

    expect(
      canGrantPayrollAdminCapability({
        hasEligibleRole: false,
        grantIsActive: true,
      }),
    ).toBe(false);

    expect(
      canGrantPayrollAdminCapability({
        hasEligibleRole: true,
        grantIsActive: false,
      }),
    ).toBe(false);
  });
});
