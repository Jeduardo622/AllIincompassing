import {
  format,
  parseISO,
  addMinutes,
  isWithinInterval,
  isSameDay,
  startOfWeek,
  endOfWeek,
  differenceInMinutes,
  addDays
} from 'date-fns';
import { getDistance } from 'geolib';
import type { Therapist, Client, Session } from '../types';

// Performance optimizations
const memoCache = new Map<string, unknown>();

function memoize<T extends (...args: unknown[]) => unknown>(
  fn: T,
  keyFn: (...args: Parameters<T>) => string
): T {
  return ((...args: Parameters<T>) => {
    const key = keyFn(...args);
    if (memoCache.has(key)) {
      return memoCache.get(key);
    }
    const result = fn(...args);
    memoCache.set(key, result);
    return result;
  }) as T;
}

// Clear cache periodically to prevent memory leaks
export function clearScheduleCache() {
  memoCache.clear();
}

// Optimized constants
export const CONSTRAINTS = {
  MAX_DAILY_HOURS: 8,
  MAX_CONSECUTIVE_SESSIONS: 4,
  MIN_BREAK_MINUTES: 15,
  MAX_DAILY_TRAVEL_TIME: 120, // minutes
} as const;

export const WEIGHTS = {
  COMPATIBILITY: 0.25,
  AVAILABILITY: 0.20,
  WORKLOAD: 0.15,
  TRAVEL_TIME: 0.15,
  CONTINUITY: 0.10,
  URGENCY: 0.10,
  EFFICIENCY: 0.05,
} as const;

// Optimized interfaces
export interface Location {
  latitude: number;
  longitude: number;
  address?: string;
}

export interface ScheduleSlot {
  therapist: Therapist;
  client: Client;
  startTime: string;
  endTime: string;
  score: number;
  location?: Location | null;
}

const MINUTES_PER_HOUR = 60;

export interface ClientHourCapacity {
  authorizedHours: number | null;
  providedHours: number;
  unscheduledHours: number | null;
  remainingHours: number | null;
  remainingMinutes: number | null;
}

export interface CappedClientInfo {
  client: Client;
  remainingMinutes: number;
}

export interface GenerateOptimalScheduleResult {
  slots: ScheduleSlot[];
  cappedClients: CappedClientInfo[];
}

function sanitizeHourValue(value: number | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (Number.isFinite(value)) {
    return Math.max(0, Number(value));
  }

  return null;
}

export function normalizeClientHourCapacity(client: Client): ClientHourCapacity {
  const authorizedHours = sanitizeHourValue(client.authorized_hours_per_month ?? null);
  const providedHours = sanitizeHourValue(client.hours_provided_per_month ?? 0) ?? 0;
  const unscheduledHours = sanitizeHourValue(client.unscheduled_hours ?? null);

  let remainingHours: number | null = null;

  if (authorizedHours !== null) {
    const boundedProvided = Math.min(providedHours, authorizedHours);
    remainingHours = Math.max(authorizedHours - boundedProvided, 0);
  }

  if (unscheduledHours !== null) {
    if (remainingHours === null) {
      remainingHours = unscheduledHours;
    } else {
      remainingHours = Math.min(remainingHours, unscheduledHours);
    }
  }

  return {
    authorizedHours,
    providedHours,
    unscheduledHours,
    remainingHours,
    remainingMinutes: remainingHours === null ? null : remainingHours * MINUTES_PER_HOUR
  };
}

// Memoized helper functions
const getLocationFromAddress = memoize(
  (client: Client): Location | null => {
    if (!client.address) return null;
    
    // This would typically call a geocoding service
    // For now, return a mock location
    return {
      latitude: 40.7128 + Math.random() * 0.1,
      longitude: -74.0060 + Math.random() * 0.1,
      address: client.address,
    };
  },
  (client: Client) => `location_${client.id}_${client.address}`
);

const calculateTravelInfo = memoize(
  (from: Location, to: Location, time: Date) => {
    const distance = getDistance(
      { latitude: from.latitude, longitude: from.longitude },
      { latitude: to.latitude, longitude: to.longitude }
    );
    
    // Estimate travel time based on distance and time of day
    const hour = time.getHours();
    const isRushHour = (hour >= 7 && hour <= 9) || (hour >= 16 && hour <= 18);
    const baseSpeed = isRushHour ? 25 : 35; // km/h
    
    const duration = Math.ceil((distance / 1000) / baseSpeed * 60); // minutes
    
    return { distance, duration };
  },
  (from: Location, to: Location, time: Date) => 
    `travel_${from.latitude}_${from.longitude}_${to.latitude}_${to.longitude}_${time.getHours()}`
);

