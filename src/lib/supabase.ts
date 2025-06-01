import { createClient } from '@supabase/supabase-js';
import { Database } from './database.types';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Supabase environment variables are missing. Please check your .env file.');
}

export const supabase = createClient<Database>(supabaseUrl || '', supabaseAnonKey || '', {
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
      console.warn('Auth connection issue:', authError);
    } else {
      console.log('Auth connection verified:', session ? 'Session exists' : 'No active session');
    }

    // Test database access - only if we have credentials
    if (supabaseUrl && supabaseAnonKey) {
      try {
        const { data: rolesCount, error: rolesError } = await supabase
          .from('roles')
          .select('count');
        
        if (rolesError) {
          console.warn('Database connection issue:', rolesError);
        } else {
          console.log('Database connection verified');
        }
      } catch (dbError) {
        console.warn('Database test failed:', dbError);
      }

      // Test RPC function
      try {
        const { data: roles, error: rpcError } = await supabase.rpc('get_user_roles');
        if (rpcError) {
          console.warn('RPC function test issue:', rpcError);
        } else {
          console.log('RPC functions verified');
        }
      } catch (rpcError) {
        console.warn('RPC test failed:', rpcError);
      }
    } else {
      console.warn('Skipping database tests due to missing credentials');
    }
  } catch (error) {
    console.warn('Supabase connection test error:', error);
  }
};

// Export test function for use in other parts of the app
export const verifyConnection = testConnection;

// Initial connection test - but don't block rendering
setTimeout(testConnection, 1000);