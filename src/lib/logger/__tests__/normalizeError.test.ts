import { describe, expect, it } from 'vitest';
import { toError } from '../normalizeError';

describe('toError', () => {
  it('returns the original Error instance', () => {
    const err = new Error('boom');
    expect(toError(err)).toBe(err);
  });

  it('extracts string messages', () => {
    const result = toError('  simple message  ');
    expect(result).toBeInstanceOf(Error);
    expect(result.message).toBe('simple message');
  });

  it('extracts details from Supabase style objects', () => {
    const result = toError({
      message: 'Row level policy denied',
      code: '42501',
    });

    expect(result.message).toBe('Row level policy denied');
    expect(result.name).toBe('SupabaseError:42501');
  });

  it('falls back to error_description when message is missing', () => {
    const result = toError({
      error_description: 'Token expired',
    });

    expect(result.message).toBe('Token expired');
  });

  it('returns fallback error when nothing matches', () => {
    const result = toError(123, 'Fallback');
    expect(result.message).toBe('Fallback');
  });
});

