import type { RuntimeSupabaseConfig } from '../lib/runtimeConfig';

type RequiredEnvKey = 'SUPABASE_URL' | 'SUPABASE_ANON_KEY';

const requireEnv = (key: RequiredEnvKey): string => {
  const value = process.env[key];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required Supabase environment variable: ${key}`);
  }
  return value;
};

export const getRuntimeSupabaseConfig = (): RuntimeSupabaseConfig => {
  const supabaseUrl = requireEnv('SUPABASE_URL');
  const supabaseAnonKey = requireEnv('SUPABASE_ANON_KEY');

  const supabaseEdgeUrl = process.env.SUPABASE_EDGE_URL?.trim();

  return {
    supabaseUrl,
    supabaseAnonKey,
    supabaseEdgeUrl: supabaseEdgeUrl?.length ? supabaseEdgeUrl : undefined,
  };
};

