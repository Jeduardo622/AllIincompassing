import { createClient } from '@supabase/supabase-js';
import { Database } from './database.types';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    storageKey: 'auth-storage',
    flowType: 'pkce',
  },
});

// Test connection and database access
const testConnection = async () => {
  try {
    // Test auth connection
    const { data: { session }, error: authError } = await supabase.auth.getSession();
    if (authError) {
      throw authError;
    }
    console.log('Auth connection verified:', session ? 'Session exists' : 'No active session');

    // Test database access with a public table query that doesn't require auth
    const { data: rolesCount, error: rolesError } = await supabase
      .from('roles')
      .select('count');
    
    if (rolesError) {
      throw rolesError;
    }
    console.log('Database connection verified');

    // Only test RPC functions if we have an authenticated session
    if (session) {
      const { data: roles, error: rpcError } = await supabase.rpc('get_user_roles');
      if (rpcError) {
        throw rpcError;
      }
      console.log('RPC functions verified');
    }

  } catch (error) {
    console.error('Supabase connection error:', error);
    // Don't throw the error if it's just an authentication issue
    if (error instanceof Error && !error.message.includes('No authenticated user found')) {
      throw error;
    }
  }
};

// Export test function for use in other parts of the app
export const verifyConnection = testConnection;

// Initial connection test
testConnection();