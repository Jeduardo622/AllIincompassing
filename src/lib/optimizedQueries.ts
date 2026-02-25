import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import { CACHE_STRATEGIES, generateCacheKey, useSmartInvalidation } from './cacheStrategy';
import { useDebounce } from './performance';
import type { Session } from '../types';
import { logger } from './logger/logger';
import { toError } from './logger/normalizeError';
import { useDashboardLiveRefresh } from './dashboardLiveRefresh';

// ============================================================================
// BATCHED SCHEDULE QUERIES (Replaces N+1 queries)
// ============================================================================

/**
 * Optimized schedule data fetching - replaces 3 separate queries with 1 RPC call
 * Reduces API calls by ~60% on Schedule page
 */
export const useScheduleDataBatch = (startDate: Date, endDate: Date) => {
  return useQuery({
    queryKey: generateCacheKey.sessionsBatch(startDate.toISOString(), endDate.toISOString()),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_schedule_data_batch', {
        p_start_date: startDate.toISOString(),
        p_end_date: endDate.toISOString()
      });

      if (error) {
        // Gracefully fall back to the non-batched queries when the RPC is unavailable/misconfigured.
        logger.warn('Schedule batch RPC failed; falling back to individual queries', {
          metadata: {
            rpc: 'get_schedule_data_batch',
            code: (error as { code?: string }).code ?? null,
            message: (error as { message?: string }).message ?? 'Unknown RPC error',
          },
        });
        return null;
      }
      return data;
    },
    retry: false,
    staleTime: CACHE_STRATEGIES.SESSIONS.schedule_batch,
    gcTime: CACHE_STRATEGIES.SESSIONS.schedule_batch * 2,
    refetchOnWindowFocus: false,
    refetchOnReconnect: 'always',
  });
};

/**
 * Optimized sessions query with built-in joins
 * Replaces separate therapist/client lookups
 */
export const useSessionsOptimized = (
  startDate: Date,
  endDate: Date,
  therapistId?: string,
  clientId?: string
) => {
  // Debounce filter changes to prevent excessive API calls
  const debouncedTherapistId = useDebounce(therapistId, 300);
  const debouncedClientId = useDebounce(clientId, 300);
  
  return useQuery({
    queryKey: generateCacheKey.sessions(
      startDate.toISOString(),
      endDate.toISOString(),
      debouncedTherapistId,
      debouncedClientId
    ),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_sessions_optimized', {
        p_start_date: startDate.toISOString(),
        p_end_date: endDate.toISOString(),
        p_therapist_id: debouncedTherapistId || null,
        p_client_id: debouncedClientId || null
      });
      
      if (error) throw error;
      
      // Transform RPC result back to expected format
      return data?.map((item: { session_data: Session }) => item.session_data) || [];
    },
    staleTime: CACHE_STRATEGIES.SESSIONS.current_week,
    enabled: !!startDate && !!endDate,
  });
};

// ============================================================================
// OPTIMIZED DROPDOWN DATA
// ============================================================================

/**
 * Cached dropdown data - single query for all dropdowns
 * Reduces 3 separate queries to 1, cached for 20 minutes
 */
export const useDropdownData = () => {
  return useQuery({
    queryKey: generateCacheKey.dropdowns(),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_dropdown_data');
      if (error) throw error;
      return data;
    },
    staleTime: CACHE_STRATEGIES.ENTITIES.dropdowns,
    gcTime: CACHE_STRATEGIES.ENTITIES.dropdowns * 2,
    refetchOnWindowFocus: false,
  });
};

// ============================================================================
// REPORT OPTIMIZATION
// ============================================================================

/**
 * Database-level report aggregations
 * Replaces client-side calculations with optimized SQL
 */
export const useSessionMetrics = (
  startDate: string,
  endDate: string,
  therapistId?: string,
  clientId?: string
) => {
  const debouncedFilters = useDebounce({ therapistId, clientId }, 300);
  
  return useQuery({
    queryKey: generateCacheKey.sessionMetrics(
      startDate,
      endDate,
      debouncedFilters.therapistId,
      debouncedFilters.clientId
    ),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_session_metrics', {
        p_start_date: startDate,
        p_end_date: endDate,
        p_therapist_id: debouncedFilters.therapistId || null,
        p_client_id: debouncedFilters.clientId || null
      });
      
      if (error) throw error;
      return data;
    },
    staleTime: CACHE_STRATEGIES.REPORTS.session_metrics,
    enabled: !!startDate && !!endDate,
  });
};

