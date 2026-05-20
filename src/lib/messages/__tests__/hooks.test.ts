import { describe, expect, it } from 'vitest';
import { buildParticipantIdsForCreate, canCreateGroupThread } from '../hooks';

describe('staff messaging hooks helpers', () => {
  it('allows group thread creation for admins only', () => {
    expect(canCreateGroupThread('admin')).toBe(true);
    expect(canCreateGroupThread('super_admin')).toBe(true);
    expect(canCreateGroupThread('therapist')).toBe(false);
  });

  it('builds participant ids including creator for direct threads', () => {
    const ids = buildParticipantIdsForCreate('creator-id', ['other-id'], 'direct');
    expect(ids).toEqual(expect.arrayContaining(['creator-id', 'other-id']));
    expect(ids).toHaveLength(2);
  });

  it('rejects direct threads without exactly one other participant', () => {
    expect(() => buildParticipantIdsForCreate('creator-id', [], 'direct')).toThrow(/exactly one other/i);
  });
});
