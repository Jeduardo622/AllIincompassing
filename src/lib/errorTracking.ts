import { supabase } from './supabase';
import type { Json } from './generated/database.types';
import { logger } from './logger/logger';
import { redactPhi } from './logger/redactPhi';
import { toError } from './logger/normalizeError';
import { isMissingRpcFunctionError } from './supabase/isMissingRpcFunctionError';

const hasBrowserEnvironment = typeof window !== 'undefined' && typeof navigator !== 'undefined';

const safeNavigator = (): Navigator | undefined => (typeof navigator !== 'undefined' ? navigator : undefined);
const safeWindow = (): Window | undefined => (typeof window !== 'undefined' ? window : undefined);
const safeLocationHref = (): string | undefined => safeWindow()?.location?.href;
const safeUserAgent = (): string | undefined => safeNavigator()?.userAgent;
const hasPerformanceObserverSupport = typeof PerformanceObserver !== 'undefined';

const getLocalStorageItem = (key: string): string | null => {
  if (typeof localStorage === 'undefined') {
    return null;
  }

  try {
    return localStorage.getItem(key);
  } catch (error) {
    logger.error('Failed to read from local storage', {
      error: toError(error, 'Local storage read failed'),
      metadata: {
        scope: 'errorTracking.storage.read',
        key
      }
    });
    return null;
  }
};

const setLocalStorageItem = (key: string, value: string): void => {
  if (typeof localStorage === 'undefined') {
    return;
  }

  try {
    localStorage.setItem(key, value);
  } catch (error) {
    logger.error('Failed to write to local storage', {
      error: toError(error, 'Local storage write failed'),
      metadata: {
        scope: 'errorTracking.storage.write',
        key
      }
    });
  }
};

const removeLocalStorageItem = (key: string): void => {
  if (typeof localStorage === 'undefined') {
    return;
  }

  try {
    localStorage.removeItem(key);
  } catch (error) {
    logger.error('Failed to remove local storage item', {
      error: toError(error, 'Local storage remove failed'),
      metadata: {
        scope: 'errorTracking.storage.remove',
        key
      }
    });
  }
};

const randomId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return Math.random().toString(36).slice(2, 10);
};

const now = (): number => {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }

  return Date.now();
};

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
  audit?: Record<string, unknown>;
  errorType:
    | 'timeout'
    | 'rate_limit'
    | 'invalid_response'
    | 'function_error'
    | 'network_error'
    | 'guardrail_violation';
}

interface PerformanceAlert {
  metric: string;
  currentValue: number;
  threshold: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  autoResolve?: boolean;
}

const sanitizeMessage = (value: unknown): string => {
  if (typeof value === 'string') {
    return redactPhi(value) as string;
  }

  if (value === null || value === undefined) {
    return '';
  }

  return redactPhi(String(value)) as string;
};

const sanitizeOptionalString = (value: unknown): string | undefined => (
  typeof value === 'string' ? (redactPhi(value) as string) : undefined
);

const sanitizeRecord = <T>(value: T | undefined | null): T | undefined | null => {
  if (value === undefined || value === null) {
    return value;
  }

  return redactPhi(value) as T;
};

const sanitizeFunctionIdentifier = (value: unknown): string => {
  if (typeof value === 'string') {
    const sanitized = redactPhi(value) as string;
    return sanitized || 'unknown';
  }

  return 'unknown';
};

class ErrorTracker {
  private static instance: ErrorTracker;
  private readonly isBrowserEnvironment: boolean;
  private errorQueue: Array<any> = [];
  private isOnline = safeNavigator()?.onLine ?? true;
  private flushInterval: NodeJS.Timeout | null = null;
  private remoteLoggingDisabled = false;

  constructor() {
    this.isBrowserEnvironment = hasBrowserEnvironment;

    if (this.isBrowserEnvironment) {
      this.initializeErrorTracking();
      this.startPeriodicFlush();
    }
  }

  static getInstance(): ErrorTracker {
    if (!ErrorTracker.instance) {
      ErrorTracker.instance = new ErrorTracker();
    }
    return ErrorTracker.instance;
  }

