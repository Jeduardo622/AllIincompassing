import { supabase } from './supabase';

interface ErrorContext {
  component?: string;
  function?: string;
  userId?: string;
  userAgent?: string;
  url?: string;
  timestamp?: Date;
  sessionId?: string;
}

interface AIErrorDetails {
  functionCalled?: string;
  tokenUsage?: number;
  responseTime?: number;
  cacheAttempted?: boolean;
  errorType: 'timeout' | 'rate_limit' | 'invalid_response' | 'function_error' | 'network_error';
}

interface PerformanceAlert {
  metric: string;
  currentValue: number;
  threshold: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  autoResolve?: boolean;
}

class ErrorTracker {
  private static instance: ErrorTracker;
  private errorQueue: Array<any> = [];
  private isOnline = navigator.onLine;
  private flushInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.initializeErrorTracking();
    this.startPeriodicFlush();
  }

  static getInstance(): ErrorTracker {
    if (!ErrorTracker.instance) {
      ErrorTracker.instance = new ErrorTracker();
    }
    return ErrorTracker.instance;
  }

  private initializeErrorTracking() {
    // Global error handler
    window.addEventListener('error', (event) => {
      this.trackError(event.error, {
        component: 'global',
        url: window.location.href,
        timestamp: new Date()
      });
    });

    // Unhandled promise rejections
    window.addEventListener('unhandledrejection', (event) => {
      this.trackError(new Error(event.reason), {
        component: 'promise',
        url: window.location.href,
        timestamp: new Date()
      });
    });

    // Online/offline status
    window.addEventListener('online', () => {
      this.isOnline = true;
      this.flushErrorQueue();
    });

    window.addEventListener('offline', () => {
      this.isOnline = false;
    });
  }

  /**
   * Track AI-specific errors with detailed context
   */
  async trackAIError(error: Error, details: AIErrorDetails, context?: ErrorContext): Promise<void> {
    const errorData = {
      type: 'ai_error',
      message: error.message,
      stack: error.stack,
      details,
      context: {
        ...context,
        timestamp: new Date(),
        userAgent: navigator.userAgent,
        url: window.location.href
      }
    };

    // Log performance metrics for AI errors
    await this.logAIPerformanceMetric({
      responseTime: details.responseTime || 0,
      cacheHit: false,
      tokenUsage: details.tokenUsage || 0,
      functionCalled: details.functionCalled || 'unknown',
      errorOccurred: true,
      errorType: details.errorType
    });

    this.queueError(errorData);
  }

  /**
   * Track general application errors
   */
  trackError(error: Error, context?: ErrorContext): void {
    const errorData = {
      type: 'application_error',
      message: error.message,
      stack: error.stack,
      context: {
        ...context,
        timestamp: new Date(),
        userAgent: navigator.userAgent,
        url: window.location.href
      }
    };

    this.queueError(errorData);
  }

  /**
   * Track performance degradation and create alerts
   */
  async trackPerformanceAlert(alert: PerformanceAlert): Promise<void> {
    try {
      await supabase.rpc('check_performance_thresholds', {
        p_metric_name: alert.metric,
        p_current_value: alert.currentValue
      });

      // Log to local storage for offline scenarios
      const alerts = JSON.parse(localStorage.getItem('performance_alerts') || '[]');
      alerts.push({
        ...alert,
        timestamp: new Date().toISOString(),
        id: crypto.randomUUID()
      });
      
      // Keep only last 50 alerts
      localStorage.setItem('performance_alerts', JSON.stringify(alerts.slice(-50)));

    } catch (error) {
      console.error('Failed to track performance alert:', error);
    }
  }

  /**
   * Log AI performance metrics for monitoring
   */
  private async logAIPerformanceMetric(metrics: {
    responseTime: number;
    cacheHit: boolean;
    tokenUsage: number;
    functionCalled: string;
    errorOccurred: boolean;
    errorType?: string;
  }): Promise<void> {
    try {
      await supabase.rpc('log_ai_performance', {
        p_response_time_ms: metrics.responseTime,
        p_cache_hit: metrics.cacheHit,
        p_token_usage: { 
          total: metrics.tokenUsage,
          error_type: metrics.errorType 
        },
        p_function_called: metrics.functionCalled,
        p_error_occurred: metrics.errorOccurred,
        p_user_id: null, // Will be set by RLS
        p_conversation_id: null
      });
    } catch (error) {
      console.error('Failed to log AI performance metric:', error);
    }
  }

  /**
   * Queue errors for batch processing
   */
  private queueError(errorData: any): void {
    this.errorQueue.push({
      ...errorData,
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString()
    });

    // Immediate flush for critical errors
    if (this.isCriticalError(errorData)) {
      this.flushErrorQueue();
    }

    // Prevent memory leaks
    if (this.errorQueue.length > 100) {
      this.errorQueue = this.errorQueue.slice(-50);
    }
  }

  /**
   * Determine if error is critical and needs immediate attention
   */
  private isCriticalError(errorData: any): boolean {
    const criticalPatterns = [
      /auth/i,
      /payment/i,
      /security/i,
      /database/i,
      /ai.*timeout/i,
      /rate.*limit/i
    ];

    return criticalPatterns.some(pattern => 
      pattern.test(errorData.message) || 
      pattern.test(errorData.type)
    );
  }

  /**
   * Flush error queue to remote logging service
   */
  private async flushErrorQueue(): Promise<void> {
    if (!this.isOnline || this.errorQueue.length === 0) {
      return;
    }

    const errorsToFlush = [...this.errorQueue];
    this.errorQueue = [];

    try {
      // Log to Supabase
      for (const error of errorsToFlush) {
        await supabase.from('error_logs').insert([{
          error_type: error.type,
          message: error.message,
          stack_trace: error.stack,
          context: error.context,
          details: error.details,
          severity: this.calculateSeverity(error),
          created_at: error.timestamp
        }]);
      }

      // Clear from local storage
      localStorage.removeItem('queued_errors');

    } catch (error) {
      console.error('Failed to flush error queue:', error);
      
      // Re-queue errors for retry
      this.errorQueue.unshift(...errorsToFlush);
      
      // Store in local storage for persistence
      try {
        const existingErrors = JSON.parse(localStorage.getItem('queued_errors') || '[]');
        localStorage.setItem('queued_errors', JSON.stringify([
          ...existingErrors,
          ...errorsToFlush
        ].slice(-100))); // Keep last 100 errors
      } catch (storageError) {
        console.error('Failed to store errors locally:', storageError);
      }
    }
  }

  /**
   * Calculate error severity based on context
   */
  private calculateSeverity(errorData: any): string {
    if (this.isCriticalError(errorData)) {
      return 'critical';
    }

    if (errorData.type === 'ai_error') {
      const details = errorData.details as AIErrorDetails;
      switch (details.errorType) {
        case 'timeout':
        case 'rate_limit':
          return 'high';
        case 'function_error':
          return 'medium';
        default:
          return 'low';
      }
    }

    return 'medium';
  }

  /**
   * Start periodic error queue flushing
   */
  private startPeriodicFlush(): void {
    this.flushInterval = setInterval(() => {
      this.flushErrorQueue();
    }, 30000); // Flush every 30 seconds
  }

  /**
   * Get recent errors for debugging
   */
  getRecentErrors(limit: number = 10): any[] {
    const localErrors = JSON.parse(localStorage.getItem('queued_errors') || '[]');
    return [...this.errorQueue, ...localErrors]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, limit);
  }

  /**
   * Get performance alerts from local storage
   */
  getPerformanceAlerts(): any[] {
    return JSON.parse(localStorage.getItem('performance_alerts') || '[]');
  }

  /**
   * Clear all stored errors and alerts
   */
  clearErrorData(): void {
    this.errorQueue = [];
    localStorage.removeItem('queued_errors');
    localStorage.removeItem('performance_alerts');
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }
    this.flushErrorQueue();
  }
}

