// IMPORTANT: Use a single Supabase client across the app to avoid
// multiple GoTrue instances (which can cause session/cookie conflicts).
// Re-use the canonical client from supabaseClient.ts.
import { supabase } from './supabaseClient';
import { buildSupabaseEdgeUrl } from './runtimeConfig';
import { fetchWithRetry, type RetryOptions } from './retry';
// Re-export for modules importing from './supabase'
export { supabase };

const getServerEnvValue = (key: string): string | undefined => {
  if (typeof process === 'undefined' || !process?.env) {
    return undefined;
  }
  const value = process.env[key];
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const buildEdgeUrlWithFallback = (path: string): string => {
  try {
    return buildSupabaseEdgeUrl(path);
  } catch (error) {
    const supabaseUrl = getServerEnvValue('SUPABASE_URL');
    if (supabaseUrl) {
      const normalized = supabaseUrl.endsWith('/') ? supabaseUrl : `${supabaseUrl}/`;
      return new URL(path, `${normalized}functions/v1/`).toString();
    }
    throw error;
  }
};

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
const diagnosticsLogScope = 'supabase.connectionDiagnostics';

const parseBooleanFlag = (value: unknown): boolean | null => {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();

    if (['1', 'true', 'yes', 'on'].includes(normalized)) {
      return true;
    }

    if (['0', 'false', 'no', 'off', ''].includes(normalized)) {
      return false;
    }
  }

  return null;
};

export const shouldRunConnectionDiagnostics = (): boolean => {
  const vitestFlag = parseBooleanFlag(import.meta.env?.VITEST);
  if (vitestFlag === true) {
    return false;
  }

  const explicitFlag = parseBooleanFlag(import.meta.env?.VITE_ENABLE_CONNECTION_DIAGNOSTICS);
  return explicitFlag === true;
};

const testConnection = async () => {
  console.info('[supabase] Starting connection diagnostics checks', { scope: diagnosticsLogScope });
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
    // Diagnostics must never break app boot.
  }
};

// Export test function for use in other parts of the app
export const verifyConnection = testConnection;

export const runConnectionDiagnosticsIfEnabled = (): boolean => {
  if (!shouldRunConnectionDiagnostics()) {
    return false;
  }

  console.info('[supabase] Running connection diagnostics', { scope: diagnosticsLogScope });
  void testConnection();
  return true;
};

runConnectionDiagnosticsIfEnabled();

export interface CallEdgeOptions {
  accessToken?: string;
  anonKey?: string;
  retry?: RetryOptions;
  requestId?: string;
  correlationId?: string;
  agentOperationId?: string;
}

// Edge Function helper - attaches user's JWT automatically
export async function callEdge(
  path: string,
  init: RequestInit = {},
  options: CallEdgeOptions = {},
) {
  const headers = new Headers(init.headers ?? {});

  const providedToken = typeof options.accessToken === 'string'
    ? options.accessToken.trim()
    : '';

  if (providedToken.length > 0) {
    headers.set('Authorization', `Bearer ${providedToken}`);
  } else if (!headers.has('Authorization')) {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) {
        headers.set('Authorization', `Bearer ${session.access_token}`);
      }
    } catch {
      // In server runtimes without browser bootstrap, proceed unauthenticated.
    }
  }

  const anonKey = typeof options.anonKey === 'string' ? options.anonKey.trim() : '';
  if (anonKey.length > 0) {
    headers.set('apikey', anonKey);
  }
  if (typeof options.requestId === "string" && options.requestId.trim().length > 0) {
    headers.set("x-request-id", options.requestId.trim());
  }
  if (typeof options.correlationId === "string" && options.correlationId.trim().length > 0) {
    headers.set("x-correlation-id", options.correlationId.trim());
  }
  if (typeof options.agentOperationId === "string" && options.agentOperationId.trim().length > 0) {
    headers.set("x-agent-operation-id", options.agentOperationId.trim());
  }

  const url = buildEdgeUrlWithFallback(path);
  if (options.retry) {
    return fetchWithRetry(url, { ...init, headers }, options.retry);
  }
  return fetch(url, { ...init, headers });
}

export type SessionNotesPdfExportStatus = 'queued' | 'processing' | 'ready' | 'failed' | 'expired';

export interface SessionNotesPdfExportState {
  exportId: string;
  status: SessionNotesPdfExportStatus;
  error?: string | null;
  expiresAt?: string | null;
  pollAfterMs?: number;
  downloadReady?: boolean;
  isTerminal?: boolean;
}

const parseJsonSafe = async (response: Response): Promise<Record<string, unknown> | null> => {
  return response.json().catch(() => null) as Promise<Record<string, unknown> | null>;
};

const isExportStatus = (value: unknown): value is SessionNotesPdfExportStatus => {
  return value === 'queued' || value === 'processing' || value === 'ready' || value === 'failed' || value === 'expired';
};

const parseExportState = (payload: Record<string, unknown> | null): SessionNotesPdfExportState | null => {
  const data = payload?.data;
  if (!data || typeof data !== 'object') {
    return null;
  }

  const record = data as Record<string, unknown>;
  const exportId = typeof record.exportId === 'string' ? record.exportId : null;
  const status = isExportStatus(record.status) ? record.status : null;
  if (!exportId || !status) {
    return null;
  }

  return {
    exportId,
    status,
    error: typeof record.error === 'string' ? record.error : null,
    expiresAt: typeof record.expiresAt === 'string' ? record.expiresAt : null,
    pollAfterMs: typeof record.pollAfterMs === 'number' ? record.pollAfterMs : undefined,
    downloadReady: record.downloadReady === true,
    isTerminal: record.isTerminal === true,
  };
};

export async function enqueueSessionNotesPdfExport(clientId: string, noteIds: string[]): Promise<SessionNotesPdfExportState> {
  const response = await callEdge('generate-session-notes-pdf', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      clientId,
      noteIds,
    }),
  });

  const payload = await parseJsonSafe(response);
  if (!response.ok) {
    const message = typeof payload?.error === 'string'
      ? payload.error
      : `Failed to enqueue PDF export (${response.status})`;
    throw new Error(message);
  }

  const parsed = parseExportState(payload);
  if (!parsed) {
    throw new Error('Invalid enqueue response contract for session notes export.');
  }
  return parsed;
}

export async function getSessionNotesPdfExportStatus(exportId: string): Promise<SessionNotesPdfExportState> {
  const response = await callEdge('session-notes-pdf-status', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ exportId }),
  });

  const payload = await parseJsonSafe(response);
  if (!response.ok) {
    const message = typeof payload?.error === 'string'
      ? payload.error
      : `Failed to check export status (${response.status})`;
    throw new Error(message);
  }

  const parsed = parseExportState(payload);
  if (!parsed) {
    throw new Error('Invalid status response contract for session notes export.');
  }
  return parsed;
}

export async function downloadSessionNotesPdfExport(exportId: string): Promise<Blob> {
  const response = await callEdge('session-notes-pdf-download', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ exportId }),
  });

  if (!response.ok) {
    const payload = await parseJsonSafe(response);
    const message = typeof payload?.error === 'string'
      ? payload.error
      : `Failed to download PDF export (${response.status})`;
    throw new Error(message);
  }

  return response.blob();
}

/**
 * Testing guidance:
 * - Mock `supabase` with a chainable shape: from().select().eq().order().limit().single().maybeSingle().
 * - Ensure the module returns the same `supabase` instance across imports.
 */