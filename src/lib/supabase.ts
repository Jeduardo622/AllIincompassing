// IMPORTANT: Use a single Supabase client across the app to avoid
// multiple GoTrue instances (which can cause session/cookie conflicts).
// Re-use the canonical client from supabaseClient.ts.
import { supabase } from './supabaseClient';
import { buildSupabaseEdgeUrl } from './runtimeConfig';
// Re-export for modules importing from './supabase'
export { supabase };

// Performance monitoring for database operations
const monitorDatabaseOperation = async <T>(
  operation: () => Promise<T>,
  operationName: string
): Promise<T> => {
  const startTime = performance.now();
  
  try {
    const result = await operation();
    const endTime = performance.now();
    const duration = endTime - startTime;
    
    // Log slow queries (> 1 second)
    if (duration > 1000) {
      console.warn(`Slow database operation detected: ${operationName} took ${duration.toFixed(2)}ms`);
      
      // Track slow queries in localStorage for performance analysis
      if (typeof window !== 'undefined') {
        const slowQueries = JSON.parse(localStorage.getItem('slowDbQueries') || '[]');
        slowQueries.push({
          operation: operationName,
          duration: duration.toFixed(2),
          timestamp: new Date().toISOString()
        });
        
        // Keep only last 20 slow queries
        if (slowQueries.length > 20) {
          slowQueries.splice(0, slowQueries.length - 20);
        }
        
        localStorage.setItem('slowDbQueries', JSON.stringify(slowQueries));
      }
    }
    
    return result;
  } catch (error) {
    const endTime = performance.now();
    const duration = endTime - startTime;
    
    console.error(`Database operation failed: ${operationName} after ${duration.toFixed(2)}ms`, error);
    throw error;
  }
};

// Enhanced client with performance monitoring
class PerformanceSupabaseClient {
  private client = supabase;
  
  // Wrapper for monitored queries
  async query<T>(
    operation: () => Promise<T>,
    operationName: string
  ): Promise<T> {
    return monitorDatabaseOperation(operation, operationName);
  }
  
  // Connection pool status
  getConnectionPoolStatus() {
    return {
      activeConnections: 'N/A', // Supabase manages this internally
      maxConnections: 'N/A',
      performance: this.getPerformanceMetrics()
    };
  }
  
  // Get performance metrics
  getPerformanceMetrics() {
    if (typeof window === 'undefined') return null;
    
    const slowQueries = JSON.parse(localStorage.getItem('slowDbQueries') || '[]');
    return {
      slowQueryCount: slowQueries.length,
      lastSlowQueries: slowQueries.slice(-5),
      averageSlowQueryTime: slowQueries.length > 0 
        ? (slowQueries.reduce((sum: number, q: { duration: string }) => sum + parseFloat(q.duration), 0) / slowQueries.length).toFixed(2)
        : '0'
    };
  }
  
  // Direct access to Supabase client
  get auth() { return this.client.auth; }
  get storage() { return this.client.storage; }
  get realtime() { return this.client.realtime; }
  
  from(table: string) { return this.client.from(table); }
  rpc(fn: string, args?: Record<string, unknown>) { return this.client.rpc(fn, args); }
  
  // Monitored RPC calls
  async monitoredRpc<T = unknown>(functionName: string, args?: Record<string, unknown>): Promise<{ data: T | null; error: Error | null }> {
    return this.query(
      async () => {
        const result = await this.client.rpc(functionName, args);
        return result;
      },
      `RPC: ${functionName}`
    );
  }
  
  // Optimized batch operations
  async batchQuery<T>(operations: Array<() => Promise<T>>): Promise<T[]> {
    const startTime = performance.now();
    
    try {
      const results = await Promise.all(operations.map(op => op()));
      const duration = performance.now() - startTime;
      
      console.log(`Batch operation completed: ${operations.length} queries in ${duration.toFixed(2)}ms`);
      return results;
    } catch (error) {
      console.error('Batch operation failed:', error);
      throw error;
    }
  }
  
  // Connection health check
  async healthCheck(): Promise<boolean> {
    try {
      const { error } = await this.client
        .from('roles')
        .select('count')
        .limit(1);
      
      return !error;
    } catch {
      return false;
    }
  }
}

// Enhanced client instance
export const supabaseClient = new PerformanceSupabaseClient();

// Connection verification function for development
const testConnection = async () => {
  try {
    // Test auth connection
    const { data: { session }, error: authError } = await supabase.auth.getSession();
    if (authError) {
      throw authError;
    }
    console.log('Auth connection verified:', session ? 'Session exists' : 'No active session');

    // Test database access with a public table query that doesn't require auth
    const { error: rolesError } = await supabase
      .from('roles')
      .select('count');
    
    if (rolesError) {
      throw rolesError;
    }
    console.log('Database connection verified');

    // Performance health check
    const isHealthy = await supabaseClient.healthCheck();
    console.log('Connection health status:', isHealthy ? 'Healthy' : 'Degraded');

    // Only test RPC functions if we have an authenticated session
    if (session) {
      const { error: rpcError } = await supabase.rpc('get_user_roles');
      if (rpcError) {
        throw rpcError;
      }
      console.log('RPC functions verified');
    }

  } catch (error) {
    console.error('Supabase connection error:', error);
    // Don't throw error in bolt.new environment to prevent app crashes
    // Also don't throw if it's just an authentication issue
    if (import.meta.env.DEV && error instanceof Error && !error.message.includes('No authenticated user found')) {
      throw error;
    }
  }
};

// Export test function for use in other parts of the app
export const verifyConnection = testConnection;

// Only run connection test in development or when proper credentials exist
if (!import.meta.env.VITEST) {
  testConnection();
}

// Edge Function helper - attaches user's JWT automatically
export async function callEdge(path: string, init: RequestInit = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  const headers = new Headers(init.headers || {});
  if (session?.access_token) headers.set('Authorization', `Bearer ${session.access_token}`);

  const url = buildSupabaseEdgeUrl(path);
  return fetch(url, { ...init, headers });
}

/**
 * Testing guidance:
 * - Mock `supabase` with a chainable shape: from().select().eq().order().limit().single().maybeSingle().
 * - Ensure the module returns the same `supabase` instance across imports.
 */