import { parseISO, format } from 'date-fns';
import { toZonedTime as utcToZonedTime, fromZonedTime as zonedTimeToUtc } from 'date-fns-tz';
import type { Session, Therapist, Client } from '../types';
import type { AvailabilityWindow } from '../types';
import { edgeInvoke } from './edgeInvoke';

export interface Conflict {
  type: 'therapist_unavailable' | 'client_unavailable' | 'session_overlap';
  message: string;
}

export interface AlternativeTime {
  startTime: string;
  endTime: string;
  score: number;
  reason: string;
}

export interface ConflictCheckOptions {
  excludeSessionId?: string;
  timeZone?: string;
}

interface MinuteRange {
  start: number;
  end: number;
}

const DAY_KEY_ALIASES: Record<string, string[]> = {
  sunday: ["sunday", "sun"],
  monday: ["monday", "mon"],
  tuesday: ["tuesday", "tue", "tues"],
  wednesday: ["wednesday", "wed"],
  thursday: ["thursday", "thu", "thur", "thurs"],
  friday: ["friday", "fri"],
  saturday: ["saturday", "sat"],
};

const normalizeAvailabilityDayKey = (value: string): string =>
  value.toLowerCase().replace(/[^a-z]/g, "");

/** True if the window can produce at least one minute range (non-empty objects are otherwise truthy but unusable). */
const isUsableAvailabilityWindow = (w: AvailabilityWindow | undefined): boolean => {
  if (!w || typeof w !== "object") {
    return false;
  }
  const hasPrimary =
    typeof w.start === "string" &&
    w.start.length > 0 &&
    typeof w.end === "string" &&
    w.end.length > 0;
  const hasSecondary =
    typeof w.start2 === "string" &&
    w.start2.length > 0 &&
    typeof w.end2 === "string" &&
    w.end2.length > 0;
  return hasPrimary || hasSecondary;
};

const resolveDailyAvailability = (
  availabilityHours: Therapist["availability_hours"] | Client["availability_hours"] | null | undefined,
  dayName: string,
): AvailabilityWindow | undefined => {
  if (!availabilityHours || typeof availabilityHours !== "object") {
    return undefined;
  }

  const aliases = DAY_KEY_ALIASES[dayName] ?? [dayName];
  for (const alias of aliases) {
    const direct = availabilityHours[alias as keyof typeof availabilityHours];
    if (direct && isUsableAvailabilityWindow(direct as AvailabilityWindow)) {
      return direct as AvailabilityWindow;
    }
  }

  const normalizedAliases = new Set(aliases.map((alias) => normalizeAvailabilityDayKey(alias)));
  for (const [key, value] of Object.entries(availabilityHours)) {
    if (!value || !isUsableAvailabilityWindow(value as AvailabilityWindow)) {
      continue;
    }
    if (normalizedAliases.has(normalizeAvailabilityDayKey(key))) {
      return value as AvailabilityWindow;
    }
  }

  return undefined;
};

