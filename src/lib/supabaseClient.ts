import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './generated/database.types';
import { getRuntimeSupabaseConfig } from './runtimeConfig';

const AUTH_STORAGE_PREFIX = 'sb-';
const AUTH_STORAGE_SUFFIX = '-auth-token';

const clearStorageByPrefix = (storage: Storage | undefined): void => {
  if (!storage) {
    return;
  }

  const keysToRemove: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key) {
      continue;
    }
    if (key.startsWith(AUTH_STORAGE_PREFIX) && key.endsWith(AUTH_STORAGE_SUFFIX)) {
      keysToRemove.push(key);
    }
  }

  keysToRemove.forEach((key) => storage.removeItem(key));
};

export const clearSupabaseAuthStorage = (): void => {
  if (typeof window === 'undefined') {
    return;
  }
  clearStorageByPrefix(window.sessionStorage);
  clearStorageByPrefix(window.localStorage);
};

const resolveSupabaseConfig = (): { supabaseUrl: string; supabaseAnonKey: string } => {
  try {
    const { supabaseUrl, supabaseAnonKey } = getRuntimeSupabaseConfig();
    return { supabaseUrl, supabaseAnonKey };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown runtime configuration error';
    throw new Error(`[Supabase] Failed to initialise client: ${message}`);
  }
};

let supabaseClient: SupabaseClient<Database> | null = null;

const getSupabaseClient = (): SupabaseClient<Database> => {
  if (supabaseClient) {
    return supabaseClient;
  }

  const { supabaseUrl, supabaseAnonKey } = resolveSupabaseConfig();
  const browserStorage = typeof window === 'undefined' ? undefined : window.sessionStorage;
  supabaseClient = createClient<Database>(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
      ...(browserStorage ? { storage: browserStorage } : {}),
    },
    global: {
      headers: {
        apikey: supabaseAnonKey,
      },
    },
  });
  return supabaseClient;
};

// Lazy singleton proxy. Importing this module never throws before runtime config
// is initialised; the config is resolved only when the client is first used.
export const supabase = new Proxy({} as SupabaseClient<Database>, {
  get(_target, property) {
    const client = getSupabaseClient() as Record<PropertyKey, unknown>;
    // Use the client itself as receiver to avoid private-field access errors.
    const value = Reflect.get(client, property, client);
    return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(client) : value;
  },
});