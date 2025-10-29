// Test-friendly module exposing secret resolution helpers without CLI/shebang side effects.

const SUPABASE_URL_FALLBACK = 'https://wnnjeqheqxxyrgsjmygy.supabase.co';

export function resolveSupabaseServiceKey(env: Record<string, string | undefined> = process.env as Record<string, string | undefined>): string {
  const raw = typeof env.SUPABASE_SERVICE_ROLE_KEY === 'string' ? env.SUPABASE_SERVICE_ROLE_KEY : '';
  const normalized = raw.trim();
  if (!normalized) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY environment variable is required to run this script.');
  }
  return normalized;
}

export function resolveSupabaseUrl(env: Record<string, string | undefined> = process.env as Record<string, string | undefined>): string {
  return env.SUPABASE_URL || SUPABASE_URL_FALLBACK;
}

export function resolveSupabaseAnonKey(env: Record<string, string | undefined> = process.env as Record<string, string | undefined>): string {
  const key = env.SUPABASE_ANON_KEY;
  if (!key) {
    throw new Error('SUPABASE_ANON_KEY environment variable is required to run the transcription test suite.');
  }
  return key;
}


