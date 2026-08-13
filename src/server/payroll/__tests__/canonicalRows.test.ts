import { describe, expect, it } from "vitest";
import { buildCanonicalRows, type LockedPeriodInput } from "../canonicalRows";

const baseInput = (): LockedPeriodInput => ({
  schemaVersion: "provider-neutral-v1",
  exportId: "11111111-1111-4111-8111-111111111111",
  adjustsExportId: null,
  snapshots: [
    {
      organizationPayrollId: "ORG-001",
      employeePayrollId: "EMP-002",
      payGroupId: "GROUP,01",
      periodStart: "2026-08-11",
      periodEnd: "2026-08-24",
      snapshotVersion: 4,
      snapshotHash: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      locked: true,
      totals: {
        regularSeconds: 27_000,
        overtimeSeconds: 0,
        doubleTimeSeconds: 3_600,
        mealPremiumCents: 0,
        grossEarningsCents: 28_500,
      },
      segments: [
        {
          workDate: "2026-08-11",
          seconds: 3_600,
          bucket: "doubletime",
          hourlyRateCents: 3_000,
          grossCents: 6_000,
        },
        {
          workDate: "2026-08-11",
          seconds: 27_000,
          bucket: "regular",
          hourlyRateCents: 3_000,
          grossCents: 22_500,
        },
      ],
      premiums: [],
    },
    {
      organizationPayrollId: "ORG-001",
      employeePayrollId: "EMP-001",
      payGroupId: "GROUP,01",
      periodStart: "2026-08-11",
      periodEnd: "2026-08-24",
      snapshotVersion: 3,
      snapshotHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      locked: true,
      totals: {
        regularSeconds: 28_800,
        overtimeSeconds: 7_200,
        doubleTimeSeconds: 0,
        mealPremiumCents: 2_000,
        grossEarningsCents: 24_000,
      },
      segments: [
        {
          workDate: "2026-08-11",
          seconds: 7_200,
          bucket: "overtime",
          hourlyRateCents: 2_000,
          grossCents: 6_000,
        },
        {
          workDate: "2026-08-11",
          seconds: 28_800,
          bucket: "regular",
          hourlyRateCents: 2_000,
          grossCents: 16_000,
        },
      ],
      premiums: [
        {
          workDate: "2026-08-11",
          seconds: 3_600,
          cents: 2_000,
          hourlyRateCents: 2_000,
        },
      ],
    },
  ],
});

