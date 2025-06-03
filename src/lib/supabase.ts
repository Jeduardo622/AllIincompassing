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
  }
);

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
if (supabaseUrl && !supabaseUrl.includes('placeholder')) {
  testConnection();
}