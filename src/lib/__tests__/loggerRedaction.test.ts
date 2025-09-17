import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../errorTracking', () => ({
  errorTracker: {
    trackError: vi.fn()
  }
}));

import { logger } from '../logger/logger';
import { REDACTED_VALUE } from '../logger/redactPhi';
import { getConsoleGuard } from '../../test/utils/consoleGuard';
import { errorTracker } from '../errorTracking';

const guard = getConsoleGuard();

describe('logger redaction with console guard', () => {
  beforeEach(() => {
    guard.resetCapturedLogs();
    vi.clearAllMocks();
  });

  it('masks PHI tokens in both message and metadata when using the safe logger', () => {
    logger.info(
      'Creating session for jane.doe@example.com with MRN: MRN-778899 and diagnosis: F84.0 at 555-987-6543',
      {
        metadata: {
          email: 'jane.doe@example.com',
          phone_number: '(555) 987-6543',
          mrn: 'MRN-778899',
          diagnosis: 'F84.0',
          guardian: {
            contact_email: 'guardian@example.com',
            mobile: '+1 (555) 222-3333'
          }
        }
      }
    );

    const captured = guard.getCapturedLogs('info');
    expect(captured).toHaveLength(1);
    const combined = captured[0];

    expect(combined).toContain(REDACTED_VALUE);
    expect(combined).not.toMatch(/jane\.doe@example\.com/i);
    expect(combined).not.toMatch(/guardian@example\.com/i);
    expect(combined).not.toMatch(/MRN-778899/i);
    expect(combined).not.toMatch(/555-987-6543/);
    expect(combined).not.toMatch(/\bF84\.0\b/);
    expect(combined).toContain('"email": "****"');
    expect(combined).toContain('"mrn": "****"');
    expect(combined).toContain('"phone_number": "****"');
  });

  it('sanitizes error payloads before forwarding them to the console and tracker', () => {
    const sensitiveError = new Error('Encountered MRN: 445566 with email leak@example.com');

    logger.error('Failed to process leak@example.com for MRN: 445566', {
      error: sensitiveError,
      metadata: {
        email_address: 'leak@example.com',
        phone: '415-555-9999',
        diagnosis: 'F90.2'
      }
    });

    const captured = guard.getCapturedLogs('error');
    expect(captured).toHaveLength(1);
    const combined = captured[0];

    expect(combined).not.toMatch(/leak@example\.com/);
    expect(combined).not.toMatch(/445566/);
    expect(combined).not.toMatch(/415-555-9999/);
    expect(combined).not.toMatch(/\bF90\.2\b/);
    expect(combined).toContain(REDACTED_VALUE);

    const trackErrorSpy = vi.mocked(errorTracker.trackError);
    expect(trackErrorSpy).toHaveBeenCalledTimes(1);
    const [trackedError, context] = trackErrorSpy.mock.calls[0];
    expect(trackedError).toBeInstanceOf(Error);
    expect((trackedError as Error).message).not.toContain('leak@example.com');
    expect((trackedError as Error).message).toContain(REDACTED_VALUE);
    expect(JSON.stringify(context)).not.toContain('415-555-9999');
  });

  it('throws when console output contains unredacted PHI', () => {
    expect(() => console.warn('Reach client at 212-555-0101 or jane.raw@example.com')).toThrowError(
      /ConsoleGuard detected potential/,
    );
    expect(guard.getCapturedLogs()).toHaveLength(0);
  });
});
