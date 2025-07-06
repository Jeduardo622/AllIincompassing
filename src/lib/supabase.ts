import { createClient } from '@supabase/supabase-js';

// bolt.new will inject these automatically when connected to Supabase
// Fallback to import.meta.env for local development
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase environment variables not found. This is expected in bolt.new before Supabase connection.');
  // In bolt.new, these will be injected after connecting to Supabase
  // For now, we'll create a placeholder client that will be replaced
}

// Performance-optimized Supabase client with connection pooling
export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co', 
  supabaseAnonKey || 'placeholder-key',
  {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
      storageKey: 'auth-storage',
      flowType: 'pkce',
    },
    db: {
      schema: 'public',
    },
    realtime: {
      params: {
        eventsPerSecond: 10,
      },
    },
    global: {
      headers: {
        'x-my-custom-header': 'therapy-practice-management',
      },
    },
  }
);

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
    // Skip connection test if using placeholder values (bolt.new pre-connection)
    if (supabaseUrl?.includes('placeholder')) {
      console.log('Supabase connection pending - connect via bolt.new interface');
      return;
    }

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
if (supabaseUrl &&
    !supabaseUrl.includes('placeholder') &&
    !import.meta.env.VITEST) {
  testConnection();
}