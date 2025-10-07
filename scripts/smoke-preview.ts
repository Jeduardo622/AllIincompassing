import { createClient } from '@supabase/supabase-js';

const TIMEOUT_MS = 15000;

const maskSecret = (value: string | undefined): string => {
  if (!value) {
    return '<empty>';
  }

  if (value.length <= 8) {
    return `${value.at(0)}***${value.at(-1)}`;
  }

  return `${value.slice(0, 6)}***${value.slice(-2)}`;
};

const getArg = (flag: string): string | undefined => {
  const index = process.argv.indexOf(flag);
  if (index === -1 || index + 1 >= process.argv.length) {
    return undefined;
  }

  return process.argv[index + 1];
};

const withTimeout = async <T>(operation: (signal: AbortSignal) => Promise<T>, label: string): Promise<T> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const result = await operation(controller.signal);
    clearTimeout(timer);
    return result;
  } catch (error) {
    clearTimeout(timer);
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} failed: ${message}`);
  }
};

const fetchJson = async <T>(url: string, signal: AbortSignal): Promise<T> => {
  const response = await fetch(url, {
    signal,
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`HTTP ${response.status} ${response.statusText} :: ${body.slice(0, 200)}`);
  }

  return response.json() as Promise<T>;
};

const fetchText = async (url: string, signal: AbortSignal): Promise<string> => {
  const response = await fetch(url, {
    signal,
    headers: { Accept: 'text/html' },
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  return response.text();
};

const resolvePreviewUrl = (): string => {
  const baseUrl =
    process.env.PREVIEW_URL ||
    process.env.DEPLOY_PRIME_URL ||
    process.env.URL ||
    getArg('--url');

  if (!baseUrl) {
    throw new Error('Missing preview URL. Provide PREVIEW_URL env var or --url flag.');
  }

  return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
};

type RuntimeConfig = {
  readonly supabaseUrl: string;
  readonly supabaseAnonKey: string;
  readonly supabaseEdgeUrl?: string;
};

const checkIndexShell = async (baseUrl: string): Promise<void> => {
  const html = await withTimeout((signal) => fetchText(baseUrl, signal), 'Fetch index');
  if (!/<div\s+id=["']root["']/.test(html)) {
    throw new Error('Root container missing from index.html response');
  }
  console.log('[smoke] index.html -> OK');
};

const checkRuntimeConfig = async (baseUrl: string): Promise<RuntimeConfig> => {
  const runtimeConfig = await withTimeout<RuntimeConfig>(
    (signal) => fetchJson<RuntimeConfig>(`${baseUrl}/api/runtime-config`, signal),
    'Fetch runtime config',
  );

  if (!runtimeConfig.supabaseUrl || !runtimeConfig.supabaseAnonKey) {
    throw new Error('Runtime config missing Supabase URL or anon key');
  }

  console.log('[smoke] runtime-config ->', {
    supabaseUrl: runtimeConfig.supabaseUrl,
    supabaseAnonKey: maskSecret(runtimeConfig.supabaseAnonKey),
    supabaseEdgeUrl: maskSecret(runtimeConfig.supabaseEdgeUrl),
  });

  return runtimeConfig;
};

const checkSupabaseHealth = async ({ supabaseUrl }: RuntimeConfig): Promise<void> => {
  const healthUrl = `${supabaseUrl.replace(/\/$/, '')}/auth/v1/health`;
  await withTimeout(async (signal) => {
    const response = await fetch(healthUrl, { signal, cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Supabase auth health check failed with ${response.status}`);
    }
    return undefined;
  }, 'Supabase auth health');
  console.log('[smoke] Supabase auth health -> OK');
};

const checkSupabaseAnonAccess = async ({ supabaseUrl, supabaseAnonKey }: RuntimeConfig): Promise<void> => {
  const client = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, detectSessionInUrl: false },
  });

  await withTimeout(async () => {
    const { data, error } = await client.auth.getSession();
    if (error) {
      throw new Error(`Supabase auth session check failed: ${error.message}`);
    }

    if (data?.session !== null && data?.session !== undefined) {
      throw new Error('Unexpected active session returned for anonymous smoke test');
    }

    return undefined;
  }, 'Supabase anonymous auth check');
  console.log('[smoke] Supabase anon auth -> OK');
};

const run = async (): Promise<void> => {
  const baseUrl = resolvePreviewUrl();
  console.log(`[smoke] Target ${baseUrl}`);

  await checkIndexShell(baseUrl);
  const runtimeConfig = await checkRuntimeConfig(baseUrl);
  await checkSupabaseHealth(runtimeConfig);
  await checkSupabaseAnonAccess(runtimeConfig);

  console.log('[smoke] PASS');
};

run().catch((error) => {
  console.error('[smoke] FAIL', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