// ============================================================================
// DASHBOARD OPTIMIZATION
// ============================================================================

/**
 * Batched dashboard data - single query for all dashboard metrics
 * Reduces 5+ separate queries to 1 optimized RPC call
 */
export const fetchDashboardData = async () => {
  // Proxy through server to enforce SECURITY INVOKER policy and org checks
  const headers = new Headers({ 'Accept': 'application/json' });
  try {
    const result: any = await (supabase as any)?.auth?.getSession?.();
    const token = result?.data?.session?.access_token;
    if (typeof token === 'string' && token.length > 0) {
      headers.set('Authorization', `Bearer ${token}`);
    }
  } catch {
    // In tests/SSR, session lookup may fail; proceed without auth header
  }
  const response = await fetch('/api/dashboard', { method: 'GET', headers });
  if (!response.ok) {
    const status = response.status;
    const payload = await response.json().catch(() => ({}));
    const message = typeof payload?.error === 'string' ? payload.error : 'Failed to load dashboard data';
    const error = new Error(message) as Error & { status?: number };
    error.status = status;
    throw error;
  }
  return response.json();
};

export const useDashboardData = () => {
  const { isLiveRole, intervalMs } = useDashboardLiveRefresh();
  return useQuery({
    queryKey: generateCacheKey.dashboard(),
    queryFn: fetchDashboardData,
    staleTime: CACHE_STRATEGIES.DASHBOARD.summary,
    gcTime: CACHE_STRATEGIES.DASHBOARD.summary * 2,
    keepPreviousData: true,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    refetchInterval: intervalMs,
    refetchIntervalInBackground: isLiveRole,
  });
};

// ============================================================================
// CURSOR-BASED PAGINATION
// ============================================================================

/**
 * Cursor-based pagination hook for large datasets
 * More efficient than offset-based pagination for large tables
 */
export const useCursorPagination = <T extends { created_at: string; id: string }>(
  table: string,
  pageSize = 50,
  orderBy = 'created_at',
  ascending = false
) => {
  return useQuery({
    queryKey: [table, 'cursor-pagination', pageSize, orderBy, ascending],
    queryFn: async ({ pageParam }: { pageParam?: string }) => {
      let query = supabase
        .from(table)
        .select('*')
        .order(orderBy, { ascending })
        .limit(pageSize + 1); // +1 to check if there's next page
      
      if (pageParam) {
        query = ascending 
          ? query.gt(orderBy, pageParam)
          : query.lt(orderBy, pageParam);
      }
      
      const { data, error } = await query;
      if (error) throw error;
      
      const hasNextPage = data.length > pageSize;
      const items = hasNextPage ? data.slice(0, -1) : data;
      const nextCursor = hasNextPage && items.length > 0 
        ? items[items.length - 1][orderBy]
        : null;
      
      return {
        items: items as T[],
        nextCursor,
        hasNextPage,
      };
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
};

// ============================================================================
// OPTIMIZED MUTATIONS WITH SMART INVALIDATION
// ============================================================================

/**
 * Session mutations with intelligent cache invalidation
 */
export const useOptimizedSessionMutations = () => {
  const _queryClient = useQueryClient();
  const { invalidateRelated } = useSmartInvalidation();
  
  const createSession = useMutation({
    mutationFn: async (newSession: Partial<Session>) => {
      const { data, error } = await supabase
        .from('sessions')
        .insert([newSession])
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      invalidateRelated('sessions', 'create');
    },
  });
  
  const updateSession = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<Session> }) => {
      const { data, error } = await supabase
        .from('sessions')
        .update(updates)
        .eq('id', id)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: (_, variables) => {
      invalidateRelated('sessions', 'update', variables.id);
    },
  });
  
  const deleteSession = useMutation({
    mutationFn: async (sessionId: string) => {
      const { error } = await supabase
        .from('sessions')
        .delete()
        .eq('id', sessionId);
      
      if (error) throw error;
    },
    onSuccess: (_, sessionId) => {
      invalidateRelated('sessions', 'delete', sessionId);
    },
  });
  
  return { createSession, updateSession, deleteSession };
};

