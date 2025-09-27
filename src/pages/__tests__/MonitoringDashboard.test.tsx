import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import MonitoringDashboard from '../MonitoringDashboard';

vi.mock('../../components/monitoring/AIPerformance', () => ({
  __esModule: true,
  default: () => <div>AIPerformance</div>,
}));

vi.mock('../../components/monitoring/DatabasePerformance', () => ({
  __esModule: true,
  default: () => <div>DatabasePerformance</div>,
}));

vi.mock('../../components/monitoring/SystemPerformance', () => ({
  __esModule: true,
  default: () => <div>SystemPerformance</div>,
}));

const analyzePerformance = vi.fn();
const manualCleanup = vi.fn();
let cleanupCallCount = 0;
const getCleanupStats = vi.fn(() => {
  cleanupCallCount += 1;
  return {
    isRunning: false,
    totalCleanups: cleanupCallCount,
    bytesFreed: 1024,
    memoryUsage: {
      totalJSHeapSize: 1024 * 1024,
      usedJSHeapSize: 512 * 1024,
      jsHeapSizeLimit: 2048 * 1024,
    },
    activeIntervals: 1,
    errors: 0,
    lastCleanup: new Date().toISOString(),
  };
});

const getAnalysis = vi.fn(async () => ({
  performance: {
    avgResponseTime: 120,
    slowQueryCount: 2,
    cacheHitRate: 95,
  },
  patterns: [],
  recommendations: [],
}));

const getQueryStats = vi.fn(() => ({
  bufferSize: 1,
  patternCount: 0,
  sessionId: 'abcdef',
  isEnabled: true,
}));

let intervalCallbacks: Array<() => void> = [];
let setIntervalSpy: ReturnType<typeof vi.spyOn>;
let clearIntervalSpy: ReturnType<typeof vi.spyOn>;

vi.mock('../../lib/authContext', () => ({
  useAuth: () => ({
    loading: false,
    isAdmin: () => true,
  }),
}));

vi.mock('../../lib/performance', () => ({
  useRealtimePerformanceMonitoring: () => ({
    isConnected: true,
    connectionStatus: 'connected',
    metrics: [{ id: 'metric-1' }],
    alerts: [],
    clearMetrics: vi.fn(),
    clearAlerts: vi.fn(),
  }),
  usePerformanceAnalytics: () => ({
    analytics: {
      healthScore: 90,
      bottlenecks: [],
      trends: {
        aiResponseTime: {
          current: 100,
          change: -5,
        },
        cacheHitRate: {
          current: 97,
          change: 1.5,
        },
      },
    },
    analyzePerformance,
  }),
}));

vi.mock('../../lib/cacheCleanup', () => ({
  useCacheCleanup: () => ({
    manualCleanup,
    getCleanupStats,
  }),
}));

vi.mock('../../lib/queryPerformanceTracker', () => ({
  useQueryPerformanceTracking: () => ({
    getAnalysis,
    getStats: getQueryStats,
    isActive: true,
  }),
}));

vi.mock('../../lib/logger/logger', () => ({
  logger: {
    error: vi.fn(),
  },
}));

vi.mock('../../lib/logger/normalizeError', () => ({
  toError: (error: unknown) => (error instanceof Error ? error : new Error(String(error))),
}));

describe('MonitoringDashboard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    analyzePerformance.mockClear();
    manualCleanup.mockClear();
    getCleanupStats.mockClear();
    getAnalysis.mockClear();
    getQueryStats.mockClear();
    cleanupCallCount = 0;
    intervalCallbacks = [];
    setIntervalSpy = vi.spyOn(global, 'setInterval').mockImplementation(((cb: TimerHandler) => {
      if (typeof cb === 'function') {
        intervalCallbacks.push(cb as () => void);
      }
      return 1 as unknown as ReturnType<typeof setInterval>;
    }) as typeof setInterval);
    clearIntervalSpy = vi.spyOn(global, 'clearInterval').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    setIntervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
  });

  it('refreshes data without reloading the page', async () => {
    const originalLocation = window.location;
    const reloadSpy = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: { reload: reloadSpy } as Location,
    });

    try {
      render(<MonitoringDashboard />);
      const cacheTab = screen.getByRole('button', { name: /cache management/i });
      await userEvent.click(cacheTab);

      await waitFor(() => expect(getCleanupStats).toHaveBeenCalledTimes(1));

      const refreshTokenValue = () => screen.getByTestId('refresh-token-value').textContent ?? '';
      expect(refreshTokenValue()).toBe('0');

      expect(intervalCallbacks.length).toBeGreaterThan(0);
      await act(async () => {
        intervalCallbacks[0]!();
      });

      await waitFor(() => expect(refreshTokenValue()).toBe('1'));
      await waitFor(() => expect(getCleanupStats.mock.calls.length).toBeGreaterThan(1));
      expect(reloadSpy).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(window, 'location', {
        configurable: true,
        writable: true,
        value: originalLocation,
      });
    }
  });

});
