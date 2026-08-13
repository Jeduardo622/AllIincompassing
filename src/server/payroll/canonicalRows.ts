import type {
  CanonicalAppliedRateDenominator,
  CanonicalAppliedRateNumerator,
  CanonicalCorrectionIndicator,
  CanonicalEarningCode,
  CanonicalPayrollRow,
  LockedPeriodInput,
  LockedSegmentPayload,
  LockedSnapshot,
} from "./exportTypes";

const SNAPSHOT_HASH_REGEX = /^[0-9a-f]{64}$/;
const UNSAFE_FORMULA_PREFIX_REGEX = /^\s*[=+\-@]/;
const UNSAFE_CONTROL_CHARACTER_REGEX = /[\r\n\t]/;

const EARNING_ORDER: Record<CanonicalEarningCode, number> = {
  REG: 0,
  OT: 1,
  DT: 2,
  MEAL_PREMIUM: 3,
};

const SEGMENT_TO_EARNING: Record<LockedSegmentPayload["bucket"], CanonicalEarningCode> = {
  regular: "REG",
  overtime: "OT",
  doubletime: "DT",
};

const SEGMENT_TO_RATE: Record<
  LockedSegmentPayload["bucket"],
  readonly [CanonicalAppliedRateNumerator, CanonicalAppliedRateDenominator]
> = {
  regular: [1, 1],
  overtime: [3, 2],
  doubletime: [2, 1],
};

type ComparableRowKey = Omit<
  CanonicalPayrollRow,
  "schemaVersion" | "exportId" | "adjustsExportId" | "correctionIndicator" | "snapshotVersion" | "snapshotHash"
>;

const toComparableKey = (row: ComparableRowKey) =>
  [
    row.organizationPayrollId,
    row.employeePayrollId,
    row.payGroupId,
    row.periodStart,
    row.periodEnd,
    row.workDate,
    row.earningCode,
    row.baseRateCents,
    row.appliedRateNumerator,
    row.appliedRateDenominator,
  ].join("|");

const assertSafeIdentifier = (label: string, value: string | null, allowNull = false) => {
  if (value === null && allowNull) {
    return;
  }
  if (!value || UNSAFE_FORMULA_PREFIX_REGEX.test(value) || UNSAFE_CONTROL_CHARACTER_REGEX.test(value)) {
    throw new Error(`Unsafe identifier in ${label}.`);
  }
};

const assertInteger = (label: string, value: number) => {
  if (!Number.isInteger(value)) {
    throw new Error(`${label} must use integer seconds/cents only.`);
  }
};

const assertSnapshot = (snapshot: LockedSnapshot) => {
  if (!snapshot.locked) {
    throw new Error("Locked snapshot required for payroll export.");
  }

  assertSafeIdentifier("organizationPayrollId", snapshot.organizationPayrollId);
  assertSafeIdentifier("employeePayrollId", snapshot.employeePayrollId);
  assertSafeIdentifier("payGroupId", snapshot.payGroupId);

  if (!SNAPSHOT_HASH_REGEX.test(snapshot.snapshotHash)) {
    throw new Error("Snapshot hash must be lowercase SHA-256.");
  }

  assertInteger("snapshotVersion", snapshot.snapshotVersion);
  assertInteger("regularSeconds", snapshot.totals.regularSeconds);
  assertInteger("overtimeSeconds", snapshot.totals.overtimeSeconds);
  assertInteger("doubleTimeSeconds", snapshot.totals.doubleTimeSeconds);
  assertInteger("mealPremiumCents", snapshot.totals.mealPremiumCents);
  assertInteger("grossEarningsCents", snapshot.totals.grossEarningsCents);
};

