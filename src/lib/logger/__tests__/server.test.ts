import { afterEach, describe, expect, it, vi } from 'vitest';
import { serverLogger } from '../server';

describe('serverLogger', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('redacts PHI/PII from message metadata', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    serverLogger.error('Login failed for test@example.com', {
      email: 'test@example.com',
      phone: '(555) 123-4567',
      context: 'user workflow',
    });

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [, loggedMessage, loggedMetadata] = errorSpy.mock.calls[0] ?? [];

    expect(String(loggedMessage)).not.toContain('test@example.com');
    expect(JSON.stringify(loggedMetadata)).not.toContain('test@example.com');
    expect(JSON.stringify(loggedMetadata)).not.toContain('(555) 123-4567');
    expect(JSON.stringify(loggedMetadata)).toContain('****');
  });
});