// Performance monitoring hooks
export const usePerformanceMonitoring = () => {
  const errorTracker = ErrorTracker.getInstance();

  const trackAIPerformance = async (
    operation: () => Promise<any>,
    functionName: string,
    expectedTokens?: number
  ) => {
    const startTime = performance.now();
    let success = false;
    let tokenUsage = 0;
    let cacheHit = false;

    try {
      const result = await operation();
      success = true;
      
      // Extract performance data from result if available
      if (result && typeof result === 'object') {
        tokenUsage = result.tokenUsage?.total || expectedTokens || 0;
        cacheHit = result.cacheHit || false;
      }

      return result;
    } catch (error) {
      const responseTime = performance.now() - startTime;
      
      await errorTracker.trackAIError(error as Error, {
        functionCalled: functionName,
        responseTime,
        tokenUsage,
        cacheAttempted: true,
        errorType: determineErrorType(error as Error)
      });

      throw error;
    } finally {
      const responseTime = performance.now() - startTime;

      // Track performance metrics
      if (success) {
        await errorTracker.logAIPerformanceMetric({
          responseTime,
          cacheHit,
          tokenUsage,
          functionCalled: functionName,
          errorOccurred: false
        });
      }

      // Check performance thresholds
      if (responseTime > 1000) {
        await errorTracker.trackPerformanceAlert({
          metric: 'ai_response_time',
          currentValue: responseTime,
          threshold: 750,
          severity: responseTime > 2000 ? 'critical' : 'high'
        });
      }
    }
  };

  const trackPagePerformance = (pageName: string) => {
    const observer = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      
      entries.forEach(async (entry) => {
        if (entry.entryType === 'navigation') {
          const navEntry = entry as PerformanceNavigationTiming;
          const loadTime = navEntry.loadEventEnd - navEntry.fetchStart;
          
          if (loadTime > 3000) { // 3 second threshold
            await errorTracker.trackPerformanceAlert({
              metric: 'page_load_time',
              currentValue: loadTime,
              threshold: 3000,
              severity: loadTime > 5000 ? 'high' : 'medium'
            });
          }
        }
      });
    });

    observer.observe({ entryTypes: ['navigation'] });
    
    return () => observer.disconnect();
  };

  return {
    trackAIPerformance,
    trackPagePerformance,
    trackError: errorTracker.trackError.bind(errorTracker),
    getRecentErrors: errorTracker.getRecentErrors.bind(errorTracker),
    getPerformanceAlerts: errorTracker.getPerformanceAlerts.bind(errorTracker)
  };
};

