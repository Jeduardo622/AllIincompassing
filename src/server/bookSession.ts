import "./bootstrapSupabase";
import { addDays } from "date-fns";
import { formatInTimeZone, fromZonedTime as zonedTimeToUtc } from "date-fns-tz";
import {
  cancelSessionHold,
  confirmSessionBooking,
  requestSessionHold,
} from "../lib/sessionHolds";
import { deriveCptMetadata } from "./deriveCpt";
import { persistSessionCptMetadata } from "./sessionCptPersistence";
import type {
  BookSessionRequest,
  BookSessionResult,
  BookableSession,
  RequiredSessionFields,
  RecurrenceOccurrence,
  SessionRecurrence,
} from "./types";

const REQUIRED_SESSION_FIELDS: Array<keyof RequiredSessionFields> = [
  "therapist_id",
  "client_id",
  "start_time",
  "end_time",
];

function assertSessionCompleteness(session: BookableSession) {
  for (const field of REQUIRED_SESSION_FIELDS) {
    const value = session[field];
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new Error(`Missing required session field: ${String(field)}`);
    }
  }
}

const WEEKDAY_MAP: Record<string, number> = {
  SU: 0,
  SUN: 0,
  MO: 1,
  MON: 1,
  TU: 2,
  TUE: 2,
  WE: 3,
  WED: 3,
  TH: 4,
  THU: 4,
  FR: 5,
  FRI: 5,
  SA: 6,
  SAT: 6,
};

interface ParsedRRule {
  freq: string;
  interval: number;
  byDays: number[];
  count?: number;
  until?: string;
}

function parseRRule(rule: string): ParsedRRule {
  const parsed: ParsedRRule = {
    freq: "WEEKLY",
    interval: 1,
    byDays: [],
  };

  if (typeof rule !== "string" || rule.trim().length === 0) {
    return parsed;
  }

  const segments = rule.split(";");
  for (const segment of segments) {
    const [rawKey, rawValue] = segment.split("=");
    if (!rawKey || !rawValue) {
      continue;
    }

    const key = rawKey.trim().toUpperCase();
    const value = rawValue.trim();

    if (key === "FREQ" && value.length > 0) {
      parsed.freq = value.toUpperCase();
      continue;
    }

    if (key === "INTERVAL") {
      const numericValue = Number(value);
      if (Number.isFinite(numericValue) && numericValue > 0) {
        parsed.interval = Math.trunc(numericValue);
      }
      continue;
    }

    if (key === "BYDAY") {
      const codes = value.split(",").map((code) => code.trim().toUpperCase());
      parsed.byDays = codes
        .map((code) => WEEKDAY_MAP[code])
        .filter((weekday) => typeof weekday === "number");
      continue;
    }

    if (key === "COUNT") {
      const numericValue = Number(value);
      if (Number.isFinite(numericValue) && numericValue > 0) {
        parsed.count = Math.trunc(numericValue);
      }
      continue;
    }

    if (key === "UNTIL" && value.length > 0) {
      parsed.until = value;
    }
  }

  return parsed;
}

