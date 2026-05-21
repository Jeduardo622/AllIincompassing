import { describe, expect, it } from 'vitest';

import { validateMessageBody } from '../mutations';

describe('validateMessageBody', () => {
  it('rejects empty messages', () => {
    expect(validateMessageBody('   ')).toBe('Message cannot be empty.');
  });

  it('accepts non-empty trimmed messages', () => {
    expect(validateMessageBody('  hello team  ')).toBeNull();
  });
});