// Optimized scoring functions
const calculateCompatibilityScore = memoize(
  (therapist: Therapist, client: Client): number => {
    let score = 0;
    
    // Service type compatibility
    const clientServices = client.service_preference || [];
    const therapistServices = therapist.service_type || [];
    
    const commonServices = clientServices.filter(service => 
      therapistServices.includes(service)
  );

    if (commonServices.length === 0) return 0;
    
    score += (commonServices.length / Math.max(clientServices.length, therapistServices.length)) * 0.4;
    
    // Specialties match
    const clientSpecialtyNeeds = client.diagnosis || [];
    const therapistSpecialties = therapist.specialties || [];
    
    const specialtyMatch = clientSpecialtyNeeds.some(need => 
      therapistSpecialties.some(specialty => 
        specialty.toLowerCase().includes(need.toLowerCase())
      )
    );
    
    if (specialtyMatch) score += 0.3;
  
    // Language compatibility
    if (therapist.languages?.includes(client.preferred_language || 'English')) {
      score += 0.2;
    }
    
    // Experience level
    const experienceYears = therapist.years_experience || 0;
    if (experienceYears >= 3) score += 0.1;
    
    return Math.min(score, 1);
  },
  (therapist: Therapist, client: Client) => `compatibility_${therapist.id}_${client.id}`
);

const calculateAvailabilityScore = memoize(
  (startTime: Date, endTime: Date, therapist: Therapist, client: Client, existingSessions: Session[]): number => {
  const dayName = format(startTime, 'EEEE').toLowerCase();
  let score = 0;

  // Check therapist availability
    const therapistAvail = therapist.availability_hours?.[dayName];
    if (!therapistAvail?.start || !therapistAvail?.end) return 0;

  const [therapistStartHour] = therapistAvail.start.split(':').map(Number);
  const [therapistEndHour] = therapistAvail.end.split(':').map(Number);
  const sessionStartHour = startTime.getHours();
  const sessionEndHour = endTime.getHours();

  if (sessionStartHour < therapistStartHour || sessionEndHour > therapistEndHour) return 0;

  // Check client availability
    const clientAvail = client.availability_hours?.[dayName];
    if (!clientAvail?.start || !clientAvail?.end) return 0;

  const [clientStartHour] = clientAvail.start.split(':').map(Number);
  const [clientEndHour] = clientAvail.end.split(':').map(Number);

  if (sessionStartHour < clientStartHour || sessionEndHour > clientEndHour) return 0;

  // Check for conflicts with existing sessions
  const hasConflict = existingSessions.some(session => {
    const sessionStart = parseISO(session.start_time);
    const sessionEnd = parseISO(session.end_time);
    
    if (!isSameDay(startTime, sessionStart)) return false;
    
    if (session.therapist_id === therapist.id || session.client_id === client.id) {
      return isWithinInterval(startTime, { start: sessionStart, end: sessionEnd }) ||
             isWithinInterval(endTime, { start: sessionStart, end: sessionEnd }) ||
             isWithinInterval(sessionStart, { start: startTime, end: endTime });
    }
    return false;
  });

  if (hasConflict) return 0;

  // Calculate optimal time slot score
    const preferredStartHour = 9;
    const preferredEndHour = 15;
  const hourFromStart = Math.abs(sessionStartHour - preferredStartHour);
    const hourFromEnd = Math.abs(sessionEndHour - preferredEndHour);

    score = Math.max(0, 1 - (hourFromStart + hourFromEnd) / 10);

  return score;
  },
  (startTime: Date, endTime: Date, therapist: Therapist, client: Client) => 
    `availability_${startTime.toISOString()}_${endTime.toISOString()}_${therapist.id}_${client.id}`
);

// Additional optimized scoring functions
const calculateWorkloadScore = memoize(
  (therapist: Therapist, startTime: Date, existingSessions: Session[]): number => {
  const dayStart = startOfWeek(startTime);
  const dayEnd = endOfWeek(startTime);
  
    const weekSessions = existingSessions.filter(session => {
    const sessionStart = parseISO(session.start_time);
    return session.therapist_id === therapist.id &&
           isWithinInterval(sessionStart, { start: dayStart, end: dayEnd });
  });

    const totalMinutes = weekSessions.reduce((acc, session) => {
    const sessionStart = parseISO(session.start_time);
    const sessionEnd = parseISO(session.end_time);
    return acc + differenceInMinutes(sessionEnd, sessionStart);
  }, 0);

  const hoursWorked = totalMinutes / 60;
  const targetHours = (therapist.weekly_hours_min + therapist.weekly_hours_max) / 2;
  const hoursRemaining = targetHours - hoursWorked;

  if (hoursRemaining <= 0) return 0;
  if (hoursWorked >= CONSTRAINTS.MAX_DAILY_HOURS) return 0;

  return Math.min(hoursRemaining / targetHours, 1);
  },
  (therapist: Therapist, startTime: Date) => `workload_${therapist.id}_${startTime.toISOString()}`
);

