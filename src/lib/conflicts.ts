import { parseISO, isWithinInterval, format } from 'date-fns';
import { toZonedTime as utcToZonedTime } from 'date-fns-tz';
import type { Session, Therapist, Client } from '../types';
import { supabase } from './supabase';

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

  const startUtc = parseISO(startTime);
  const endUtc = parseISO(endTime);
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

  const sessionStartMinutes = getMinutesSinceMidnight(startLocal);
  const sessionEndMinutes = getMinutesSinceMidnight(endLocal);
  const getDay = (d: Date) => d.getDay();
  const weekdayNames = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'] as const;
  const dayName = weekdayNames[getDay(startLocal)];

  // Check therapist availability using minute-level bounds
  const therapistAvailability = therapist.availability_hours[dayName];
  if (
    therapistAvailability &&
    therapistAvailability.start &&
    therapistAvailability.end
  ) {
    const availabilityStartMinutes = parseAvailabilityMinutes(
      therapistAvailability.start,
      startLocal,
    );
    const availabilityEndMinutes = parseAvailabilityMinutes(
      therapistAvailability.end,
      startLocal,
    );

    if (
      availabilityStartMinutes === null ||
      availabilityEndMinutes === null ||
      sessionStartMinutes < availabilityStartMinutes ||
      sessionEndMinutes > availabilityEndMinutes
    ) {
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
        message: `Therapist ${therapist.full_name} is not available on ${format(startLocal, 'EEEE')}s`,
      });
      addedTypes.add('therapist_unavailable');
    }
  }

  // If therapist is unavailable, short-circuit to avoid stacking conflicts
  if (addedTypes.has('therapist_unavailable')) {
    return conflicts;
  }

  // Check client availability using minute-level bounds
  const clientAvailability = client.availability_hours[dayName];
  if (
    clientAvailability &&
    clientAvailability.start &&
    clientAvailability.end
  ) {
    const availabilityStartMinutes = parseAvailabilityMinutes(
      clientAvailability.start,
      startLocal,
    );
    const availabilityEndMinutes = parseAvailabilityMinutes(
      clientAvailability.end,
      startLocal,
    );

    if (
      availabilityStartMinutes === null ||
      availabilityEndMinutes === null ||
      sessionStartMinutes < availabilityStartMinutes ||
      sessionEndMinutes > availabilityEndMinutes
    ) {
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
        message: `Client ${client.full_name} is not available on ${format(startLocal, 'EEEE')}s`,
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

    return (
      (session.therapist_id === therapistId || session.client_id === clientId) &&
      (isWithinInterval(startUtc, { start: sessionStart, end: sessionEnd }) ||
        isWithinInterval(endUtc, { start: sessionStart, end: sessionEnd }) ||
        isWithinInterval(sessionStart, { start: startUtc, end: endUtc }))
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
    const { data, error } = await supabase.functions.invoke('suggest-alternative-times', {
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
      console.error('Error suggesting alternative times:', error);
      return [];
    }

    return data.alternatives || [];
  } catch (error) {
    console.error('Error suggesting alternative times:', error);
    return [];
  }
}