import { describe, expect, it } from "vitest";

import { deriveCaliforniaTimesheet, type CalculationInput } from "../supabase/functions/_shared/payroll/california";
import { nextWorkdayStartUtc, weekStartUtc } from "../supabase/functions/_shared/payroll/timezone";

const event = (
  id: string,
  eventType: CalculationInput["events"][number]["eventType"],
  occurredAt: string,
): CalculationInput["events"][number] => ({
  id,
  source: "employee_time",
  eventType,
  occurredAt,
  createdAt: new Date(new Date(occurredAt).getTime() + 1000).toISOString(),
  timezone: "America/Los_Angeles",
  workLocation: "office",
  workCategory: "direct_service",
});

const inputWith = (events: CalculationInput["events"]): CalculationInput => ({
  employeeId: "employment-1",
  timezone: "America/Los_Angeles",
  workdayStartLocal: "05:00:00",
  workweekStartsOn: 1,
  policyVersionId: "policy-v1",
  payPeriodId: "pay-period-1",
  events,
  rateVersions: [
    {
      id: "rate-v1",
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      effectiveThrough: null,
      hourlyRateCents: 2000,
    },
  ],
  mealResolutions: [],
  policy: {
    jurisdiction: "CA",
    classification: "nonexempt",
    supportsAlternativeWorkweek: false,
    supportsCollectiveBargainingOverrides: false,
    supportsIndustryExceptions: false,
    supportsMultiRateRegularRate: false,
  },
  sourceHighWater: {
    employeeTimeEvents: {
      createdAt: events.at(-1)?.createdAt ?? null,
      id: events.at(-1)?.id ?? null,
      rowCount: events.length,
    },
    sessionAttendanceEvents: { createdAt: null, id: null, rowCount: 0 },
    timeCorrectionRequests: { createdAt: null, id: null, rowCount: 0 },
    sessionAttendanceCorrectionRequests: { createdAt: null, id: null, rowCount: 0 },
    timekeepingExceptions: { createdAt: null, id: null, rowCount: 0 },
    mealResolutions: { createdAt: null, id: null, rowCount: 0 },
  },
});

describe("payroll timekeeping derivation regressions", () => {
  it("keeps an unclosed meal blocking even when the shift is shorter than five hours", () => {
    const result = deriveCaliforniaTimesheet(inputWith([
      event("shift-start", "shift_started", "2026-08-11T16:00:00.000Z"),
      event("meal-start", "meal_started", "2026-08-11T19:00:00.000Z"),
      event("shift-end", "shift_ended", "2026-08-11T19:30:00.000Z"),
    ]));

    expect(result.lockable).toBe(false);
    expect(result.exceptions).toContainEqual(
      expect.objectContaining({
        code: "open_meal",
        blocking: true,
      }),
    );
  });

  it("recomputes the next workday boundary in local time across spring-forward DST", () => {
    expect(
      nextWorkdayStartUtc("2026-03-07", "America/Los_Angeles", "05:00:00").toISOString(),
    ).toBe("2026-03-08T12:00:00.000Z");
  });

  it("recomputes the workweek boundary in local time across fall-back DST", () => {
    expect(
      weekStartUtc(
        new Date("2026-11-01T14:00:00.000Z"),
        "America/Los_Angeles",
        "05:00:00",
        1,
      ).toISOString(),
    ).toBe("2026-10-26T12:00:00.000Z");
  });
});