const calculateTravelScore = memoize(
  (therapist: Therapist, client: Client, startTime: Date, existingSessions: Session[]): number => {
  const clientLocation = getLocationFromAddress(client);
    if (!clientLocation) return 0.5; // Neutral score if no location

    // Find the previous session for this therapist on the same day
    const sameDay = existingSessions
      .filter(session => 
        session.therapist_id === therapist.id && 
        isSameDay(parseISO(session.start_time), startTime)
      )
      .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());

    if (sameDay.length === 0) return 1; // First session of the day

    const _lastSession = sameDay[sameDay.length - 1];
    // In a real implementation, you'd get the location from the last session's client
    // For now, assume a base location
    const lastLocation = { latitude: 40.7128, longitude: -74.0060 };

    const { duration } = calculateTravelInfo(lastLocation, clientLocation, startTime);
    
    // Score based on travel time (less is better)
    return Math.max(0, 1 - duration / 60); // Normalize to 0-1
  },
  (therapist: Therapist, client: Client, startTime: Date) => 
    `travel_${therapist.id}_${client.id}_${startTime.toISOString()}`
);

// Simplified scoring functions for demo
const calculateContinuityScore = () => 0.5;
const calculateUrgencyScore = () => 0.5;
const calculateEfficiencyScore = () => 0.5;

// Optimized main scheduling function
export function generateOptimalSchedule(
  therapists: Therapist[],
  clients: Client[],
  existingSessions: Session[],
  startDate: Date,
  endDate: Date,
  sessionDuration = 60
): GenerateOptimalScheduleResult {
  const slots: ScheduleSlot[] = [];
  const weeklyAssignments = new Map<
    string,
    {
      therapistMinutes: Map<string, number>;
      clientMinutes: Map<string, number>;
    }
  >();
  const clientRemainingMinutes = new Map<string, number | null>();
  const cappedClientInfo = new Map<string, CappedClientInfo>();

  const markClientCapped = (client: Client, remainingMinutes: number) => {
    const safeMinutes = Math.max(0, remainingMinutes);
    const existing = cappedClientInfo.get(client.id);

    if (!existing || safeMinutes < existing.remainingMinutes) {
      cappedClientInfo.set(client.id, { client, remainingMinutes: safeMinutes });
    }
  };

  clients.forEach(client => {
    const capacity = normalizeClientHourCapacity(client);
    clientRemainingMinutes.set(client.id, capacity.remainingMinutes);

    if (capacity.remainingMinutes !== null && capacity.remainingMinutes < sessionDuration) {
      markClientCapped(client, capacity.remainingMinutes);
    }
  });

  // Pre-filter compatible therapist-client pairs
  const compatiblePairs = therapists.flatMap(therapist =>
    clients.map(client => ({
      therapist,
      client,
      baseScore: calculateCompatibilityScore(therapist, client)
    }))
  ).filter(pair => pair.baseScore > 0)
  .sort((a, b) => b.baseScore - a.baseScore);

  // Generate slots in batches for better performance
  let currentDate = new Date(startDate);
  while (currentDate <= endDate) {
    const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 });
    const weekEnd = endOfWeek(currentDate, { weekStartsOn: 1 });
    const weekKey = format(weekStart, 'yyyy-MM-dd');

    if (!weeklyAssignments.has(weekKey)) {
      weeklyAssignments.set(weekKey, {
        therapistMinutes: new Map<string, number>(),
        clientMinutes: new Map<string, number>()
      });
    }
    const weeklyAssignmentMap = weeklyAssignments.get(weekKey)!;

    let dayDate = new Date(weekStart);
    while (dayDate <= weekEnd && dayDate <= endDate) {
      const dayName = format(dayDate, 'EEEE').toLowerCase();

      if (dayName === 'sunday') {
        dayDate = addDays(dayDate, 1);
        continue;
      }

      // Process hours in batches
      for (let hour = 8; hour < 18; hour++) {
        for (const { therapist, client, baseScore } of compatiblePairs) {
          // Check weekly limits early
          const therapistWeeklyMinutes =
            weeklyAssignmentMap.therapistMinutes.get(therapist.id) || 0;
          const clientWeeklyMinutes = weeklyAssignmentMap.clientMinutes.get(client.id) || 0;

          const therapistWeeklyLimit = therapist.weekly_hours_max * MINUTES_PER_HOUR;
          if (therapistWeeklyMinutes + sessionDuration > therapistWeeklyLimit) {
            continue;
          }

          const remainingMinutes = clientRemainingMinutes.get(client.id);
          if (remainingMinutes !== undefined && remainingMinutes !== null && remainingMinutes < sessionDuration) {
            markClientCapped(client, remainingMinutes);
            continue;
          }

          const startTime = new Date(dayDate);
          startTime.setHours(hour, 0, 0, 0);
          const endTime = addMinutes(startTime, sessionDuration);

          // Calculate scores
          const availabilityScore = calculateAvailabilityScore(
            startTime, endTime, therapist, client, existingSessions
          );

          if (availabilityScore === 0) continue;

          const workloadScore = calculateWorkloadScore(therapist, startTime, existingSessions);
          const travelScore = calculateTravelScore(therapist, client, startTime, existingSessions);

          const finalScore =
            (baseScore * WEIGHTS.COMPATIBILITY) +
            (availabilityScore * WEIGHTS.AVAILABILITY) +
            (workloadScore * WEIGHTS.WORKLOAD) +
            (travelScore * WEIGHTS.TRAVEL_TIME) +
            (calculateContinuityScore() * WEIGHTS.CONTINUITY) +
            (calculateUrgencyScore() * WEIGHTS.URGENCY) +
            (calculateEfficiencyScore() * WEIGHTS.EFFICIENCY);

          if (finalScore > 0.3) { // Minimum threshold
            slots.push({
              therapist,
              client,
              startTime: startTime.toISOString(),
              endTime: endTime.toISOString(),
              score: finalScore,
              location: getLocationFromAddress(client)
            });

            // Update assignments
            weeklyAssignmentMap.therapistMinutes.set(
              therapist.id,
              therapistWeeklyMinutes + sessionDuration
            );
            weeklyAssignmentMap.clientMinutes.set(
              client.id,
              clientWeeklyMinutes + sessionDuration
            );

            if (remainingMinutes !== undefined && remainingMinutes !== null) {
              const updatedRemaining = Math.max(remainingMinutes - sessionDuration, 0);
              clientRemainingMinutes.set(client.id, updatedRemaining);

              if (updatedRemaining < sessionDuration) {
                markClientCapped(client, updatedRemaining);
              }
            }

            break; // Move to next hour
          }
        }
      }
      dayDate = addDays(dayDate, 1);
    }
    currentDate = addDays(currentDate, 7);
  }

  const limitedSlots = slots
    .sort((a, b) => b.score - a.score)
    .slice(0, 100);

  const cappedClients = Array.from(cappedClientInfo.values()).sort((a, b) => {
    const aName = a.client.full_name?.toLowerCase() || '';
    const bName = b.client.full_name?.toLowerCase() || '';
    if (aName === bName) {
      return a.client.id.localeCompare(b.client.id);
    }
    return aName.localeCompare(bName);
  });

  return {
    slots: limitedSlots,
    cappedClients
  };
}

