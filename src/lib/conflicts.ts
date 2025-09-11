import { parseISO, isWithinInterval, format } from 'date-fns';
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

export async function checkSchedulingConflicts(
  startTime: string,
  endTime: string,
  therapistId: string,
  clientId: string,
  existingSessions: Session[],
  therapist: Therapist,
  client: Client,
  excludeSessionId?: string
): Promise<Conflict[]> {
  const conflicts: Conflict[] = [];
  const addedTypes = new Set<Conflict['type']>();

  // Normalize ISO strings so that `Z`-suffixed timestamps are treated as local wall-time.
  // This aligns UI selections (datetime-local) with stored session timestamps for comparisons.
  const parseAsLocal = (iso: string): Date => {
    if (!iso) return new Date(NaN);
    const normalized = /Z$/.test(iso) ? iso.slice(0, -1) : iso;
    return parseISO(normalized);
  };

  const startDate = parseAsLocal(startTime);
  const endDate = parseAsLocal(endTime);
  const getHour = (d: Date) => d.getHours();
  const getDay = (d: Date) => d.getDay();
  // Derive weekday in UTC to avoid timezone drift across environments
  const weekdayNames = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'] as const;
  const dayName = weekdayNames[getDay(startDate)];

  // Check therapist availability (hour-level bounds; inclusive start/exclusive end)
  const therapistAvailability = therapist.availability_hours[dayName];
  if (
    therapistAvailability &&
    therapistAvailability.start &&
    therapistAvailability.end
  ) {
    const [availStartHour] = therapistAvailability.start.split(':').map(Number);
    const [availEndHour] = therapistAvailability.end.split(':').map(Number);
    const sessionStartHour = getHour(startDate);
    const sessionEndHour = getHour(endDate);

    if (sessionStartHour < availStartHour || sessionEndHour > availEndHour) {
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
        message: `Therapist ${therapist.full_name} is not available on ${format(startDate, 'EEEE')}s`,
      });
      addedTypes.add('therapist_unavailable');
    }
  }

  // If therapist is unavailable, short-circuit to avoid stacking conflicts
  if (addedTypes.has('therapist_unavailable')) {
    return conflicts;
  }

  // Check client availability (hour-level bounds; inclusive start/exclusive end)
  const clientAvailability = client.availability_hours[dayName];
  if (
    clientAvailability &&
    clientAvailability.start &&
    clientAvailability.end
  ) {
    const [availStartHour] = clientAvailability.start.split(':').map(Number);
    const [availEndHour] = clientAvailability.end.split(':').map(Number);
    const sessionStartHour = getHour(startDate);
    const sessionEndHour = getHour(endDate);

    if (sessionStartHour < availStartHour || sessionEndHour > availEndHour) {
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
        message: `Client ${client.full_name} is not available on ${format(startDate, 'EEEE')}s`,
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

    const sessionStart = parseAsLocal(session.start_time);
    const sessionEnd = parseAsLocal(session.end_time);

    return (
      (session.therapist_id === therapistId || session.client_id === clientId) &&
      (isWithinInterval(startDate, { start: sessionStart, end: sessionEnd }) ||
        isWithinInterval(endDate, { start: sessionStart, end: sessionEnd }) ||
        isWithinInterval(sessionStart, { start: startDate, end: endDate }))
    );
  });

  if (overlappingSessions.length > 0 && !addedTypes.has('session_overlap')) {
    const session = overlappingSessions[0];
    conflicts.push({
      type: 'session_overlap',
      message: `Overlaps with existing session from ${format(parseISO(session.start_time), 'h:mm a')} to ${format(parseISO(session.end_time), 'h:mm a')}`,
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
  excludeSessionId?: string
): Promise<AlternativeTime[]> {
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
        excludeSessionId
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