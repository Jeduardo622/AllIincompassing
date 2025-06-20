// Scheduling constraints and configuration
export const CONSTRAINTS = {
  // Time constraints
  MIN_BREAK_MINUTES: 30,
  MAX_DAILY_HOURS: 8,
  MAX_CONSECUTIVE_SESSIONS: 4,
  MIN_REST_BETWEEN_AREAS: 45,
  MAX_DAILY_TRAVEL_TIME: 180,

  // Location constraints
  SERVICE_AREA_RADIUS: 25,
  MAX_DISTANCE_KM: 50,

  // Traffic patterns
  RUSH_HOUR_MULTIPLIER: 1.5,
  RUSH_HOURS: {
    MORNING: { start: 7, end: 9 },
    EVENING: { start: 16, end: 18 }
  },

  // Service preferences
  MIN_HOURS_PER_CLIENT: 2,
  MAX_CLIENTS_PER_THERAPIST: 10,
  
  // Optimization weights
  WEIGHTS: {
    COMPATIBILITY: 0.25,
    AVAILABILITY: 0.20,
    TRAVEL_TIME: 0.15,
    WORKLOAD: 0.10,
    CLIENT_PREFERENCE: 0.10,
    CONTINUITY: 0.10,
    EFFICIENCY: 0.05,
    URGENCY: 0.05
  }
};

// Traffic patterns by hour (24-hour format)
export const TRAFFIC_PATTERNS: Record<number, number> = {
  7: 1.5,  // Morning rush hour
  8: 1.5,
  9: 1.2,
  16: 1.5, // Evening rush hour
  17: 1.5,
  18: 1.3,
};

// Service area definitions
export const SERVICE_AREAS = {
  'Irvine': {
    center: { latitude: 33.6846, longitude: -117.7857 },
    radiusKm: 15
  },
  'Santa Ana': {
    center: { latitude: 33.7455, longitude: -117.8677 },
    radiusKm: 12
  },
  'Tustin': {
    center: { latitude: 33.7458, longitude: -117.8227 },
    radiusKm: 10
  },
  'Orange': {
    center: { latitude: 33.7879, longitude: -117.8531 },
    radiusKm: 10
  }
};
