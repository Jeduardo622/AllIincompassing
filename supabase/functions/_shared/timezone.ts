export interface TimezoneValidationPayload {
  start_time: string;
  end_time: string;
  start_time_offset_minutes: number;
  end_time_offset_minutes: number;
  time_zone: string;
}

export function deriveOffsetFromTimeZone(timeZone: string, isoString: string): number | null {
  try {
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) {
      return null;
    }

    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "shortOffset",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });

    const tzPart = formatter
      .formatToParts(date)
      .find((part) => part.type === "timeZoneName");

    if (!tzPart) return null;

    if (tzPart.value === "GMT" || tzPart.value === "UTC") {
      return 0;
    }

    const match = tzPart.value.match(/GMT([+-]?)(\d{1,2})(?::(\d{2}))?/);
    if (!match) return null;

    const sign = match[1] === "-" ? -1 : 1;
    const hours = Number(match[2]);
    const minutes = Number(match[3] ?? "0");

    return sign * (hours * 60 + minutes);
  } catch (error) {
    console.error("Failed to derive timezone offset", error);
    return null;
  }
}

export function validateTimezonePayload(payload: TimezoneValidationPayload) {
  const normalize = (value: number) => Math.trunc(value);
  const hasValidNumber = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 16 * 60;

  if (!hasValidNumber(payload.start_time_offset_minutes)) {
    return { ok: false as const, message: "Invalid start_time_offset_minutes" };
  }

  if (!hasValidNumber(payload.end_time_offset_minutes)) {
    return { ok: false as const, message: "Invalid end_time_offset_minutes" };
  }

  if (typeof payload.time_zone !== "string" || payload.time_zone.trim().length === 0) {
    return { ok: false as const, message: "Missing time_zone" };
  }

  const startDerived = deriveOffsetFromTimeZone(payload.time_zone, payload.start_time);
  const endDerived = deriveOffsetFromTimeZone(payload.time_zone, payload.end_time);

  if (startDerived === null || endDerived === null) {
    return { ok: false as const, message: "Unable to determine timezone offset" };
  }

  if (normalize(payload.start_time_offset_minutes) !== startDerived) {
    return { ok: false as const, message: "start_time_offset_minutes mismatch" };
  }

  if (normalize(payload.end_time_offset_minutes) !== endDerived) {
    return { ok: false as const, message: "end_time_offset_minutes mismatch" };
  }

  if (Math.abs(payload.start_time_offset_minutes - payload.end_time_offset_minutes) > 120) {
    return { ok: false as const, message: "Offset difference too large" };
  }

  return { ok: true as const };
}
