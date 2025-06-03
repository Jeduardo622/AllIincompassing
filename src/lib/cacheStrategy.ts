import { useCallback } from 'react';
import { useQueryClient, QueryClient } from '@tanstack/react-query';

// ============================================================================
// TIERED CACHE STRATEGY
// ============================================================================

export const CACHE_STRATEGIES = {
  // Static/semi-static data - long cache times
  ENTITIES: {
    therapists: 15 * 60 * 1000,    // 15 minutes
    clients: 15 * 60 * 1000,      // 15 minutes  
    locations: 30 * 60 * 1000,    // 30 minutes
    settings: 30 * 60 * 1000,     // 30 minutes
    dropdowns: 20 * 60 * 1000,    // 20 minutes (batched dropdown data)
  },
  
  // Dynamic data - short cache times
  SESSIONS: {
    current_week: 2 * 60 * 1000,  // 2 minutes
    future_weeks: 10 * 60 * 1000, // 10 minutes
    past_sessions: 30 * 60 * 1000, // 30 minutes (rarely change)
    schedule_batch: 3 * 60 * 1000, // 3 minutes (batched schedule data)
  },
  
  // Reports - medium cache with smart invalidation
  REPORTS: {
    current_month: 5 * 60 * 1000,  // 5 minutes
    past_months: 60 * 60 * 1000,   // 1 hour (stable data)
    session_metrics: 10 * 60 * 1000, // 10 minutes (aggregated data)
  },
  
  // Dashboard - frequent updates
  DASHBOARD: {
    summary: 2 * 60 * 1000,       // 2 minutes
    today_sessions: 1 * 60 * 1000, // 1 minute
    metrics: 5 * 60 * 1000,       // 5 minutes
  },
  
  // Real-time data - very short cache
  REALTIME: {
    notifications: 30 * 1000,      // 30 seconds
    online_status: 60 * 1000,      // 1 minute
    live_updates: 15 * 1000,       // 15 seconds
  }
} as const;

// ============================================================================
// CACHE KEY GENERATORS
// ============================================================================

export const generateCacheKey = {
  sessions: (startDate: string, endDate: string, therapistId?: string, clientId?: string) => [
    'sessions',
    startDate,
    endDate,
    therapistId || 'all',
    clientId || 'all'
  ],
  
  sessionsBatch: (startDate: string, endDate: string) => [
    'sessions-batch',
    startDate,
    endDate
  ],
  
  dropdowns: () => ['dropdowns'],
  
  reports: (type: string, startDate: string, endDate: string, filters?: Record<string, unknown>) => [
    'reports',
    type,
    startDate,
    endDate,
    JSON.stringify(filters || {})
  ],
  
  dashboard: () => ['dashboard'],
  
  sessionMetrics: (startDate: string, endDate: string, therapistId?: string, clientId?: string) => [
    'session-metrics',
    startDate,
    endDate,
    therapistId || 'all',
    clientId || 'all'
  ]
};

// ============================================================================
// SMART CACHE INVALIDATION
// ============================================================================

export const useSmartInvalidation = () => {
  const queryClient = useQueryClient();
  
  const invalidateRelated = useCallback((
    entity: 'sessions' | 'clients' | 'therapists' | 'authorizations' | 'billing',
    action: 'create' | 'update' | 'delete',
    entityId?: string
  ) => {
    const invalidationMap = {
      sessions: [
        'sessions',
        'sessions-batch',
        'reports',
        'dashboard',
        'session-metrics'
      ],
      clients: [
        'clients',
        'dropdowns',
        'sessions',
        'reports',
        'dashboard'
      ],
      therapists: [
        'therapists',
        'dropdowns',
        'sessions',
        'reports',
        'dashboard'
      ],
      authorizations: [
        'authorizations',
        'dashboard',
        'reports'
      ],
      billing: [
        'billing',
        'reports',
        'dashboard'
      ]
    };
    
    // Invalidate related query keys
    invalidationMap[entity]?.forEach(key => {
      queryClient.invalidateQueries({ queryKey: [key] });
    });
    
    // Log invalidation for monitoring
    console.log(`Cache invalidated for ${entity} ${action}`, {
      entity,
      action,
      entityId,
      invalidatedKeys: invalidationMap[entity],
      timestamp: new Date().toISOString()
    });
  }, [queryClient]);
  
  // Intelligent cache warming
  const warmCache = useCallback(async (keys: string[]) => {
    for (const key of keys) {
      try {
        await queryClient.prefetchQuery({
          queryKey: [key],
          staleTime: CACHE_STRATEGIES.ENTITIES.therapists, // Default to 15 minutes
        });
      } catch (error) {
        console.warn(`Failed to warm cache for ${key}:`, error);
      }
    }
  }, [queryClient]);
  
  return { invalidateRelated, warmCache };
};

// ============================================================================
// CACHE PERFORMANCE MONITORING
// ============================================================================

