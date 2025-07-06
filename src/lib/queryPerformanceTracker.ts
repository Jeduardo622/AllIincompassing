import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';

// ============================================================================
// QUERY PERFORMANCE TRACKING TYPES
// ============================================================================

export interface QueryPerformanceMetric {
  id: string;
  queryKey: string;
  operation: string;
  startTime: number;
  endTime: number;
  duration: number;
  dataSize?: number;
  cacheHit: boolean;
  errorOccurred: boolean;
  errorMessage?: string;
  stackTrace?: string;
  timestamp: string;
  sessionId: string;
  userId?: string;
  queryComplexity?: 'low' | 'medium' | 'high';
  affectedRows?: number;
  connectionCount?: number;
}

export interface SlowQueryPattern {
  pattern: string;
  count: number;
  avgDuration: number;
  maxDuration: number;
  minDuration: number;
  lastOccurrence: string;
  recommendation: string;
  impact: 'low' | 'medium' | 'high' | 'critical';
}

export interface PerformanceThreshold {
  name: string;
  warning: number;
  critical: number;
  unit: 'ms' | 'bytes' | 'percentage';
  enabled: boolean;
}

export interface QueryAnalysis {
  performance: {
    avgResponseTime: number;
    p95ResponseTime: number;
    slowQueryCount: number;
    cacheHitRate: number;
    errorRate: number;
  };
  patterns: SlowQueryPattern[];
  recommendations: Array<{
    type: 'index' | 'cache' | 'query' | 'connection';
    priority: 'low' | 'medium' | 'high' | 'critical';
    description: string;
    estimatedImprovement: string;
  }>;
  alerts: Array<{
    level: 'warning' | 'error' | 'critical';
    message: string;
    threshold: string;
    currentValue: string;
    timestamp: string;
  }>;
}

// ============================================================================
// CONFIGURATION
// ============================================================================

export interface QueryPerformanceConfig {
  thresholds: {
    slowQuery: number;        // Milliseconds for slow query detection
    criticalQuery: number;    // Milliseconds for critical slow queries
    cacheHitRate: number;     // Minimum acceptable cache hit rate (%)
    errorRate: number;        // Maximum acceptable error rate (%)
    maxDataSize: number;      // Maximum query result size (bytes)
  };
  
  monitoring: {
    sampleRate: number;       // Percentage of queries to monitor (0-100)
    bufferSize: number;       // Number of metrics to keep in memory
    flushInterval: number;    // How often to flush to database (ms)
    enableStackTrace: boolean; // Capture stack traces for slow queries
  };
  
  analysis: {
    patternDetection: boolean; // Enable slow query pattern detection
    autoOptimization: boolean; // Enable automatic optimization suggestions
    realTimeAlerts: boolean;   // Enable real-time alerting
    trendAnalysis: boolean;    // Enable performance trend analysis
  };
  
  retention: {
    metrics: number;          // How long to keep metrics (ms)
    patterns: number;         // How long to keep patterns (ms)
    alerts: number;          // How long to keep alerts (ms)
  };
}

export const DEFAULT_PERFORMANCE_CONFIG: QueryPerformanceConfig = {
  thresholds: {
    slowQuery: 1000,        // 1 second
    criticalQuery: 5000,    // 5 seconds
    cacheHitRate: 80,       // 80%
    errorRate: 5,           // 5%
    maxDataSize: 10 * 1024 * 1024, // 10MB
  },
  
  monitoring: {
    sampleRate: 100,        // Monitor all queries in development
    bufferSize: 1000,       // Keep 1000 metrics in memory
    flushInterval: 30000,   // Flush every 30 seconds
    enableStackTrace: true, // Enable for debugging
  },
  
  analysis: {
    patternDetection: true,
    autoOptimization: true,
    realTimeAlerts: true,
    trendAnalysis: true,
  },
  
  retention: {
    metrics: 7 * 24 * 60 * 60 * 1000,  // 7 days
    patterns: 30 * 24 * 60 * 60 * 1000, // 30 days
    alerts: 14 * 24 * 60 * 60 * 1000,  // 14 days
  },
};

// ============================================================================
// QUERY PERFORMANCE TRACKER
// ============================================================================

export class QueryPerformanceTracker {
  private config: QueryPerformanceConfig;
  private metricsBuffer: QueryPerformanceMetric[] = [];
  private patterns: Map<string, SlowQueryPattern> = new Map();
  private flushInterval: NodeJS.Timeout | null = null;
  private sessionId: string;
  private isEnabled = true;

