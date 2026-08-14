import {
  BANNED_PHI_TOKENS,
  PROVIDER_NEUTRAL_V1_HEADER,
  type CanonicalPayrollRow,
} from "./exportTypes";

const BANNED_PHI_PATTERN = new RegExp(BANNED_PHI_TOKENS.join("|"), "i");

const escapeCsvCell = (value: string) => {
  if (!/[",\r\n]/.test(value)) {
    return value;
  }
  return `"${value.replaceAll("\"", "\"\"")}"`;
};

const roundDiv = (numerator: bigint, denominator: bigint) => (numerator + denominator / 2n) / denominator;

const formatHours = (seconds: number) => {
  const sign = seconds < 0 ? "-" : "";
  const scaled = roundDiv(BigInt(Math.abs(seconds)) * 1_000_000n, 3_600n);
  const whole = scaled / 1_000_000n;
  const fraction = (scaled % 1_000_000n).toString().padStart(6, "0");
  return `${sign}${whole.toString()}.${fraction}`;
};

const formatMoney = (cents: number) => {
  const sign = cents < 0 ? "-" : "";
  const absolute = Math.abs(cents);
  const units = Math.trunc(absolute / 100);
  const remainder = String(absolute % 100).padStart(2, "0");
  return `${sign}${units}.${remainder}`;
};

const formatAppliedRate = (numerator: number, denominator: number) =>
  formatMoney(Number(roundDiv(BigInt(numerator) * 100n, BigInt(denominator))));

const scanForBannedPhiTokens = (cells: readonly string[]) => {
  for (const cell of cells) {
    if (BANNED_PHI_PATTERN.test(cell)) {
      throw new Error(`Banned PHI token found in provider-neutral export value: ${cell}`);
    }
  }
};

const toCells = (row: CanonicalPayrollRow) => [
  row.schemaVersion,
  row.exportId,
  row.adjustsExportId ?? "",
  row.organizationPayrollId,
  row.employeePayrollId,
  row.payGroupId,
  row.periodStart,
  row.periodEnd,
  row.workDate,
  row.earningCode,
  formatHours(row.seconds),
  formatMoney(row.baseRateCents),
  formatAppliedRate(row.appliedRateNumerator, row.appliedRateDenominator),
  formatMoney(row.grossCents),
  row.correctionIndicator,
  String(row.snapshotVersion),
  row.snapshotHash,
];

export function renderProviderNeutralCsvV1(rows: readonly CanonicalPayrollRow[]): string {
  scanForBannedPhiTokens(PROVIDER_NEUTRAL_V1_HEADER);
  const lines = [PROVIDER_NEUTRAL_V1_HEADER.join(",")];
  for (const row of rows) {
    const cells = toCells(row);
    scanForBannedPhiTokens(cells);
    lines.push(cells.map(escapeCsvCell).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}