export const useCachePerformanceMonitor = () => {
  const queryClient = useQueryClient();
  
  const getCacheStats = useCallback(() => {
    const cache = queryClient.getQueryCache();
    const queries = cache.getAll();
    
    const stats = {
      totalQueries: queries.length,
      staleCaches: queries.filter(q => q.isStale()).length,
      activeCaches: queries.filter(q => !q.isStale()).length,
      errorCaches: queries.filter(q => q.state.status === 'error').length,
      cacheHitRate: 0,
      averageAge: 0,
      memoryUsage: 0
    };
    
    // Calculate cache hit rate (simplified)
    const activeQueries = queries.filter(q => q.state.status === 'success');
    stats.cacheHitRate = queries.length > 0 
      ? (activeQueries.length / queries.length) * 100 
      : 0;
    
    // Calculate average cache age
    const now = Date.now();
    const ages = queries
      .filter(q => q.state.dataUpdatedAt)
      .map(q => now - q.state.dataUpdatedAt);
    
    stats.averageAge = ages.length > 0 
      ? ages.reduce((sum, age) => sum + age, 0) / ages.length 
      : 0;
    
    // Estimate memory usage (rough calculation)
    stats.memoryUsage = queries.reduce((total, query) => {
      try {
        return total + JSON.stringify(query.state.data || {}).length;
      } catch {
        return total;
      }
    }, 0);
    
    return stats;
  }, [queryClient]);
  
  const clearStaleCache = useCallback(() => {
    const cache = queryClient.getQueryCache();
    const staleQueries = cache.getAll().filter(q => q.isStale());
    
    staleQueries.forEach(query => {
      queryClient.removeQueries({ queryKey: query.queryKey });
    });
    
    console.log(`Cleared ${staleQueries.length} stale cache entries`);
  }, [queryClient]);
  
  return { getCacheStats, clearStaleCache };
};

// ============================================================================
// OPTIMIZED QUERY HOOKS
// ============================================================================

export const useOptimizedQuery = <T>(
  queryKey: unknown[],
  queryFn: () => Promise<T>,
  cacheStrategy: keyof typeof CACHE_STRATEGIES,
  subKey?: keyof typeof CACHE_STRATEGIES[keyof typeof CACHE_STRATEGIES]
) => {
  // Get cache time based on strategy
  const getCacheTime = () => {
    const strategy = CACHE_STRATEGIES[cacheStrategy];
    if (subKey && typeof strategy === 'object') {
      return strategy[subKey as keyof typeof strategy] || 5 * 60 * 1000;
    }
    return typeof strategy === 'number' ? strategy : 5 * 60 * 1000;
  };
  
  return {
    queryKey,
    queryFn,
    staleTime: getCacheTime(),
    gcTime: getCacheTime() * 2, // Keep in memory longer than stale time
    refetchOnWindowFocus: false,
    refetchOnReconnect: 'always',
    retry: (failureCount: number, error: Error) => {
      // Don't retry on 4xx errors
      const errorWithStatus = error as Error & { status?: number };
      if (errorWithStatus?.status && errorWithStatus.status >= 400 && errorWithStatus.status < 500) {
        return false;
      }
      return failureCount < 2;
    },
    networkMode: 'online' as const,
  };
};

// ============================================================================
// CACHE PRELOADING STRATEGIES
// ============================================================================

export const useCachePreloading = () => {
  const queryClient = useQueryClient();
  
  const preloadScheduleData = useCallback(async (currentWeek: Date) => {
    // Preload next week's data
    const nextWeek = new Date(currentWeek);
    nextWeek.setDate(nextWeek.getDate() + 7);
    
    try {
      await queryClient.prefetchQuery({
        queryKey: generateCacheKey.sessionsBatch(
          currentWeek.toISOString(),
          nextWeek.toISOString()
        ),
        staleTime: CACHE_STRATEGIES.SESSIONS.future_weeks,
      });
    } catch (error) {
      console.warn('Failed to preload next week data:', error);
    }
  }, [queryClient]);
  
  const preloadDropdowns = useCallback(async () => {
    try {
      await queryClient.prefetchQuery({
        queryKey: generateCacheKey.dropdowns(),
        staleTime: CACHE_STRATEGIES.ENTITIES.dropdowns,
      });
    } catch (error) {
      console.warn('Failed to preload dropdown data:', error);
    }
  }, [queryClient]);
  
  return { preloadScheduleData, preloadDropdowns };
};

// ============================================================================
// CACHE CONFIGURATION
// ============================================================================

export const createOptimizedQueryClient = (existingClient?: QueryClient) => {
  const queryClient = existingClient || new QueryClient();
  
  // Set up global cache defaults
  queryClient.setDefaultOptions({
    queries: {
      retry: (failureCount: number, error: Error) => {
        const errorWithStatus = error as Error & { status?: number };
        if (errorWithStatus?.status && errorWithStatus.status >= 400 && errorWithStatus.status < 500) {
          return false;
        }
        return failureCount < 2;
      },
      refetchOnWindowFocus: false,
      refetchOnReconnect: 'always',
      staleTime: 5 * 60 * 1000, // 5 minutes default
      gcTime: 30 * 60 * 1000, // 30 minutes garbage collection
      networkMode: 'online',
    },
    mutations: {
      retry: 1,
      networkMode: 'online',
    },
  });
  
  return queryClient;
};

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  CACHE_STRATEGIES,
  generateCacheKey,
  useSmartInvalidation,
  useCachePerformanceMonitor,
  useOptimizedQuery,
  useCachePreloading,
  createOptimizedQueryClient
};