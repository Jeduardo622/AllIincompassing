import { describe, expect, it } from 'vitest';
import { prepareFormData, sanitizeString } from '../validation';

describe('prepareFormData', () => {
  it('parses insurance_info JSON strings into objects', () => {
    const result = prepareFormData({
      insurance_info: '{"provider":"Acme","memberId":"123"}',
    });

    expect(result.insurance_info).toEqual({ provider: 'Acme', memberId: '123' });
  });

  it('sets empty insurance_info strings to null', () => {
    const result = prepareFormData({
      insurance_info: '   ',
    });

    expect(result.insurance_info).toBeNull();
  });
});

describe('sanitizeString', () => {
  it('removes script tags and event handlers', () => {
    const input = '<img src=x onerror=alert(1)><script>alert(2)</script>hello';
    const result = sanitizeString(input);

    expect(result).toBe('hello');
    expect(result).not.toMatch(/script|onerror|alert/i);
  });

  it('trims whitespace and keeps plain text', () => {
    const result = sanitizeString('   Safe text   ');
    expect(result).toBe('Safe text');
  });
});

