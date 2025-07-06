import { useEffect, useCallback, useRef } from 'react';
import { useQueryClient, QueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';

// ============================================================================
// CACHE CLEANUP CONFIGURATION
// ============================================================================

export interface CacheCleanupConfig {
  // Browser cache cleanup intervals (in milliseconds)
  intervals: {
    reactQuery: number;          // React Query cache cleanup
    localStorage: number;        // localStorage data cleanup
    sessionStorage: number;      // sessionStorage cleanup
    aiCache: number;            // AI response cache cleanup
    performanceData: number;    // Performance metrics cleanup
  };
  
  // Data retention policies (in milliseconds)
  retention: {
    slowQueries: number;        // Keep slow query logs
    performanceAlerts: number;  // Keep performance alerts
    errorLogs: number;         // Keep error logs
    aiCacheEntries: number;    // Keep AI cache entries
    chatHistory: number;       // Keep chat history
  };
  
  // Memory thresholds for aggressive cleanup
  memoryThresholds: {
    warning: number;           // Warning threshold (bytes)
    critical: number;          // Critical threshold (bytes)
    maxCacheSize: number;      // Max total cache size (bytes)
  };
  
  // Feature flags
  features: {
    enableAggressive: boolean;  // Enable aggressive cleanup
    enableCompression: boolean; // Enable data compression
    enableAnalytics: boolean;   // Enable cleanup analytics
  };
}

export const DEFAULT_CLEANUP_CONFIG: CacheCleanupConfig = {
  intervals: {
    reactQuery: 10 * 60 * 1000,      // 10 minutes
    localStorage: 15 * 60 * 1000,    // 15 minutes
    sessionStorage: 5 * 60 * 1000,   // 5 minutes
    aiCache: 30 * 60 * 1000,         // 30 minutes
    performanceData: 60 * 60 * 1000, // 1 hour
  },
  retention: {
    slowQueries: 7 * 24 * 60 * 60 * 1000,        // 7 days
    performanceAlerts: 30 * 24 * 60 * 60 * 1000, // 30 days
    errorLogs: 14 * 24 * 60 * 60 * 1000,         // 14 days
    aiCacheEntries: 24 * 60 * 60 * 1000,         // 24 hours
    chatHistory: 90 * 24 * 60 * 60 * 1000,       // 90 days
  },
  memoryThresholds: {
    warning: 50 * 1024 * 1024,    // 50MB
    critical: 100 * 1024 * 1024,  // 100MB
    maxCacheSize: 200 * 1024 * 1024, // 200MB
  },
  features: {
    enableAggressive: false,
    enableCompression: true,
    enableAnalytics: true,
  },
};

// ============================================================================
// MEMORY MONITORING
// ============================================================================

interface MemoryStats {
  used: number;
  total: number;
  percentage: number;
  breakdown: {
    reactQuery: number;
    localStorage: number;
    sessionStorage: number;
    estimated: boolean;
  };
}

export function estimateMemoryUsage(): MemoryStats {
  const stats: MemoryStats = {
    used: 0,
    total: 0,
    percentage: 0,
    breakdown: {
      reactQuery: 0,
      localStorage: 0,
      sessionStorage: 0,
      estimated: true,
    },
  };

  try {
    // Get browser memory info if available
    if ('memory' in performance) {
      const memInfo = (performance as any).memory;
      stats.used = memInfo.usedJSHeapSize || 0;
      stats.total = memInfo.totalJSHeapSize || 0;
      stats.percentage = stats.total > 0 ? (stats.used / stats.total) * 100 : 0;
      stats.breakdown.estimated = false;
    }

    // Estimate localStorage usage
    let localStorageSize = 0;
    if (typeof localStorage !== 'undefined') {
      for (let key in localStorage) {
        if (localStorage.hasOwnProperty(key)) {
          localStorageSize += localStorage[key].length;
        }
      }
    }
    stats.breakdown.localStorage = localStorageSize;

    // Estimate sessionStorage usage
    let sessionStorageSize = 0;
    if (typeof sessionStorage !== 'undefined') {
      for (let key in sessionStorage) {
        if (sessionStorage.hasOwnProperty(key)) {
          sessionStorageSize += sessionStorage[key].length;
        }
      }
    }
    stats.breakdown.sessionStorage = sessionStorageSize;

    // Estimate total if browser memory API not available
    if (stats.used === 0) {
      stats.used = stats.breakdown.localStorage + stats.breakdown.sessionStorage;
      stats.total = stats.used * 2; // Rough estimate
      stats.percentage = 50; // Conservative estimate
    }

  } catch (error) {
    console.warn('Failed to estimate memory usage:', error);
  }

  return stats;
}

// ============================================================================
// CACHE CLEANUP STRATEGIES
// ============================================================================

export class CacheCleanupManager {
  private config: CacheCleanupConfig;
  private intervals: Map<string, NodeJS.Timeout> = new Map();
  private isRunning = false;
  private cleanupStats = {
    totalCleanups: 0,
    bytesFreed: 0,
    lastCleanup: null as Date | null,
    errors: 0,
  };

  constructor(config: CacheCleanupConfig = DEFAULT_CLEANUP_CONFIG) {
    this.config = { ...config };
  }

  // Start automated cleanup
  start(): void {
    if (this.isRunning) return;
    
    this.isRunning = true;
    this.scheduleCleanups();
    
    // Setup memory monitoring
    if (this.config.features.enableAnalytics) {
      this.startMemoryMonitoring();
    }

    console.log('Cache cleanup manager started');
  }

  // Stop all cleanup intervals
  stop(): void {
    this.intervals.forEach(interval => clearInterval(interval));
    this.intervals.clear();
    this.isRunning = false;
    
    console.log('Cache cleanup manager stopped');
  }

  // Schedule all cleanup tasks
  private scheduleCleanups(): void {
    // React Query cache cleanup
    this.intervals.set('reactQuery', setInterval(
      () => this.cleanupReactQuery(),
      this.config.intervals.reactQuery
    ));

    // localStorage cleanup
    this.intervals.set('localStorage', setInterval(
      () => this.cleanupLocalStorage(),
      this.config.intervals.localStorage
    ));

    // sessionStorage cleanup
    this.intervals.set('sessionStorage', setInterval(
      () => this.cleanupSessionStorage(),
      this.config.intervals.sessionStorage
    ));

    // AI cache cleanup
    this.intervals.set('aiCache', setInterval(
      () => this.cleanupAICache(),
      this.config.intervals.aiCache
    ));

    // Performance data cleanup
    this.intervals.set('performanceData', setInterval(
      () => this.cleanupPerformanceData(),
      this.config.intervals.performanceData
    ));
  }

  // Clean up React Query cache
  private async cleanupReactQuery(): Promise<void> {
    try {
      // This will be called from the hook context
      const event = new CustomEvent('cleanup:reactQuery');
      window.dispatchEvent(event);
      
      this.updateStats('reactQuery');
    } catch (error) {
      console.error('React Query cleanup failed:', error);
      this.cleanupStats.errors++;
    }
  }

  // Clean up localStorage data
  private async cleanupLocalStorage(): Promise<void> {
    if (typeof localStorage === 'undefined') return;

    try {
      const keysToClean = [
        'slowQueries',
        'slowDbQueries', 
        'performance_alerts',
        'queued_errors',
        'cache_stats'
      ];

      let bytesFreed = 0;

      keysToClean.forEach(key => {
        const data = localStorage.getItem(key);
        if (!data) return;

        try {
          const parsed = JSON.parse(data);
          if (Array.isArray(parsed)) {
            const cutoffDate = new Date(Date.now() - this.getRetentionTime(key));
            
            const filtered = parsed.filter((item: any) => {
              const itemDate = new Date(item.timestamp || item.created_at || 0);
              return itemDate > cutoffDate;
            });

            // Apply size limits
            const maxItems = this.getMaxItems(key);
            const truncated = filtered.slice(-maxItems);

            if (truncated.length < parsed.length) {
              bytesFreed += data.length - JSON.stringify(truncated).length;
              localStorage.setItem(key, JSON.stringify(truncated));
            }
          }
        } catch (parseError) {
          // If parsing fails, remove the corrupted data
          bytesFreed += data.length;
          localStorage.removeItem(key);
        }
      });

      this.cleanupStats.bytesFreed += bytesFreed;
      this.updateStats('localStorage', bytesFreed);
      
    } catch (error) {
      console.error('localStorage cleanup failed:', error);
      this.cleanupStats.errors++;
    }
  }

  // Clean up sessionStorage
  private async cleanupSessionStorage(): Promise<void> {
    if (typeof sessionStorage === 'undefined') return;

    try {
      const keysToClean = ['tempData', 'formState', 'uiState'];
      let bytesFreed = 0;

      keysToClean.forEach(key => {
        const data = sessionStorage.getItem(key);
        if (data) {
          // Remove session data older than 1 hour
          try {
            const parsed = JSON.parse(data);
            if (parsed.timestamp && 
                Date.now() - parsed.timestamp > 60 * 60 * 1000) {
              bytesFreed += data.length;
              sessionStorage.removeItem(key);
            }
          } catch {
            // Remove invalid data
            bytesFreed += data.length;
            sessionStorage.removeItem(key);
          }
        }
      });

      this.cleanupStats.bytesFreed += bytesFreed;
      this.updateStats('sessionStorage', bytesFreed);
      
    } catch (error) {
      console.error('sessionStorage cleanup failed:', error);
      this.cleanupStats.errors++;
    }
  }

  // Clean up AI response cache
  private async cleanupAICache(): Promise<void> {
    try {
      const { data: deletedCount, error } = await supabase
        .rpc('cleanup_ai_cache');

      if (error) throw error;

      this.updateStats('aiCache', deletedCount || 0);
      
    } catch (error) {
      console.error('AI cache cleanup failed:', error);
      this.cleanupStats.errors++;
    }
  }

  // Clean up performance data
  private async cleanupPerformanceData(): Promise<void> {
    try {
      // Clean up old performance metrics
      const cutoffDate = new Date(Date.now() - this.config.retention.performanceAlerts);
      
      const { error: metricsError } = await supabase
        .from('ai_performance_metrics')
        .delete()
        .lt('timestamp', cutoffDate.toISOString());

      if (metricsError) throw metricsError;

      const { error: dbError } = await supabase
        .from('db_performance_metrics')
        .delete()
        .lt('timestamp', cutoffDate.toISOString());

      if (dbError) throw dbError;

      // Clean up resolved alerts older than retention period
      const { error: alertsError } = await supabase
        .from('performance_alerts')
        .delete()
        .eq('resolved', true)
        .lt('resolved_at', cutoffDate.toISOString());

      if (alertsError) throw alertsError;

      this.updateStats('performanceData');
      
    } catch (error) {
      console.error('Performance data cleanup failed:', error);
      this.cleanupStats.errors++;
    }
  }

  // Get retention time for specific data type
  private getRetentionTime(key: string): number {
    switch (key) {
      case 'slowQueries':
      case 'slowDbQueries':
        return this.config.retention.slowQueries;
      case 'performance_alerts':
        return this.config.retention.performanceAlerts;
      case 'queued_errors':
        return this.config.retention.errorLogs;
      default:
        return 7 * 24 * 60 * 60 * 1000; // 7 days default
    }
  }

  // Get maximum items to keep for specific data type
  private getMaxItems(key: string): number {
    switch (key) {
      case 'slowQueries':
      case 'slowDbQueries':
        return 100;
      case 'performance_alerts':
        return 200;
      case 'queued_errors':
        return 50;
      default:
        return 50;
    }
  }

  // Update cleanup statistics
  private updateStats(source: string, bytesFreed?: number): void {
    this.cleanupStats.totalCleanups++;
    this.cleanupStats.lastCleanup = new Date();
    
    if (bytesFreed) {
      this.cleanupStats.bytesFreed += bytesFreed;
    }

    if (this.config.features.enableAnalytics) {
      console.log(`Cache cleanup completed: ${source}`, {
        bytesFreed,
        totalCleanups: this.cleanupStats.totalCleanups,
        totalBytesFreed: this.cleanupStats.bytesFreed,
      });
    }
  }

  // Aggressive cleanup when memory is critical
  async performAggressiveCleanup(): Promise<void> {
    if (!this.config.features.enableAggressive) return;

    console.warn('Performing aggressive cache cleanup due to memory pressure');

    try {
      // Force cleanup all caches immediately
      await Promise.all([
        this.cleanupLocalStorage(),
        this.cleanupSessionStorage(),
        this.cleanupAICache(),
        this.cleanupPerformanceData(),
      ]);

      // Clear React Query cache aggressively
      const event = new CustomEvent('cleanup:aggressive');
      window.dispatchEvent(event);

      // Force garbage collection if available
      if (window.gc) {
        window.gc();
      }

    } catch (error) {
      console.error('Aggressive cleanup failed:', error);
      this.cleanupStats.errors++;
    }
  }

  // Start memory monitoring
  private startMemoryMonitoring(): void {
    const checkMemory = () => {
      const memStats = estimateMemoryUsage();
      
      if (memStats.used > this.config.memoryThresholds.critical) {
        this.performAggressiveCleanup();
      } else if (memStats.used > this.config.memoryThresholds.warning) {
        console.warn('Memory usage approaching threshold:', memStats);
      }
    };

    // Check memory every 5 minutes
    this.intervals.set('memoryMonitor', setInterval(checkMemory, 5 * 60 * 1000));
  }

  // Get cleanup statistics
  getStats() {
    return {
      ...this.cleanupStats,
      isRunning: this.isRunning,
      activeIntervals: this.intervals.size,
      memoryUsage: estimateMemoryUsage(),
    };
  }

  // Update configuration
  updateConfig(newConfig: Partial<CacheCleanupConfig>): void {
    this.config = { ...this.config, ...newConfig };
    
    if (this.isRunning) {
      this.stop();
      this.start();
    }
  }
}

// ============================================================================
// REACT HOOKS
// ============================================================================

// Singleton instance
let cleanupManager: CacheCleanupManager | null = null;

export function useCacheCleanup(config?: Partial<CacheCleanupConfig>) {
  const queryClient = useQueryClient();
  const managerRef = useRef<CacheCleanupManager | null>(null);

  // Initialize cleanup manager
  useEffect(() => {
    if (!managerRef.current) {
      const finalConfig = config ? { ...DEFAULT_CLEANUP_CONFIG, ...config } : DEFAULT_CLEANUP_CONFIG;
      managerRef.current = new CacheCleanupManager(finalConfig);
      cleanupManager = managerRef.current;
    }

    const manager = managerRef.current;
    manager.start();

    // Setup React Query cleanup listeners
    const handleReactQueryCleanup = () => {
      const cache = queryClient.getQueryCache();
      const queries = cache.getAll();
      
      // Remove stale queries
      const staleQueries = queries.filter(q => q.isStale());
      staleQueries.forEach(query => {
        queryClient.removeQueries({ queryKey: query.queryKey });
      });

      // Remove error queries older than 5 minutes
      const errorQueries = queries.filter(q => 
        q.state.status === 'error' && 
        Date.now() - (q.state.errorUpdatedAt || 0) > 5 * 60 * 1000
      );
      errorQueries.forEach(query => {
        queryClient.removeQueries({ queryKey: query.queryKey });
      });

      console.log(`Cleaned up ${staleQueries.length + errorQueries.length} React Query entries`);
    };

    const handleAggressiveCleanup = () => {
      // Clear all cached data aggressively
      queryClient.clear();
      console.log('Performed aggressive React Query cleanup');
    };

    window.addEventListener('cleanup:reactQuery', handleReactQueryCleanup);
    window.addEventListener('cleanup:aggressive', handleAggressiveCleanup);

    return () => {
      window.removeEventListener('cleanup:reactQuery', handleReactQueryCleanup);
      window.removeEventListener('cleanup:aggressive', handleAggressiveCleanup);
      manager.stop();
    };
  }, [queryClient, config]);

  // Manual cleanup functions
  const manualCleanup = useCallback(async (type?: string) => {
    const manager = managerRef.current;
    if (!manager) return;

    switch (type) {
      case 'localStorage':
        await (manager as any).cleanupLocalStorage();
        break;
      case 'reactQuery':
        await (manager as any).cleanupReactQuery();
        break;
      case 'aiCache':
        await (manager as any).cleanupAICache();
        break;
      case 'aggressive':
        await manager.performAggressiveCleanup();
        break;
      default:
        // Clean all
        await Promise.all([
          (manager as any).cleanupLocalStorage(),
          (manager as any).cleanupSessionStorage(),
          (manager as any).cleanupAICache(),
          (manager as any).cleanupReactQuery(),
        ]);
    }
  }, []);

  const getCleanupStats = useCallback(() => {
    return managerRef.current?.getStats() || null;
  }, []);

  const updateCleanupConfig = useCallback((newConfig: Partial<CacheCleanupConfig>) => {
    managerRef.current?.updateConfig(newConfig);
  }, []);

  return {
    manualCleanup,
    getCleanupStats,
    updateCleanupConfig,
    estimateMemoryUsage,
    isActive: managerRef.current?.getStats().isRunning || false,
  };
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  CacheCleanupManager,
  useCacheCleanup,
  estimateMemoryUsage,
  DEFAULT_CLEANUP_CONFIG,
}; 