export async function checkSchedulingConflicts(
  startTime: string,
  endTime: string,
  therapistId: string,
  clientId: string,
  existingSessions: Session[],
  therapist: Therapist,
  client: Client,
  options: ConflictCheckOptions = {}
): Promise<Conflict[]> {
  const conflicts: Conflict[] = [];
  const addedTypes = new Set<Conflict['type']>();
  const { excludeSessionId, timeZone = 'UTC' } = options;

  const hasZoneInfo = (value: string) => /[zZ]|[+-]\d{2}:?\d{2}$/.test(value);
  const startUtc = hasZoneInfo(startTime) ? parseISO(startTime) : zonedTimeToUtc(startTime, timeZone);
  const endUtc = hasZoneInfo(endTime) ? parseISO(endTime) : zonedTimeToUtc(endTime, timeZone);
  if (Number.isNaN(startUtc.getTime()) || Number.isNaN(endUtc.getTime())) {
    return conflicts;
  }

  const startLocal = utcToZonedTime(startUtc, timeZone);
  const endLocal = utcToZonedTime(endUtc, timeZone);

  const getMinutesSinceMidnight = (d: Date) => d.getHours() * 60 + d.getMinutes();
  const parseAvailabilityMinutes = (
    value: string | null | undefined,
    referenceDate: Date,
  ): number | null => {
    if (typeof value !== 'string') {
      return null;
    }

    const [hourPart, minutePart = '0'] = value.split(':');
    const hours = Number.parseInt(hourPart, 10);
    const minutes = Number.parseInt(minutePart, 10);

    if (Number.isNaN(hours) || Number.isNaN(minutes)) {
      return null;
    }

    const adjusted = new Date(referenceDate);
    adjusted.setHours(hours, minutes, 0, 0);
    return getMinutesSinceMidnight(adjusted);
  };

  const toMinuteRanges = (
    availability: AvailabilityWindow | undefined,
    referenceDate: Date,
  ): MinuteRange[] => {
    if (!availability) {
      return [];
    }

    const ranges: MinuteRange[] = [];
    const firstStart = parseAvailabilityMinutes(availability.start, referenceDate);
    const firstEnd = parseAvailabilityMinutes(availability.end, referenceDate);
    if (firstStart !== null && firstEnd !== null && firstStart < firstEnd) {
      ranges.push({ start: firstStart, end: firstEnd });
    }

    const secondStart = parseAvailabilityMinutes(availability.start2, referenceDate);
    const secondEnd = parseAvailabilityMinutes(availability.end2, referenceDate);
    if (secondStart !== null && secondEnd !== null && secondStart < secondEnd) {
      ranges.push({ start: secondStart, end: secondEnd });
    }

    return ranges;
  };

  const isWithinAnyRange = (ranges: MinuteRange[], startMinutes: number, endMinutes: number): boolean => (
    ranges.some((range) => startMinutes >= range.start && endMinutes <= range.end)
  );

  const sessionStartMinutes = getMinutesSinceMidnight(startLocal);
  const sessionEndMinutes = getMinutesSinceMidnight(endLocal);
  const getDay = (d: Date) => d.getDay();
  const weekdayNames = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'] as const;
  const dayName = weekdayNames[getDay(startLocal)];

  // Check therapist availability using minute-level bounds
  const therapistAvailability = resolveDailyAvailability(therapist.availability_hours, dayName);
  const therapistRanges = toMinuteRanges(therapistAvailability, startLocal);
  if (therapistRanges.length > 0) {
    if (!isWithinAnyRange(therapistRanges, sessionStartMinutes, sessionEndMinutes)) {
      if (!addedTypes.has('therapist_unavailable')) {
        conflicts.push({
          type: 'therapist_unavailable',
          message: `Therapist ${therapist.full_name} is not available during this time`,
        });
        addedTypes.add('therapist_unavailable');
      }
    }
  } else {
    if (!addedTypes.has('therapist_unavailable')) {
      conflicts.push({
        type: 'therapist_unavailable',
          message: `Therapist ${therapist.full_name} is not available on ${format(startLocal, 'EEEE')}`,
      });
      addedTypes.add('therapist_unavailable');
    }
  }

  // If therapist is unavailable, short-circuit to avoid stacking conflicts
  if (addedTypes.has('therapist_unavailable')) {
    return conflicts;
  }

  // Check client availability using minute-level bounds
  const clientAvailability = resolveDailyAvailability(client.availability_hours, dayName);
  const clientRanges = toMinuteRanges(clientAvailability, startLocal);
  if (clientRanges.length > 0) {
    if (!isWithinAnyRange(clientRanges, sessionStartMinutes, sessionEndMinutes)) {
      if (!addedTypes.has('client_unavailable')) {
        conflicts.push({
          type: 'client_unavailable',
          message: `Client ${client.full_name} is not available during this time`,
        });
        addedTypes.add('client_unavailable');
      }
    }
  } else {
    if (!addedTypes.has('client_unavailable')) {
      conflicts.push({
        type: 'client_unavailable',
          message: `Client ${client.full_name} is not available on ${format(startLocal, 'EEEE')}`,
      });
      addedTypes.add('client_unavailable');
    }
  }

  // If client is unavailable, short-circuit to avoid stacking conflicts
  if (addedTypes.has('client_unavailable')) {
    return conflicts;
  }

  // Check for overlapping sessions
  const overlappingSessions = existingSessions.filter(session => {
    if (excludeSessionId && session.id === excludeSessionId) return false;

    const sessionStart = parseISO(session.start_time);
    const sessionEnd = parseISO(session.end_time);
    const hasOverlap = startUtc.getTime() < sessionEnd.getTime() && sessionStart.getTime() < endUtc.getTime();

    return (
      (session.therapist_id === therapistId || session.client_id === clientId) &&
      hasOverlap
    );
  });

  if (overlappingSessions.length > 0 && !addedTypes.has('session_overlap')) {
    const session = overlappingSessions[0];
    const overlapStart = utcToZonedTime(parseISO(session.start_time), timeZone);
    const overlapEnd = utcToZonedTime(parseISO(session.end_time), timeZone);
    conflicts.push({
      type: 'session_overlap',
      message: `Overlaps with existing session from ${format(overlapStart, 'h:mm a')} to ${format(overlapEnd, 'h:mm a')}`,
    });
    addedTypes.add('session_overlap');
  }

  return conflicts;
}

export async function suggestAlternativeTimes(
  startTime: string,
  endTime: string,
  therapistId: string,
  clientId: string,
  existingSessions: Session[],
  therapist: Therapist,
  client: Client,
  conflicts: Conflict[],
  options: ConflictCheckOptions = {}
): Promise<AlternativeTime[]> {
  const { excludeSessionId, timeZone = 'UTC' } = options;
  try {
    const { data, error, status } = await edgeInvoke<{ alternatives?: AlternativeTime[] }>('suggest-alternative-times', {
      body: {
        startTime,
        endTime,
        therapistId,
        clientId,
        conflicts,
        therapist,
        client,
        existingSessions,
        excludeSessionId,
        timeZone,
      },
    });

    if (error) {
      console.error('Error suggesting alternative times:', { message: error.message, status });
      return [];
    }

    return (data?.alternatives) || [];
  } catch (error) {
    console.error('Error suggesting alternative times:', error);
    return [];
  }
}