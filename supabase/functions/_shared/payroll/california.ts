import { pairEvents, sortCalculationEvents, type MealInterval, type ShiftInterval } from "./pairEvents.ts";
import { localDateKey, nextWorkdayStartUtc, weekKey, workdayKey } from "./timezone.ts";
import type {
  CalculationEvent,
  CalculationException,
  CalculationInput,
  ClassifiedSegment,
  MealResolution,
  RateVersion,
  TimesheetCalculation,
  TimesheetTotals,
} from "./types.ts";

export type { CalculationInput } from "./types.ts";

type Segment = {
  start: Date;
  end: Date;
  seconds: number;
  dayKey: string;
  weekKey: string;
  rateVersionId: string;
  hourlyRateCents: number;
};

type MealIssue = {
  code: CalculationException["code"];
  shiftStartEventId: string;
  mealOrdinal: 1 | 2;
  message: string;
  deadlineAt: Date;
  mealStartEventId?: string;
  mealEndEventId?: string;
};

type ShiftMealContext = {
  shiftInterval: ShiftInterval;
  durationSeconds: number;
  mealIntervals: MealInterval[];
  mealStartEvents: CalculationEvent[];
};

const ZERO_TOTALS: TimesheetTotals = {
  regularSeconds: 0,
  overtimeSeconds: 0,
  doubleTimeSeconds: 0,
  mealPremiumCents: 0,
  grossEarningsCents: 0,
};

const blocking = (code: CalculationException["code"], message: string, details?: Record<string, unknown>): CalculationException => ({
  code,
  blocking: true,
  message,
  ...(details ? { details } : {}),
});

const nonBlocking = (code: CalculationException["code"], message: string, details?: Record<string, unknown>): CalculationException => ({
  code,
  blocking: false,
  message,
  ...(details ? { details } : {}),
});

const mealResolutionKey = (shiftStartEventId: string, mealOrdinal: 1 | 2): string =>
  `${shiftStartEventId}:${mealOrdinal}`;

const unsupportedPolicy = (input: CalculationInput): CalculationException | null => {
  if (input.policy.jurisdiction !== "CA") {
    return blocking("unsupported_policy", "Only California derivation is supported.");
  }
  if (input.policy.classification !== "nonexempt") {
    return blocking("unsupported_policy", "Only nonexempt derivation is supported.");
  }
  if (
    input.policy.supportsAlternativeWorkweek ||
    input.policy.supportsCollectiveBargainingOverrides ||
    input.policy.supportsIndustryExceptions ||
    input.policy.supportsMultiRateRegularRate
  ) {
    return blocking("unsupported_policy", "Unsupported payroll policy flags require fail-closed handling.");
  }
  return null;
};

const rateAt = (instant: Date, rateVersions: readonly RateVersion[]): RateVersion | null => {
  const matches = rateVersions.filter((rate) =>
    instant.toISOString() >= rate.effectiveFrom &&
    (rate.effectiveThrough === null || instant.toISOString() < rate.effectiveThrough)
  );
  if (matches.length !== 1) {
    return null;
  }
  return matches[0];
};

