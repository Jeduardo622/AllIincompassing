import { createClient } from '@supabase/supabase-js';
import type { Database } from './generated/database.types';
import { getRuntimeSupabaseConfig } from './runtimeConfig';

const resolveSupabaseConfig = (): { supabaseUrl: string; supabaseAnonKey: string } => {
  try {
    const { supabaseUrl, supabaseAnonKey } = getRuntimeSupabaseConfig();
    return { supabaseUrl, supabaseAnonKey };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown runtime configuration error';
    throw new Error(`[Supabase] Failed to initialise client: ${message}`);
  }
};

const { supabaseUrl, supabaseAnonKey } = resolveSupabaseConfig();

// Browser singleton client. Typed with generated Database.
export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
});