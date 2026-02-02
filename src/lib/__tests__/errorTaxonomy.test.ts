import { describe, expect, it } from 'vitest';

import { getErrorClassification, isRetryableStatus } from '../errorTaxonomy';

describe('error taxonomy', () => {
  it('returns classification for known codes', () => {
    const classification = getErrorClassification('rate_limited');
    expect(classification.retryable).toBe(true);
    expect(classification.httpStatus).toBe(429);
  });

  it('falls back to internal_error for unknown codes', () => {
    const classification = getErrorClassification('unknown_code');
    expect(classification.httpStatus).toBe(500);
    expect(classification.retryable).toBe(false);
  });

  it('flags retryable status codes', () => {
    expect(isRetryableStatus(503)).toBe(true);
    expect(isRetryableStatus(400)).toBe(false);
  });
});