describe("buildCanonicalRows", () => {
  it("builds deterministic provider-neutral rows from locked segment and premium payloads", () => {
    const rows = buildCanonicalRows(baseInput());

    expect(rows).toEqual([
      {
        schemaVersion: "provider-neutral-v1",
        exportId: "11111111-1111-4111-8111-111111111111",
        adjustsExportId: null,
        organizationPayrollId: "ORG-001",
        employeePayrollId: "EMP-001",
        payGroupId: "GROUP,01",
        periodStart: "2026-08-11",
        periodEnd: "2026-08-24",
        workDate: "2026-08-11",
        earningCode: "REG",
        seconds: 28_800,
        baseRateCents: 2_000,
        appliedRateNumerator: 1,
        appliedRateDenominator: 1,
        grossCents: 16_000,
        correctionIndicator: "N",
        snapshotVersion: 3,
        snapshotHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
      {
        schemaVersion: "provider-neutral-v1",
        exportId: "11111111-1111-4111-8111-111111111111",
        adjustsExportId: null,
        organizationPayrollId: "ORG-001",
        employeePayrollId: "EMP-001",
        payGroupId: "GROUP,01",
        periodStart: "2026-08-11",
        periodEnd: "2026-08-24",
        workDate: "2026-08-11",
        earningCode: "OT",
        seconds: 7_200,
        baseRateCents: 2_000,
        appliedRateNumerator: 3,
        appliedRateDenominator: 2,
        grossCents: 6_000,
        correctionIndicator: "N",
        snapshotVersion: 3,
        snapshotHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
      {
        schemaVersion: "provider-neutral-v1",
        exportId: "11111111-1111-4111-8111-111111111111",
        adjustsExportId: null,
        organizationPayrollId: "ORG-001",
        employeePayrollId: "EMP-001",
        payGroupId: "GROUP,01",
        periodStart: "2026-08-11",
        periodEnd: "2026-08-24",
        workDate: "2026-08-11",
        earningCode: "MEAL_PREMIUM",
        seconds: 3_600,
        baseRateCents: 2_000,
        appliedRateNumerator: 1,
        appliedRateDenominator: 1,
        grossCents: 2_000,
        correctionIndicator: "N",
        snapshotVersion: 3,
        snapshotHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
      {
        schemaVersion: "provider-neutral-v1",
        exportId: "11111111-1111-4111-8111-111111111111",
        adjustsExportId: null,
        organizationPayrollId: "ORG-001",
        employeePayrollId: "EMP-002",
        payGroupId: "GROUP,01",
        periodStart: "2026-08-11",
        periodEnd: "2026-08-24",
        workDate: "2026-08-11",
        earningCode: "REG",
        seconds: 27_000,
        baseRateCents: 3_000,
        appliedRateNumerator: 1,
        appliedRateDenominator: 1,
        grossCents: 22_500,
        correctionIndicator: "N",
        snapshotVersion: 4,
        snapshotHash: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      },
      {
        schemaVersion: "provider-neutral-v1",
        exportId: "11111111-1111-4111-8111-111111111111",
        adjustsExportId: null,
        organizationPayrollId: "ORG-001",
        employeePayrollId: "EMP-002",
        payGroupId: "GROUP,01",
        periodStart: "2026-08-11",
        periodEnd: "2026-08-24",
        workDate: "2026-08-11",
        earningCode: "DT",
        seconds: 3_600,
        baseRateCents: 3_000,
        appliedRateNumerator: 2,
        appliedRateDenominator: 1,
        grossCents: 6_000,
        correctionIndicator: "N",
        snapshotVersion: 4,
        snapshotHash: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      },
    ]);
  });

  it("rejects unlocked snapshots before producing rows", () => {
    const input = baseInput();
    input.snapshots[0]!.locked = false;

    expect(() => buildCanonicalRows(input)).toThrow(/locked snapshot/i);
  });

  it("rejects reconciliation mismatches between snapshot totals and derived rows", () => {
    const input = baseInput();
    input.snapshots[1]!.totals.grossEarningsCents = 99_999;

    expect(() => buildCanonicalRows(input)).toThrow(/reconciliation mismatch/i);
  });

  it("rejects identifier values with unsafe formula prefixes", () => {
    const input = baseInput();
    input.snapshots[0]!.employeePayrollId = "=EMP-002";

    expect(() => buildCanonicalRows(input)).toThrow(/unsafe identifier/i);
  });

  it("rejects formula prefixes hidden by whitespace and control characters", () => {
    const whitespaceFormula = baseInput();
    whitespaceFormula.snapshots[0]!.employeePayrollId = "  +SUM(A1:A2)";
    expect(() => buildCanonicalRows(whitespaceFormula)).toThrow(/unsafe identifier/i);

    const newline = baseInput();
    newline.snapshots[0]!.payGroupId = "GROUP-01\nINJECTED";
    expect(() => buildCanonicalRows(newline)).toThrow(/unsafe identifier/i);
  });

  it("emits delta adjustment rows when an adjustment export references a prior run", () => {
    const input = baseInput();
    input.exportId = "22222222-2222-4222-8222-222222222222";
    input.adjustsExportId = "11111111-1111-4111-8111-111111111111";
    input.priorRows = [
      {
        schemaVersion: "provider-neutral-v1",
        exportId: "11111111-1111-4111-8111-111111111111",
        adjustsExportId: null,
        organizationPayrollId: "ORG-001",
        employeePayrollId: "EMP-001",
        payGroupId: "GROUP,01",
        periodStart: "2026-08-11",
        periodEnd: "2026-08-24",
        workDate: "2026-08-11",
        earningCode: "REG",
        seconds: 21_600,
        baseRateCents: 2_000,
        appliedRateNumerator: 1,
        appliedRateDenominator: 1,
        grossCents: 12_000,
        correctionIndicator: "N",
        snapshotVersion: 2,
        snapshotHash: "9999999999999999999999999999999999999999999999999999999999999999",
      },
      {
        schemaVersion: "provider-neutral-v1",
        exportId: "11111111-1111-4111-8111-111111111111",
        adjustsExportId: null,
        organizationPayrollId: "ORG-001",
        employeePayrollId: "EMP-001",
        payGroupId: "GROUP,01",
        periodStart: "2026-08-11",
        periodEnd: "2026-08-24",
        workDate: "2026-08-11",
        earningCode: "OT",
        seconds: 7_200,
        baseRateCents: 2_000,
        appliedRateNumerator: 3,
        appliedRateDenominator: 2,
        grossCents: 6_000,
        correctionIndicator: "N",
        snapshotVersion: 2,
        snapshotHash: "9999999999999999999999999999999999999999999999999999999999999999",
      },
      {
        schemaVersion: "provider-neutral-v1",
        exportId: "11111111-1111-4111-8111-111111111111",
        adjustsExportId: null,
        organizationPayrollId: "ORG-001",
        employeePayrollId: "EMP-001",
        payGroupId: "GROUP,01",
        periodStart: "2026-08-11",
        periodEnd: "2026-08-24",
        workDate: "2026-08-11",
        earningCode: "MEAL_PREMIUM",
        seconds: 3_600,
        baseRateCents: 2_000,
        appliedRateNumerator: 1,
        appliedRateDenominator: 1,
        grossCents: 2_000,
        correctionIndicator: "N",
        snapshotVersion: 2,
        snapshotHash: "9999999999999999999999999999999999999999999999999999999999999999",
      },
    ];

    const rows = buildCanonicalRows(input);

    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        exportId: "22222222-2222-4222-8222-222222222222",
        adjustsExportId: "11111111-1111-4111-8111-111111111111",
        employeePayrollId: "EMP-001",
        earningCode: "REG",
        seconds: 7_200,
        grossCents: 4_000,
        correctionIndicator: "Y",
      }),
    ]));
    expect(rows).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        employeePayrollId: "EMP-001",
        earningCode: "OT",
        correctionIndicator: "Y",
      }),
    ]));
  });
});
