type EnvLike = Record<string, string | undefined>;

type MswUnhandledRequestPrint = {
  error: () => void;
  warning: () => void;
};

const truthyFlags = new Set(['1', 'true', 'yes', 'on']);

export const LIVE_SUPABASE_REQUEST_HEADER = 'x-internal-live-supabase-test';
export const LIVE_SUPABASE_REQUEST_HEADER_VALUE = 'rls-integration';
export const LIVE_SUPABASE_REQUEST_HEADERS = {
  [LIVE_SUPABASE_REQUEST_HEADER]: LIVE_SUPABASE_REQUEST_HEADER_VALUE,
} as const;

const isTruthyFlag = (value: string | undefined): boolean => (
  value ? truthyFlags.has(value.toLowerCase()) : false
);

const configuredSupabaseHosts = (env: EnvLike): Set<string> => {
  const hosts = new Set<string>();

  for (const key of ['SUPABASE_URL', 'VITE_SUPABASE_URL']) {
    const value = env[key];
    if (!value) {
      continue;
    }

    try {
      hosts.add(new URL(value).host);
    } catch {
      // Ignore invalid optional test environment values.
    }
  }

  return hosts;
};

export const shouldBypassUnhandledMswRequest = (
  request: Request,
  env: EnvLike = process.env,
): boolean => {
  if (!isTruthyFlag(env.RUN_DB_IT)) {
    return false;
  }

  if (request.headers.get(LIVE_SUPABASE_REQUEST_HEADER) !== LIVE_SUPABASE_REQUEST_HEADER_VALUE) {
    return false;
  }

  const supabaseHosts = configuredSupabaseHosts(env);
  if (supabaseHosts.size === 0) {
    return false;
  }

  const url = new URL(request.url);
  return supabaseHosts.has(url.host);
};

export const handleUnhandledMswRequest = (
  request: Request,
  print: MswUnhandledRequestPrint,
  env: EnvLike = process.env,
): void => {
  if (shouldBypassUnhandledMswRequest(request, env)) {
    return;
  }

  print.error();
};
