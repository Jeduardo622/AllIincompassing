import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  deriveCaliforniaTimesheet,
  type CalculationInput,
} from "../supabase/functions/_shared/payroll/california";

const fixtureCatalog = JSON.parse(
  readFileSync(
    path.join(
      process.cwd(),
      "tests",
      "fixtures",
      "payroll",
      "california-ordinary-nonexempt.json",
    ),
    "utf8",
  ),
) as {
  fixtures: Array<{
    id: string;
    expected: {
      regularSeconds: number;
      overtimeSeconds: number;
      doubleTimeSeconds: number;
      mealPremiumCents: number;
      grossEarningsCents: number;
      exceptionCodes: string[];
    };
  }>;
};

const fixtureById = new Map(
  fixtureCatalog.fixtures.map((fixture) => [fixture.id, fixture.expected]),
);

const event = (
  id: string,
  eventType: CalculationInput["events"][number]["eventType"],
  occurredAt: string,
  overrides: Partial<CalculationInput["events"][number]> = {},
): CalculationInput["events"][number] => ({
  id,
  source: "employee_time",
  eventType,
  occurredAt,
  createdAt: new Date(new Date(occurredAt).getTime() + 1000).toISOString(),
  timezone: "America/Los_Angeles",
  workLocation: "office",
  workCategory: "direct_service",
  ...overrides,
});

const inputWith = (
  events: CalculationInput["events"],
  overrides: Partial<CalculationInput> = {},
): CalculationInput => ({
  ...baseInput(),
  events,
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
    mealResolutions: {
      createdAt: overrides.mealResolutions?.at(-1)?.resolvedAt ?? null,
      id: overrides.mealResolutions?.at(-1)?.id ?? null,
      rowCount: overrides.mealResolutions?.length ?? 0,
    },
  },
  ...overrides,
});

const mealResolution = (
  id: string,
  shiftStartEventId: string,
  mealOrdinal: 1 | 2,
  deadlineAt: string,
  code: CalculationInput["mealResolutions"][number]["code"],
  overrides: Partial<CalculationInput["mealResolutions"][number]> = {},
): CalculationInput["mealResolutions"][number] => ({
  id,
  shiftStartEventId,
  mealOrdinal,
  deadlineAt,
  code,
  resolvedAt: "2026-08-12T00:10:00.000Z",
  ...overrides,
});

const expectFixture = (fixtureId: string, result: ReturnType<typeof deriveCaliforniaTimesheet>) => {
  const expected = fixtureById.get(fixtureId);
  expect(expected, `missing fixture ${fixtureId}`).toBeDefined();
  expect(result.totals).toEqual({
    regularSeconds: expected?.regularSeconds,
    overtimeSeconds: expected?.overtimeSeconds,
    doubleTimeSeconds: expected?.doubleTimeSeconds,
    mealPremiumCents: expected?.mealPremiumCents,
    grossEarningsCents: expected?.grossEarningsCents,
  });
  expect(result.exceptions.map((exception) => exception.code)).toEqual(expected?.exceptionCodes ?? []);
};

