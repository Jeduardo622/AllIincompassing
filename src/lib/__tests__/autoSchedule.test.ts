import { afterEach, describe, expect, it } from 'vitest';
import {
  generateOptimalSchedule,
  normalizeClientHourCapacity,
  clearScheduleCache,
} from '../autoSchedule';
import { configureGeocoding, resetGeocodingConfig } from '../geocoding';
import type { Therapist, Client, Session } from '../../types';

const createTherapist = (overrides: Partial<Therapist> = {}): Therapist => ({
  id: 'therapist-1',
  email: 'therapist@example.com',
  full_name: 'Therapist Example',
  specialties: [],
  max_clients: 10,
  service_type: ['ABA'],
  weekly_hours_min: 0,
  weekly_hours_max: 40,
  availability_hours: {
    monday: { start: '08:00', end: '17:00' },
    tuesday: { start: '08:00', end: '17:00' },
    wednesday: { start: '08:00', end: '17:00' },
    thursday: { start: '08:00', end: '17:00' },
    friday: { start: '08:00', end: '17:00' },
    saturday: { start: null, end: null },
    sunday: { start: null, end: null }
  },
  created_at: new Date('2024-01-01T00:00:00Z').toISOString(),
  ...overrides
});

const createClient = (overrides: Partial<Client> = {}): Client => ({
  id: 'client-1',
  email: 'client@example.com',
  full_name: 'Client Example',
  date_of_birth: '2015-01-01',
  insurance_info: {},
  service_preference: ['ABA'],
  one_to_one_units: 0,
  supervision_units: 0,
  parent_consult_units: 0,
  assessment_units: 0,
  availability_hours: {
    monday: { start: '08:00', end: '17:00' },
    tuesday: { start: '08:00', end: '17:00' },
    wednesday: { start: '08:00', end: '17:00' },
    thursday: { start: '08:00', end: '17:00' },
    friday: { start: '08:00', end: '17:00' },
    saturday: { start: null, end: null },
    sunday: { start: null, end: null }
  },
  created_at: new Date('2024-01-01T00:00:00Z').toISOString(),
  ...overrides
});

describe('normalizeClientHourCapacity', () => {
  it('uses the smaller of remaining authorized and unscheduled hours', () => {
    const client = createClient({
      authorized_hours_per_month: 20,
      hours_provided_per_month: 5,
      unscheduled_hours: 3
    });

    const capacity = normalizeClientHourCapacity(client);
    expect(capacity.remainingHours).toBe(3);
    expect(capacity.remainingMinutes).toBe(180);
  });

  it('falls back to unscheduled hours when no authorization exists', () => {
    const client = createClient({
      authorized_hours_per_month: undefined,
      hours_provided_per_month: undefined,
      unscheduled_hours: 4
    });

    const capacity = normalizeClientHourCapacity(client);
    expect(capacity.remainingHours).toBe(4);
    expect(capacity.authorizedHours).toBeNull();
  });
});

describe('generateOptimalSchedule', () => {
  const baseTherapist = createTherapist();
  const schedulingWindow = {
    start: new Date('2024-06-03T00:00:00Z'),
    end: new Date('2024-06-07T23:59:59Z')
  };
  const sessions: Session[] = [];

  afterEach(() => {
    clearScheduleCache();
    resetGeocodingConfig();
  });

  it('skips clients who have no remaining hours for a full session', () => {
    const cappedClient = createClient({
      id: 'client-capped',
      full_name: 'Capped Client',
      email: 'capped@example.com',
      authorized_hours_per_month: 10,
      hours_provided_per_month: 10,
      unscheduled_hours: 0
    });

    const result = generateOptimalSchedule(
      [baseTherapist],
      [cappedClient],
      sessions,
      schedulingWindow.start,
      schedulingWindow.end
    );

    expect(result.slots).toHaveLength(0);
    expect(result.cappedClients.map(info => info.client.id)).toContain('client-capped');
  });

  it('avoids scheduling clients with insufficient fractional availability', () => {
    const fractionalClient = createClient({
      id: 'client-fractional',
      full_name: 'Fractional Client',
      email: 'fractional@example.com',
      authorized_hours_per_month: 1,
      hours_provided_per_month: 0.75
    });

    const result = generateOptimalSchedule(
      [baseTherapist],
      [fractionalClient],
      sessions,
      schedulingWindow.start,
      schedulingWindow.end
    );

    expect(result.slots).toHaveLength(0);
    expect(result.cappedClients.map(info => info.client.id)).toContain('client-fractional');
  });

  it('prioritizes eligible clients while omitting capped ones', () => {
    const cappedClient = createClient({
      id: 'client-capped',
      full_name: 'Capped Client',
      email: 'capped@example.com',
      authorized_hours_per_month: 8,
      hours_provided_per_month: 8
    });

    const eligibleClient = createClient({
      id: 'client-open',
      full_name: 'Open Client',
      email: 'open@example.com',
      authorized_hours_per_month: 12,
      hours_provided_per_month: 6
    });

    const result = generateOptimalSchedule(
      [baseTherapist],
      [cappedClient, eligibleClient],
      sessions,
      schedulingWindow.start,
      schedulingWindow.end
    );

    const scheduledClientIds = result.slots.map(slot => slot.client.id);
    expect(scheduledClientIds).toContain('client-open');
    expect(scheduledClientIds).not.toContain('client-capped');
    expect(result.cappedClients.map(info => info.client.id)).toContain('client-capped');
  });

  it('produces consistent travel scoring for repeated runs with the same input', () => {
    const therapist = createTherapist({ id: 'therapist-travel' });
    const client = createClient({
      id: 'client-travel',
      address: '1600 Pennsylvania Avenue NW, Washington, DC 20500',
    });

    const first = generateOptimalSchedule(
      [therapist],
      [client],
      sessions,
      schedulingWindow.start,
      schedulingWindow.end
    );

    clearScheduleCache();

    const second = generateOptimalSchedule(
      [therapist],
      [client],
      sessions,
      schedulingWindow.start,
      schedulingWindow.end
    );

    expect(first.slots[0]?.location).toEqual(second.slots[0]?.location);
    expect(second.slots[0]?.score).toBeCloseTo(first.slots[0]?.score ?? 0, 6);
  });

  it('supports injecting a custom geocoding provider for deterministic tests', () => {
    configureGeocoding({
      provider: () => ({ latitude: 35.123456, longitude: -120.654321 }),
    });

    const client = createClient({
      id: 'client-custom-geo',
      address: '742 Evergreen Terrace, Springfield',
    });

    const result = generateOptimalSchedule(
      [baseTherapist],
      [client],
      sessions,
      schedulingWindow.start,
      schedulingWindow.end
    );

    expect(result.slots[0]?.location).toMatchObject({
      latitude: 35.123456,
      longitude: -120.654321,
    });
  });
});
