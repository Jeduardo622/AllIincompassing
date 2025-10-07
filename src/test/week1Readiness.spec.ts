import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/errorTracking', () => ({
  errorTracker: {
    trackError: vi.fn(),
  },
}));

import { logger } from '../lib/logger/logger';
import { errorTracker } from '../lib/errorTracking';
import { REDACTED_VALUE } from '../lib/logger/redactPhi';

describe('week-1 remediation verification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('enables client domain verification suites by default', () => {
    expect(process.env.RUN_CLIENT_DOMAIN_TESTS).toBe('true');
    expect(process.env.TEST_JWT_ORG_A).toBe('test-org-a-jwt-placeholder');
  });

  it('redacts telemetry payloads for domain verification errors', () => {
    const trackErrorSpy = vi.mocked(errorTracker.trackError);
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      logger.error('Client client@example.com failed domain verification', {
        context: {
          component: 'DomainVerifier',
          payload: {
            clientEmail: 'client@example.com',
            guardianName: 'Guardian Doe',
          },
        },
        metadata: {
          guardianName: 'Guardian Doe',
          failureReason: 'Email domain mismatch for client@example.com',
        },
        error: new Error('Domain verification rejected client@example.com for Guardian Doe'),
      });

      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      const [message, metadata] = consoleErrorSpy.mock.calls[0];
      expect(String(message)).not.toContain('client@example.com');
      expect(metadata).toEqual({
        guardianName: REDACTED_VALUE,
        failureReason: expect.stringContaining(REDACTED_VALUE),
      });

      expect(trackErrorSpy).toHaveBeenCalledTimes(1);
      const [trackedError, context] = trackErrorSpy.mock.calls[0];
      expect(trackedError).toBeInstanceOf(Error);
      expect(trackedError.message).not.toContain('client@example.com');
      expect(trackedError.message).toContain(REDACTED_VALUE);

      const serializedContext = JSON.stringify(context);
      expect(serializedContext).not.toContain('client@example.com');
      expect(serializedContext).not.toContain('Guardian Doe');
      expect(serializedContext).toContain(REDACTED_VALUE);

      expect(context).toMatchObject({
        component: 'DomainVerifier',
        payload: {
          clientEmail: REDACTED_VALUE,
          guardianName: REDACTED_VALUE,
        },
        metadata: {
          guardianName: REDACTED_VALUE,
          failureReason: expect.stringContaining(REDACTED_VALUE),
        },
      });
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});
