import { describe, expect, it } from 'vitest';
import { normalizeClientId, parseAvailabilityCell } from '../importClientAvailability';

describe('normalizeClientId', () => {
  it('builds IDs from first and last names', () => {
    expect(normalizeClientId('Abigail', 'Peredo Arias')).toBe('ABPEAR');
    expect(normalizeClientId('John', 'Doe')).toBe('JODO');
  });

  it('returns null when inputs are missing', () => {
    expect(normalizeClientId(null, 'Doe')).toBeNull();
    expect(normalizeClientId('John', null)).toBeNull();
  });
});

describe('parseAvailabilityCell', () => {
  it('parses explicit ranges with meridiem', () => {
    expect(parseAvailabilityCell('3-6pm')).toMatchObject({ start: '15:00', end: '18:00' });
    expect(parseAvailabilityCell('3:30-6:30pm')).toMatchObject({ start: '15:30', end: '18:30' });
  });

  it('interprets open availability', () => {
    expect(parseAvailabilityCell('open')).toMatchObject({ start: '06:00', end: '21:00' });
  });

  it('interprets after and before windows', () => {
    expect(parseAvailabilityCell('after 2pm')).toMatchObject({ start: '14:00', end: '21:00' });
    expect(parseAvailabilityCell('before 1:30pm')).toMatchObject({ start: '06:00', end: '13:30' });
  });

  it('returns null for non-availability markers', () => {
    expect(parseAvailabilityCell('n/a')).toBeNull();
    expect(parseAvailabilityCell('no intake')).toBeNull();
  });
});
