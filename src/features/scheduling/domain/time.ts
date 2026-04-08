import { addMinutes, differenceInMinutes, format, parseISO } from "date-fns";
import {
  fromZonedTime as zonedTimeToUtc,
  toZonedTime as utcToZonedTime,
} from "date-fns-tz";
import { logger } from "../../../lib/logger/logger";

export const resolveSchedulingTimeZone = (timeZone?: string): string => {
  if (timeZone && timeZone.length > 0) {
    return timeZone;
  }
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
  } catch (error) {
    logger.warn("Unable to resolve user timezone", {
      error,
      context: { domain: "scheduling", operation: "resolveSchedulingTimeZone" },
    });
    return "UTC";
  }
};

export const formatSessionLocalInput = (isoString: string | null | undefined, resolvedTimeZone: string): string => {
  if (!isoString) return "";
  try {
    const date = parseISO(isoString);
    if (Number.isNaN(date.getTime())) return "";
    const zoned = utcToZonedTime(date, resolvedTimeZone);
    return format(zoned, "yyyy-MM-dd'T'HH:mm");
  } catch (error) {
    logger.error("Failed to format local input", {
      error,
      context: { domain: "scheduling", operation: "formatSessionLocalInput" },
    });
    return "";
  }
};

export const toUtcSessionIsoString = (localValue: string | undefined, resolvedTimeZone: string): string => {
  if (!localValue) return "";
  try {
    return zonedTimeToUtc(localValue, resolvedTimeZone).toISOString();
  } catch (error) {
    logger.error("Failed to convert local time to UTC", {
      error,
      context: { domain: "scheduling", operation: "toUtcSessionIsoString" },
    });
    return "";
  }
};

export const getDefaultSessionEndTime = (startTimeStr: string): string => {
  if (!startTimeStr) return "";
  const startTime = parseISO(startTimeStr);
  const endTime = addMinutes(startTime, 60);
  return format(endTime, "yyyy-MM-dd'T'HH:mm");
};

/** Minutes between two local datetime-local values in the scheduling timezone; null if invalid. */
export const diffMinutesBetweenLocalInputs = (
  startLocal: string,
  endLocal: string,
  resolvedTimeZone: string,
): number | null => {
  if (!startLocal?.trim() || !endLocal?.trim()) {
    return null;
  }
  try {
    const startUtc = zonedTimeToUtc(startLocal, resolvedTimeZone);
    const endUtc = zonedTimeToUtc(endLocal, resolvedTimeZone);
    const diff = differenceInMinutes(endUtc, startUtc);
    return Number.isFinite(diff) ? diff : null;
  } catch {
    return null;
  }
};

export const addMinutesToLocalInput = (
  localInput: string,
  minutes: number,
  resolvedTimeZone: string,
): string => {
  const utc = zonedTimeToUtc(localInput, resolvedTimeZone);
  const shifted = addMinutes(utc, minutes);
  const local = utcToZonedTime(shifted, resolvedTimeZone);
  return format(local, "yyyy-MM-dd'T'HH:mm");
};

/** Rounds a single local datetime-local value to the nearest 15 minutes (scheduling timezone). */
export const normalizeQuarterHourLocalInput = (value: string, resolvedTimeZone: string): string => {
  const utcDate = zonedTimeToUtc(value, resolvedTimeZone);
  const minutes = utcDate.getUTCMinutes();
  const roundedMinutes = Math.round(minutes / 15) * 15;

  const adjustedUtc = new Date(utcDate);
  adjustedUtc.setUTCMinutes(roundedMinutes % 60, 0, 0);
  if (roundedMinutes >= 60) {
    adjustedUtc.setUTCHours(utcDate.getUTCHours() + Math.floor(roundedMinutes / 60));
  }

  const adjustedLocal = utcToZonedTime(adjustedUtc, resolvedTimeZone);
  return format(adjustedLocal, "yyyy-MM-dd'T'HH:mm");
};

