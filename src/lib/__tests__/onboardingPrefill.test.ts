import { describe, expect, it } from 'vitest';

import { parseClientOnboardingPrefill } from '../onboardingPrefill';

describe('parseClientOnboardingPrefill', () => {
  it('preserves plus aliases in email values', () => {
    const parsed = parseClientOnboardingPrefill('?email=john%2Bfilter@example.com');
    expect(parsed.email).toBe('john+filter@example.com');
  });
});
