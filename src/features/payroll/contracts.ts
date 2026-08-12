export const PAYROLL_FEATURE_FLAG_KEY = "payroll_timekeeping_v1" as const;

export const PAYROLL_RETENTION_MINIMUM_YEARS = 4 as const;

export const PAYROLL_TIME_JURISDICTIONS = ["CA", "TX", "AZ"] as const;

export const PAYROLL_ADMIN_ELIGIBLE_ROLES = ["admin", "super_admin"] as const;

export const PAYROLL_CAPABILITIES = [
  "time.clock_self",
  "time.view_self",
  "time.request_correction_self",
  "time.review_assigned",
  "time.approve_assigned",
  "session_attendance.record_assigned",
  "payroll.configure_employment",
  "payroll.resolve_exceptions",
  "payroll.lock_period",
  "payroll.reopen_period",
  "payroll.export_period",
  "payroll.view_compensation",
] as const;

export const TIME_EVENT_TYPES = [
  "shift_started",
  "shift_ended",
  "meal_started",
  "meal_ended",
  "work_category_changed",
] as const;

export const SESSION_ATTENDANCE_EVENT_TYPES = [
  "session_started",
  "session_ended",
] as const;

export const WORK_CATEGORIES = [
  "direct_service",
  "administration",
  "travel",
  "training",
] as const;

export const WORK_LOCATIONS = [
  "client_site",
  "office",
  "home",
  "community",
  "other",
] as const;

export const PAYROLL_EVENT_OPERATIONS = [
  "record_employee_time_event",
  "record_session_attendance_event",
  "request_time_correction",
  "request_session_attendance_correction",
] as const;

export const PAYROLL_APPROVAL_ACTIONS = [
  "submit",
  "manager_approve",
  "return",
  "lock",
  "reopen",
  "resolve_blocker",
] as const;

export const PAYROLL_BLOCKER_TYPES = [
  "time_correction_request",
  "session_attendance_correction_request",
  "timekeeping_exception",
] as const;

export const PAYROLL_BLOCKER_RESOLUTIONS = [
  "resolved",
  "reopened",
] as const;

export type PayrollJurisdiction = (typeof PAYROLL_TIME_JURISDICTIONS)[number];
export type PayrollAdminEligibleRole =
  (typeof PAYROLL_ADMIN_ELIGIBLE_ROLES)[number];
export type PayrollEventOperation = (typeof PAYROLL_EVENT_OPERATIONS)[number];
export type PayrollApprovalAction = (typeof PAYROLL_APPROVAL_ACTIONS)[number];
export type PayrollBlockerType = (typeof PAYROLL_BLOCKER_TYPES)[number];
export type PayrollBlockerResolution = (typeof PAYROLL_BLOCKER_RESOLUTIONS)[number];
export type PayrollCapability = (typeof PAYROLL_CAPABILITIES)[number];
export type TimeEventType = (typeof TIME_EVENT_TYPES)[number];
export type SessionAttendanceEventType =
  (typeof SESSION_ATTENDANCE_EVENT_TYPES)[number];
export type WorkCategory = (typeof WORK_CATEGORIES)[number];
export type WorkLocation = (typeof WORK_LOCATIONS)[number];

export type PayrollMutationEnvelope<T extends { idempotencyKey?: string }> = {
  data: T;
  occurredAt: string;
  timezone: string;
  workLocation: WorkLocation;
};
