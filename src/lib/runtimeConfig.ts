export interface RuntimeSupabaseConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  supabaseEdgeUrl?: string;
}

const RUNTIME_CONFIG_SYMBOL = '__SUPABASE_RUNTIME_CONFIG__';

type RuntimeConfigContainer = typeof globalThis & {
  [RUNTIME_CONFIG_SYMBOL]?: RuntimeSupabaseConfig;
};

const getContainer = (): RuntimeConfigContainer => globalThis as RuntimeConfigContainer;

const validateConfig = (config: RuntimeSupabaseConfig): void => {
  if (!config || typeof config !== 'object') {
    throw new Error('Invalid Supabase runtime configuration payload');
  }
  if (!config.supabaseUrl) {
    throw new Error('Supabase runtime config missing `supabaseUrl`');
  }
  if (!config.supabaseAnonKey) {
    throw new Error('Supabase runtime config missing `supabaseAnonKey`');
  }
};

let fetchPromise: Promise<RuntimeSupabaseConfig> | null = null;

export const setRuntimeSupabaseConfig = (config: RuntimeSupabaseConfig): void => {
  validateConfig(config);
  getContainer()[RUNTIME_CONFIG_SYMBOL] = {
    supabaseUrl: config.supabaseUrl,
    supabaseAnonKey: config.supabaseAnonKey,
    supabaseEdgeUrl: config.supabaseEdgeUrl,
  };
};

export const getRuntimeSupabaseConfig = (): RuntimeSupabaseConfig => {
  const config = getContainer()[RUNTIME_CONFIG_SYMBOL];
  if (!config) {
    throw new Error('Supabase runtime configuration has not been initialised');
  }
  return config;
};

export const ensureRuntimeSupabaseConfig = async (): Promise<RuntimeSupabaseConfig> => {
  try {
    return getRuntimeSupabaseConfig();
  } catch {
    // Ignore and fetch below
  }

  if (!fetchPromise) {
    if (typeof fetch !== 'function') {
      throw new Error('Supabase runtime configuration unavailable and fetch is not supported');
    }

    fetchPromise = fetch('/api/runtime-config', {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    })
      .then(async (response) => {
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          const detail = typeof payload.error === 'string' ? payload.error : response.statusText;
          throw new Error(`Failed to load Supabase runtime config: ${detail}`);
        }
        return response.json() as Promise<RuntimeSupabaseConfig>;
      })
      .then((config) => {
        setRuntimeSupabaseConfig(config);
        return config;
      })
      .catch((error) => {
        fetchPromise = null;
        throw error;
      });
  }

  return fetchPromise;
};

export const getSupabaseUrl = (): string => getRuntimeSupabaseConfig().supabaseUrl;

export const getSupabaseAnonKey = (): string => getRuntimeSupabaseConfig().supabaseAnonKey;

export const getSupabaseEdgeBaseUrl = (): string => {
  const config = getRuntimeSupabaseConfig();
  if (config.supabaseEdgeUrl && config.supabaseEdgeUrl.trim().length > 0) {
    return config.supabaseEdgeUrl;
  }
  const normalized = config.supabaseUrl.endsWith('/')
    ? config.supabaseUrl
    : `${config.supabaseUrl}/`;
  return `${normalized}functions/v1/`;
};

export const buildSupabaseEdgeUrl = (path: string): string => {
  const base = getSupabaseEdgeBaseUrl();
  return new URL(path, base).toString();
};

export const resetRuntimeSupabaseConfigForTests = (): void => {
  delete getContainer()[RUNTIME_CONFIG_SYMBOL];
  fetchPromise = null;
};