  private initializeErrorTracking() {
    if (!this.isBrowserEnvironment) {
      return;
    }

    const browserWindow = safeWindow();

    if (!browserWindow) {
      return;
    }

    // Global error handler
    browserWindow.addEventListener('error', (event) => {
      this.trackError(event.error, {
        component: 'global',
        url: browserWindow.location.href,
        timestamp: new Date()
      });
    });

    // Unhandled promise rejections
    browserWindow.addEventListener('unhandledrejection', (event) => {
      this.trackError(new Error(event.reason), {
        component: 'promise',
        url: browserWindow.location.href,
        timestamp: new Date()
      });
    });

    // Online/offline status
    browserWindow.addEventListener('online', () => {
      this.isOnline = true;
      this.flushErrorQueue();
    });

    browserWindow.addEventListener('offline', () => {
      this.isOnline = false;
    });
  }

  /**
   * Track AI-specific errors with detailed context
  */
  async trackAIError(error: Error, details: AIErrorDetails, context?: ErrorContext): Promise<void> {
    const baseContext: ErrorContext = {
      ...(context ?? {}),
      timestamp: new Date(),
      ...(safeUserAgent() ? { userAgent: safeUserAgent() } : {}),
      ...(safeLocationHref() ? { url: safeLocationHref() } : {})
    };

    const sanitizedDetails = sanitizeRecord(details) as AIErrorDetails;
    const sanitizedContext = sanitizeRecord(baseContext) as ErrorContext;

    const errorData = {
      type: 'ai_error',
      message: sanitizeMessage(error.message),
      stack: sanitizeOptionalString(error.stack),
      details: sanitizedDetails,
      context: sanitizedContext
    };

    // Log performance metrics for AI errors
    await this.logAIPerformanceMetric({
      responseTime: sanitizedDetails.responseTime ?? 0,
      cacheHit: false,
      tokenUsage: sanitizedDetails.tokenUsage ?? 0,
      functionCalled: sanitizedDetails.functionCalled ?? 'unknown',
      errorOccurred: true,
      errorType: sanitizedDetails.errorType
    });

    this.queueError(errorData);
  }

  /**
   * Track general application errors
   */
  trackError(error: Error, context?: ErrorContext): void {
    const baseContext: ErrorContext = {
      ...(context ?? {}),
      timestamp: new Date(),
      ...(safeUserAgent() ? { userAgent: safeUserAgent() } : {}),
      ...(safeLocationHref() ? { url: safeLocationHref() } : {})
    };

    const sanitizedContext = sanitizeRecord(baseContext) as ErrorContext;

    const errorData = {
      type: 'application_error',
      message: sanitizeMessage(error.message),
      stack: sanitizeOptionalString(error.stack),
      context: sanitizedContext
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
      const storedAlerts = getLocalStorageItem('performance_alerts');
      const alerts = storedAlerts
        ? (() => {
            try {
              return JSON.parse(storedAlerts);
            } catch (parseError) {
              logger.error('Failed to parse performance alerts from local storage', {
                error: toError(parseError, 'Performance alerts parse failed'),
                metadata: {
                  scope: 'errorTracking.performanceAlert'
                }
              });
              return [];
            }
          })()
        : [];
      alerts.push({
        ...alert,
        timestamp: new Date().toISOString(),
        id: randomId()
      });

      // Keep only last 50 alerts
      setLocalStorageItem('performance_alerts', JSON.stringify(alerts.slice(-50)));

    } catch (error) {
      logger.error('Failed to track performance alert', {
        error: toError(error, 'Performance alert tracking failed'),
        metadata: {
          scope: 'errorTracking.performanceAlert',
        },
      });
    }
  }

  /**
   * Log AI performance metrics for monitoring
   */
  public async logAIPerformanceMetric(metrics: {
    responseTime: number;
    cacheHit: boolean;
    tokenUsage: number;
    functionCalled: string;
    errorOccurred: boolean;
    errorType?: string;
  }): Promise<void> {
    const sanitizedFunctionCalled = sanitizeFunctionIdentifier(metrics.functionCalled);

    try {
      await supabase.rpc('log_ai_performance', {
        p_response_time_ms: metrics.responseTime,
        p_cache_hit: metrics.cacheHit,
        p_token_usage: {
          total: metrics.tokenUsage,
          error_type: metrics.errorType
        },
        p_function_called: sanitizedFunctionCalled,
        p_error_occurred: metrics.errorOccurred,
        p_user_id: null, // Will be set by RLS
        p_conversation_id: null
      });
    } catch (error) {
      logger.error('Failed to log AI performance metric', {
        error: toError(error, 'AI performance logging failed'),
        metadata: {
          scope: 'errorTracking.aiPerformance',
          functionCalled: sanitizedFunctionCalled,
        },
      });
    }
  }