const splitByBoundaries = (
  start: Date,
  end: Date,
  input: CalculationInput,
): Segment[] => {
  const boundaries = new Set<number>([start.getTime(), end.getTime()]);
  let cursor = new Date(start.getTime());
  while (cursor.getTime() < end.getTime()) {
    const dayKey = workdayKey(cursor, input.timezone, input.workdayStartLocal);
    const nextBoundary = nextWorkdayStartUtc(dayKey, input.timezone, input.workdayStartLocal);
    if (nextBoundary.getTime() > start.getTime() && nextBoundary.getTime() < end.getTime()) {
      boundaries.add(nextBoundary.getTime());
    }
    cursor = new Date(nextBoundary.getTime());
  }

  for (const rate of input.rateVersions) {
    const effectiveFrom = new Date(rate.effectiveFrom).getTime();
    if (effectiveFrom > start.getTime() && effectiveFrom < end.getTime()) {
      boundaries.add(effectiveFrom);
    }
    if (rate.effectiveThrough) {
      const effectiveThrough = new Date(rate.effectiveThrough).getTime();
      if (effectiveThrough > start.getTime() && effectiveThrough < end.getTime()) {
        boundaries.add(effectiveThrough);
      }
    }
  }

  const sorted = [...boundaries].sort((left, right) => left - right);
  const segments: Segment[] = [];
  for (let index = 0; index < sorted.length - 1; index += 1) {
    const segmentStart = new Date(sorted[index]);
    const segmentEnd = new Date(sorted[index + 1]);
    const seconds = Math.round((segmentEnd.getTime() - segmentStart.getTime()) / 1000);
    if (seconds <= 0) {
      continue;
    }
    const rate = rateAt(segmentStart, input.rateVersions);
    if (!rate) {
      segments.push({
        start: segmentStart,
        end: segmentEnd,
        seconds,
        dayKey: workdayKey(segmentStart, input.timezone, input.workdayStartLocal),
        weekKey: weekKey(segmentStart, input.timezone, input.workdayStartLocal, input.workweekStartsOn),
        rateVersionId: "__missing__",
        hourlyRateCents: 0,
      });
      continue;
    }
    segments.push({
      start: segmentStart,
      end: segmentEnd,
      seconds,
      dayKey: workdayKey(segmentStart, input.timezone, input.workdayStartLocal),
      weekKey: weekKey(segmentStart, input.timezone, input.workdayStartLocal, input.workweekStartsOn),
      rateVersionId: rate.id,
      hourlyRateCents: rate.hourlyRateCents,
    });
  }
  return segments;
};

const classifySegments = (segments: Segment[]): ClassifiedSegment[] => {
  const classified: ClassifiedSegment[] = [];
  const byWeek = new Map<string, Segment[]>();
  for (const segment of segments) {
    const list = byWeek.get(segment.weekKey) ?? [];
    list.push(segment);
    byWeek.set(segment.weekKey, list);
  }

  for (const weekSegments of byWeek.values()) {
    weekSegments.sort((left, right) => left.start.getTime() - right.start.getTime());
    const byDay = new Map<string, Segment[]>();
    for (const segment of weekSegments) {
      const list = byDay.get(segment.dayKey) ?? [];
      list.push(segment);
      byDay.set(segment.dayKey, list);
    }

    const dayKeys = [...byDay.keys()].sort();
    let weekRegularSeconds = 0;
    let streak = 0;
    let previousDay: string | null = null;

    for (const dayKey of dayKeys) {
      if (!previousDay) {
        streak = 1;
      } else {
        const prev = new Date(`${previousDay}T00:00:00.000Z`);
        const next = new Date(`${dayKey}T00:00:00.000Z`);
        const dayDiff = Math.round((next.getTime() - prev.getTime()) / (24 * 3600 * 1000));
        streak = dayDiff === 1 ? streak + 1 : 1;
      }
      previousDay = dayKey;

      let dayConsumedSeconds = 0;
      for (const segment of byDay.get(dayKey) ?? []) {
        let remaining = segment.seconds;
        let segmentCursor = new Date(segment.start.getTime());

        while (remaining > 0) {
          let bucket: ClassifiedSegment["bucket"];
          if (streak >= 7) {
            bucket = dayConsumedSeconds < 8 * 3600 ? "overtime" : "doubletime";
          } else if (dayConsumedSeconds >= 12 * 3600) {
            bucket = "doubletime";
          } else if (dayConsumedSeconds >= 8 * 3600) {
            bucket = "overtime";
          } else {
            bucket = "regular";
          }

          let sliceSeconds = remaining;
          if (bucket === "regular") {
            sliceSeconds = Math.min(remaining, 8 * 3600 - dayConsumedSeconds);
            if (weekRegularSeconds >= 40 * 3600) {
              bucket = "overtime";
            } else if (weekRegularSeconds + sliceSeconds > 40 * 3600) {
              sliceSeconds = 40 * 3600 - weekRegularSeconds;
            }
          } else if (bucket === "overtime") {
            const cap = streak >= 7 ? 8 * 3600 : 12 * 3600;
            sliceSeconds = Math.min(remaining, cap - dayConsumedSeconds);
          }

          if (sliceSeconds <= 0) {
            sliceSeconds = remaining;
          }

          const sliceStart = new Date(segmentCursor.getTime());
          const sliceEnd = new Date(segmentCursor.getTime() + sliceSeconds * 1000);
          classified.push({
            start: sliceStart.toISOString(),
            end: sliceEnd.toISOString(),
            seconds: sliceSeconds,
            bucket,
            rateVersionId: segment.rateVersionId,
            hourlyRateCents: segment.hourlyRateCents,
            dayKey: segment.dayKey,
            weekKey: segment.weekKey,
          });
          if (bucket === "regular") {
            weekRegularSeconds += sliceSeconds;
          }
          dayConsumedSeconds += sliceSeconds;
          segmentCursor = new Date(sliceEnd.getTime());
          remaining -= sliceSeconds;
        }
      }
    }
  }

  return classified.sort((left, right) => left.start.localeCompare(right.start));
};

