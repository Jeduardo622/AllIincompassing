import { differenceInMinutes, parseISO } from 'date-fns';
import { getDistance } from 'geolib';
import type { Therapist, Client, Session } from '../../types';
import { CONSTRAINTS, TRAFFIC_PATTERNS } from './constraints';

export function calculateCompatibilityScore(therapist: Therapist, client: Client): number {
  let score = 0;

  // Service type match
  const matchingServices = therapist.service_type.filter(service =>
    client.service_preference.includes(service)
  );
  score += (matchingServices.length / Math.max(therapist.service_type.length, client.service_preference.length)) * 0.4;

  // Specialty match
  const relevantSpecialties = therapist.specialties.filter(specialty =>
    client.service_preference.includes(specialty)
  );
  score += (relevantSpecialties.length > 0 ? 0.3 : 0);

  // Location preferences
  const locationMatch = therapist.service_type.some(type => {
    if (type === 'In clinic' && client.in_clinic) return true;
    if (type === 'In home' && client.in_home) return true;
    if (type === 'In school' && client.in_school) return true;
    return false;
  });
  score += (locationMatch ? 0.3 : 0);

  // Geographic compatibility
  if (therapist.latitude && therapist.longitude && client.latitude && client.longitude) {
    const distance = getDistance(
      { latitude: therapist.latitude, longitude: therapist.longitude },
      { latitude: client.latitude, longitude: client.longitude }
    ) / 1000; // Convert to km
    
    const maxDistance = Math.min(
      therapist.service_radius_km || CONSTRAINTS.SERVICE_AREA_RADIUS,
      client.preferred_radius_km || CONSTRAINTS.SERVICE_AREA_RADIUS
    );
    
    if (distance <= maxDistance) {
      score += 0.2 * (1 - distance / maxDistance);
    }
  }

  return score;
}

export function calculateContinuityScore(
  therapist: Therapist,
  client: Client,
  existingSessions: Session[]
): number {
  const previousSessions = existingSessions.filter(
    session => session.therapist_id === therapist.id && session.client_id === client.id
  );

  if (previousSessions.length === 0) return 0.5;

  const completedSessions = previousSessions.filter(
    session => session.status === 'completed'
  );
  const successRate = completedSessions.length / previousSessions.length;

  // Consider session notes quality
  const notesQuality = previousSessions.reduce((sum, session) => {
    return sum + (session.notes ? 1 : 0);
  }, 0) / previousSessions.length;

  return (successRate * 0.7) + (notesQuality * 0.3);
}

export function calculateUrgencyScore(
  client: Client,
  existingSessions: Session[]
): number {
  const authorizedHours = client.authorized_hours_per_month;
  const usedHours = client.hours_provided_per_month;
  const remainingHours = authorizedHours - usedHours;
  
  if (remainingHours <= 0) return 0;
  
  const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
  const daysRemaining = daysInMonth - new Date().getDate();
  
  // Calculate daily hours needed
  const requiredDailyHours = remainingHours / daysRemaining;
  
  // Higher score for clients who need more hours
  return Math.min(requiredDailyHours / 2, 1);
}

export function calculateEfficiencyScore(
  location: { latitude: number; longitude: number },
  existingLocations: { latitude: number; longitude: number }[]
): number {
  if (existingLocations.length === 0) return 1;

  // Find minimum distance to any existing location
  const distances = existingLocations.map(loc =>
    getDistance(location, loc) / 1000 // Convert to km
  );
  
  const minDistance = Math.min(...distances);
  
  // Score based on proximity (closer is better)
  return Math.max(0, 1 - (minDistance / CONSTRAINTS.SERVICE_AREA_RADIUS));
}

export function calculateTravelScore(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
  time: Date
): number {
  const distance = getDistance(from, to) / 1000; // Convert to km
  const hour = time.getHours();
  const trafficMultiplier = TRAFFIC_PATTERNS[hour] || 1;
  
  // Base travel time (assuming average speed of 30 km/h)
  const travelTimeMinutes = (distance / 30) * 60 * trafficMultiplier;
  
  // Score based on travel time (lower is better)
  return Math.max(0, 1 - (travelTimeMinutes / CONSTRAINTS.MAX_DAILY_TRAVEL_TIME));
}
