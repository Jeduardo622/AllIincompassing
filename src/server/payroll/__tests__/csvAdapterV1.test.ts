import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildCanonicalRows, type LockedPeriodInput } from "../canonicalRows";
import { renderProviderNeutralCsvV1 } from "../csvAdapterV1";
import { sha256ProviderNeutralCsvV1 } from "../exportHash";

const fixturePath = path.resolve(process.cwd(), "tests/fixtures/payroll/provider-neutral-v1.csv");

const baseInput = (): LockedPeriodInput => ({
  schemaVersion: "provider-neutral-v1",
  exportId: "11111111-1111-4111-8111-111111111111",
  adjustsExportId: null,
  snapshots: [
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
          seconds: 28_800,
          bucket: "regular",
          hourlyRateCents: 2_000,
          grossCents: 16_000,
        },
        {
          workDate: "2026-08-11",
          seconds: 7_200,
          bucket: "overtime",
          hourlyRateCents: 2_000,
          grossCents: 6_000,
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
          seconds: 27_000,
          bucket: "regular",
          hourlyRateCents: 3_000,
          grossCents: 22_500,
        },
        {
          workDate: "2026-08-11",
          seconds: 3_600,
          bucket: "doubletime",
          hourlyRateCents: 3_000,
          grossCents: 6_000,
        },
      ],
      premiums: [],
    },
  ],
});

describe("provider-neutral csv adapter v1", () => {
  it("renders the exact Task 5 header, UTF-8 RFC4180 rows, CRLF endings, and stable SHA-256", () => {
    const rows = buildCanonicalRows(baseInput());
    const csv = renderProviderNeutralCsvV1(rows);
    const expected = `${readFileSync(fixturePath, "utf8").replace(/\r?\n/g, "\r\n").replace(/\r\n$/, "")}\r\n`;

    expect(csv).toBe(expected);
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(csv).toContain("\"GROUP,01\"");
    expect(csv).toContain("8.000000");
    expect(csv).toContain("7.500000");
    expect(csv).toContain("20.00");
    expect(csv).toContain("30.00");
    expect(csv).toContain("1.00");
    expect(csv).toContain("1.50");
    expect(csv).toContain("2.00");
    expect(sha256ProviderNeutralCsvV1(rows)).toBe("cc2c92c105dc70e08d3d513911e2bb070bf663a18cc117d322ddf762340c7991");
  });

  it("rejects values containing banned PHI tokens case-insensitively", () => {
    const input = baseInput();
    input.snapshots[0]!.employeePayrollId = "CLIENT-01";

    expect(() => renderProviderNeutralCsvV1(buildCanonicalRows(input))).toThrow(/banned phi token/i);
  });
});
