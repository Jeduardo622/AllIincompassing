import { describe, expect, it } from 'vitest';

import { buildReplayHeaders, parseReplaySeed } from '../agentReplay';

describe('agent replay helpers', () => {
  it('parses replay seed values', () => {
    expect(parseReplaySeed('42')).toBe(42);
    expect(parseReplaySeed('-1')).toBeUndefined();
    expect(parseReplaySeed('abc')).toBeUndefined();
  });

  it('builds replay headers', () => {
    const headers = buildReplayHeaders('corr-1', 'req-1');
    expect(headers).toEqual({
      'x-correlation-id': 'corr-1',
      'x-request-id': 'req-1',
    });
  });
});