const mealDeadline = (shiftStart: Date, mealOrdinal: 1 | 2): Date =>
  new Date(shiftStart.getTime() + (mealOrdinal === 1 ? 5 : 10) * 3600 * 1000);

const shiftMealContexts = (
  input: CalculationInput,
  shiftIntervals: readonly ShiftInterval[],
  mealIntervals: readonly MealInterval[],
): ShiftMealContext[] => {
  const sortedEvents = sortCalculationEvents(input.events.filter((event) => event.source === "employee_time"));
  return [...shiftIntervals]
    .sort((left, right) => left.start.getTime() - right.start.getTime())
    .map((shiftInterval) => {
      const startMs = shiftInterval.start.getTime();
      const endMs = shiftInterval.end.getTime();
      return {
        shiftInterval,
        durationSeconds: Math.round((endMs - startMs) / 1000),
        mealIntervals: mealIntervals
          .filter((interval) => interval.shiftStartEventId === shiftInterval.startEventId)
          .sort((left, right) => left.start.getTime() - right.start.getTime()),
        mealStartEvents: sortedEvents.filter((event) =>
          event.eventType === "meal_started" &&
          new Date(event.occurredAt).getTime() >= startMs &&
          new Date(event.occurredAt).getTime() <= endMs
        ),
      };
    });
};

const mealIssuesForShift = (context: ShiftMealContext): MealIssue[] => {
  const issues: MealIssue[] = [];
  const firstDeadline = mealDeadline(context.shiftInterval.start, 1);
  const secondDeadline = mealDeadline(context.shiftInterval.start, 2);
  const mealStarts = context.mealStartEvents;
  const firstMeal = context.mealIntervals[0];
  const secondMeal = context.mealIntervals[1];

  if (context.durationSeconds > 5 * 3600) {
    if (!firstMeal) {
      issues.push({
        code: mealStarts.length >= 1 ? "meal_interrupted" : "meal_missing",
        shiftStartEventId: context.shiftInterval.startEventId,
        mealOrdinal: 1,
        message: mealStarts.length >= 1
          ? "First meal did not end cleanly."
          : "First meal was required but not recorded.",
        deadlineAt: firstDeadline,
      });
    } else {
      if (firstMeal.start.getTime() > firstDeadline.getTime()) {
        issues.push({
          code: "meal_late",
          shiftStartEventId: context.shiftInterval.startEventId,
          mealOrdinal: 1,
          message: "First meal started after the required deadline.",
          deadlineAt: firstDeadline,
          mealStartEventId: firstMeal.startEventId,
          mealEndEventId: firstMeal.endEventId,
        });
      }
      if (firstMeal.end.getTime() - firstMeal.start.getTime() < 30 * 60 * 1000) {
        issues.push({
          code: "meal_short",
          shiftStartEventId: context.shiftInterval.startEventId,
          mealOrdinal: 1,
          message: "First meal was shorter than thirty minutes.",
          deadlineAt: firstDeadline,
          mealStartEventId: firstMeal.startEventId,
          mealEndEventId: firstMeal.endEventId,
        });
      }
    }
  }

  if (context.durationSeconds > 10 * 3600) {
    if (!secondMeal) {
      issues.push({
        code: mealStarts.length >= 2 ? "meal_interrupted" : "meal_missing",
        shiftStartEventId: context.shiftInterval.startEventId,
        mealOrdinal: 2,
        message: mealStarts.length >= 2
          ? "Second meal did not end cleanly."
          : "Second meal was required but not recorded.",
        deadlineAt: secondDeadline,
      });
    } else {
      if (secondMeal.start.getTime() > secondDeadline.getTime()) {
        issues.push({
          code: "meal_late",
          shiftStartEventId: context.shiftInterval.startEventId,
          mealOrdinal: 2,
          message: "Second meal started after the required deadline.",
          deadlineAt: secondDeadline,
          mealStartEventId: secondMeal.startEventId,
          mealEndEventId: secondMeal.endEventId,
        });
      }
      if (secondMeal.end.getTime() - secondMeal.start.getTime() < 30 * 60 * 1000) {
        issues.push({
          code: "meal_short",
          shiftStartEventId: context.shiftInterval.startEventId,
          mealOrdinal: 2,
          message: "Second meal was shorter than thirty minutes.",
          deadlineAt: secondDeadline,
          mealStartEventId: secondMeal.startEventId,
          mealEndEventId: secondMeal.endEventId,
        });
      }
    }
  }

  return issues;
};

