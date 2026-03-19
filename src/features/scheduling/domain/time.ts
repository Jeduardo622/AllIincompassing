import { addMinutes, format, parseISO } from "date-fns";
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

export const normalizeQuarterHourLocalInput = (
  value: string,
  resolvedTimeZone: string,
): { normalizedStart: string; normalizedEnd: string } => {
  const utcDate = zonedTimeToUtc(value, resolvedTimeZone);
  const minutes = utcDate.getUTCMinutes();
  const roundedMinutes = Math.round(minutes / 15) * 15;

  const adjustedUtc = new Date(utcDate);
  adjustedUtc.setUTCMinutes(roundedMinutes % 60, 0, 0);
  if (roundedMinutes >= 60) {
    adjustedUtc.setUTCHours(utcDate.getUTCHours() + Math.floor(roundedMinutes / 60));
  }

  const adjustedLocal = utcToZonedTime(adjustedUtc, resolvedTimeZone);
  const endUtc = addMinutes(adjustedUtc, 60);
  const endLocal = utcToZonedTime(endUtc, resolvedTimeZone);

  return {
    normalizedStart: format(adjustedLocal, "yyyy-MM-dd'T'HH:mm"),
    normalizedEnd: format(endLocal, "yyyy-MM-dd'T'HH:mm"),
  };
};