const buildRowsFromSnapshot = (
  input: LockedPeriodInput,
  snapshot: LockedSnapshot,
  correctionIndicator: CanonicalCorrectionIndicator,
): CanonicalPayrollRow[] => {
  const rows: CanonicalPayrollRow[] = [];

  for (const segment of snapshot.segments) {
    assertInteger("segment.seconds", segment.seconds);
    assertInteger("segment.hourlyRateCents", segment.hourlyRateCents);
    assertInteger("segment.grossCents", segment.grossCents);
    const [appliedRateNumerator, appliedRateDenominator] = SEGMENT_TO_RATE[segment.bucket];
    rows.push({
      schemaVersion: "provider-neutral-v1",
      exportId: input.exportId,
      adjustsExportId: input.adjustsExportId,
      organizationPayrollId: snapshot.organizationPayrollId,
      employeePayrollId: snapshot.employeePayrollId,
      payGroupId: snapshot.payGroupId,
      periodStart: snapshot.periodStart,
      periodEnd: snapshot.periodEnd,
      workDate: segment.workDate,
      earningCode: SEGMENT_TO_EARNING[segment.bucket],
      seconds: segment.seconds,
      baseRateCents: segment.hourlyRateCents,
      appliedRateNumerator,
      appliedRateDenominator,
      grossCents: segment.grossCents,
      correctionIndicator,
      snapshotVersion: snapshot.snapshotVersion,
      snapshotHash: snapshot.snapshotHash,
    });
  }

  for (const premium of snapshot.premiums) {
    assertInteger("premium.seconds", premium.seconds);
    assertInteger("premium.hourlyRateCents", premium.hourlyRateCents);
    assertInteger("premium.cents", premium.cents);
    rows.push({
      schemaVersion: "provider-neutral-v1",
      exportId: input.exportId,
      adjustsExportId: input.adjustsExportId,
      organizationPayrollId: snapshot.organizationPayrollId,
      employeePayrollId: snapshot.employeePayrollId,
      payGroupId: snapshot.payGroupId,
      periodStart: snapshot.periodStart,
      periodEnd: snapshot.periodEnd,
      workDate: premium.workDate,
      earningCode: "MEAL_PREMIUM",
      seconds: premium.seconds,
      baseRateCents: premium.hourlyRateCents,
      appliedRateNumerator: 1,
      appliedRateDenominator: 1,
      grossCents: premium.cents,
      correctionIndicator,
      snapshotVersion: snapshot.snapshotVersion,
      snapshotHash: snapshot.snapshotHash,
    });
  }

  return rows;
};

const aggregateRows = (rows: readonly CanonicalPayrollRow[], correctionIndicator: CanonicalCorrectionIndicator) => {
  const aggregated = new Map<string, CanonicalPayrollRow>();
  for (const row of rows) {
    const comparable: ComparableRowKey = {
      organizationPayrollId: row.organizationPayrollId,
      employeePayrollId: row.employeePayrollId,
      payGroupId: row.payGroupId,
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
      workDate: row.workDate,
      earningCode: row.earningCode,
      seconds: row.seconds,
      baseRateCents: row.baseRateCents,
      appliedRateNumerator: row.appliedRateNumerator,
      appliedRateDenominator: row.appliedRateDenominator,
      grossCents: row.grossCents,
    };
    const key = toComparableKey(comparable);
    const existing = aggregated.get(key);
    if (existing) {
      existing.seconds += row.seconds;
      existing.grossCents += row.grossCents;
      existing.snapshotVersion = Math.max(existing.snapshotVersion, row.snapshotVersion);
      existing.snapshotHash = existing.snapshotVersion === row.snapshotVersion ? row.snapshotHash : existing.snapshotHash;
      continue;
    }
    aggregated.set(key, {
      ...row,
      correctionIndicator,
    });
  }
  return [...aggregated.values()];
};

const reconcileSnapshotTotals = (snapshot: LockedSnapshot, rows: readonly CanonicalPayrollRow[]) => {
  const derived = rows.reduce(
    (totals, row) => {
      totals.grossEarningsCents += row.grossCents;
      if (row.earningCode === "REG") {
        totals.regularSeconds += row.seconds;
      } else if (row.earningCode === "OT") {
        totals.overtimeSeconds += row.seconds;
      } else if (row.earningCode === "DT") {
        totals.doubleTimeSeconds += row.seconds;
      } else {
        totals.mealPremiumCents += row.grossCents;
      }
      return totals;
    },
    {
      regularSeconds: 0,
      overtimeSeconds: 0,
      doubleTimeSeconds: 0,
      mealPremiumCents: 0,
      grossEarningsCents: 0,
    },
  );

  if (
    derived.regularSeconds !== snapshot.totals.regularSeconds
    || derived.overtimeSeconds !== snapshot.totals.overtimeSeconds
    || derived.doubleTimeSeconds !== snapshot.totals.doubleTimeSeconds
    || derived.mealPremiumCents !== snapshot.totals.mealPremiumCents
    || derived.grossEarningsCents !== snapshot.totals.grossEarningsCents
  ) {
    throw new Error("Reconciliation mismatch between locked snapshot totals and canonical rows.");
  }
};