  constructor(config: QueryPerformanceConfig = DEFAULT_PERFORMANCE_CONFIG) {
    this.config = { ...config };
    this.sessionId = this.generateSessionId();
    this.startFlushInterval();
  }

  // Generate unique session ID
  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // Start the metric flushing interval
  private startFlushInterval(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }

    this.flushInterval = setInterval(
      () => this.flushMetrics(),
      this.config.monitoring.flushInterval
    );
  }

  // Track a query operation
  async trackQuery<T>(
    queryKey: unknown[],
    operation: string,
    queryFn: () => Promise<T>,
    options: {
      userId?: string;
      complexity?: 'low' | 'medium' | 'high';
      cacheAttempted?: boolean;
    } = {}
  ): Promise<T> {
    // Check if we should sample this query
    if (Math.random() * 100 > this.config.monitoring.sampleRate) {
      return await queryFn();
    }

    const metric: Partial<QueryPerformanceMetric> = {
      id: crypto.randomUUID(),
      queryKey: Array.isArray(queryKey) ? queryKey.join('::') : String(queryKey),
      operation,
      startTime: performance.now(),
      cacheHit: false,
      errorOccurred: false,
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
      userId: options.userId,
      queryComplexity: options.complexity || 'medium',
    };

    try {
      const result = await queryFn();
      metric.endTime = performance.now();
      metric.duration = metric.endTime - metric.startTime!;
      
      // Estimate data size
      if (result) {
        try {
          metric.dataSize = JSON.stringify(result).length;
        } catch {
          metric.dataSize = 0;
        }
      }

      // Check if this was a cache hit (heuristic)
      metric.cacheHit = options.cacheAttempted && metric.duration < 50;

      this.addMetric(metric as QueryPerformanceMetric);
      
      // Real-time analysis for slow queries
      if (metric.duration > this.config.thresholds.slowQuery) {
        this.handleSlowQuery(metric as QueryPerformanceMetric);
      }

      return result;

    } catch (error) {
      metric.endTime = performance.now();
      metric.duration = metric.endTime - metric.startTime!;
      metric.errorOccurred = true;
      metric.errorMessage = error instanceof Error ? error.message : String(error);
      
      if (this.config.monitoring.enableStackTrace && error instanceof Error) {
        metric.stackTrace = error.stack;
      }

      this.addMetric(metric as QueryPerformanceMetric);
      
      // Always analyze errors
      this.handleQueryError(metric as QueryPerformanceMetric);
      
      throw error;
    }
  }

  // Add metric to buffer
  private addMetric(metric: QueryPerformanceMetric): void {
    if (!this.isEnabled) return;

    this.metricsBuffer.push(metric);
    
    // Prevent memory leaks by limiting buffer size
    if (this.metricsBuffer.length > this.config.monitoring.bufferSize) {
      this.metricsBuffer = this.metricsBuffer.slice(-this.config.monitoring.bufferSize);
    }
  }

  // Handle slow query detection
  private handleSlowQuery(metric: QueryPerformanceMetric): void {
    if (!this.config.analysis.patternDetection) return;

    const patternKey = this.extractQueryPattern(metric.queryKey);
    const existing = this.patterns.get(patternKey);

    if (existing) {
      existing.count++;
      existing.avgDuration = (existing.avgDuration * (existing.count - 1) + metric.duration) / existing.count;
      existing.maxDuration = Math.max(existing.maxDuration, metric.duration);
      existing.minDuration = Math.min(existing.minDuration, metric.duration);
      existing.lastOccurrence = metric.timestamp;
    } else {
      this.patterns.set(patternKey, {
        pattern: patternKey,
        count: 1,
        avgDuration: metric.duration,
        maxDuration: metric.duration,
        minDuration: metric.duration,
        lastOccurrence: metric.timestamp,
        recommendation: this.generateRecommendation(metric),
        impact: this.calculateImpact(metric.duration),
      });
    }

    // Real-time alerting
    if (this.config.analysis.realTimeAlerts) {
      this.sendSlowQueryAlert(metric);
    }
  }

  // Handle query errors
  private handleQueryError(metric: QueryPerformanceMetric): void {
    console.error('Query error detected:', {
      queryKey: metric.queryKey,
      operation: metric.operation,
      duration: metric.duration,
      error: metric.errorMessage,
      timestamp: metric.timestamp,
    });

    // Store error pattern for analysis
    if (this.config.analysis.patternDetection) {
      const errorKey = `error::${metric.queryKey}`;
      // Process error patterns similar to slow queries
    }
  }

  // Extract query pattern for pattern detection
  private extractQueryPattern(queryKey: string): string {
    // Remove dynamic values to identify patterns
    return queryKey
      .replace(/\d+/g, '[ID]')          // Replace numbers with [ID]
      .replace(/uuid-[a-f0-9-]+/g, '[UUID]') // Replace UUIDs
      .replace(/\d{4}-\d{2}-\d{2}/g, '[DATE]') // Replace dates
      .toLowerCase();
  }

  // Generate optimization recommendation
  private generateRecommendation(metric: QueryPerformanceMetric): string {
    if (metric.operation.includes('select') || metric.operation.includes('query')) {
      if (metric.duration > 2000) {
        return 'Consider adding database indexes or optimizing query structure';
      } else if (metric.duration > 1000) {
        return 'Consider implementing query result caching';
      }
    } else if (metric.operation.includes('mutation') || metric.operation.includes('update')) {
      return 'Consider batching mutations or using optimistic updates';
    }
    
    return 'Monitor query performance and consider optimization if pattern persists';
  }

  // Calculate impact level
  private calculateImpact(duration: number): 'low' | 'medium' | 'high' | 'critical' {
    if (duration > this.config.thresholds.criticalQuery) return 'critical';
    if (duration > this.config.thresholds.slowQuery * 2) return 'high';
    if (duration > this.config.thresholds.slowQuery) return 'medium';
    return 'low';
  }

  // Send slow query alert
  private sendSlowQueryAlert(metric: QueryPerformanceMetric): void {
    const alert = {
      level: metric.duration > this.config.thresholds.criticalQuery ? 'critical' : 'warning' as const,
      message: `Slow query detected: ${metric.operation} took ${metric.duration.toFixed(2)}ms`,
      threshold: `${this.config.thresholds.slowQuery}ms`,
      currentValue: `${metric.duration.toFixed(2)}ms`,
      timestamp: metric.timestamp,
      queryKey: metric.queryKey,
      sessionId: metric.sessionId,
    };

    // Emit event for real-time alerting system
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('slowQueryDetected', { detail: alert }));
    }
  }

  // Flush metrics to database
  private async flushMetrics(): Promise<void> {
    if (this.metricsBuffer.length === 0) return;

    const metricsToFlush = [...this.metricsBuffer];
    this.metricsBuffer = [];

    try {
      // Store in database for persistence
      const { error } = await supabase
        .from('query_performance_metrics')
        .insert(metricsToFlush.map(metric => ({
          query_key: metric.queryKey,
          operation: metric.operation,
          duration_ms: metric.duration,
          data_size_bytes: metric.dataSize,
          cache_hit: metric.cacheHit,
          error_occurred: metric.errorOccurred,
          error_message: metric.errorMessage,
          query_complexity: metric.queryComplexity,
          affected_rows: metric.affectedRows,
          session_id: metric.sessionId,
          user_id: metric.userId,
          timestamp: metric.timestamp,
        })));

      if (error) {
        console.error('Failed to flush query metrics:', error);
        // Re-add metrics to buffer for retry
        this.metricsBuffer.unshift(...metricsToFlush);
      }

    } catch (error) {
      console.error('Error flushing metrics:', error);
      // Store in localStorage as fallback
      this.storeMetricsLocally(metricsToFlush);
    }
  }

  // Store metrics locally as fallback
  private storeMetricsLocally(metrics: QueryPerformanceMetric[]): void {
    try {
      const stored = JSON.parse(localStorage.getItem('queryMetrics') || '[]');
      const combined = [...stored, ...metrics].slice(-100); // Keep last 100
      localStorage.setItem('queryMetrics', JSON.stringify(combined));
    } catch (error) {
      console.error('Failed to store metrics locally:', error);
    }
  }

  // Get performance analysis
  async getPerformanceAnalysis(timeRange: '1h' | '24h' | '7d' = '24h'): Promise<QueryAnalysis> {
    const cutoffTime = this.getCutoffTime(timeRange);
    
    // Get metrics from both buffer and database
    const recentMetrics = this.metricsBuffer.filter(m => 
      new Date(m.timestamp) > cutoffTime
    );

    // Fetch from database
    const { data: dbMetrics, error } = await supabase
      .from('query_performance_metrics')
      .select('*')
      .gte('timestamp', cutoffTime.toISOString())
      .order('timestamp', { ascending: false })
      .limit(1000);

    if (error) {
      console.error('Failed to fetch performance metrics:', error);
    }

    const allMetrics = [...recentMetrics, ...(dbMetrics || [])];
    
    return this.analyzeMetrics(allMetrics);
  }

  // Analyze metrics to generate insights
  private analyzeMetrics(metrics: any[]): QueryAnalysis {
    const analysis: QueryAnalysis = {
      performance: {
        avgResponseTime: 0,
        p95ResponseTime: 0,
        slowQueryCount: 0,
        cacheHitRate: 0,
        errorRate: 0,
      },
      patterns: Array.from(this.patterns.values()),
      recommendations: [],
      alerts: [],
    };

    if (metrics.length === 0) return analysis;

    // Calculate performance metrics
    const durations = metrics.map(m => m.duration_ms || m.duration).sort((a, b) => a - b);
    analysis.performance.avgResponseTime = durations.reduce((sum, d) => sum + d, 0) / durations.length;
    analysis.performance.p95ResponseTime = durations[Math.floor(durations.length * 0.95)] || 0;
    analysis.performance.slowQueryCount = metrics.filter(m => 
      (m.duration_ms || m.duration) > this.config.thresholds.slowQuery
    ).length;
    analysis.performance.cacheHitRate = (metrics.filter(m => m.cache_hit).length / metrics.length) * 100;
    analysis.performance.errorRate = (metrics.filter(m => m.error_occurred).length / metrics.length) * 100;

    // Generate recommendations
    analysis.recommendations = this.generateRecommendations(analysis.performance);

    // Generate alerts
    analysis.alerts = this.generateAlerts(analysis.performance);

    return analysis;
  }

  // Generate optimization recommendations
  private generateRecommendations(performance: QueryAnalysis['performance']): QueryAnalysis['recommendations'] {
    const recommendations: QueryAnalysis['recommendations'] = [];

    if (performance.avgResponseTime > this.config.thresholds.slowQuery) {
      recommendations.push({
        type: 'query',
        priority: 'high',
        description: 'Average response time exceeds threshold - consider query optimization',
        estimatedImprovement: '30-50% response time reduction',
      });
    }

    if (performance.cacheHitRate < this.config.thresholds.cacheHitRate) {
      recommendations.push({
        type: 'cache',
        priority: 'medium',
        description: 'Low cache hit rate - review caching strategy',
        estimatedImprovement: '20-40% performance improvement',
      });
    }

    if (performance.slowQueryCount > 5) {
      recommendations.push({
        type: 'index',
        priority: 'high',
        description: 'Multiple slow queries detected - add database indexes',
        estimatedImprovement: '40-70% query performance improvement',
      });
    }

    if (performance.errorRate > this.config.thresholds.errorRate) {
      recommendations.push({
        type: 'query',
        priority: 'critical',
        description: 'High error rate - investigate and fix failing queries',
        estimatedImprovement: 'Improved reliability and user experience',
      });
    }

    return recommendations;
  }

  // Generate performance alerts
  private generateAlerts(performance: QueryAnalysis['performance']): QueryAnalysis['alerts'] {
    const alerts: QueryAnalysis['alerts'] = [];

    if (performance.avgResponseTime > this.config.thresholds.criticalQuery) {
      alerts.push({
        level: 'critical',
        message: 'Critical: Average response time exceeds critical threshold',
        threshold: `${this.config.thresholds.criticalQuery}ms`,
        currentValue: `${performance.avgResponseTime.toFixed(2)}ms`,
        timestamp: new Date().toISOString(),
      });
    } else if (performance.avgResponseTime > this.config.thresholds.slowQuery) {
      alerts.push({
        level: 'warning',
        message: 'Warning: Average response time exceeds acceptable threshold',
        threshold: `${this.config.thresholds.slowQuery}ms`,
        currentValue: `${performance.avgResponseTime.toFixed(2)}ms`,
        timestamp: new Date().toISOString(),
      });
    }

    if (performance.errorRate > this.config.thresholds.errorRate * 2) {
      alerts.push({
        level: 'critical',
        message: 'Critical: High query error rate detected',
        threshold: `${this.config.thresholds.errorRate}%`,
        currentValue: `${performance.errorRate.toFixed(2)}%`,
        timestamp: new Date().toISOString(),
      });
    }

    return alerts;
  }

  // Get cutoff time for analysis
  private getCutoffTime(timeRange: '1h' | '24h' | '7d'): Date {
    const now = new Date();
    switch (timeRange) {
      case '1h':
        return new Date(now.getTime() - 60 * 60 * 1000);
      case '24h':
        return new Date(now.getTime() - 24 * 60 * 60 * 1000);
      case '7d':
        return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    }
  }

  // Clean up resources
  destroy(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    
    // Flush remaining metrics
    this.flushMetrics();
    
    this.isEnabled = false;
  }

  // Get current statistics
  getStats() {
    return {
      bufferSize: this.metricsBuffer.length,
      patternCount: this.patterns.size,
      sessionId: this.sessionId,
      isEnabled: this.isEnabled,
      config: this.config,
    };
  }

  // Update configuration
  updateConfig(newConfig: Partial<QueryPerformanceConfig>): void {
    this.config = { ...this.config, ...newConfig };
    
    // Restart flush interval if changed
    if (newConfig.monitoring?.flushInterval) {
      this.startFlushInterval();
    }
  }
}

