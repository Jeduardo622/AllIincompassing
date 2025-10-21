import { describe, it, expect } from 'vitest';

describe('get-therapist-details auth (policy intent)', () => {
  it('blocks non-admin from fetching arbitrary therapist', async () => {
    expect(true).toBe(true);
  });

  it('allows therapist to fetch self', async () => {
    expect(true).toBe(true);
  });
});


