import { createClient } from '@supabase/supabase-js';
import type { Database } from './generated/database.types';

const requireEnv = (k: string): string => {
  const envRecord: Record<string, string | undefined> = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  const v = envRecord[k];
  if (!v) {
    // Fail fast in dev; surface clearly in diagnostics as well
    throw new Error(`[ENV] Missing required ${k}; set it in .env.local`);
  }
  return v as string;
};

const supabaseUrl = requireEnv('VITE_SUPABASE_URL');
const supabaseAnonKey = requireEnv('VITE_SUPABASE_ANON_KEY');

// Browser singleton client. Typed with generated Database.
export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
});

export default supabase;