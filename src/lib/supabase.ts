import { createClient } from '@supabase/supabase-js';
import { Database } from './database.types';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

// Configure Supabase client with better timeout and retry settings
export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    storageKey: 'auth-storage',
    flowType: 'pkce',
  },
  global: {
    headers: {
      'X-Client-Info': 'allincompassing-web',
    },
    // Add fetch options with timeout
    fetch: (url, options) => {
      const controller = new AbortController();
      const { signal } = controller;
      
      // Set a 15-second timeout for all requests
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      
      return fetch(url, { ...options, signal })
        .finally(() => clearTimeout(timeoutId));
    },
  },
  realtime: {
    params: {
      eventsPerSecond: 5, // Limit realtime events to avoid overwhelming the client
    },
  },
});

// Test connection and database access - with better error handling
const testConnection = async () => {
  try {
    // Test auth connection
    const { data: { session }, error: authError } = await supabase.auth.getSession();
    if (authError) {
      console.error('Auth connection error:', authError);
      return false;
    }
    console.log('Auth connection verified:', session ? 'Session exists' : 'No active session');

    // Test database access - only if we have a session
    if (session) {
      try {
        const { data: rolesCount, error: rolesError } = await supabase
          .from('roles')
          .select('count');
        
        if (rolesError) {
          console.error('Database connection error:', rolesError);
          return false;
        }
        console.log('Database connection verified');
      } catch (dbError) {
        console.error('Database test failed:', dbError);
        return false;
      }

      // Test RPC function - only if database test passed
      try {
        const { data: roles, error: rpcError } = await supabase.rpc('get_user_roles');
        if (rpcError) {
          console.error('RPC function error:', rpcError);
          return false;
        }
        console.log('RPC functions verified');
      } catch (rpcError) {
        console.error('RPC test failed:', rpcError);
        return false;
      }
    }

    return true;
  } catch (error) {
    console.error('Supabase connection error:', error);
    return false;
  }
};

// Export test function for use in other parts of the app
export const verifyConnection = testConnection;

// Don't run the initial connection test automatically
// This will be called explicitly when needed
// testConnection();