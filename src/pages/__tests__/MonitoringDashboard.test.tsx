import React from 'react';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import { MonitoringDashboard } from '../MonitoringDashboard';

const agentTraceMocks = vi.hoisted(() => ({
  fetchAgentTraceReport: vi.fn(),
  fetchAgentWorkOperations: vi.fn(),
}));

vi.mock('../../lib/agentTraceReport', () => agentTraceMocks);

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
let realtimeMetrics: Array<{ id: string }> = [{ id: 'metric-1' }];
let realtimeAlerts: Array<{
  severity: 'critical' | 'high' | 'medium' | 'low';
  alert_type: string;
  message: string;
  created_at: string;
  resolved: boolean;
}> = [];
let performanceBottlenecks: Array<{
  component: string;
  metric: string;
  impact: 'high' | 'medium' | 'low';
  recommendation: string;
}> = [];
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
let authState = {
  loading: false,
  isAdmin: () => true,
  hasCapability: (capability: string) => capability === 'viewMonitoring',
  session: null,
};

vi.mock('../../lib/authContext', () => ({
  useAuth: () => authState,
}));

vi.mock('../../lib/performance', () => ({
  useRealtimePerformanceMonitoring: () => ({
    isConnected: true,
    connectionStatus: 'connected',
    metrics: realtimeMetrics,
    alerts: realtimeAlerts,
    clearMetrics: vi.fn(),
    clearAlerts: vi.fn(),
  }),
  usePerformanceAnalytics: () => ({
    analytics: {
      healthScore: 90,
      bottlenecks: performanceBottlenecks,
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
    agentTraceMocks.fetchAgentTraceReport.mockReset();
    agentTraceMocks.fetchAgentWorkOperations.mockReset();
    cleanupCallCount = 0;
    realtimeMetrics = [{ id: 'metric-1' }];
    realtimeAlerts = [];
    performanceBottlenecks = [];
    authState = {
      loading: false,
      isAdmin: () => true,
      hasCapability: (capability: string) => capability === 'viewMonitoring',
      session: null,
    };
    intervalCallbacks = [];
    setIntervalSpy = vi.spyOn(global, 'setInterval').mockImplementation(((cb: TimerHandler) => {
      if (typeof cb === 'function') {
        intervalCallbacks.push(cb as () => void);
      }
      return 1 as unknown as ReturnType<typeof setInterval>;
    }) as typeof setInterval);
    clearIntervalSpy = vi.spyOn(global, 'clearInterval').mockImplementation(() => {});
  });

  it('distinguishes a connected channel from unavailable telemetry', () => {
    realtimeMetrics = [];

    render(<MonitoringDashboard />);

    expect(screen.getByText('Connected')).toBeInTheDocument();
    expect(screen.getByText('Health Score: Not available')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Performance samples unavailable');
    expect(
      screen.getByText(/no performance samples have been received/i),
    ).toBeInTheDocument();
    expect(screen.getByText('No performance samples received')).toBeInTheDocument();
    expect(screen.getByText('System Health').parentElement).toHaveTextContent('Not available');
    expect(screen.getByText('AI Response Time').parentElement).toHaveTextContent('Not available');
    expect(screen.getByText('Cache Hit Rate').parentElement).toHaveTextContent('Not available');
    expect(screen.queryByText('Health Score: 0%')).not.toBeInTheDocument();
    expect(screen.queryByText('0ms')).not.toBeInTheDocument();
  });

  it('preserves measured overview values when telemetry exists', () => {
    render(<MonitoringDashboard />);

    expect(screen.getByText('Health Score: 90%')).toBeInTheDocument();
    expect(screen.getByText('1 metrics tracked')).toBeInTheDocument();
    expect(screen.getByText('System Health').parentElement).toHaveTextContent('90%');
    expect(screen.getByText('AI Response Time').parentElement).toHaveTextContent('100ms');
    expect(screen.getByText('Cache Hit Rate').parentElement).toHaveTextContent('97%');
    expect(screen.queryByText('Performance samples unavailable')).not.toBeInTheDocument();
  });

  it('hides stale analysis when telemetry is cleared', () => {
    performanceBottlenecks = [{
      component: 'Database',
      metric: 'Latency',
      impact: 'high',
      recommendation: 'Inspect the query path.',
    }];

    const { rerender } = render(<MonitoringDashboard />);

    expect(screen.getByText('Performance Bottlenecks')).toBeInTheDocument();
    expect(screen.getByText('Database - Latency')).toBeInTheDocument();

    realtimeMetrics = [];
    rerender(<MonitoringDashboard />);

    expect(screen.getByRole('status')).toHaveTextContent('Performance samples unavailable');
    expect(screen.queryByText('Performance Bottlenecks')).not.toBeInTheDocument();
    expect(screen.queryByText('Database - Latency')).not.toBeInTheDocument();
  });

  it('keeps active alerts visible when performance samples are unavailable', () => {
    realtimeMetrics = [];
    realtimeAlerts = [{
      severity: 'high',
      alert_type: 'Queue delay',
      message: 'A synthetic alert remains active.',
      created_at: '2026-08-21T12:00:00.000Z',
      resolved: false,
    }];

    render(<MonitoringDashboard />);

    expect(screen.getByRole('status')).toHaveTextContent('Performance samples unavailable');
    expect(screen.getByText('No performance samples received')).toBeInTheDocument();
    expect(screen.getByText('1 active alerts')).toBeInTheDocument();
    expect(screen.getByText('Recent Alerts')).toBeInTheDocument();
    expect(screen.getByText('Queue delay')).toBeInTheDocument();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    setIntervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
    vi.useRealTimers();
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
      expect(
        screen.getByRole('button', { name: /open monitoring settings/i }),
      ).toBeInTheDocument();
      const cacheTab = screen.getByRole('button', { name: /cache management/i });
      fireEvent.click(cacheTab);

      expect(getCleanupStats).toHaveBeenCalledTimes(1);

      const refreshTokenValue = () => screen.getByTestId('refresh-token-value').textContent ?? '';
      expect(refreshTokenValue()).toBe('0');

      expect(intervalCallbacks.length).toBeGreaterThan(0);
      await act(async () => {
        intervalCallbacks[0]!();
      });

      expect(refreshTokenValue()).toBe('1');
      expect(getCleanupStats.mock.calls.length).toBeGreaterThan(1);
      expect(reloadSpy).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(window, 'location', {
        configurable: true,
        writable: true,
        value: originalLocation,
      });
    }
  });

  it('fails closed when broad admin status is true but the monitoring capability is absent', () => {
    authState = {
      loading: false,
      isAdmin: () => true,
      hasCapability: () => false,
      session: null,
    };

    render(<MonitoringDashboard />);

    expect(screen.getByText(/admin access required/i)).toBeInTheDocument();
  });

  it('keeps the monitoring tab strip horizontally scrollable without page overflow', () => {
    render(<MonitoringDashboard />);

    const overviewTab = screen.getByRole('button', { name: /overview/i });
    const tabList = overviewTab.closest('nav');
    const scroller = tabList?.parentElement;

    expect(tabList).toHaveClass('min-w-max');
    expect(scroller).toHaveClass('overflow-x-auto');
  });

  it('renders bounded agent work operations and sanitized drill-down fields', async () => {
    agentTraceMocks.fetchAgentWorkOperations.mockResolvedValue({
      schemaVersion: 'agent-work-operations.v1',
      generatedAt: '2026-08-02T12:00:00.000Z',
      sample: { limit: 500, truncated: false, releaseGateStatus: 'evaluable' },
      summary: {
        totalWorkItems: 5,
        blockedWorkItems: 1,
        waitingSteps: 2,
        staleLeases: 0,
        retryExhaustedSteps: 1,
        parityMismatches: 0,
        duplicateEffectsPrevented: 3,
        pendingApprovals: 1,
        oldestWaitingAgeSeconds: 120,
        oldestApprovalAgeSeconds: 300,
      },
      rates: { retryExhaustionPercent: 10, abortPercent: 0 },
      releaseSignals: {
        crossTenantAccess: 0,
        falseCompletion: 0,
        unverifiedMutationEffects: 0,
        phiPayloadViolations: 0,
        approvalBypassOrStaleAcceptance: 0,
        unknownStateTransitions: 0,
        staleRunningBeyondSlo: 0,
        readinessEvidenceCoveragePercent: 100,
      },
      aggregations: { workflows: [], models: [] },
      drilldown: {
        blocked: [{ workItemId: 'work-safe-1', reasonCode: 'evidence_missing' }],
        waiting: [],
        staleLeases: [],
        retryExhausted: [],
        parityMismatches: [],
      },
      nonBlocking: {
        medianTimeToNeedsReviewSeconds: 600,
        retryAbortRatePercent: 0,
        humanOverrideRatePercent: 0,
        duplicateEffectsPrevented: 3,
        tokensPerCompletedObjective: 25,
        costPerCompletedObjective: 0,
        timeInEachStateSeconds: { running: 300 },
        blockerResolutionTimeSeconds: {
          value: null,
          availability: 'unavailable',
          reasonCode: 'blocker_resolution_not_recorded',
        },
        clinicianAdministrativeTimeSeconds: {
          value: null,
          availability: 'unavailable',
          reasonCode: 'not_recorded',
        },
      },
    });
    render(<MonitoringDashboard />);

    fireEvent.click(screen.getByRole('button', { name: /agent trace replay/i }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /load agent work operations/i }));
      await Promise.resolve();
    });

    expect(agentTraceMocks.fetchAgentWorkOperations).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Agent Work Operations')).toBeInTheDocument();
    expect(screen.getByText('Sampled blocked work items')).toBeInTheDocument();
    expect(screen.getByText('work-safe-1')).toBeInTheDocument();
    expect(screen.getByText('evidence_missing')).toBeInTheDocument();
    expect(screen.getByText('Readiness evidence')).toBeInTheDocument();
    expect(screen.getByText('100%')).toBeInTheDocument();
    expect(screen.getByText('Oldest waiting')).toBeInTheDocument();
    expect(screen.getByText('Retry exhaustion rate')).toBeInTheDocument();
    expect(screen.getByText('Median to needs review')).toBeInTheDocument();
    expect(screen.queryByText(/idempotency/i)).not.toBeInTheDocument();
  });

});