const invalidMealResolution = (
  message: string,
  resolution: MealResolution,
): CalculationException =>
  blocking("invalid_meal_resolution", message, {
    resolutionId: resolution.id,
    shiftStartEventId: resolution.shiftStartEventId,
    mealOrdinal: resolution.mealOrdinal,
    code: resolution.code,
  });

const validateMealResolutions = (
  input: CalculationInput,
  contexts: readonly ShiftMealContext[],
  issues: readonly MealIssue[],
): {
  validResolutions: MealResolution[];
  exceptions: CalculationException[];
} => {
  const contextByShift = new Map(contexts.map((context) => [context.shiftInterval.startEventId, context]));
  const issuesByKey = new Map<string, MealIssue[]>();
  for (const issue of issues) {
    const key = mealResolutionKey(issue.shiftStartEventId, issue.mealOrdinal);
    const current = issuesByKey.get(key) ?? [];
    current.push(issue);
    issuesByKey.set(key, current);
  }

  const validResolutions: MealResolution[] = [];
  const exceptions: CalculationException[] = [];
  const resolutionCountByKey = new Map<string, number>();
  for (const resolution of input.mealResolutions) {
    const key = mealResolutionKey(resolution.shiftStartEventId, resolution.mealOrdinal);
    resolutionCountByKey.set(key, (resolutionCountByKey.get(key) ?? 0) + 1);
  }

  for (const resolution of input.mealResolutions) {
    const key = mealResolutionKey(resolution.shiftStartEventId, resolution.mealOrdinal);
    if ((resolutionCountByKey.get(key) ?? 0) > 1) {
      exceptions.push(invalidMealResolution(
        "Meal resolutions must be unique per shift and meal ordinal.",
        resolution,
      ));
      continue;
    }

    const context = contextByShift.get(resolution.shiftStartEventId);
    if (!context) {
      exceptions.push(invalidMealResolution("Meal resolution references an unknown shift.", resolution));
      continue;
    }

    const expectedDeadline = mealDeadline(context.shiftInterval.start, resolution.mealOrdinal).toISOString();
    if (resolution.deadlineAt !== expectedDeadline) {
      exceptions.push(invalidMealResolution("Meal resolution deadline must match the recomputed shift deadline.", resolution));
      continue;
    }

    if (resolution.code === "waived_first_meal" && resolution.mealOrdinal !== 1) {
      exceptions.push(invalidMealResolution("First-meal waiver must target ordinal 1.", resolution));
      continue;
    }
    if (resolution.code === "waived_second_meal" && resolution.mealOrdinal !== 2) {
      exceptions.push(invalidMealResolution("Second-meal waiver must target ordinal 2.", resolution));
      continue;
    }

    const resolutionIssues = issuesByKey.get(key) ?? [];
    if (resolutionIssues.length === 0) {
      exceptions.push(invalidMealResolution("Meal resolution may only target an actually detected issue.", resolution));
      continue;
    }

    if (resolution.code === "waived_first_meal") {
      const valid =
        context.durationSeconds > 5 * 3600 &&
        context.durationSeconds <= 6 * 3600 &&
        resolutionIssues.every((issue) => issue.code === "meal_missing");
      if (!valid) {
        exceptions.push(invalidMealResolution("First-meal waiver is invalid for the detected work period.", resolution));
        continue;
      }
      validResolutions.push(resolution);
      continue;
    }

    if (resolution.code === "waived_second_meal") {
      const firstMealIssues = issuesByKey.get(mealResolutionKey(resolution.shiftStartEventId, 1)) ?? [];
      const firstMealTaken = context.mealIntervals[0] !== undefined && firstMealIssues.length === 0;
      const valid =
        context.durationSeconds > 10 * 3600 &&
        context.durationSeconds <= 12 * 3600 &&
        firstMealTaken &&
        resolutionIssues.every((issue) => issue.code === "meal_missing");
      if (!valid) {
        exceptions.push(invalidMealResolution("Second-meal waiver is invalid for the detected work period.", resolution));
        continue;
      }
      validResolutions.push(resolution);
      continue;
    }

    const mealInterval = context.mealIntervals[resolution.mealOrdinal - 1];
    const expectedMealStartId = resolutionIssues[0]?.mealStartEventId ?? null;
    const expectedMealEndId = resolutionIssues[0]?.mealEndEventId ?? null;
    const providedMealStartId = resolution.mealStartEventId ?? null;
    const providedMealEndId = resolution.mealEndEventId ?? null;
    const matchesMealLinks =
      providedMealStartId === expectedMealStartId &&
      providedMealEndId === expectedMealEndId &&
      (!mealInterval || (
        (expectedMealStartId === null || expectedMealStartId === mealInterval.startEventId) &&
        (expectedMealEndId === null || expectedMealEndId === mealInterval.endEventId)
      ));
    if (!matchesMealLinks) {
      exceptions.push(invalidMealResolution("Meal resolution linked meal events do not match the detected issue.", resolution));
      continue;
    }

    validResolutions.push(resolution);
  }

  return { validResolutions, exceptions };
};

