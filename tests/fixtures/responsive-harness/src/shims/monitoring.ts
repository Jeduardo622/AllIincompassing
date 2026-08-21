export type AgentTraceTimelineEvent = {
  detail: Record<string, unknown>;
};

export type AgentTraceReportData = Record<string, never>;
export type AgentWorkOperationsData = Record<string, never>;

export const useRealtimePerformanceMonitoring = () => ({
  isConnected: true,
  connectionStatus: "connected",
  metrics: [],
  alerts: [],
  clearMetrics: () => {},
  clearAlerts: () => {},
});

export const useDebounce = <T,>(value: T): T => value;

export const usePerformanceAnalytics = () => ({
  analytics: {
    healthScore: 0,
    bottlenecks: [],
    trends: {
      aiResponseTime: { current: 0, change: 0 },
      cacheHitRate: { current: 0, change: 0 },
    },
  },
  analyzePerformance: () => {},
});

export const useCacheCleanup = () => ({
  manualCleanup: async () => {},
  getCleanupStats: () => ({
    isRunning: false,
    totalCleanups: 0,
    bytesFreed: 0,
    memoryUsage: null,
    activeIntervals: 0,
    errors: 0,
    lastCleanup: null,
  }),
});

export const useQueryPerformanceTracking = () => ({
  getAnalysis: async () => ({ performance: {}, patterns: [], recommendations: [] }),
  getStats: () => ({ bufferSize: 0, patternCount: 0, sessionId: null, isEnabled: false }),
  isActive: false,
});

export const fetchAgentTraceReport = async (): Promise<AgentTraceReportData> => ({});
export const fetchAgentWorkOperations = async (): Promise<AgentWorkOperationsData> => ({});