function deriveOffsetMinutes(timeZone: string, iso: string): number {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ISO string for timezone offset: ${iso}`);
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

  const parts = formatter.formatToParts(date);
  const timeZoneName = parts.find((part) => part.type === "timeZoneName");
  if (!timeZoneName) {
    throw new Error(`Unable to derive timezone offset for ${timeZone}`);
  }

  if (timeZoneName.value === "GMT" || timeZoneName.value === "UTC") {
    return 0;
  }

  const match = timeZoneName.value.match(/GMT([+-]?)(\d{1,2})(?::(\d{2}))?/);
  if (!match) {
    throw new Error(`Unable to parse timezone offset: ${timeZoneName.value}`);
  }

  const sign = match[1] === "-" ? -1 : 1;
  const hours = Number(match[2]);
  const minutes = Number(match[3] ?? "0");

  return sign * (hours * 60 + minutes);
}

function parseTimeZoneDate(value: string | undefined, timeZone: string): Date | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(trimmed)) {
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  try {
    return zonedTimeToUtc(trimmed, timeZone);
  } catch (error) {
    console.warn("Failed to parse timezone-aware date", { value, timeZone, error });
    return null;
  }
}

function normalizeExceptions(exceptions: string[] | undefined): Set<string> {
  if (!Array.isArray(exceptions) || exceptions.length === 0) {
    return new Set<string>();
  }

  const normalized = new Set<string>();
  for (const value of exceptions) {
    try {
      const iso = new Date(value).toISOString();
      normalized.add(iso);
    } catch (error) {
      console.warn("Ignoring invalid recurrence exception", { value, error });
    }
  }
  return normalized;
}

function buildBaseOccurrence(
  startTime: string,
  endTime: string,
  startOffsetMinutes: number,
  endOffsetMinutes: number,
): RecurrenceOccurrence {
  return {
    startTime,
    endTime,
    startOffsetMinutes,
    endOffsetMinutes,
  };
}

function generateOccurrences(
  session: BookableSession,
  recurrence: SessionRecurrence | null | undefined,
  payload: { startOffsetMinutes: number; endOffsetMinutes: number; timeZone: string },
): RecurrenceOccurrence[] {
  const baseStart = session.start_time;
  const baseEnd = session.end_time;

  if (typeof baseStart !== "string" || typeof baseEnd !== "string") {
    throw new Error("Session start_time and end_time must be provided");
  }

  const baseStartDate = new Date(baseStart);
  const baseEndDate = new Date(baseEnd);

  if (Number.isNaN(baseStartDate.getTime()) || Number.isNaN(baseEndDate.getTime())) {
    throw new Error("Invalid session start or end time");
  }

  if (!recurrence || typeof recurrence.rule !== "string" || recurrence.rule.trim().length === 0) {
    return [
      buildBaseOccurrence(
        baseStart,
        baseEnd,
        payload.startOffsetMinutes,
        payload.endOffsetMinutes,
      ),
    ];
  }

  const rule = parseRRule(recurrence.rule);
  if (rule.freq !== "WEEKLY") {
    console.warn("Unsupported recurrence frequency; defaulting to single occurrence", rule.freq);
    return [
      buildBaseOccurrence(
        baseStart,
        baseEnd,
        payload.startOffsetMinutes,
        payload.endOffsetMinutes,
      ),
    ];
  }

  const timeZone = recurrence.timeZone ?? payload.timeZone;
  const durationMs = baseEndDate.getTime() - baseStartDate.getTime();
  const baseLocalDate = formatInTimeZone(baseStart, timeZone, "yyyy-MM-dd");
  const baseLocalTime = formatInTimeZone(baseStart, timeZone, "HH:mm:ss");
  const baseDayCode = formatInTimeZone(baseStart, timeZone, "EEE").toUpperCase();
  const baseDayNumber = WEEKDAY_MAP[baseDayCode] ?? 0;
  const byDays = rule.byDays.length > 0 ? Array.from(new Set(rule.byDays)).sort((a, b) => a - b) : [baseDayNumber];
  const interval = Math.max(1, rule.interval);
  const maxCount = recurrence.count ?? rule.count;
  const untilDate = parseTimeZoneDate(recurrence.until ?? rule.until, timeZone);
  const exceptions = normalizeExceptions(recurrence.exceptions);

  const baseWeekStartUtc = addDays(zonedTimeToUtc(`${baseLocalDate}T00:00:00`, timeZone), -baseDayNumber);
  const occurrences: RecurrenceOccurrence[] = [];
  const maxIterations = 520; // ~10 years of weekly recurrences

  let weekIndex = 0;
  while (weekIndex < maxIterations) {
    const weekStartUtc = addDays(baseWeekStartUtc, weekIndex * interval * 7);

    for (const weekday of byDays) {
      const candidateDateUtc = addDays(weekStartUtc, weekday);
      const candidateLocalDate = formatInTimeZone(candidateDateUtc, timeZone, "yyyy-MM-dd");
      const candidateStartUtc = zonedTimeToUtc(`${candidateLocalDate}T${baseLocalTime}`, timeZone);

      if (occurrences.length === 0 && candidateStartUtc.getTime() < baseStartDate.getTime()) {
        continue;
      }

      if (untilDate && candidateStartUtc.getTime() > untilDate.getTime()) {
        return occurrences.length > 0
          ? occurrences
          : [
              buildBaseOccurrence(
                baseStart,
                baseEnd,
                payload.startOffsetMinutes,
                payload.endOffsetMinutes,
              ),
            ];
      }

      const occurrenceStartIso = candidateStartUtc.toISOString();
      if (exceptions.has(occurrenceStartIso)) {
        continue;
      }

      const occurrenceEndIso = new Date(candidateStartUtc.getTime() + durationMs).toISOString();
      const startOffsetMinutes = deriveOffsetMinutes(timeZone, occurrenceStartIso);
      const endOffsetMinutes = deriveOffsetMinutes(timeZone, occurrenceEndIso);

      occurrences.push(
        buildBaseOccurrence(
          occurrenceStartIso,
          occurrenceEndIso,
          startOffsetMinutes,
          endOffsetMinutes,
        ),
      );

      if (typeof maxCount === "number" && occurrences.length >= maxCount) {
        return occurrences;
      }
    }

    weekIndex += 1;
  }

  if (occurrences.length === 0) {
    return [
      buildBaseOccurrence(
        baseStart,
        baseEnd,
        payload.startOffsetMinutes,
        payload.endOffsetMinutes,
      ),
    ];
  }

  return occurrences;
}

export async function bookSession(payload: BookSessionRequest): Promise<BookSessionResult> {
  if (!payload?.session) {
    throw new Error("Session payload is required");
  }

  assertSessionCompleteness(payload.session);

  const recurrence = payload.recurrence ?? payload.session.recurrence ?? null;

  const cpt = deriveCptMetadata({
    session: payload.session,
    overrides: payload.overrides,
  });

  const sessionId = typeof payload.session.id === "string" ? payload.session.id : undefined;

  const occurrences = generateOccurrences(payload.session, recurrence, {
    startOffsetMinutes: payload.startTimeOffsetMinutes,
    endOffsetMinutes: payload.endTimeOffsetMinutes,
    timeZone: payload.timeZone,
  });

  const [primaryOccurrence] = occurrences;
  if (!primaryOccurrence) {
    throw new Error("Unable to derive primary occurrence for booking");
  }

  const hold = await requestSessionHold({
    therapistId: payload.session.therapist_id,
    clientId: payload.session.client_id,
    startTime: primaryOccurrence.startTime,
    endTime: primaryOccurrence.endTime,
    sessionId,
    holdSeconds: payload.holdSeconds,
    idempotencyKey: payload.idempotencyKey,
    startTimeOffsetMinutes: primaryOccurrence.startOffsetMinutes,
    endTimeOffsetMinutes: primaryOccurrence.endOffsetMinutes,
    timeZone: recurrence?.timeZone ?? payload.timeZone,
    accessToken: payload.accessToken,
    occurrences: occurrences.map((occurrence) => ({
      startTime: occurrence.startTime,
      endTime: occurrence.endTime,
      startTimeOffsetMinutes: occurrence.startOffsetMinutes,
      endTimeOffsetMinutes: occurrence.endOffsetMinutes,
    })),
  });

  const sessionPayload: BookableSession = {
    ...payload.session,
    status: payload.session.status ?? "scheduled",
  };

  let confirmed;
  try {
    confirmed = await confirmSessionBooking({
      holdKey: hold.holdKey,
      session: sessionPayload,
      idempotencyKey: payload.idempotencyKey,
      startTimeOffsetMinutes: primaryOccurrence.startOffsetMinutes,
      endTimeOffsetMinutes: primaryOccurrence.endOffsetMinutes,
      timeZone: recurrence?.timeZone ?? payload.timeZone,
      accessToken: payload.accessToken,
      occurrences: hold.holds.map((heldOccurrence, index) => ({
        holdKey: heldOccurrence.holdKey,
        session: {
          ...sessionPayload,
          start_time: occurrences[index]?.startTime ?? heldOccurrence.startTime,
          end_time: occurrences[index]?.endTime ?? heldOccurrence.endTime,
        },
        startTimeOffsetMinutes:
          occurrences[index]?.startOffsetMinutes ?? deriveOffsetMinutes(
            recurrence?.timeZone ?? payload.timeZone,
            heldOccurrence.startTime,
          ),
        endTimeOffsetMinutes:
          occurrences[index]?.endOffsetMinutes ?? deriveOffsetMinutes(
            recurrence?.timeZone ?? payload.timeZone,
            heldOccurrence.endTime,
          ),
        timeZone: recurrence?.timeZone ?? payload.timeZone,
      })),
    });
  } catch (error) {
    const cancelIdempotencyKey = payload.idempotencyKey
      ? `cancel:${payload.idempotencyKey}`
      : `cancel:${hold.holdKey}`;
    try {
      await cancelSessionHold({
        holdKey: hold.holdKey,
        idempotencyKey: cancelIdempotencyKey,
        accessToken: payload.accessToken,
      });
    } catch (releaseError) {
      console.warn("Failed to release session hold after confirmation error", releaseError);
    }
    throw error;
  }

  if (!confirmed.session) {
    throw new Error("Session confirmation missing session payload");
  }

  const sessionsToPersist = Array.isArray(confirmed.sessions) && confirmed.sessions.length > 0
    ? confirmed.sessions
    : [confirmed.session];

  const uniqueSessionsMap = new Map<string, typeof sessionsToPersist[number]>();
  for (const session of sessionsToPersist) {
    if (!session || typeof session !== "object") {
      continue;
    }

    const identifier = typeof session.id === "string" ? session.id : null;
    if (!identifier) {
      continue;
    }

    if (!uniqueSessionsMap.has(identifier)) {
      uniqueSessionsMap.set(identifier, session);
    }
  }

  const uniqueSessions = uniqueSessionsMap.size > 0
    ? Array.from(uniqueSessionsMap.values())
    : sessionsToPersist;

  try {
    await Promise.all(
      uniqueSessions.map(async (session) => {
        const billedMinutes = typeof session.duration_minutes === "number" && Number.isFinite(session.duration_minutes)
          ? session.duration_minutes
          : cpt.durationMinutes;

        await persistSessionCptMetadata({
          sessionId: session.id,
          cpt,
          billedMinutes,
        });
      }),
    );
  } catch (error) {
    console.error("Failed to persist CPT metadata for session", error);
    throw error;
  }

  return {
    session: confirmed.session,
    sessions: sessionsToPersist,
    hold,
    cpt,
  };
}