  /**
   * Queue errors for batch processing
   */
  private queueError(errorData: any): void {
    this.errorQueue.push({
      ...errorData,
      id: randomId(),
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

    if (this.remoteLoggingDisabled) {
      this.errorQueue.unshift(...errorsToFlush);
      this.persistErrors(errorsToFlush);
      return;
    }

    try {
      // Log to Supabase
      const failedErrors: Array<any> = [];
      for (const error of errorsToFlush) {
        const sanitizedType = typeof error.type === 'string'
          ? (redactPhi(error.type) as string)
          : sanitizeMessage(error.type);
        const sanitizedMessage = sanitizeMessage(error.message);
        const sanitizedStack = sanitizeOptionalString(error.stack);
        const sanitizedContext = sanitizeRecord(error.context) as ErrorContext | undefined;
        const sanitizedDetails = sanitizeRecord(error.details);
        const sanitizedErrorData = {
          ...error,
          type: sanitizedType,
          message: sanitizedMessage,
          stack: sanitizedStack,
          context: sanitizedContext,
          details: sanitizedDetails
        };

        const enableRemoteLogging = (import.meta as any)?.env?.VITE_ENABLE_REMOTE_ERROR_LOGGING ?? '1';
        if (String(enableRemoteLogging) !== '1') {
          continue;
        }

        const { error: rpcError } = await supabase.rpc('log_error_event', {
          payload: {
            error_type: sanitizedType,
            message: sanitizedMessage,
            stack: sanitizedStack ?? null,
            context: (sanitizedContext ?? null) as Json | null,
            details: (sanitizedDetails ?? null) as Json | null,
            severity: this.calculateSeverity(sanitizedErrorData),
            url: (sanitizedContext?.url ?? null) as string | null,
            user_agent: (sanitizedContext?.userAgent ?? null) as string | null,
          } as unknown as Json,
        });

        if (rpcError) {
          if (isMissingRpcFunctionError(rpcError, 'log_error_event')) {
            this.remoteLoggingDisabled = true;
            failedErrors.push(sanitizedErrorData);
            logger.warn('Remote error logging disabled: log_error_event RPC unavailable', {
              error: toError(rpcError, 'log_error_event RPC missing'),
              metadata: { pendingErrors: errorsToFlush.length },
              track: false,
            });
            continue;
          }
          throw rpcError;
        }
      }

      if (failedErrors.length > 0) {
        this.errorQueue.unshift(...failedErrors);
        this.persistErrors(failedErrors);
      }

      // Clear from local storage
      removeLocalStorageItem('queued_errors');

    } catch (error) {
      logger.error('Failed to flush error queue', {
        error: toError(error, 'Error queue flush failed'),
        metadata: {
          scope: 'errorTracking.flush',
        },
        track: false,
      });

      // Re-queue errors for retry
      this.errorQueue.unshift(...errorsToFlush);

      this.persistErrors(errorsToFlush);
    }
  }

  private persistErrors(errorsToPersist: any[]): void {
    try {
      const existingErrorsRaw = getLocalStorageItem('queued_errors');
      const existingErrors = existingErrorsRaw
        ? (() => {
            try {
              return JSON.parse(existingErrorsRaw);
            } catch (parseError) {
              logger.error('Failed to parse queued errors from local storage', {
                error: toError(parseError, 'Queued errors parse failed'),
                metadata: {
                  scope: 'errorTracking.flush'
                },
                track: false,
              });
              return [];
            }
          })()
        : [];
      const sanitizedExistingErrors = Array.isArray(existingErrors)
        ? existingErrors.map((queuedError: any) => ({
          ...queuedError,
          message: sanitizeMessage(queuedError?.message),
          stack: sanitizeOptionalString(queuedError?.stack),
          context: sanitizeRecord(queuedError?.context),
          details: sanitizeRecord(queuedError?.details)
        }))
        : [];
      const sanitizedNewErrors = errorsToPersist.map((queuedError) => ({
        ...queuedError,
        message: sanitizeMessage(queuedError?.message),
        stack: sanitizeOptionalString(queuedError?.stack),
        context: sanitizeRecord(queuedError?.context),
        details: sanitizeRecord(queuedError?.details)
      }));

      setLocalStorageItem('queued_errors', JSON.stringify([
        ...sanitizedExistingErrors,
        ...sanitizedNewErrors
      ].slice(-100)));
    } catch (storageError) {
      logger.error('Failed to store errors locally', {
        error: toError(storageError, 'Persisting queued errors failed'),
        metadata: {
          scope: 'errorTracking.flush',
        },
        track: false,
      });
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
    const localErrorsRaw = getLocalStorageItem('queued_errors');
    const localErrors = localErrorsRaw
      ? (() => {
          try {
            return JSON.parse(localErrorsRaw);
          } catch (parseError) {
            logger.error('Failed to parse recent errors from local storage', {
              error: toError(parseError, 'Recent errors parse failed'),
              metadata: {
                scope: 'errorTracking.getRecentErrors'
              }
            });
            return [];
          }
        })()
      : [];
    return [...this.errorQueue, ...localErrors]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, limit);
  }

  /**
   * Get performance alerts from local storage
   */
  getPerformanceAlerts(): any[] {
    const storedAlerts = getLocalStorageItem('performance_alerts');

    if (!storedAlerts) {
      return [];
    }

    try {
      return JSON.parse(storedAlerts);
    } catch (parseError) {
      logger.error('Failed to parse performance alerts during retrieval', {
        error: toError(parseError, 'Performance alerts retrieval failed'),
        metadata: {
          scope: 'errorTracking.getPerformanceAlerts'
        }
      });
      return [];
    }
  }

  /**
   * Clear all stored errors and alerts
   */
  clearErrorData(): void {
    this.errorQueue = [];
    removeLocalStorageItem('queued_errors');
    removeLocalStorageItem('performance_alerts');
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

type ErrorTrackerApi = Pick<
  ErrorTracker,
  | 'trackAIError'
  | 'trackError'
  | 'trackPerformanceAlert'
  | 'logAIPerformanceMetric'
  | 'getRecentErrors'
  | 'getPerformanceAlerts'
  | 'clearErrorData'
  | 'destroy'
>;

const serverSafeErrorTracker: ErrorTrackerApi = {
  async trackAIError() {
    // No-op in non-browser environments
  },
  trackError() {
    // No-op in non-browser environments
  },
  async trackPerformanceAlert() {
    // No-op in non-browser environments
  },
  async logAIPerformanceMetric() {
    // No-op in non-browser environments
  },
  getRecentErrors() {
    return [];
  },
  getPerformanceAlerts() {
    return [];
  },
  clearErrorData() {
    // No-op in non-browser environments
  },
  destroy() {
    // No-op in non-browser environments
  }
};

export const getErrorTracker = (): ErrorTrackerApi => (
  hasBrowserEnvironment
    ? ErrorTracker.getInstance()
    : serverSafeErrorTracker
);

// Performance monitoring hooks
export const usePerformanceMonitoring = () => {
  const errorTracker = getErrorTracker();

  const trackAIPerformance = async (
    operation: () => Promise<any>,
    functionName: string,
    expectedTokens?: number
  ) => {
    const startTime = now();
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
      const responseTime = now() - startTime;

      await errorTracker.trackAIError(error as Error, {
        functionCalled: functionName,
        responseTime,
        tokenUsage,
        cacheAttempted: true,
        errorType: determineErrorType(error as Error)
      });

      throw error;
    } finally {
      const responseTime = now() - startTime;

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

  const trackPagePerformance = (_pageName: string) => {
    if (!hasBrowserEnvironment || !hasPerformanceObserverSupport) {
      return () => {};
    }

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

// Export singleton instance (browser) or no-op (server)
export const errorTracker = getErrorTracker();

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

        if (typeof window === 'undefined') {
          return undefined;
        }

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
