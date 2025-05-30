import { createClient } from '@supabase/supabase-js';
import { Database } from './database.types';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Add fallbacks for development environment
if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Missing Supabase environment variables, using development fallbacks');
}

export const supabase = createClient<Database>(
  supabaseUrl || 'https://example.supabase.co', 
  supabaseAnonKey || 'example-anon-key', 
  {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
      storageKey: 'auth-storage',
      flowType: 'pkce',
    },
  }
);

// Test connection and database access
const testConnection = async () => {
  try {
    // Test auth connection
    const { data: { session }, error: authError } = await supabase.auth.getSession();
    if (authError) {
      console.warn('Auth connection error:', authError);
      return;
    }
    console.log('Auth connection verified:', session ? 'Session exists' : 'No active session');

    // Test database access - only if we have real credentials
    if (supabaseUrl && supabaseAnonKey) {
      try {
        const { data: rolesCount, error: rolesError } = await supabase
          .from('roles')
          .select('count');
        
        if (rolesError) {
          console.warn('Database connection error:', rolesError);
          return;
        }
        console.log('Database connection verified');

        // Test RPC function
        const { data: roles, error: rpcError } = await supabase.rpc('get_user_roles');
        if (rpcError) {
          console.warn('RPC function error:', rpcError);
          return;
        }
        console.log('RPC functions verified');
      } catch (dbError) {
        console.warn('Database test error:', dbError);
      }
    } else {
      console.log('Skipping database tests due to missing credentials');
    }
  } catch (error) {
    console.warn('Supabase connection test error:', error);
  }
};

// Export test function for use in other parts of the app
export const verifyConnection = testConnection;

// Initial connection test - but don't block rendering if it fails
testConnection().catch(err => {
  console.warn('Initial connection test failed:', err);
});