// ============================================================================
// REACT HOOKS
// ============================================================================

let performanceTracker: QueryPerformanceTracker | null = null;

export function useQueryPerformanceTracking(config?: Partial<QueryPerformanceConfig>) {
  const queryClient = useQueryClient();
  const trackerRef = useRef<QueryPerformanceTracker | null>(null);
  const [isActive, setIsActive] = useState(false);

  // Initialize tracker
  useEffect(() => {
    if (!trackerRef.current) {
      const finalConfig = config ? { ...DEFAULT_PERFORMANCE_CONFIG, ...config } : DEFAULT_PERFORMANCE_CONFIG;
      trackerRef.current = new QueryPerformanceTracker(finalConfig);
      performanceTracker = trackerRef.current;
      setIsActive(true);
    }

    return () => {
      if (trackerRef.current) {
        trackerRef.current.destroy();
        trackerRef.current = null;
        performanceTracker = null;
        setIsActive(false);
      }
    };
  }, [config]);

  // Track query function
  const trackQuery = useCallback(async <T>(
    queryKey: unknown[],
    operation: string,
    queryFn: () => Promise<T>,
    options?: {
      userId?: string;
      complexity?: 'low' | 'medium' | 'high';
      cacheAttempted?: boolean;
    }
  ): Promise<T> => {
    if (!trackerRef.current) {
      return await queryFn();
    }

    return trackerRef.current.trackQuery(queryKey, operation, queryFn, options);
  }, []);

  // Get performance analysis
  const getAnalysis = useCallback(async (timeRange?: '1h' | '24h' | '7d') => {
    if (!trackerRef.current) return null;
    return trackerRef.current.getPerformanceAnalysis(timeRange);
  }, []);

  // Get current statistics
  const getStats = useCallback(() => {
    return trackerRef.current?.getStats() || null;
  }, []);

  // Update configuration
  const updateConfig = useCallback((newConfig: Partial<QueryPerformanceConfig>) => {
    trackerRef.current?.updateConfig(newConfig);
  }, []);

  return {
    trackQuery,
    getAnalysis,
    getStats,
    updateConfig,
    isActive,
  };
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

// Create migration for query_performance_metrics table
export const createQueryPerformanceTable = async () => {
  const { error } = await supabase.rpc('exec_sql', {
    sql: `
      CREATE TABLE IF NOT EXISTS query_performance_metrics (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        query_key text NOT NULL,
        operation text NOT NULL,
        duration_ms numeric NOT NULL,
        data_size_bytes integer,
        cache_hit boolean DEFAULT false,
        error_occurred boolean DEFAULT false,
        error_message text,
        query_complexity text CHECK (query_complexity IN ('low', 'medium', 'high')),
        affected_rows integer,
        session_id text NOT NULL,
        user_id uuid,
        timestamp timestamptz DEFAULT now(),
        created_at timestamptz DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS idx_query_performance_timestamp 
      ON query_performance_metrics(timestamp DESC);
      
      CREATE INDEX IF NOT EXISTS idx_query_performance_duration 
      ON query_performance_metrics(duration_ms DESC) 
      WHERE duration_ms > 1000;
      
      CREATE INDEX IF NOT EXISTS idx_query_performance_session 
      ON query_performance_metrics(session_id, timestamp);
      
      CREATE INDEX IF NOT EXISTS idx_query_performance_errors 
      ON query_performance_metrics(error_occurred, timestamp) 
      WHERE error_occurred = true;
    `
  });

  if (error) {
    console.error('Failed to create query performance table:', error);
  }
};

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  QueryPerformanceTracker,
  useQueryPerformanceTracking,
  createQueryPerformanceTable,
  DEFAULT_PERFORMANCE_CONFIG,
}; 