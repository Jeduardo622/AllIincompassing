import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REDACTED_VALUE } from '../logger/redactPhi';

const rpcMock = vi.fn<
  Promise<{ data: unknown; error: null }>,
  [string, Record<string, unknown> | undefined]
>();

vi.mock('../supabase', () => ({
  supabase: {
    rpc: rpcMock
  }
}));

const loggerMock = {
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn()
};

vi.mock('../logger/logger', () => ({
  logger: loggerMock
}));

const setNavigatorProperty = (key: keyof Navigator, value: unknown) => {
  Object.defineProperty(window.navigator, key, {
    configurable: true,
    get: () => value
  });
};

const loadTracker = async () => {
  const module = await import('../errorTracking');
  module.errorTracker.clearErrorData();
  return module.errorTracker;
};

beforeEach(() => {
  rpcMock.mockReset();
  rpcMock.mockResolvedValue({ data: null, error: null });
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    value: true
  });
  setNavigatorProperty('userAgent', 'test-agent patient@example.com');
  localStorage.clear();
  vi.clearAllMocks();
});

afterEach(async () => {
  const module = await import('../errorTracking');
  module.errorTracker.clearErrorData();
});

afterAll(async () => {
  const module = await import('../errorTracking');
  module.errorTracker.destroy();
});

describe('ErrorTracker PHI redaction', () => {
  it('redacts sensitive data before enqueuing general errors', async () => {
    const tracker = await loadTracker();
    const error = new Error('Patient email patient@example.com');
    error.stack = 'at handler (patient@example.com:1)';

    tracker.trackError(error, {
      component: 'PatientView',
      function: 'loadPatient',
      url: 'https://app.local/context/patient@example.com',
      userAgent: 'custom-agent patient@example.com',
      sessionId: 'session patient@example.com'
    });

    const queue = (tracker as unknown as { errorQueue: any[] }).errorQueue;
    expect(queue).toHaveLength(1);
    const queued = queue[0];

    expect(queued.message).not.toContain('patient@example.com');
    expect(queued.message).toContain(REDACTED_VALUE);
    expect(queued.stack).toContain(REDACTED_VALUE);
    expect(queued.context.userAgent).toContain(REDACTED_VALUE);
    expect(queued.context.sessionId).toContain(REDACTED_VALUE);
  });

  it('redacts AI error payloads and RPC submissions', async () => {
    const tracker = await loadTracker();
    const error = new Error('AI failure for patient@example.com');
    error.stack = 'stack patient@example.com';

    await tracker.trackAIError(
      error,
      {
        functionCalled: 'callPatient patient@example.com',
        tokenUsage: 123,
        responseTime: 456,
        cacheAttempted: true,
        errorType: 'function_error'
      },
      {
        component: 'AIService',
        function: 'callPatient'
      }
    );

    const queue = (tracker as unknown as { errorQueue: any[] }).errorQueue;
    expect(queue).toHaveLength(1);
    const queued = queue[0];

    expect(queued.message).toContain(REDACTED_VALUE);
    expect(queued.stack).toContain(REDACTED_VALUE);
    expect(queued.details.functionCalled).toContain(REDACTED_VALUE);
    expect(queued.context.userAgent).toContain(REDACTED_VALUE);

    const performanceCall = rpcMock.mock.calls.find(([fn]) => fn === 'log_ai_performance');
    expect(performanceCall).toBeDefined();
    const performanceArgs = performanceCall?.[1] as Record<string, unknown>;
    expect(performanceArgs.p_function_called).toContain(REDACTED_VALUE);
    expect(String(performanceArgs.p_function_called)).not.toContain('patient@example.com');

    rpcMock.mockClear();
    rpcMock.mockResolvedValue({ data: null, error: null });

    await (tracker as unknown as { flushErrorQueue: () => Promise<void> }).flushErrorQueue();

    const flushCall = rpcMock.mock.calls.find(([fn]) => fn === 'log_error_event');
    expect(flushCall).toBeDefined();
    const flushArgs = flushCall?.[1] as Record<string, unknown>;
    const payload = flushArgs?.payload as Record<string, unknown>;
    expect(payload).toBeDefined();
    expect(String(payload.message)).toContain(REDACTED_VALUE);
    expect(String(payload.message)).not.toContain('patient@example.com');
    expect(String(payload.stack)).toContain(REDACTED_VALUE);

    const context = payload.context as { userAgent?: string } | null;
    expect(context).toBeTruthy();
    expect(context?.userAgent).toContain(REDACTED_VALUE);

    const details = payload.details as { functionCalled?: string } | null;
    expect(details).toBeTruthy();
    expect(details?.functionCalled).toContain(REDACTED_VALUE);
  });
});
