import { describe, expect, it } from 'vitest';
import { isPermissionDeniedError, toTherapistMutationError } from '../mutationErrorHandling';

describe('isPermissionDeniedError', () => {
  it('returns true for standard Postgres permission code', () => {
    expect(isPermissionDeniedError({ code: '42501', message: 'permission denied' })).toBe(true);
  });

  it('returns true for forbidden status errors', () => {
    expect(isPermissionDeniedError({ status: 403, message: 'forbidden' })).toBe(true);
  });

  it('returns false for unrelated errors', () => {
    expect(isPermissionDeniedError(new Error('network unavailable'))).toBe(false);
  });
});

describe('toTherapistMutationError', () => {
  it('normalizes permission errors to actionable copy', () => {
    const normalized = toTherapistMutationError({ code: '42501', message: 'permission denied' });
    expect(normalized.message).toContain('Access denied while creating the therapist');
  });

  it('normalizes timeout errors', () => {
    const normalized = toTherapistMutationError(new Error('Timeout: creating therapist'));
    expect(normalized.message).toBe('Therapist creation timed out. Please retry.');
  });
});
