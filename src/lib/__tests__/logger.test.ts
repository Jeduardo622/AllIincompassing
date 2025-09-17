import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../errorTracking', () => ({
  errorTracker: {
    trackError: vi.fn()
  }
}));

import { logger } from '../logger/logger';
import { redactPhi, REDACTED_VALUE } from '../logger/redactPhi';
import { errorTracker } from '../errorTracking';

describe('redactPhi', () => {
  it('redacts nested PHI in structured objects', () => {
    const input = {
      first_name: 'Jane',
      last_name: 'Doe',
      contact: {
        email: 'jane.doe@example.com',
        phone: '(555) 123-4567',
        conversation_id: 'chat-789',
        guardian_name: 'Mary Doe'
      },
      notes: ['DOB: 2001-04-05', 'Diagnosis: Autism Spectrum Disorder']
    };

    const sanitized = redactPhi(input);

    expect(sanitized.first_name).toBe(REDACTED_VALUE);
    expect((sanitized.contact as Record<string, unknown>).email).toBe(REDACTED_VALUE);
    expect((sanitized.contact as Record<string, unknown>).conversation_id).toBe(REDACTED_VALUE);
    expect(Array.isArray(sanitized.notes)).toBe(true);
    expect((sanitized.notes as string[])[0]).toContain(REDACTED_VALUE);
    expect((sanitized.notes as string[])[1]).toContain(REDACTED_VALUE);

    expect(input.first_name).toBe('Jane');
    expect(input.contact.email).toBe('jane.doe@example.com');
  });

  it('redacts sensitive values in freeform strings', () => {
    const message = 'Patient Name: John Doe, Email: john@example.com, Phone: 555-987-6543, conversation_id=abc123, DOB 01/01/1990';

    const sanitized = redactPhi(message);

    expect(typeof sanitized).toBe('string');
    const sanitizedString = sanitized as string;
    expect(sanitizedString).not.toContain('John Doe');
    expect(sanitizedString).not.toContain('john@example.com');
    const replacementCount = sanitizedString.split(REDACTED_VALUE).length - 1;
    expect(replacementCount).toBeGreaterThanOrEqual(4);
  });
});

describe('logger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sanitizes metadata before logging info', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    try {
      logger.info('Client Name: Jane Doe', {
        metadata: { email: 'jane.doe@example.com', phone: '555-123-4567' }
      });

      expect(infoSpy).toHaveBeenCalledTimes(1);
      const [message, metadata] = infoSpy.mock.calls[0];
      expect(String(message)).toContain(REDACTED_VALUE);
      expect(metadata).toEqual({ email: REDACTED_VALUE, phone: REDACTED_VALUE });
    } finally {
      infoSpy.mockRestore();
    }
  });

  it('forwards sanitized errors to the error tracker', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const trackErrorSpy = vi.mocked(errorTracker.trackError);

    const originalError = new Error('Client email john@example.com failed validation');

    try {
      logger.error('Failed to create client', {
        error: originalError,
        metadata: { conversationId: 'conv-123' }
      });

      expect(errorSpy).toHaveBeenCalledTimes(1);
      const [, metadata] = errorSpy.mock.calls[0];
      expect(metadata).toEqual({ conversationId: REDACTED_VALUE });

      expect(trackErrorSpy).toHaveBeenCalledTimes(1);
      const [trackedError, context] = trackErrorSpy.mock.calls[0];
      expect(trackedError).toBeInstanceOf(Error);
      expect(trackedError.message).toContain(REDACTED_VALUE);
      expect(trackedError.message).not.toContain('john@example.com');
      expect(context).toEqual({ metadata: { conversationId: REDACTED_VALUE } });
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('respects the track=false option', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const trackErrorSpy = vi.mocked(errorTracker.trackError);

    try {
      logger.error('Handled client onboarding warning', {
        metadata: { step: 'validation' },
        track: false
      });

      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(trackErrorSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });
});
