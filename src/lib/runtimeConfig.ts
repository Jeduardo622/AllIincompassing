export interface RuntimeSupabaseConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  defaultOrganizationId: string;
  supabaseEdgeUrl?: string;
}

const RUNTIME_CONFIG_SYMBOL = '__SUPABASE_RUNTIME_CONFIG__';
const PLACEHOLDER_VALUE_PATTERNS = [/^\*+$/, /^changeme$/i, /^replace[-_ ]?me$/i, /^your[-_ ]/i];
const RUNTIME_CONFIG_RETRY_DELAYS_MS = [100, 300] as const;

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
  if (!config.defaultOrganizationId) {
    throw new Error('Supabase runtime config missing `defaultOrganizationId`');
  }

  const trimmedUrl = config.supabaseUrl.trim();
  const trimmedAnonKey = config.supabaseAnonKey.trim();
  if (PLACEHOLDER_VALUE_PATTERNS.some((pattern) => pattern.test(trimmedUrl))) {
    throw new Error('Supabase runtime config has placeholder `supabaseUrl`');
  }
  if (PLACEHOLDER_VALUE_PATTERNS.some((pattern) => pattern.test(trimmedAnonKey))) {
    throw new Error('Supabase runtime config has placeholder `supabaseAnonKey`');
  }
};

class RetryableRuntimeConfigFetchError extends Error {
  constructor(
    readonly causeError: Error,
    readonly retryable: boolean,
  ) {
    super(causeError.message);
    this.name = 'RetryableRuntimeConfigFetchError';
  }
}

const normalizeRuntimeConfigError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

const waitForRetryDelay = async (delayMs: number): Promise<void> => {
  await new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
};

const fetchRuntimeConfigOnce = async (): Promise<RuntimeSupabaseConfig> => {
  const response = await fetch('/api/runtime-config', {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  }).catch((error: unknown) => {
    throw new RetryableRuntimeConfigFetchError(normalizeRuntimeConfigError(error), true);
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const detail = typeof payload.error === 'string' ? payload.error : response.statusText;
    throw new RetryableRuntimeConfigFetchError(
      new Error(`Failed to load Supabase runtime config: ${detail}`),
      response.status === 429 || response.status >= 500,
    );
  }

  const config = (await response.json()) as RuntimeSupabaseConfig;
  setRuntimeSupabaseConfig(config);
  return config;
};

const fetchRuntimeConfigWithRetry = async (): Promise<RuntimeSupabaseConfig> => {
  let attempt = 0;

  while (true) {
    try {
      return await fetchRuntimeConfigOnce();
    } catch (error) {
      attempt += 1;

      if (!(error instanceof RetryableRuntimeConfigFetchError)) {
        throw error;
      }

      if (!error.retryable || attempt > RUNTIME_CONFIG_RETRY_DELAYS_MS.length) {
        throw error.causeError;
      }

      await waitForRetryDelay(RUNTIME_CONFIG_RETRY_DELAYS_MS[attempt - 1]);
    }
  }
};

let fetchPromise: Promise<RuntimeSupabaseConfig> | null = null;

export const setRuntimeSupabaseConfig = (config: RuntimeSupabaseConfig): void => {
  validateConfig(config);
  getContainer()[RUNTIME_CONFIG_SYMBOL] = {
    supabaseUrl: config.supabaseUrl,
    supabaseAnonKey: config.supabaseAnonKey,
    defaultOrganizationId: config.defaultOrganizationId,
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

    fetchPromise = fetchRuntimeConfigWithRetry()
      .catch((error) => {
        fetchPromise = null;
        throw error;
      });
  }

  return fetchPromise;
};

export const getSupabaseUrl = (): string => getRuntimeSupabaseConfig().supabaseUrl;

export const getSupabaseAnonKey = (): string => getRuntimeSupabaseConfig().supabaseAnonKey;

export const getDefaultOrganizationId = (): string => getRuntimeSupabaseConfig().defaultOrganizationId;

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

