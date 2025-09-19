import type { RuntimeSupabaseConfig } from '../lib/runtimeConfig';
import { getOptionalServerEnv, getRequiredServerEnv } from './env';

export const getRuntimeSupabaseConfig = (): RuntimeSupabaseConfig => {
  const supabaseUrl = getRequiredServerEnv('SUPABASE_URL');
  const supabaseAnonKey = getRequiredServerEnv('SUPABASE_ANON_KEY');
  const supabaseEdgeUrl = getOptionalServerEnv('SUPABASE_EDGE_URL');

  return {
    supabaseUrl,
    supabaseAnonKey,
    supabaseEdgeUrl: supabaseEdgeUrl ?? undefined,
  };
};

