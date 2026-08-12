import type { CalculationEvent, CalculationException } from "./types.ts";
import { isValidTimezone } from "./timezone.ts";

export type PairedInterval = {
  start: Date;
  end: Date;
  startEventId: string;
  endEventId: string;
};

export type ShiftInterval = PairedInterval;

export type MealInterval = PairedInterval & {
  shiftStartEventId: string;
};

export type PairEventsResult = {
  shiftIntervals: ShiftInterval[];
  paidIntervals: PairedInterval[];
  mealIntervals: MealInterval[];
  exceptions: CalculationException[];
};

const subtractInterval = (source: PairedInterval, exclusion: PairedInterval): PairedInterval[] => {
  const sourceStart = source.start.getTime();
  const sourceEnd = source.end.getTime();
  const exclusionStart = exclusion.start.getTime();
  const exclusionEnd = exclusion.end.getTime();

  if (exclusionEnd <= sourceStart || exclusionStart >= sourceEnd) {
    return [source];
  }

  const trimmed: PairedInterval[] = [];
  if (exclusionStart > sourceStart) {
    trimmed.push({
      start: source.start,
      end: new Date(exclusionStart),
      startEventId: source.startEventId,
      endEventId: exclusion.startEventId,
    });
  }
  if (exclusionEnd < sourceEnd) {
    trimmed.push({
      start: new Date(exclusionEnd),
      end: source.end,
      startEventId: exclusion.endEventId,
      endEventId: source.endEventId,
    });
  }
  return trimmed.filter((interval) => interval.end.getTime() > interval.start.getTime());
};

const subtractMealIntervals = (
  shiftIntervals: readonly PairedInterval[],
  mealIntervals: readonly PairedInterval[],
): PairedInterval[] => {
  let paid = [...shiftIntervals];
  for (const mealInterval of mealIntervals) {
    paid = paid.flatMap((interval) => subtractInterval(interval, mealInterval));
  }
  return paid;
};

const compareEvents = (left: CalculationEvent, right: CalculationEvent): number =>
  left.occurredAt.localeCompare(right.occurredAt) ||
  left.createdAt.localeCompare(right.createdAt) ||
  left.id.localeCompare(right.id);

export const sortCalculationEvents = (events: readonly CalculationEvent[]): CalculationEvent[] =>
  [...events].sort(compareEvents);

export function pairEvents(events: readonly CalculationEvent[]): PairEventsResult {
  const sorted = sortCalculationEvents(events);
  const shiftIntervals: ShiftInterval[] = [];
  const mealIntervals: MealInterval[] = [];
  const exceptions: CalculationException[] = [];

  let activeShift: CalculationEvent | null = null;
  let activeMeal: CalculationEvent | null = null;

  for (const event of sorted) {
    if (!isValidTimezone(event.timezone)) {
      exceptions.push({
        code: "invalid_timezone",
        blocking: true,
        message: `Invalid timezone on event ${event.id}.`,
        relatedIds: [event.id],
      });
      continue;
    }

    if (event.source === "session_attendance") {
      continue;
    }

    if (event.eventType === "shift_started") {
      if (activeShift) {
        exceptions.push({
          code: "duplicate_shift_start",
          blocking: true,
          message: "Shift start occurred while another shift was open.",
          relatedIds: [activeShift.id, event.id],
        });
      } else {
        activeShift = event;
      }
      continue;
    }

    if (event.eventType === "shift_ended") {
      if (!activeShift) {
        exceptions.push({
          code: "open_shift",
          blocking: true,
          message: "Shift end was recorded without an open shift.",
          relatedIds: [event.id],
        });
      } else {
        shiftIntervals.push({
          start: new Date(activeShift.occurredAt),
          end: new Date(event.occurredAt),
          startEventId: activeShift.id,
          endEventId: event.id,
        });
        if (activeMeal) {
          exceptions.push({
            code: "open_meal",
            blocking: true,
            message: "Open meal remained unmatched when the shift ended.",
            relatedIds: [activeMeal.id, event.id],
          });
        }
        activeShift = null;
      }
      activeMeal = null;
      continue;
    }

    if (event.eventType === "meal_started") {
      if (!activeShift) {
        exceptions.push({
          code: "meal_interrupted",
          blocking: true,
          message: "Meal start occurred outside an open shift.",
          relatedIds: [event.id],
        });
        continue;
      }
      if (activeMeal) {
        exceptions.push({
          code: "duplicate_meal_start",
          blocking: true,
          message: "Meal start occurred while another meal was open.",
          relatedIds: [activeMeal.id, event.id],
        });
      } else {
        activeMeal = event;
      }
      continue;
    }

    if (event.eventType === "meal_ended") {
      if (!activeMeal) {
        exceptions.push({
          code: "meal_interrupted",
          blocking: true,
          message: "Meal end occurred without a matching meal start.",
          relatedIds: [event.id],
        });
      } else {
        mealIntervals.push({
          start: new Date(activeMeal.occurredAt),
          end: new Date(event.occurredAt),
          startEventId: activeMeal.id,
          endEventId: event.id,
          shiftStartEventId: activeShift?.id ?? activeMeal.id,
        });
        activeMeal = null;
      }
    }
  }

  if (activeShift) {
    exceptions.push({
      code: "open_shift",
      blocking: true,
      message: "Open shift remains unmatched at the end of the source period.",
      relatedIds: [activeShift.id],
    });
  }

  if (activeMeal) {
    exceptions.push({
      code: "open_meal",
      blocking: true,
      message: "Open meal remains unmatched at the end of the source period.",
      relatedIds: [activeMeal.id],
    });
  }

  return {
    shiftIntervals,
    paidIntervals: subtractMealIntervals(shiftIntervals, mealIntervals),
    mealIntervals,
    exceptions,
  };
}