/**
 * Determine error type from error object
 */
function determineErrorType(error: Error): AIErrorDetails['errorType'] {
  const message = error.message.toLowerCase();
  
  if (message.includes('timeout')) return 'timeout';
  if (message.includes('rate limit')) return 'rate_limit';
  if (message.includes('network')) return 'network_error';
  if (message.includes('function')) return 'function_error';
  
  return 'invalid_response';
}

// Export singleton instance
export const errorTracker = ErrorTracker.getInstance();

// Error boundary helper for React components
export const withErrorTracking = <P extends object>(
  WrappedComponent: React.ComponentType<P>,
  componentName: string
) => {
  return React.forwardRef<any, P>((props, ref) => {
    const { trackError } = usePerformanceMonitoring();

    const ErrorBoundary: React.FC<{ children: React.ReactNode }> = ({ children }) => {
      React.useEffect(() => {
        const handleError = (error: Error) => {
          trackError(error, {
            component: componentName,
            function: 'render'
          });
        };

        window.addEventListener('error', handleError);
        
        return () => window.removeEventListener('error', handleError);
      }, []);

      return React.createElement(React.Fragment, null, children);
    };

    return React.createElement(
      ErrorBoundary,
      null,
      React.createElement(WrappedComponent, { ...props, ref })
    );
  });
};

export default ErrorTracker; 