// ============================================================================
// PERFORMANCE MONITORING HOOKS
// ============================================================================

/**
 * Query performance monitoring for optimization insights
 */
export const useQueryPerformanceMonitor = () => {
  const queryClient = useQueryClient();
  
  const logSlowQuery = (queryKey: unknown[], duration: number, dataSize?: number) => {
    if (duration > 1000) { // Log queries taking longer than 1 second
      const normalizedKey = Array.isArray(queryKey)
        ? queryKey.map((keyPart) => String(keyPart)).join(':')
        : String(queryKey);

      logger.warn('Slow query detected', {
        metadata: {
          queryKey: normalizedKey,
          durationMs: Number(duration.toFixed(2)),
          dataSizeBytes: dataSize ?? null,
          timestamp: new Date().toISOString(),
        },
      });
      
      // In production, send to monitoring service
      if (typeof window !== 'undefined') {
        const slowQueries = JSON.parse(localStorage.getItem('slowQueries') || '[]');
        slowQueries.push({
          queryKey: queryKey.join('-'),
          duration,
          dataSize,
          timestamp: new Date().toISOString()
        });
        
        // Keep only last 50 slow queries
        if (slowQueries.length > 50) {
          slowQueries.splice(0, slowQueries.length - 50);
        }
        
        localStorage.setItem('slowQueries', JSON.stringify(slowQueries));
      }
    }
  };
  
  const getPerformanceReport = () => {
    if (typeof window === 'undefined') return null;
    
    const slowQueries = JSON.parse(localStorage.getItem('slowQueries') || '[]');
    const cache = queryClient.getQueryCache();
    const queries = cache.getAll();
    
    return {
      slowQueryCount: slowQueries.length,
      totalQueries: queries.length,
      cacheHitRate: queries.length > 0 
        ? (queries.filter(q => q.state.status === 'success').length / queries.length) * 100 
        : 0,
      slowQueries: slowQueries.slice(-10), // Last 10 slow queries
    };
  };
  
  return { logSlowQuery, getPerformanceReport };
};

// ============================================================================
// SMART PREFETCHING
// ============================================================================

/**
 * Intelligent data prefetching based on user behavior
 */
export const useSmartPrefetch = () => {
  const queryClient = useQueryClient();
  
  const prefetchNextWeek = async (currentWeekStart: Date) => {
    const nextWeekStart = new Date(currentWeekStart);
    nextWeekStart.setDate(nextWeekStart.getDate() + 7);
    
    const nextWeekEnd = new Date(nextWeekStart);
    nextWeekEnd.setDate(nextWeekEnd.getDate() + 6);
    
    try {
      await queryClient.prefetchQuery({
        queryKey: generateCacheKey.sessionsBatch(
          nextWeekStart.toISOString(),
          nextWeekEnd.toISOString()
        ),
        staleTime: CACHE_STRATEGIES.SESSIONS.future_weeks,
      });
    } catch (error) {
      logger.warn('Failed to prefetch next week data', {
        metadata: {
          scope: 'smartPrefetch.nextWeek',
          failure: toError(error, 'Next week prefetch failed').message,
        },
      });
    }
  };
  
  const prefetchReportData = async (currentMonth: Date) => {
    const nextMonth = new Date(currentMonth);
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    
    try {
      await queryClient.prefetchQuery({
        queryKey: generateCacheKey.sessionMetrics(
          nextMonth.toISOString().split('T')[0],
          new Date(nextMonth.getFullYear(), nextMonth.getMonth() + 1, 0).toISOString().split('T')[0]
        ),
        staleTime: CACHE_STRATEGIES.REPORTS.past_months,
      });
    } catch (error) {
      logger.warn('Failed to prefetch next month data', {
        metadata: {
          scope: 'smartPrefetch.nextMonth',
          failure: toError(error, 'Next month prefetch failed').message,
        },
      });
    }
  };
  
  return { prefetchNextWeek, prefetchReportData };
};