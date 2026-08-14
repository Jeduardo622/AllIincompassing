export const PROVIDER_NEUTRAL_V1_HEADER = [
  "schema_version",
  "export_id",
  "adjusts_export_id",
  "organization_payroll_id",
  "employee_payroll_id",
  "pay_group_id",
  "period_start",
  "period_end",
  "work_date",
  "earning_code",
  "hours",
  "base_rate",
  "applied_rate",
  "gross_earnings",
  "correction_indicator",
  "snapshot_version",
  "snapshot_hash",
] as const;

export const BANNED_PHI_TOKENS = [
  "session",
  "client",
  "patient",
  "diagnosis",
  "goal",
  "note",
  "authorization",
] as const;

export type ProviderNeutralSchemaVersion = "provider-neutral-v1";
export type CanonicalEarningCode = "REG" | "OT" | "DT" | "MEAL_PREMIUM";
export type CanonicalCorrectionIndicator = "N" | "Y";
export type CanonicalAppliedRateNumerator = 1 | 2 | 3;
export type CanonicalAppliedRateDenominator = 1 | 2;

export type CanonicalPayrollRow = {
  schemaVersion: ProviderNeutralSchemaVersion;
  exportId: string;
  adjustsExportId: string | null;
  organizationPayrollId: string;
  employeePayrollId: string;
  payGroupId: string;
  periodStart: string;
  periodEnd: string;
  workDate: string;
  earningCode: CanonicalEarningCode;
  seconds: number;
  baseRateCents: number;
  appliedRateNumerator: CanonicalAppliedRateNumerator;
  appliedRateDenominator: CanonicalAppliedRateDenominator;
  grossCents: number;
  correctionIndicator: CanonicalCorrectionIndicator;
  snapshotVersion: number;
  snapshotHash: string;
};

export type LockedSegmentPayload = {
  workDate: string;
  seconds: number;
  bucket: "regular" | "overtime" | "doubletime";
  hourlyRateCents: number;
  grossCents: number;
};

export type LockedPremiumPayload = {
  workDate: string;
  seconds: number;
  cents: number;
  hourlyRateCents: number;
};

export type LockedSnapshotTotals = {
  regularSeconds: number;
  overtimeSeconds: number;
  doubleTimeSeconds: number;
  mealPremiumCents: number;
  grossEarningsCents: number;
};

export type LockedSnapshot = {
  organizationPayrollId: string;
  employeePayrollId: string;
  payGroupId: string;
  periodStart: string;
  periodEnd: string;
  snapshotVersion: number;
  snapshotHash: string;
  locked: boolean;
  totals: LockedSnapshotTotals;
  segments: readonly LockedSegmentPayload[];
  premiums: readonly LockedPremiumPayload[];
};

export type LockedPeriodInput = {
  schemaVersion: ProviderNeutralSchemaVersion;
  exportId: string;
  adjustsExportId: string | null;
  snapshots: readonly LockedSnapshot[];
  priorRows?: readonly CanonicalPayrollRow[];
};