const unresolvedMealExceptions = (
  issues: readonly MealIssue[],
  validResolutions: readonly MealResolution[],
): CalculationException[] => {
  const resolvedKeys = new Set(validResolutions.map((resolution) =>
    mealResolutionKey(resolution.shiftStartEventId, resolution.mealOrdinal)
  ));
  return issues.flatMap((issue) => {
    if (resolvedKeys.has(mealResolutionKey(issue.shiftStartEventId, issue.mealOrdinal))) {
      return [];
    }
    return [blocking(issue.code, issue.message, {
      shiftStartEventId: issue.shiftStartEventId,
      mealOrdinal: issue.mealOrdinal,
      ...(issue.mealStartEventId ? { mealStartEventId: issue.mealStartEventId } : {}),
      ...(issue.mealEndEventId ? { mealEndEventId: issue.mealEndEventId } : {}),
    })];
  });
};

export function deriveCaliforniaTimesheet(input: CalculationInput): TimesheetCalculation {
  const policyException = unsupportedPolicy(input);
  if (policyException) {
    return {
      lockable: false,
      workedSeconds: 0,
      classifiedSeconds: 0,
      totals: { ...ZERO_TOTALS },
      segments: [],
      exceptions: [policyException],
    };
  }

  if (input.events.length > 500) {
    return {
      lockable: false,
      workedSeconds: 0,
      classifiedSeconds: 0,
      totals: { ...ZERO_TOTALS },
      segments: [],
      exceptions: [blocking("event_limit_exceeded", "Timesheet derivation is capped at 500 combined events.")],
    };
  }

  const pairing = pairEvents(input.events);
  const correctionRows =
    input.sourceHighWater.timeCorrectionRequests.rowCount +
    input.sourceHighWater.sessionAttendanceCorrectionRequests.rowCount;
  const sourceExceptions = input.events.filter((event) => event.source === "timekeeping_exception");

  const segments = pairing.paidIntervals.flatMap((interval) => splitByBoundaries(interval.start, interval.end, input));
  const rateErrors = segments.filter((segment) => segment.rateVersionId === "__missing__");
  const derivedExceptions: CalculationException[] = [...pairing.exceptions];
  if (rateErrors.length > 0) {
    derivedExceptions.push(blocking("missing_rate", "Every worked segment must resolve to exactly one active rate."));
  }

  const mealContexts = shiftMealContexts(input, pairing.shiftIntervals, pairing.mealIntervals);
  const mealIssues = mealContexts.flatMap((context) => mealIssuesForShift(context));
  const { validResolutions, exceptions: mealResolutionExceptions } = validateMealResolutions(input, mealContexts, mealIssues);
  derivedExceptions.push(...mealResolutionExceptions);
  derivedExceptions.push(...unresolvedMealExceptions(mealIssues, validResolutions));

  for (const event of input.events.filter((event) => event.source === "session_attendance")) {
    const eventAt = new Date(event.occurredAt).getTime();
    const withinShift = pairing.paidIntervals.some((interval) =>
      eventAt >= interval.start.getTime() && eventAt <= interval.end.getTime()
    );
    if (!withinShift) {
      derivedExceptions.push(nonBlocking("session_outside_shift", "Session attendance fell outside a payroll shift.", {
        sessionId: event.sessionId ?? null,
      }));
    }
  }

  if (correctionRows > 0 || sourceExceptions.some((event) => event.eventType === "session_started")) {
    derivedExceptions.push(blocking("correction_pending_review", "Correction requests require snapshot review before lock."));
  }

  const classified = classifySegments(segments);
  const workedSeconds = segments.reduce((sum, segment) => sum + segment.seconds, 0);
  const classifiedSeconds = classified.reduce((sum, segment) => sum + segment.seconds, 0);

  let mealPremiumCents = 0;
  for (const resolution of validResolutions) {
    if (resolution.code !== "premium_owed") {
      continue;
    }
    const deadlineRate = rateAt(new Date(resolution.deadlineAt), input.rateVersions);
    if (!deadlineRate) {
      derivedExceptions.push(blocking("missing_rate", "Meal premium deadline must resolve to exactly one active base rate.", {
        shiftStartEventId: resolution.shiftStartEventId,
        mealOrdinal: resolution.mealOrdinal,
      }));
      continue;
    }
    mealPremiumCents += deadlineRate.hourlyRateCents;
  }

  const totals = classified.reduce<TimesheetTotals>((current, segment) => {
    if (segment.bucket === "regular") {
      current.regularSeconds += segment.seconds;
      current.grossEarningsCents += Math.round((segment.hourlyRateCents * segment.seconds) / 3600);
    } else if (segment.bucket === "overtime") {
      current.overtimeSeconds += segment.seconds;
      current.grossEarningsCents += Math.round((segment.hourlyRateCents * 1.5 * segment.seconds) / 3600);
    } else {
      current.doubleTimeSeconds += segment.seconds;
      current.grossEarningsCents += Math.round((segment.hourlyRateCents * 2 * segment.seconds) / 3600);
    }
    return current;
  }, {
    regularSeconds: 0,
    overtimeSeconds: 0,
    doubleTimeSeconds: 0,
    mealPremiumCents,
    grossEarningsCents: mealPremiumCents,
  });

  const lockable = derivedExceptions.every((exception) => !exception.blocking);

  return {
    lockable,
    workedSeconds,
    classifiedSeconds,
    totals,
    segments: classified,
    exceptions: derivedExceptions,
  };
}
