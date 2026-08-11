export const PAYROLL_FEATURE_FLAG_KEY = "payroll_timekeeping_v1" as const;

export const PAYROLL_RETENTION_MINIMUM_YEARS = 4 as const;

export const PAYROLL_TIME_JURISDICTIONS = ["CA", "TX", "AZ"] as const;

export const PAYROLL_ADMIN_ELIGIBLE_ROLES = ["admin", "super_admin"] as const;

export const PAYROLL_EVENT_OPERATIONS = [
  "record_employee_time_event",
  "record_session_attendance_event",
  "request_time_correction",
  "request_session_attendance_correction",
] as const;

export type PayrollJurisdiction = (typeof PAYROLL_TIME_JURISDICTIONS)[number];
export type PayrollAdminEligibleRole =
  (typeof PAYROLL_ADMIN_ELIGIBLE_ROLES)[number];
export type PayrollEventOperation = (typeof PAYROLL_EVENT_OPERATIONS)[number];
