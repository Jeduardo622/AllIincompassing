import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

const DATE_FORMAT = "yyyy-MM-dd";
const DAY_MS = 24 * 3600 * 1000;

const shiftDateKey = (dayKey: string, days: number): string => {
  const midnightUtc = new Date(`${dayKey}T00:00:00.000Z`);
  return new Date(midnightUtc.getTime() + days * DAY_MS).toISOString().slice(0, 10);
};

export const isValidTimezone = (timeZone: string): boolean => {
  try {
    Intl.DateTimeFormat("en-US", { timeZone }).format(new Date("2026-01-01T00:00:00.000Z"));
    return true;
  } catch {
    return false;
  }
};

export const localDateKey = (instant: Date, timeZone: string): string =>
  formatInTimeZone(instant, timeZone, DATE_FORMAT);

export const workdayKey = (
  instant: Date,
  timeZone: string,
  workdayStartLocal: string,
): string => {
  const dateKey = localDateKey(instant, timeZone);
  const boundary = fromZonedTime(`${dateKey}T${workdayStartLocal}`, timeZone);
  if (instant.getTime() < boundary.getTime()) {
    return shiftDateKey(dateKey, -1);
  }
  return dateKey;
};

export const workdayStartUtc = (
  dayKey: string,
  timeZone: string,
  workdayStartLocal: string,
): Date => fromZonedTime(`${dayKey}T${workdayStartLocal}`, timeZone);

export const nextWorkdayStartUtc = (
  dayKey: string,
  timeZone: string,
  workdayStartLocal: string,
): Date => {
  return workdayStartUtc(shiftDateKey(dayKey, 1), timeZone, workdayStartLocal);
};

export const weekdayNumber = (instant: Date, timeZone: string): number => {
  const weekday = formatInTimeZone(instant, timeZone, "i");
  return Number.parseInt(weekday, 10) % 7;
};

export const weekStartUtc = (
  instant: Date,
  timeZone: string,
  workdayStartLocal: string,
  workweekStartsOn: number,
): Date => {
  const dayKey = workdayKey(instant, timeZone, workdayStartLocal);
  const weekday = weekdayNumber(workdayStartUtc(dayKey, timeZone, workdayStartLocal), timeZone);
  const diff = (weekday - workweekStartsOn + 7) % 7;
  return workdayStartUtc(shiftDateKey(dayKey, -diff), timeZone, workdayStartLocal);
};

export const weekKey = (
  instant: Date,
  timeZone: string,
  workdayStartLocal: string,
  workweekStartsOn: number,
): string => localDateKey(weekStartUtc(instant, timeZone, workdayStartLocal, workweekStartsOn), timeZone);