// Additional helper functions
export function rescheduleSession(
  session: Session,
  conflictingSession: Session,
  availableSlots: ScheduleSlot[],
  existingSessions: Session[]
): ScheduleSlot | null {
  return availableSlots
    .filter(slot => {
    const slotStart = new Date(slot.startTime);
    const slotEnd = new Date(slot.endTime);
    
      return !existingSessions.some(existing => {
      if (existing.id === session.id) return false;
      const existingStart = new Date(existing.start_time);
      const existingEnd = new Date(existing.end_time);
      return isWithinInterval(slotStart, { start: existingStart, end: existingEnd }) ||
             isWithinInterval(slotEnd, { start: existingStart, end: existingEnd });
    });
    })
    .sort((a, b) => b.score - a.score)[0] || null;
}

export function validateSchedule(
  slots: ScheduleSlot[],
  constraints: typeof CONSTRAINTS
): { valid: boolean; violations: string[] } {
  const violations: string[] = [];
  const therapistDaySlots = new Map<string, Map<string, ScheduleSlot[]>>();
  
  slots.forEach(slot => {
    const day = format(new Date(slot.startTime), 'yyyy-MM-dd');
    if (!therapistDaySlots.has(slot.therapist.id)) {
      therapistDaySlots.set(slot.therapist.id, new Map());
    }
    const daySlots = therapistDaySlots.get(slot.therapist.id)!;
    if (!daySlots.has(day)) {
      daySlots.set(day, []);
    }
    daySlots.get(day)!.push(slot);
  });

  therapistDaySlots.forEach((daySlots, therapistId) => {
    daySlots.forEach((slots, day) => {
      slots.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

      const totalMinutes = slots.reduce((acc, slot) => {
        return acc + differenceInMinutes(new Date(slot.endTime), new Date(slot.startTime));
      }, 0);
      
      if (totalMinutes / 60 > constraints.MAX_DAILY_HOURS) {
        violations.push(`Therapist ${therapistId} exceeds maximum daily hours on ${day}`);
      }
    });
  });

  return {
    valid: violations.length === 0,
    violations
  };
}