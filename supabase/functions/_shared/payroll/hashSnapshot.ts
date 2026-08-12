import type { CalculationEvent, RateVersion, SourceHighWater } from "./types.ts";
import { sortCalculationEvents } from "./pairEvents.ts";

type CanonicalPayload = {
  employeeId: string;
  payPeriodId: string;
  policyVersionId: string;
  timezone: string;
  workdayStartLocal: string;
  workweekStartsOn: number;
  events: CalculationEvent[];
  rateVersions: RateVersion[];
  sourceHighWater: SourceHighWater;
};

const stable = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(stable);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const sortedEntries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => [key, stable(nested)]);
  return Object.fromEntries(sortedEntries);
};

const encoder = new TextEncoder();

const digestHex = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

export const buildCanonicalPayload = (input: CanonicalPayload): Record<string, unknown> => stable({
  ...input,
  events: sortCalculationEvents(input.events).map((event) => stable(event)),
  rateVersions: [...input.rateVersions]
    .sort((left, right) => left.effectiveFrom.localeCompare(right.effectiveFrom) || left.id.localeCompare(right.id))
    .map((version) => stable(version)),
});

export const canonicalStringify = (input: CanonicalPayload): string =>
  JSON.stringify(buildCanonicalPayload(input));

export const hashSnapshotSources = async (input: CanonicalPayload): Promise<string> =>
  digestHex(canonicalStringify(input));
