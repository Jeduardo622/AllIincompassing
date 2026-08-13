import { describe, expect, it } from "vitest";

import {
  PAYROLL_APPROVAL_ACTIONS,
  PAYROLL_BLOCKER_RESOLUTIONS,
  PAYROLL_BLOCKER_TYPES,
  PAYROLL_ADMIN_ELIGIBLE_ROLES,
  PAYROLL_CAPABILITIES,
  PAYROLL_EVENT_OPERATIONS,
  PAYROLL_FEATURE_FLAG_KEY,
  PAYROLL_RETENTION_MINIMUM_YEARS,
  SESSION_ATTENDANCE_EVENT_TYPES,
  TIME_EVENT_TYPES,
  PAYROLL_TIME_JURISDICTIONS,
  WORK_CATEGORIES,
  WORK_LOCATIONS,
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

  it("pins the exact stable payroll capability vocabulary", () => {
    expect(PAYROLL_CAPABILITIES).toEqual([
      "time.clock_self",
      "time.view_self",
      "time.request_correction_self",
      "time.review_assigned",
      "time.approve_assigned",
      "session_attendance.record_assigned",
      "payroll.configure_settings",
      "payroll.configure_employment",
      "payroll.resolve_exceptions",
      "payroll.lock_period",
      "payroll.reopen_period",
      "payroll.export_period",
      "payroll.view_compensation",
    ]);
  });

  it("pins the exact protected payroll approval action vocabulary", () => {
    expect(PAYROLL_APPROVAL_ACTIONS).toEqual([
      "review_queue",
      "review_details",
      "submit",
      "manager_approve",
      "return",
      "lock",
      "reopen",
      "resolve_blocker",
    ]);
    expect(PAYROLL_BLOCKER_TYPES).toEqual([
      "time_correction_request",
      "session_attendance_correction_request",
      "timekeeping_exception",
    ]);
    expect(PAYROLL_BLOCKER_RESOLUTIONS).toEqual([
      "resolved",
      "reopened",
    ]);
  });

  it("pins the exact stable event, category, and location vocabularies", () => {
    expect(TIME_EVENT_TYPES).toEqual([
      "shift_started",
      "shift_ended",
      "meal_started",
      "meal_ended",
      "work_category_changed",
    ]);
    expect(SESSION_ATTENDANCE_EVENT_TYPES).toEqual([
      "session_started",
      "session_ended",
    ]);
    expect(WORK_CATEGORIES).toEqual([
      "direct_service",
      "administration",
      "travel",
      "training",
    ]);
    expect(WORK_LOCATIONS).toEqual([
      "client_site",
      "office",
      "home",
      "community",
      "other",
    ]);
  });
});
