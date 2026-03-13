import { describe, expect, it } from 'vitest';

import { parseClientOnboardingPrefill, parseTherapistOnboardingPrefill } from '../onboardingPrefill';

describe('parseClientOnboardingPrefill', () => {
  it('defaults to token-only mode and ignores plaintext query fields', () => {
    const parsed = parseClientOnboardingPrefill('?email=john%2Bfilter@example.com&first_name=John');
    expect(parsed).toEqual({
      email: '',
      firstName: '',
      lastName: '',
      dateOfBirth: '',
      servicePreference: [],
      insuranceProvider: '',
      referralSource: '',
    });
  });

  it('preserves plus aliases in email values', () => {
    const parsed = parseClientOnboardingPrefill('?email=john%2Bfilter@example.com', {
      allowLegacyQueryPrefill: true,
    });
    expect(parsed.email).toBe('john+filter@example.com');
  });

  it('filters malformed date and unknown service preferences', () => {
    const parsed = parseClientOnboardingPrefill(
      '?date_of_birth=not-a-date&service_preference=In%20home,Unknown,Telehealth',
      { allowLegacyQueryPrefill: true },
    );
    expect(parsed.dateOfBirth).toBe('');
    expect(parsed.servicePreference).toEqual(['In home', 'Telehealth']);
  });
});

describe('parseTherapistOnboardingPrefill', () => {
  it('filters unsupported therapist prefill enum values', () => {
    const parsed = parseTherapistOnboardingPrefill(
      '?service_type=In%20home,Unknown&specialties=ABA%20Therapy,Nope&title=BCBA<script>',
    );

    expect(parsed.serviceType).toEqual(['In home']);
    expect(parsed.specialties).toEqual(['ABA Therapy']);
    expect(parsed.title).toBe('BCBAscript');
  });
});