const compareRows = (left: CanonicalPayrollRow, right: CanonicalPayrollRow) =>
  left.organizationPayrollId.localeCompare(right.organizationPayrollId)
  || left.employeePayrollId.localeCompare(right.employeePayrollId)
  || left.payGroupId.localeCompare(right.payGroupId)
  || left.periodStart.localeCompare(right.periodStart)
  || left.periodEnd.localeCompare(right.periodEnd)
  || left.workDate.localeCompare(right.workDate)
  || EARNING_ORDER[left.earningCode] - EARNING_ORDER[right.earningCode]
  || left.baseRateCents - right.baseRateCents
  || left.appliedRateNumerator - right.appliedRateNumerator
  || left.appliedRateDenominator - right.appliedRateDenominator
  || left.snapshotVersion - right.snapshotVersion
  || left.snapshotHash.localeCompare(right.snapshotHash);

const buildAdjustmentRows = (
  input: LockedPeriodInput,
  currentRows: readonly CanonicalPayrollRow[],
) => {
  const priorRows = input.priorRows ?? [];
  const priorByKey = new Map<string, CanonicalPayrollRow>();
  const currentByKey = new Map<string, CanonicalPayrollRow>();

  for (const row of aggregateRows(priorRows, "N")) {
    const key = toComparableKey({
      organizationPayrollId: row.organizationPayrollId,
      employeePayrollId: row.employeePayrollId,
      payGroupId: row.payGroupId,
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
      workDate: row.workDate,
      earningCode: row.earningCode,
      seconds: row.seconds,
      baseRateCents: row.baseRateCents,
      appliedRateNumerator: row.appliedRateNumerator,
      appliedRateDenominator: row.appliedRateDenominator,
      grossCents: row.grossCents,
    });
    priorByKey.set(key, row);
  }

  for (const row of aggregateRows(currentRows, "Y")) {
    const key = toComparableKey({
      organizationPayrollId: row.organizationPayrollId,
      employeePayrollId: row.employeePayrollId,
      payGroupId: row.payGroupId,
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
      workDate: row.workDate,
      earningCode: row.earningCode,
      seconds: row.seconds,
      baseRateCents: row.baseRateCents,
      appliedRateNumerator: row.appliedRateNumerator,
      appliedRateDenominator: row.appliedRateDenominator,
      grossCents: row.grossCents,
    });
    currentByKey.set(key, row);
  }

  const deltaRows: CanonicalPayrollRow[] = [];
  const allKeys = new Set([...priorByKey.keys(), ...currentByKey.keys()]);
  for (const key of allKeys) {
    const current = currentByKey.get(key);
    const prior = priorByKey.get(key);
    const template = current ?? prior;
    if (!template) {
      continue;
    }

    const deltaSeconds = (current?.seconds ?? 0) - (prior?.seconds ?? 0);
    const deltaGross = (current?.grossCents ?? 0) - (prior?.grossCents ?? 0);
    if (deltaSeconds === 0 && deltaGross === 0) {
      continue;
    }

    deltaRows.push({
      ...template,
      exportId: input.exportId,
      adjustsExportId: input.adjustsExportId,
      correctionIndicator: "Y",
      seconds: deltaSeconds,
      grossCents: deltaGross,
      snapshotVersion: current?.snapshotVersion ?? prior!.snapshotVersion,
      snapshotHash: current?.snapshotHash ?? prior!.snapshotHash,
    });
  }

  return deltaRows;
};

export type { LockedPeriodInput } from "./exportTypes";

export function buildCanonicalRows(input: LockedPeriodInput): CanonicalPayrollRow[] {
  assertSafeIdentifier("exportId", input.exportId);
  assertSafeIdentifier("adjustsExportId", input.adjustsExportId, true);
  if (input.schemaVersion !== "provider-neutral-v1") {
    throw new Error("Unsupported payroll export schema version.");
  }

  const rawRows: CanonicalPayrollRow[] = [];
  for (const snapshot of input.snapshots) {
    assertSnapshot(snapshot);
    const snapshotRows = buildRowsFromSnapshot(input, snapshot, input.adjustsExportId ? "Y" : "N");
    reconcileSnapshotTotals(snapshot, snapshotRows);
    rawRows.push(...snapshotRows);
  }

  const aggregatedCurrent = aggregateRows(rawRows, input.adjustsExportId ? "Y" : "N");
  const rows = input.adjustsExportId
    ? buildAdjustmentRows(input, aggregatedCurrent)
    : aggregatedCurrent;

  return rows.sort(compareRows);
}
