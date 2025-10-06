// ENV REQUIREMENTS: set SUPABASE_URL, SUPABASE_ANON_KEY, and TEST_JWT_ORG_A (therapist-scoped JWT) before enabling RUN_THERAPIST_DOMAIN_TESTS.
import { expect, it } from 'vitest';
import { selectSuite } from '../utils/testControls';

const runTherapistSuite =
  process.env.RUN_THERAPIST_DOMAIN_TESTS === 'true' && Boolean(process.env.TEST_JWT_ORG_A);

const suite = selectSuite({
  run: runTherapistSuite,
  reason: 'Set RUN_THERAPIST_DOMAIN_TESTS=true and configure TEST_JWT_ORG_A credentials.',
});

suite('Therapist schedule and mutation expectations', () => {
  it('documents required headers for session confirmation', () => {
    const headers = {
      Authorization: 'Bearer <supabase-jwt>',
      'Idempotency-Key': 'uuid-v4',
      'Content-Type': 'application/json',
    } as const;

    expect(headers.Authorization.startsWith('Bearer ')).toBe(true);
    expect(headers['Idempotency-Key'].split('-').length).toBe(5);
  });

  it('tracks filter contract for optimized sessions', () => {
    const filterParams = {
      therapist_id: 'uuid',
      status: 'scheduled',
      start_date: '2025-01-01',
      end_date: '2025-01-31',
    } as const;

    expect(filterParams.start_date).toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(filterParams.end_date >= filterParams.start_date).toBe(true);
  });
});
