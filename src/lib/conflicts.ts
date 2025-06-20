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
  const startDate = parseISO(startTime);
  const endDate = parseISO(endTime);
  const dayName = format(startDate, 'EEEE').toLowerCase();

  // Check therapist availability
  const therapistAvailability = therapist.availability_hours[dayName];
  if (
    therapistAvailability &&
    therapistAvailability.start &&
    therapistAvailability.end
  ) {
    const [availStartHour] = therapistAvailability.start.split(':').map(Number);
    const [availEndHour] = therapistAvailability.end.split(':').map(Number);
    const sessionStartHour = startDate.getHours();
    const sessionEndHour = endDate.getHours();

    if (sessionStartHour < availStartHour || sessionEndHour > availEndHour) {
      conflicts.push({
        type: 'therapist_unavailable',
        message: `Therapist ${therapist.full_name} is not available during this time`,
      });
    }
  } else {
    conflicts.push({
      type: 'therapist_unavailable',
      message: `Therapist ${therapist.full_name} is not available on ${format(startDate, 'EEEE')}s`,
    });
  }

  // Check client availability
  const clientAvailability = client.availability_hours[dayName];
  if (
    clientAvailability &&
    clientAvailability.start &&
    clientAvailability.end
  ) {
    const [availStartHour] = clientAvailability.start.split(':').map(Number);
    const [availEndHour] = clientAvailability.end.split(':').map(Number);
    const sessionStartHour = startDate.getHours();
    const sessionEndHour = endDate.getHours();

    if (sessionStartHour < availStartHour || sessionEndHour > availEndHour) {
      conflicts.push({
        type: 'client_unavailable',
        message: `Client ${client.full_name} is not available during this time`,
      });
    }
  } else {
    conflicts.push({
      type: 'client_unavailable',
      message: `Client ${client.full_name} is not available on ${format(startDate, 'EEEE')}s`,
    });
  }

  // Check for overlapping sessions
  const overlappingSessions = existingSessions.filter(session => {
    if (excludeSessionId && session.id === excludeSessionId) return false;

    const sessionStart = parseISO(session.start_time);
    const sessionEnd = parseISO(session.end_time);

    return (
      (session.therapist_id === therapistId || session.client_id === clientId) &&
      (isWithinInterval(startDate, { start: sessionStart, end: sessionEnd }) ||
        isWithinInterval(endDate, { start: sessionStart, end: sessionEnd }) ||
        isWithinInterval(sessionStart, { start: startDate, end: endDate }))
    );
  });

  overlappingSessions.forEach(session => {
    conflicts.push({
      type: 'session_overlap',
      message: `Conflicts with existing session from ${format(parseISO(session.start_time), 'h:mm a')} to ${format(parseISO(session.end_time), 'h:mm a')}`,
    });
  });

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