import { describe, expect, it } from 'vitest';
import { prepareFormData } from '../validation';

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