const baseInput = (): CalculationInput => ({
  employeeId: "employment-1",
  timezone: "America/Los_Angeles",
  workdayStartLocal: "00:00:00",
  workweekStartsOn: 0,
  policyVersionId: "policy-v1",
  payPeriodId: "pay-period-1",
  events: [
    {
      id: "event-1",
      source: "employee_time",
      eventType: "shift_started",
      occurredAt: "2026-08-11T16:00:00.000Z",
      createdAt: "2026-08-11T16:00:01.000Z",
      timezone: "America/Los_Angeles",
      workLocation: "office",
      workCategory: "direct_service",
    },
    {
      id: "event-1-meal-start",
      source: "employee_time",
      eventType: "meal_started",
      occurredAt: "2026-08-11T20:00:00.000Z",
      createdAt: "2026-08-11T20:00:01.000Z",
      timezone: "America/Los_Angeles",
      workLocation: "office",
      workCategory: "direct_service",
    },
    {
      id: "event-1-meal-end",
      source: "employee_time",
      eventType: "meal_ended",
      occurredAt: "2026-08-11T20:30:00.000Z",
      createdAt: "2026-08-11T20:30:01.000Z",
      timezone: "America/Los_Angeles",
      workLocation: "office",
      workCategory: "direct_service",
    },
    {
      id: "event-2",
      source: "employee_time",
      eventType: "shift_ended",
      occurredAt: "2026-08-12T00:30:00.000Z",
      createdAt: "2026-08-12T00:30:01.000Z",
      timezone: "America/Los_Angeles",
      workLocation: "office",
      workCategory: "direct_service",
    },
  ],
  rateVersions: [
    {
      id: "rate-v1",
      effectiveFrom: "2026-08-01T00:00:00.000Z",
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
    employeeTimeEvents: { createdAt: "2026-08-12T00:30:01.000Z", id: "event-2", rowCount: 4 },
    sessionAttendanceEvents: { createdAt: null, id: null, rowCount: 0 },
    timeCorrectionRequests: { createdAt: null, id: null, rowCount: 0 },
    sessionAttendanceCorrectionRequests: { createdAt: null, id: null, rowCount: 0 },
    timekeepingExceptions: { createdAt: null, id: null, rowCount: 0 },
    mealResolutions: { createdAt: null, id: null, rowCount: 0 },
  },
});

describe("deriveCaliforniaTimesheet", () => {
  it("keeps the approved synthetic fixture catalog complete", () => {
    expect(fixtureCatalog.fixtures.map((fixture) => fixture.id)).toEqual([
      "regular-day",
      "daily-overtime",
      "daily-double-time",
      "weekly-overtime",
      "seventh-consecutive-day",
      "cross-midnight",
      "dst-spring",
      "dst-fall",
      "rate-boundary",
      "missing-meal",
      "late-meal",
      "short-meal",
      "interrupted-meal",
      "meal-waiver",
      "meal-premium-owed",
      "session-outside-shift",
      "correction-invalidation",
      "open-punch-failure",
    ]);
  });

  it("derives a regular day using integer seconds and cents", () => {
    const result = deriveCaliforniaTimesheet(baseInput());

    expect(result.totals).toEqual({
      regularSeconds: 8 * 3600,
      overtimeSeconds: 0,
      doubleTimeSeconds: 0,
      mealPremiumCents: 0,
      grossEarningsCents: 16000,
    });
    expect(result.classifiedSeconds).toBe(result.workedSeconds);
    expect(result.exceptions).toEqual([]);
  });

  it("classifies daily overtime without double counting weekly overtime", () => {
    const result = deriveCaliforniaTimesheet({
      ...baseInput(),
      events: [
        {
          id: "event-1",
          source: "employee_time",
          eventType: "shift_started",
          occurredAt: "2026-08-11T16:00:00.000Z",
          createdAt: "2026-08-11T16:00:01.000Z",
          timezone: "America/Los_Angeles",
          workLocation: "office",
          workCategory: "direct_service",
        },
        {
          id: "event-1-meal-start",
          source: "employee_time",
          eventType: "meal_started",
          occurredAt: "2026-08-11T20:00:00.000Z",
          createdAt: "2026-08-11T20:00:01.000Z",
          timezone: "America/Los_Angeles",
          workLocation: "office",
          workCategory: "direct_service",
        },
        {
          id: "event-1-meal-end",
          source: "employee_time",
          eventType: "meal_ended",
          occurredAt: "2026-08-11T20:30:00.000Z",
          createdAt: "2026-08-11T20:30:01.000Z",
          timezone: "America/Los_Angeles",
          workLocation: "office",
          workCategory: "direct_service",
        },
        {
          id: "event-2",
          source: "employee_time",
          eventType: "shift_ended",
          occurredAt: "2026-08-12T02:30:00.000Z",
          createdAt: "2026-08-12T02:30:01.000Z",
          timezone: "America/Los_Angeles",
          workLocation: "office",
          workCategory: "direct_service",
        },
      ],
      sourceHighWater: {
        employeeTimeEvents: { createdAt: "2026-08-12T02:30:01.000Z", id: "event-2", rowCount: 4 },
        sessionAttendanceEvents: { createdAt: null, id: null, rowCount: 0 },
        timeCorrectionRequests: { createdAt: null, id: null, rowCount: 0 },
        sessionAttendanceCorrectionRequests: { createdAt: null, id: null, rowCount: 0 },
        timekeepingExceptions: { createdAt: null, id: null, rowCount: 0 },
        mealResolutions: { createdAt: "2026-08-12T02:10:00.000Z", id: "premium-daily-second", rowCount: 1 },
      },
      mealResolutions: [
        mealResolution(
          "premium-daily-second",
          "event-1",
          2,
          "2026-08-12T02:00:00.000Z",
          "premium_not_owed",
        ),
      ],
    });

    expect(result.totals).toEqual({
      regularSeconds: 8 * 3600,
      overtimeSeconds: 2 * 3600,
      doubleTimeSeconds: 0,
      mealPremiumCents: 0,
      grossEarningsCents: 22000,
    });
    expect(result.classifiedSeconds).toBe(result.workedSeconds);
    expect(result.exceptions).toEqual([]);
  });

  it("removes explicit meal intervals from paid time instead of counting them as worked seconds", () => {
    const result = deriveCaliforniaTimesheet({
      ...baseInput(),
      events: [
        {
          id: "event-1",
          source: "employee_time",
          eventType: "shift_started",
          occurredAt: "2026-08-11T16:00:00.000Z",
          createdAt: "2026-08-11T16:00:01.000Z",
          timezone: "America/Los_Angeles",
          workLocation: "office",
          workCategory: "direct_service",
        },
        {
          id: "event-1-meal-start",
          source: "employee_time",
          eventType: "meal_started",
          occurredAt: "2026-08-11T20:00:00.000Z",
          createdAt: "2026-08-11T20:00:01.000Z",
          timezone: "America/Los_Angeles",
          workLocation: "office",
          workCategory: "direct_service",
        },
        {
          id: "event-1-meal-end",
          source: "employee_time",
          eventType: "meal_ended",
          occurredAt: "2026-08-11T20:30:00.000Z",
          createdAt: "2026-08-11T20:30:01.000Z",
          timezone: "America/Los_Angeles",
          workLocation: "office",
          workCategory: "direct_service",
        },
        {
          id: "event-2",
          source: "employee_time",
          eventType: "shift_ended",
          occurredAt: "2026-08-12T00:00:00.000Z",
          createdAt: "2026-08-12T00:00:01.000Z",
          timezone: "America/Los_Angeles",
          workLocation: "office",
          workCategory: "direct_service",
        },
      ],
      sourceHighWater: {
        employeeTimeEvents: { createdAt: "2026-08-12T00:00:01.000Z", id: "event-2", rowCount: 4 },
        sessionAttendanceEvents: { createdAt: null, id: null, rowCount: 0 },
        timeCorrectionRequests: { createdAt: null, id: null, rowCount: 0 },
        sessionAttendanceCorrectionRequests: { createdAt: null, id: null, rowCount: 0 },
        timekeepingExceptions: { createdAt: null, id: null, rowCount: 0 },
      },
    });

    expect(result.workedSeconds).toBe(7.5 * 3600);
    expect(result.classifiedSeconds).toBe(result.workedSeconds);
    expect(result.totals).toEqual({
      regularSeconds: 7.5 * 3600,
      overtimeSeconds: 0,
      doubleTimeSeconds: 0,
      mealPremiumCents: 0,
      grossEarningsCents: 15000,
    });
  });

  it("fails closed for unsupported policy inputs", () => {
    const result = deriveCaliforniaTimesheet({
      ...baseInput(),
      policy: {
        jurisdiction: "CA",
        classification: "nonexempt",
        supportsAlternativeWorkweek: true,
        supportsCollectiveBargainingOverrides: false,
        supportsIndustryExceptions: false,
        supportsMultiRateRegularRate: false,
      },
    });

    expect(result.lockable).toBe(false);
    expect(result.totals).toEqual({
      regularSeconds: 0,
      overtimeSeconds: 0,
      doubleTimeSeconds: 0,
      mealPremiumCents: 0,
      grossEarningsCents: 0,
    });
    expect(result.exceptions).toEqual([
      expect.objectContaining({
        code: "unsupported_policy",
        blocking: true,
      }),
    ]);
  });

  it("fails closed when a required meal is missing and unresolved", () => {
    const result = deriveCaliforniaTimesheet({
      ...baseInput(),
      events: [
        {
          id: "event-1",
          source: "employee_time",
          eventType: "shift_started",
          occurredAt: "2026-08-11T16:00:00.000Z",
          createdAt: "2026-08-11T16:00:01.000Z",
          timezone: "America/Los_Angeles",
          workLocation: "office",
          workCategory: "direct_service",
        },
        {
          id: "event-2",
          source: "employee_time",
          eventType: "shift_ended",
          occurredAt: "2026-08-11T22:00:00.000Z",
          createdAt: "2026-08-11T22:00:01.000Z",
          timezone: "America/Los_Angeles",
          workLocation: "office",
          workCategory: "direct_service",
        },
      ],
      sourceHighWater: {
        employeeTimeEvents: { createdAt: "2026-08-11T22:00:01.000Z", id: "event-2", rowCount: 2 },
        sessionAttendanceEvents: { createdAt: null, id: null, rowCount: 0 },
        timeCorrectionRequests: { createdAt: null, id: null, rowCount: 0 },
        sessionAttendanceCorrectionRequests: { createdAt: null, id: null, rowCount: 0 },
        timekeepingExceptions: { createdAt: null, id: null, rowCount: 0 },
      },
    });

    expect(result.lockable).toBe(false);
    expect(result.exceptions).toEqual([
      expect.objectContaining({
        code: "meal_missing",
        blocking: true,
      }),
    ]);
  });

  it("keeps meal resolutions scoped to the qualifying shift that they reference", () => {
    const result = deriveCaliforniaTimesheet(inputWith([
      event("shift-a-start", "shift_started", "2026-08-11T15:00:00.000Z"),
      event("shift-a-end", "shift_ended", "2026-08-11T21:30:00.000Z"),
      event("shift-b-start", "shift_started", "2026-08-11T22:30:00.000Z"),
      event("shift-b-end", "shift_ended", "2026-08-12T05:00:00.000Z"),
    ], {
      mealResolutions: [
        mealResolution(
          "resolution-a",
          "shift-a-start",
          1,
          "2026-08-11T20:00:00.000Z",
          "premium_not_owed",
        ),
      ],
    }));

    expect(result.lockable).toBe(false);
    expect(result.exceptions).toContainEqual(
      expect.objectContaining({
        code: "meal_missing",
        blocking: true,
        details: expect.objectContaining({
          shiftStartEventId: "shift-b-start",
          mealOrdinal: 1,
        }),
      }),
    );
    expect(result.exceptions).not.toContainEqual(
      expect.objectContaining({
        code: "meal_missing",
        details: expect.objectContaining({
          shiftStartEventId: "shift-a-start",
          mealOrdinal: 1,
        }),
      }),
    );
  });

  it("blocks invalid first-meal waivers for longer or orphaned work periods", () => {
    const longerThanSixHours = deriveCaliforniaTimesheet(inputWith([
      event("long-shift-start", "shift_started", "2026-08-11T16:00:00.000Z"),
      event("long-shift-end", "shift_ended", "2026-08-11T23:00:00.000Z"),
    ], {
      mealResolutions: [
        mealResolution(
          "waiver-too-long",
          "long-shift-start",
          1,
          "2026-08-11T21:00:00.000Z",
          "waived_first_meal",
        ),
      ],
    }));

    expect(longerThanSixHours.lockable).toBe(false);
    expect(longerThanSixHours.exceptions).toContainEqual(
      expect.objectContaining({
        code: "meal_missing",
        blocking: true,
        details: expect.objectContaining({
          shiftStartEventId: "long-shift-start",
          mealOrdinal: 1,
        }),
      }),
    );

    const orphanedWaiver = deriveCaliforniaTimesheet(inputWith([
      event("valid-shift-start", "shift_started", "2026-08-11T16:00:00.000Z"),
      event("valid-shift-end", "shift_ended", "2026-08-11T21:00:00.000Z"),
    ], {
      mealResolutions: [
        mealResolution(
          "waiver-orphaned",
          "missing-shift-start",
          1,
          "2026-08-11T21:00:00.000Z",
          "waived_first_meal",
        ),
      ],
    }));

    expect(orphanedWaiver.lockable).toBe(false);
    expect(orphanedWaiver.exceptions).toContainEqual(
      expect.objectContaining({
        code: "invalid_meal_resolution",
        blocking: true,
      }),
    );
  });

  it("requires a second meal after ten hours and permits a second-waiver only through twelve hours after a taken first meal", () => {
    const validSecondWaiver = deriveCaliforniaTimesheet(inputWith([
      event("shift-start", "shift_started", "2026-08-11T14:00:00.000Z"),
      event("meal-1-start", "meal_started", "2026-08-11T18:00:00.000Z"),
      event("meal-1-end", "meal_ended", "2026-08-11T18:30:00.000Z"),
      event("shift-end", "shift_ended", "2026-08-12T00:30:00.000Z"),
    ], {
      mealResolutions: [
        mealResolution(
          "waiver-second-valid",
          "shift-start",
          2,
          "2026-08-12T00:00:00.000Z",
          "waived_second_meal",
        ),
      ],
    }));

    expect(validSecondWaiver.exceptions).toEqual([]);
    expect(validSecondWaiver.lockable).toBe(true);

    const invalidSecondWaiver = deriveCaliforniaTimesheet(inputWith([
      event("invalid-shift-start", "shift_started", "2026-08-11T14:00:00.000Z"),
      event("invalid-shift-end", "shift_ended", "2026-08-12T02:30:00.000Z"),
    ], {
      mealResolutions: [
        mealResolution(
          "waiver-first",
          "invalid-shift-start",
          1,
          "2026-08-11T19:00:00.000Z",
          "waived_first_meal",
        ),
        mealResolution(
          "waiver-second-invalid",
          "invalid-shift-start",
          2,
          "2026-08-12T00:00:00.000Z",
          "waived_second_meal",
        ),
      ],
    }));

    expect(invalidSecondWaiver.lockable).toBe(false);
    expect(invalidSecondWaiver.exceptions).toContainEqual(
      expect.objectContaining({
        code: "meal_missing",
        blocking: true,
        details: expect.objectContaining({
          shiftStartEventId: "invalid-shift-start",
          mealOrdinal: 2,
        }),
      }),
    );
  });

  it("keeps first- and second-meal issues blocking until the matching shift-scoped premium resolution exists", () => {
    const unresolved = deriveCaliforniaTimesheet(inputWith([
      event("shift-start", "shift_started", "2026-08-11T14:00:00.000Z"),
      event("meal-1-start", "meal_started", "2026-08-11T19:30:00.000Z"),
      event("meal-1-end", "meal_ended", "2026-08-11T19:50:00.000Z"),
      event("shift-end", "shift_ended", "2026-08-12T01:30:00.000Z"),
    ]));

    expect(unresolved.lockable).toBe(false);
    expect(unresolved.exceptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "meal_late",
          blocking: true,
          details: expect.objectContaining({
            shiftStartEventId: "shift-start",
            mealOrdinal: 1,
          }),
        }),
        expect.objectContaining({
          code: "meal_short",
          blocking: true,
          details: expect.objectContaining({
            shiftStartEventId: "shift-start",
            mealOrdinal: 1,
          }),
        }),
        expect.objectContaining({
          code: "meal_missing",
          blocking: true,
          details: expect.objectContaining({
            shiftStartEventId: "shift-start",
            mealOrdinal: 2,
          }),
        }),
      ]),
    );

    const resolved = deriveCaliforniaTimesheet(inputWith([
      event("shift-start", "shift_started", "2026-08-11T14:00:00.000Z"),
      event("meal-1-start", "meal_started", "2026-08-11T19:30:00.000Z"),
      event("meal-1-end", "meal_ended", "2026-08-11T19:50:00.000Z"),
      event("shift-end", "shift_ended", "2026-08-12T01:30:00.000Z"),
    ], {
      mealResolutions: [
        mealResolution(
          "premium-first",
          "shift-start",
          1,
          "2026-08-11T19:00:00.000Z",
          "premium_owed",
          {
            mealStartEventId: "meal-1-start",
            mealEndEventId: "meal-1-end",
          },
        ),
        mealResolution(
          "premium-second",
          "shift-start",
          2,
          "2026-08-12T00:00:00.000Z",
          "premium_not_owed",
        ),
      ],
    }));

    expect(resolved.lockable).toBe(true);
    expect(resolved.exceptions).toEqual([]);
  });

  it("prices shift-scoped premiums only from the recomputed deadline and rejects mismatched deadlines", () => {
    const mismatchedDeadline = deriveCaliforniaTimesheet(inputWith([
      event("shift-start", "shift_started", "2026-08-11T16:00:00.000Z"),
      event("shift-end", "shift_ended", "2026-08-12T00:00:00.000Z"),
    ], {
      rateVersions: [
        {
          id: "rate-v1",
          effectiveFrom: "2026-08-01T00:00:00.000Z",
          effectiveThrough: "2026-08-11T20:30:00.000Z",
          hourlyRateCents: 2000,
        },
        {
          id: "rate-v2",
          effectiveFrom: "2026-08-11T20:30:00.000Z",
          effectiveThrough: null,
          hourlyRateCents: 2400,
        },
      ],
      mealResolutions: [
        mealResolution(
          "premium-mismatch",
          "shift-start",
          1,
          "2026-08-11T20:30:00.000Z",
          "premium_owed",
        ),
      ],
    }));

    expect(mismatchedDeadline.lockable).toBe(false);
    expect(mismatchedDeadline.totals.mealPremiumCents).toBe(0);

    const matchingDeadline = deriveCaliforniaTimesheet(inputWith([
      event("shift-start", "shift_started", "2026-08-11T16:00:00.000Z"),
      event("shift-end", "shift_ended", "2026-08-12T00:00:00.000Z"),
    ], {
      rateVersions: [
        {
          id: "rate-v1",
          effectiveFrom: "2026-08-01T00:00:00.000Z",
          effectiveThrough: "2026-08-11T21:00:00.000Z",
          hourlyRateCents: 2000,
        },
        {
          id: "rate-v2",
          effectiveFrom: "2026-08-11T21:00:00.000Z",
          effectiveThrough: null,
          hourlyRateCents: 2400,
        },
      ],
      mealResolutions: [
        mealResolution(
          "premium-match",
          "shift-start",
          1,
          "2026-08-11T21:00:00.000Z",
          "premium_owed",
        ),
      ],
    }));

    expect(matchingDeadline.lockable).toBe(true);
    expect(matchingDeadline.totals.mealPremiumCents).toBe(2400);
  });

  it("rejects every duplicate meal-resolution key without suppressing issues or paying premiums", () => {
    const cases = [
      {
        name: "duplicate premium_owed resolutions",
        shiftEndAt: "2026-08-11T23:00:00.000Z",
        resolutions: [
          mealResolution(
            "premium-duplicate-a",
            "shift-start",
            1,
            "2026-08-11T21:00:00.000Z",
            "premium_owed",
          ),
          mealResolution(
            "premium-duplicate-b",
            "shift-start",
            1,
            "2026-08-11T21:00:00.000Z",
            "premium_owed",
          ),
        ],
      },
      {
        name: "waiver and premium conflict",
        shiftEndAt: "2026-08-11T22:00:00.000Z",
        resolutions: [
          mealResolution(
            "waiver-conflict",
            "shift-start",
            1,
            "2026-08-11T21:00:00.000Z",
            "waived_first_meal",
          ),
          mealResolution(
            "premium-conflict",
            "shift-start",
            1,
            "2026-08-11T21:00:00.000Z",
            "premium_owed",
          ),
        ],
      },
    ];

    for (const testCase of cases) {
      for (const resolutions of [testCase.resolutions, [...testCase.resolutions].reverse()]) {
        const result = deriveCaliforniaTimesheet(inputWith([
          event("shift-start", "shift_started", "2026-08-11T16:00:00.000Z"),
          event("shift-end", "shift_ended", testCase.shiftEndAt),
        ], {
          mealResolutions: resolutions,
        }));

        expect(result.lockable, testCase.name).toBe(false);
        expect(result.totals.mealPremiumCents, testCase.name).toBe(0);
        expect(
          result.exceptions.filter((exception) => exception.code === "invalid_meal_resolution"),
          testCase.name,
        ).toHaveLength(2);
        expect(result.exceptions, testCase.name).toContainEqual(
          expect.objectContaining({
            code: "meal_missing",
            blocking: true,
            details: expect.objectContaining({
              shiftStartEventId: "shift-start",
              mealOrdinal: 1,
            }),
          }),
        );
      }
    }
  });

  it("blocks invalid meal resolutions instead of silently altering earnings", () => {
    const unknownShift = deriveCaliforniaTimesheet(inputWith([
      event("shift-start", "shift_started", "2026-08-11T16:00:00.000Z"),
      event("shift-end", "shift_ended", "2026-08-11T22:00:00.000Z"),
    ], {
      mealResolutions: [
        mealResolution(
          "unknown-shift",
          "not-a-shift",
          1,
          "2026-08-11T21:00:00.000Z",
          "premium_not_owed",
        ),
      ],
    }));
    expect(unknownShift.lockable).toBe(false);

    const wrongCombination = deriveCaliforniaTimesheet(inputWith([
      event("combo-shift-start", "shift_started", "2026-08-11T14:00:00.000Z"),
      event("meal-1-start", "meal_started", "2026-08-11T18:00:00.000Z"),
      event("meal-1-end", "meal_ended", "2026-08-11T18:30:00.000Z"),
      event("combo-shift-end", "shift_ended", "2026-08-12T00:30:00.000Z"),
    ], {
      mealResolutions: [
        mealResolution(
          "wrong-combo",
          "combo-shift-start",
          1,
          "2026-08-11T19:00:00.000Z",
          "waived_second_meal",
        ),
      ],
    }));
    expect(wrongCombination.lockable).toBe(false);

    const mismatchedMealLink = deriveCaliforniaTimesheet(inputWith([
      event("link-shift-start", "shift_started", "2026-08-11T14:00:00.000Z"),
      event("meal-1-start", "meal_started", "2026-08-11T19:30:00.000Z"),
      event("meal-1-end", "meal_ended", "2026-08-11T19:50:00.000Z"),
      event("link-shift-end", "shift_ended", "2026-08-12T01:30:00.000Z"),
    ], {
      mealResolutions: [
        mealResolution(
          "bad-link",
          "link-shift-start",
          1,
          "2026-08-11T19:00:00.000Z",
          "premium_owed",
          {
            mealStartEventId: "wrong-start",
            mealEndEventId: "meal-1-end",
          },
        ),
      ],
    }));
    expect(mismatchedMealLink.lockable).toBe(false);

    const compliantMeal = deriveCaliforniaTimesheet(inputWith([
      event("clean-shift-start", "shift_started", "2026-08-11T16:00:00.000Z"),
      event("clean-meal-start", "meal_started", "2026-08-11T20:00:00.000Z"),
      event("clean-meal-end", "meal_ended", "2026-08-11T20:30:00.000Z"),
      event("clean-shift-end", "shift_ended", "2026-08-12T00:30:00.000Z"),
    ], {
      mealResolutions: [
        mealResolution(
          "no-issue",
          "clean-shift-start",
          1,
          "2026-08-11T21:00:00.000Z",
          "premium_owed",
          {
            mealStartEventId: "clean-meal-start",
            mealEndEventId: "clean-meal-end",
          },
        ),
      ],
    }));

    expect(compliantMeal.lockable).toBe(false);
    expect(compliantMeal.totals.mealPremiumCents).toBe(0);
  });

  it("treats pending corrections as blocking review state", () => {
    const result = deriveCaliforniaTimesheet({
      ...baseInput(),
      sourceHighWater: {
        ...baseInput().sourceHighWater,
        timeCorrectionRequests: {
          createdAt: "2026-08-12T01:00:00.000Z",
          id: "correction-1",
          rowCount: 1,
        },
      },
    });

    expect(result.lockable).toBe(false);
    expect(result.exceptions).toContainEqual(
      expect.objectContaining({
        code: "correction_pending_review",
        blocking: true,
      }),
    );
  });

  it("prices a premium_owed resolution at the meal deadline rate instead of the shift-start rate", () => {
    const result = deriveCaliforniaTimesheet({
      ...baseInput(),
      events: [
        {
          id: "event-1",
          source: "employee_time",
          eventType: "shift_started",
          occurredAt: "2026-08-11T16:00:00.000Z",
          createdAt: "2026-08-11T16:00:01.000Z",
          timezone: "America/Los_Angeles",
          workLocation: "office",
          workCategory: "direct_service",
        },
        {
          id: "event-2",
          source: "employee_time",
          eventType: "shift_ended",
          occurredAt: "2026-08-12T00:00:00.000Z",
          createdAt: "2026-08-12T00:00:01.000Z",
          timezone: "America/Los_Angeles",
          workLocation: "office",
          workCategory: "direct_service",
        },
      ],
      rateVersions: [
        {
          id: "rate-v1",
          effectiveFrom: "2026-08-01T00:00:00.000Z",
          effectiveThrough: "2026-08-11T20:30:00.000Z",
          hourlyRateCents: 2000,
        },
        {
          id: "rate-v2",
          effectiveFrom: "2026-08-11T20:30:00.000Z",
          effectiveThrough: null,
          hourlyRateCents: 2400,
        },
      ],
      mealResolutions: [
        mealResolution(
          "resolution-1",
          "event-1",
          1,
          "2026-08-11T21:00:00.000Z",
          "premium_owed",
        ),
      ],
      sourceHighWater: {
        employeeTimeEvents: { createdAt: "2026-08-12T00:00:01.000Z", id: "event-2", rowCount: 2 },
        sessionAttendanceEvents: { createdAt: null, id: null, rowCount: 0 },
        timeCorrectionRequests: { createdAt: null, id: null, rowCount: 0 },
        sessionAttendanceCorrectionRequests: { createdAt: null, id: null, rowCount: 0 },
        timekeepingExceptions: { createdAt: null, id: null, rowCount: 0 },
        mealResolutions: { createdAt: "2026-08-12T00:10:00.000Z", id: "resolution-1", rowCount: 1 },
      },
    });

    expect(result.totals.mealPremiumCents).toBe(2400);
    expect(result.totals.grossEarningsCents).toBe(19800);
  });

  it("covers daily double-time from the approved fixture matrix", () => {
    const result = deriveCaliforniaTimesheet(inputWith([
      event("shift-start", "shift_started", "2026-08-11T16:00:00.000Z"),
      event("meal-start", "meal_started", "2026-08-11T20:00:00.000Z"),
      event("meal-end", "meal_ended", "2026-08-11T20:30:00.000Z"),
      event("shift-end", "shift_ended", "2026-08-12T05:30:00.000Z"),
    ]));

    expect(result.totals).toEqual({
      regularSeconds: 8 * 3600,
      overtimeSeconds: 4 * 3600,
      doubleTimeSeconds: 1 * 3600,
      mealPremiumCents: 0,
      grossEarningsCents: 32000,
    });
    expect(result.classifiedSeconds).toBe(result.workedSeconds);
  });

  it("covers weekly overtime without double counting daily overtime", () => {
    const events: CalculationInput["events"] = [];
    for (let day = 0; day < 5; day += 1) {
      const startHour = 16 + day * 24;
      events.push(
        event(`shift-start-${day}`, "shift_started", `2026-08-${String(11 + day).padStart(2, "0")}T16:00:00.000Z`),
        event(`shift-end-${day}`, "shift_ended", `2026-08-${String(12 + day).padStart(2, "0")}T01:00:00.000Z`),
      );
    }
    const result = deriveCaliforniaTimesheet(inputWith(events, {
      mealResolutions: events
        .filter((entry) => entry.eventType === "shift_started")
        .map((entry, index) =>
          mealResolution(
            `premium-weekly-${index}`,
            entry.id,
            1,
            new Date(new Date(entry.occurredAt).getTime() + 5 * 3600 * 1000).toISOString(),
            "premium_not_owed",
          )),
    }));
    expect(result.totals).toEqual({
      regularSeconds: 40 * 3600,
      overtimeSeconds: 5 * 3600,
      doubleTimeSeconds: 0,
      mealPremiumCents: 0,
      grossEarningsCents: 95000,
    });
    expect(result.exceptions).toEqual([]);
  });

  it("covers seventh consecutive day overtime and double-time", () => {
    const events: CalculationInput["events"] = [];
    for (let day = 0; day < 6; day += 1) {
      events.push(
        event(`shift-start-${day}`, "shift_started", `2026-08-${String(9 + day).padStart(2, "0")}T16:00:00.000Z`),
        event(`shift-end-${day}`, "shift_ended", `2026-08-${String(10 + day).padStart(2, "0")}T01:00:00.000Z`),
      );
    }
    events.push(
      event("shift-start-6", "shift_started", "2026-08-15T16:00:00.000Z"),
      event("shift-end-6", "shift_ended", "2026-08-16T01:00:00.000Z"),
    );
    const result = deriveCaliforniaTimesheet(inputWith(events, {
      mealResolutions: events
        .filter((entry) => entry.eventType === "shift_started")
        .map((entry, index) =>
          mealResolution(
            `premium-seventh-${index}`,
            entry.id,
            1,
            new Date(new Date(entry.occurredAt).getTime() + 5 * 3600 * 1000).toISOString(),
            "premium_not_owed",
          )),
    }));
    expect(result.totals).toEqual({
      regularSeconds: 40 * 3600,
      overtimeSeconds: 22 * 3600,
      doubleTimeSeconds: 1 * 3600,
      mealPremiumCents: 0,
      grossEarningsCents: 150000,
    });
  });

  it("covers cross-midnight splitting at the local workday boundary", () => {
    const result = deriveCaliforniaTimesheet(inputWith([
      event("shift-start", "shift_started", "2026-08-12T05:00:00.000Z"),
      event("meal-start", "meal_started", "2026-08-12T08:00:00.000Z"),
      event("meal-end", "meal_ended", "2026-08-12T08:30:00.000Z"),
      event("shift-end", "shift_ended", "2026-08-12T12:30:00.000Z"),
    ]));
    expect(result.totals).toEqual({
      regularSeconds: 7 * 3600,
      overtimeSeconds: 0,
      doubleTimeSeconds: 0,
      mealPremiumCents: 0,
      grossEarningsCents: 14000,
    });
    expect(result.exceptions).toEqual([]);
  });

  it("uses authoritative UTC elapsed time across spring-forward DST", () => {
    const result = deriveCaliforniaTimesheet(inputWith([
      event("shift-start", "shift_started", "2026-03-08T08:00:00.000Z"),
      event("meal-start", "meal_started", "2026-03-08T11:00:00.000Z"),
      event("meal-end", "meal_ended", "2026-03-08T11:30:00.000Z"),
      event("shift-end", "shift_ended", "2026-03-08T15:30:00.000Z"),
    ], {
      rateVersions: [
        {
          id: "rate-dst-spring",
          effectiveFrom: "2026-03-01T00:00:00.000Z",
          effectiveThrough: null,
          hourlyRateCents: 2000,
        },
      ],
    }));
    expect(result.totals).toEqual({
      regularSeconds: 7 * 3600,
      overtimeSeconds: 0,
      doubleTimeSeconds: 0,
      mealPremiumCents: 0,
      grossEarningsCents: 14000,
    });
  });

  it("uses authoritative UTC elapsed time across fall-back DST", () => {
    const result = deriveCaliforniaTimesheet(inputWith([
      event("shift-start", "shift_started", "2026-11-01T06:00:00.000Z"),
      event("shift-end", "shift_ended", "2026-11-01T15:00:00.000Z"),
    ], {
      workdayStartLocal: "05:00:00",
      rateVersions: [
        {
          id: "rate-dst-fall",
          effectiveFrom: "2026-11-01T00:00:00.000Z",
          effectiveThrough: null,
          hourlyRateCents: 2000,
        },
      ],
    }));
    expect(result.totals).toEqual({
      regularSeconds: 9 * 3600,
      overtimeSeconds: 0,
      doubleTimeSeconds: 0,
      mealPremiumCents: 0,
      grossEarningsCents: 18000,
    });
  });

  it("covers rate-boundary earnings from the approved fixture matrix", () => {
    const result = deriveCaliforniaTimesheet(inputWith([
      event("shift-start", "shift_started", "2026-08-11T16:00:00.000Z"),
      event("meal-start", "meal_started", "2026-08-11T20:00:00.000Z"),
      event("meal-end", "meal_ended", "2026-08-11T20:30:00.000Z"),
      event("shift-end", "shift_ended", "2026-08-12T00:30:00.000Z"),
    ], {
      rateVersions: [
        {
          id: "rate-v1",
          effectiveFrom: "2026-08-01T00:00:00.000Z",
          effectiveThrough: "2026-08-11T20:00:00.000Z",
          hourlyRateCents: 2000,
        },
        {
          id: "rate-v2",
          effectiveFrom: "2026-08-11T20:00:00.000Z",
          effectiveThrough: null,
          hourlyRateCents: 2300,
        },
      ],
    }));
    expect(result.totals).toEqual({
      regularSeconds: 8 * 3600,
      overtimeSeconds: 0,
      doubleTimeSeconds: 0,
      mealPremiumCents: 0,
      grossEarningsCents: 17200,
    });
    expect(result.exceptions).toEqual([]);
  });

  it("covers session outside shift from the approved fixture matrix", () => {
    const result = deriveCaliforniaTimesheet(inputWith([
      event("shift-start", "shift_started", "2026-08-11T16:00:00.000Z"),
      {
        ...event("session-start", "session_started", "2026-08-11T21:00:00.000Z", {
          source: "session_attendance",
          sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          employeeTimeEventId: null,
        }),
      },
      event("shift-end", "shift_ended", "2026-08-11T20:00:00.000Z"),
    ]));
    expectFixture("session-outside-shift", result);
  });

  it("covers open punch failure from the approved fixture matrix", () => {
    const result = deriveCaliforniaTimesheet(inputWith([
      event("shift-start", "shift_started", "2026-08-11T16:00:00.000Z"),
    ]));
    expectFixture("open-punch-failure", result);
    expect(result.lockable).toBe(false);
  });

  it("supports a valid first-meal waiver under six hours", () => {
    const result = deriveCaliforniaTimesheet(inputWith([
      event("shift-start", "shift_started", "2026-08-11T16:00:00.000Z"),
      event("shift-end", "shift_ended", "2026-08-11T22:00:00.000Z"),
    ], {
      mealResolutions: [
        mealResolution(
          "waiver-1",
          "shift-start",
          1,
          "2026-08-11T21:00:00.000Z",
          "waived_first_meal",
        ),
      ],
    }));
    expectFixture("meal-waiver", result);
  });

  it("covers a missing meal from the approved fixture matrix", () => {
    const result = deriveCaliforniaTimesheet(inputWith([
      event("shift-start", "shift_started", "2026-08-11T16:00:00.000Z"),
      event("shift-end", "shift_ended", "2026-08-11T22:00:00.000Z"),
    ]));
    expectFixture("missing-meal", result);
    expect(result.lockable).toBe(false);
  });

  it("covers late, short, and interrupted meals from the approved fixture matrix", () => {
    const late = deriveCaliforniaTimesheet(inputWith([
      event("shift-start", "shift_started", "2026-08-11T16:00:00.000Z"),
      event("meal-start", "meal_started", "2026-08-11T21:30:00.000Z"),
      event("meal-end", "meal_ended", "2026-08-11T22:00:00.000Z"),
      event("shift-end", "shift_ended", "2026-08-11T23:30:00.000Z"),
    ]));
    expectFixture("late-meal", late);

    const short = deriveCaliforniaTimesheet(inputWith([
      event("shift-start", "shift_started", "2026-08-11T16:00:00.000Z"),
      event("meal-start", "meal_started", "2026-08-11T20:00:00.000Z"),
      event("meal-end", "meal_ended", "2026-08-11T20:20:00.000Z"),
      event("shift-end", "shift_ended", "2026-08-11T23:20:00.000Z"),
    ]));
    expectFixture("short-meal", short);

    const interrupted = deriveCaliforniaTimesheet(inputWith([
      event("shift-start", "shift_started", "2026-08-11T16:00:00.000Z"),
      event("meal-start", "meal_started", "2026-08-11T20:00:00.000Z"),
      event("shift-end", "shift_ended", "2026-08-11T23:00:00.000Z"),
    ]));
    expectFixture("interrupted-meal", interrupted);
  });

  it("adds second-meal premium coverage for a qualifying long day", () => {
    const result = deriveCaliforniaTimesheet(inputWith([
      event("shift-start", "shift_started", "2026-08-11T14:00:00.000Z"),
      event("meal-1-start", "meal_started", "2026-08-11T18:00:00.000Z"),
      event("meal-1-end", "meal_ended", "2026-08-11T18:30:00.000Z"),
      event("shift-end", "shift_ended", "2026-08-12T01:00:00.000Z"),
    ], {
      mealResolutions: [
        mealResolution(
          "premium-2",
          "shift-start",
          2,
          "2026-08-12T00:00:00.000Z",
          "premium_owed",
        ),
      ],
    }));

    expect(result.totals.mealPremiumCents).toBe(2000);
    expect(result.lockable).toBe(true);
  });

  it("classifies multiple shifts in one workday as a single daily overtime bucket", () => {
    const result = deriveCaliforniaTimesheet(inputWith([
      event("shift-1-start", "shift_started", "2026-08-11T16:00:00.000Z"),
      event("shift-1-end", "shift_ended", "2026-08-11T20:00:00.000Z"),
      event("shift-2-start", "shift_started", "2026-08-11T21:00:00.000Z"),
      event("shift-2-end", "shift_ended", "2026-08-12T03:00:00.000Z"),
    ]));

    expect(result.totals).toEqual({
      regularSeconds: 8 * 3600,
      overtimeSeconds: 2 * 3600,
      doubleTimeSeconds: 0,
      mealPremiumCents: 0,
      grossEarningsCents: 22000,
    });
    expect(result.classifiedSeconds).toBe(result.workedSeconds);
  });
});
