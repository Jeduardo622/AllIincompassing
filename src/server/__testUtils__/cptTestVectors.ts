export interface DurationRoundingCase {
  label: string;
  offsetMinutes: number;
  offsetSeconds: number;
  expectedMinutes: number;
}

export const DURATION_ROUNDING_CASES: DurationRoundingCase[] = [
  {
    label: "rounds down below thirty seconds",
    offsetMinutes: 52,
    offsetSeconds: 29,
    expectedMinutes: 52,
  },
  {
    label: "rounds up at thirty seconds",
    offsetMinutes: 52,
    offsetSeconds: 31,
    expectedMinutes: 53,
  },
  {
    label: "rounds down below sixty-eight threshold",
    offsetMinutes: 67,
    offsetSeconds: 29,
    expectedMinutes: 67,
  },
  {
    label: "rounds up at sixty-eight threshold",
    offsetMinutes: 67,
    offsetSeconds: 31,
    expectedMinutes: 68,
  },
  {
    label: "rounds down below ninety-three threshold",
    offsetMinutes: 92,
    offsetSeconds: 29,
    expectedMinutes: 92,
  },
  {
    label: "rounds up at ninety-three threshold",
    offsetMinutes: 92,
    offsetSeconds: 31,
    expectedMinutes: 93,
  },
];

export interface BillingUnitCase {
  minutes: number;
  expectedUnits: number;
}

export const BILLING_UNIT_CASES: BillingUnitCase[] = [
  { minutes: 37, expectedUnits: 2 },
  { minutes: 38, expectedUnits: 3 },
  { minutes: 52, expectedUnits: 3 },
  { minutes: 53, expectedUnits: 4 },
  { minutes: 67, expectedUnits: 4 },
  { minutes: 68, expectedUnits: 5 },
  { minutes: 92, expectedUnits: 6 },
  { minutes: 93, expectedUnits: 6 },
  { minutes: 98, expectedUnits: 7 },
];
