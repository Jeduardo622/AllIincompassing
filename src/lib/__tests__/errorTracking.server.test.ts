import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const globalRef = globalThis as Record<string, unknown>;
const hadWindow = 'window' in globalRef;
const hadNavigator = 'navigator' in globalRef;
const originalWindow = hadWindow ? (globalRef.window as unknown) : undefined;
const originalNavigator = hadNavigator ? (globalRef.navigator as unknown) : undefined;

describe('errorTracking server fallback', () => {
  beforeAll(() => {
    vi.resetModules();
  });

  beforeEach(() => {
    vi.resetModules();
    Reflect.deleteProperty(globalRef, 'window');
    Reflect.deleteProperty(globalRef, 'navigator');
  });

  afterEach(() => {
    vi.resetModules();
    if (hadWindow) {
      Object.defineProperty(globalRef, 'window', {
        configurable: true,
        enumerable: true,
        writable: true,
        value: originalWindow
      });
    } else {
      Reflect.deleteProperty(globalRef, 'window');
    }

    if (hadNavigator) {
      Object.defineProperty(globalRef, 'navigator', {
        configurable: true,
        enumerable: true,
        writable: true,
        value: originalNavigator
      });
    } else {
      Reflect.deleteProperty(globalRef, 'navigator');
    }
  });

  afterAll(() => {
    vi.resetModules();
    if (hadWindow) {
      Object.defineProperty(globalRef, 'window', {
        configurable: true,
        enumerable: true,
        writable: true,
        value: originalWindow
      });
    }
    if (hadNavigator) {
      Object.defineProperty(globalRef, 'navigator', {
        configurable: true,
        enumerable: true,
        writable: true,
        value: originalNavigator
      });
    }
  });

  it('provides a no-op tracker when browser globals are unavailable', async () => {
    const module = await import('../errorTracking');
    const { errorTracker, getErrorTracker } = module;

    expect(errorTracker).toBe(getErrorTracker());
    expect(errorTracker.getRecentErrors()).toEqual([]);
    expect(errorTracker.getPerformanceAlerts()).toEqual([]);
    expect(() => errorTracker.trackError(new Error('test error'))).not.toThrow();

    await expect(
      errorTracker.trackAIError(new Error('async error'), {
      errorType: 'upstream_unavailable'
      })
    ).resolves.toBeUndefined();

    await expect(
      errorTracker.trackPerformanceAlert({
        metric: 'noop',
        currentValue: 1,
        threshold: 2,
        severity: 'low'
      })
    ).resolves.toBeUndefined();
  });

  it('allows performance monitoring utilities without browser APIs', async () => {
    const module = await import('../errorTracking');
    const monitoring = module.usePerformanceMonitoring();

    const cleanup = monitoring.trackPagePerformance('server-test');
    expect(typeof cleanup).toBe('function');
    cleanup();

    await expect(
      monitoring.trackAIPerformance(async () => 'result', 'noop')
    ).resolves.toBe('result');

    await expect(
      monitoring.trackAIPerformance(async () => {
        throw new Error('failure');
      }, 'noop')
    ).rejects.toThrow('failure');

    expect(() => monitoring.trackError(new Error('test'))).not.toThrow();
  });
});

