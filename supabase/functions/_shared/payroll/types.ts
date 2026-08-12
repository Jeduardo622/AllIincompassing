export type WorkLocation = "client_site" | "office" | "home" | "community" | "other";
export type WorkCategory = "direct_service" | "administration" | "travel" | "training";
export type PayrollEventType =
  | "shift_started"
  | "shift_ended"
  | "meal_started"
  | "meal_ended"
  | "work_category_changed";
export type AttendanceEventType = "session_started" | "session_ended";
export type CalculationEventSource =
  | "employee_time"
  | "session_attendance"
  | "time_correction_request"
  | "session_attendance_correction_request"
  | "timekeeping_exception";

export type CalculationEvent = {
  id: string;
  source: CalculationEventSource;
  eventType: PayrollEventType | AttendanceEventType;
  occurredAt: string;
  createdAt: string;
  timezone: string;
  workLocation: WorkLocation | null;
  workCategory: WorkCategory | null;
  sessionId?: string | null;
  employeeTimeEventId?: string | null;
  details?: Record<string, unknown> | null;
};

export type RateVersion = {
  id: string;
  effectiveFrom: string;
  effectiveThrough: string | null;
  hourlyRateCents: number;
};

export type MealResolution = {
  id: string;
  shiftStartEventId: string;
  code:
    | "waived_first_meal"
    | "waived_second_meal"
    | "premium_owed"
    | "premium_not_owed";
  mealOrdinal: 1 | 2;
  deadlineAt: string;
  mealStartEventId?: string | null;
  mealEndEventId?: string | null;
  resolvedAt?: string;
  reason?: string | null;
};

export type PayrollPolicyInput = {
  jurisdiction: "CA" | "TX" | "AZ";
  classification: "nonexempt" | "exempt";
  supportsAlternativeWorkweek: boolean;
  supportsCollectiveBargainingOverrides: boolean;
  supportsIndustryExceptions: boolean;
  supportsMultiRateRegularRate: boolean;
};

export type HighWaterMark = {
  createdAt: string | null;
  id: string | null;
  rowCount: number;
};

export type SourceHighWater = {
  employeeTimeEvents: HighWaterMark;
  sessionAttendanceEvents: HighWaterMark;
  timeCorrectionRequests: HighWaterMark;
  sessionAttendanceCorrectionRequests: HighWaterMark;
  timekeepingExceptions: HighWaterMark;
  mealResolutions: HighWaterMark;
};

export type CalculationInput = {
  employeeId: string;
  timezone: string;
  workdayStartLocal: string;
  workweekStartsOn: number;
  policyVersionId: string;
  payPeriodId: string;
  events: readonly CalculationEvent[];
  rateVersions: readonly RateVersion[];
  mealResolutions: readonly MealResolution[];
  policy: PayrollPolicyInput;
  sourceHighWater: SourceHighWater;
};

export type CalculationExceptionCode =
  | "unsupported_policy"
  | "invalid_timezone"
  | "event_limit_exceeded"
  | "open_shift"
  | "open_meal"
  | "duplicate_shift_start"
  | "duplicate_meal_start"
  | "meal_missing"
  | "meal_late"
  | "meal_short"
  | "meal_interrupted"
  | "session_outside_shift"
  | "correction_pending_review"
  | "missing_rate"
  | "overlapping_rates"
  | "invalid_meal_resolution";

export type CalculationException = {
  code: CalculationExceptionCode;
  blocking: boolean;
  message: string;
  relatedIds?: string[];
  details?: Record<string, unknown>;
};

export type TimesheetTotals = {
  regularSeconds: number;
  overtimeSeconds: number;
  doubleTimeSeconds: number;
  mealPremiumCents: number;
  grossEarningsCents: number;
};

export type ClassifiedSegment = {
  start: string;
  end: string;
  seconds: number;
  bucket: "regular" | "overtime" | "doubletime";
  rateVersionId: string;
  hourlyRateCents: number;
  dayKey: string;
  weekKey: string;
};

export type TimesheetCalculation = {
  lockable: boolean;
  workedSeconds: number;
  classifiedSeconds: number;
  totals: TimesheetTotals;
  segments: ClassifiedSegment[];
  exceptions: CalculationException[];
};
