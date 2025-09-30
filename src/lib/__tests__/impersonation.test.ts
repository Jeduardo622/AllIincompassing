import { describe, it, expect } from 'vitest';
import {
  buildImpersonationIssuePayload,
  clampImpersonationMinutes,
  DEFAULT_IMPERSONATION_MINUTES,
  getExpiryCountdownLabel,
  shouldAutoRevoke,
  validateImpersonationScope,
} from '../impersonation';

describe('impersonation helpers', () => {
  it('validates organization scope and throws for mismatches', () => {
    expect(() => validateImpersonationScope('org-1', 'org-1')).not.toThrow();
    expect(() => validateImpersonationScope(null, 'org-1')).toThrow(/Actor organization is required/i);
    expect(() => validateImpersonationScope('org-1', null)).toThrow(/Target organization is required/i);
    expect(() => validateImpersonationScope('org-1', 'org-2')).toThrow(/Cross-organization impersonation/i);
  });

  it('clamps impersonation minutes to configured bounds', () => {
    expect(clampImpersonationMinutes(undefined)).toBe(DEFAULT_IMPERSONATION_MINUTES);
    expect(clampImpersonationMinutes(0)).toBe(1);
    expect(clampImpersonationMinutes(45)).toBe(30);
    expect(clampImpersonationMinutes(10.6)).toBe(11);
  });

  it('builds an impersonation payload with a sanitized reason', () => {
    const fixedNow = new Date('2025-06-01T12:00:00Z');
    const { body, expiresAt, expiresInMinutes } = buildImpersonationIssuePayload({
      actorOrganizationId: 'org-1234',
      targetOrganizationId: 'org-1234',
      targetUserId: 'user-9999',
      requestedMinutes: 9,
      reason: '  Investigating access issue  ',
      now: fixedNow,
    });

    expect(body).toEqual({
      action: 'issue',
      targetUserId: 'user-9999',
      targetUserEmail: undefined,
      expiresInMinutes: 9,
      reason: 'Investigating access issue',
    });
    expect(expiresInMinutes).toBe(9);
    expect(expiresAt).toBe('2025-06-01T12:09:00.000Z');
  });

  it('calculates countdown labels and automatic revocation', () => {
    const now = new Date('2025-06-01T12:00:00Z');
    const future = '2025-06-01T12:05:30.000Z';
    expect(getExpiryCountdownLabel(future, now)).toBe('05:30');

    const past = '2025-06-01T11:59:00.000Z';
    expect(shouldAutoRevoke(past, null, now)).toBe(true);
    expect(shouldAutoRevoke(future, null, now)).toBe(false);
    expect(shouldAutoRevoke(future, '2025-06-01T12:01:00.000Z', now)).toBe(false);
  });
});
