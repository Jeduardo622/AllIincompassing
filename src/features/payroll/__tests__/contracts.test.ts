import { describe, expect, it } from "vitest";

import {
  PAYROLL_ADMIN_ELIGIBLE_ROLES,
  PAYROLL_EVENT_OPERATIONS,
  PAYROLL_FEATURE_FLAG_KEY,
  PAYROLL_RETENTION_MINIMUM_YEARS,
  PAYROLL_TIME_JURISDICTIONS,
} from "../contracts";

describe("payroll contracts", () => {
  it("defines the protected payroll foundation feature and legal baseline", () => {
    expect(PAYROLL_FEATURE_FLAG_KEY).toBe("payroll_timekeeping_v1");
    expect(PAYROLL_RETENTION_MINIMUM_YEARS).toBe(4);
    expect(PAYROLL_TIME_JURISDICTIONS).toEqual(["CA", "TX", "AZ"]);
  });

  it("limits payroll-admin grant eligibility to canonical admin roles only", () => {
    expect(PAYROLL_ADMIN_ELIGIBLE_ROLES).toEqual(["admin", "super_admin"]);
    expect(PAYROLL_ADMIN_ELIGIBLE_ROLES).not.toContain("bcba");
    expect(PAYROLL_ADMIN_ELIGIBLE_ROLES).not.toContain("admin_schedule");
    expect(PAYROLL_ADMIN_ELIGIBLE_ROLES).not.toContain("midtier");
    expect(PAYROLL_ADMIN_ELIGIBLE_ROLES).not.toContain("therapist");
  });

  it("pins the four public mutation RPC operation keys for idempotent receipts", () => {
    expect(PAYROLL_EVENT_OPERATIONS).toEqual([
      "record_employee_time_event",
      "record_session_attendance_event",
      "request_time_correction",
      "request_session_attendance_correction",
    ]);
  });
});
