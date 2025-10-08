import { createClient } from '@supabase/supabase-js';
import { logger } from '../logger/logger';
import { toError } from '../logger/normalizeError';
import { REDACTED_VALUE } from '../logger/redactPhi';

export interface ServiceAccountProbeConfig {
  supabaseUrl: string;
  serviceRoleKey: string;
  timeoutMs?: number;
}

export interface ResolveServiceAccountProbeOptions {
  supabaseUrlOverride?: string;
  timeoutMs?: number;
}

export interface ServiceAccountProbeResult {
  ok: boolean;
  durationMs: number;
  error?: Error;
  timedOut: boolean;
}

interface ServiceAccountAdmin {
  listUsers: (params?: { page?: number; perPage?: number }) => Promise<{ data: unknown; error: unknown }>;
}

interface ServiceAccountClient {
  auth: {
    admin?: ServiceAccountAdmin;
  };
}

type ServiceAccountClientFactory = (
  supabaseUrl: string,
  serviceRoleKey: string,
  options: { auth: { persistSession: boolean; autoRefreshToken: boolean } }
) => ServiceAccountClient;

export interface ServiceAccountProbeDependencies {
  createClient?: ServiceAccountClientFactory;
  now?: () => number;
}

const DEFAULT_TIMEOUT_MS = 7_000;

const defaultCreateClient: ServiceAccountClientFactory = (supabaseUrl, serviceRoleKey, options) =>
  createClient(supabaseUrl, serviceRoleKey, options) as unknown as ServiceAccountClient;

const maskSecret = (value: string): string => (value ? REDACTED_VALUE : '<empty>');

const withTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout: () => void
): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        onTimeout();
        reject(new Error(`Service account admin listUsers timed out after ${timeoutMs}ms`));
      }
    }, timeoutMs);

    promise
      .then((value) => {
        settled = true;
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        settled = true;
        clearTimeout(timer);
        reject(error);
      });
  });

const ensureListUsers = (client: ServiceAccountClient): ServiceAccountAdmin['listUsers'] => {
  const admin = client.auth?.admin;
  if (!admin || typeof admin.listUsers !== 'function') {
    throw new Error('Service account client missing admin.listUsers implementation');
  }
  return admin.listUsers.bind(admin);
};

export const DEFAULT_SERVICE_ACCOUNT_PROBE_TIMEOUT_MS = DEFAULT_TIMEOUT_MS;

export const runServiceAccountSmokeProbe = async (
  config: ServiceAccountProbeConfig,
  dependencies: ServiceAccountProbeDependencies = {}
): Promise<ServiceAccountProbeResult> => {
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const supabaseUrl = config.supabaseUrl.trim();
  const serviceRoleKey = config.serviceRoleKey.trim();

  if (!supabaseUrl) {
    throw new Error('Supabase URL is required for service account smoke probe');
  }

  if (!serviceRoleKey) {
    throw new Error('Supabase service role key is required for service account smoke probe');
  }

  const now = dependencies.now ?? (() => Date.now());
  const start = now();

  logger.info('[smoke] Service account probe starting', {
    metadata: {
      scope: 'smoke.serviceAccount',
      supabaseUrl,
      serviceRoleKey: maskSecret(serviceRoleKey),
    },
  });

  const createClientFactory = dependencies.createClient ?? defaultCreateClient;
  let timedOut = false;

  try {
    const client = createClientFactory(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const listUsers = ensureListUsers(client);
    const response = await withTimeout(listUsers({ perPage: 1 }), timeoutMs, () => {
      timedOut = true;
    });

    const possibleError = (response as { error?: unknown })?.error;
    if (possibleError) {
      throw possibleError;
    }

    const end = now();
    const durationMs = end - start;

    logger.info('[smoke] Service account probe succeeded', {
      metadata: {
        scope: 'smoke.serviceAccount',
        supabaseUrl,
        durationMs,
      },
    });

    return { ok: true, durationMs, timedOut: false };
  } catch (unknownError) {
    const end = now();
    const durationMs = end - start;
    const error = toError(unknownError, 'Service account smoke probe failed');

    logger.error('[smoke] Service account probe failed', {
      error,
      metadata: {
        scope: 'smoke.serviceAccount',
        supabaseUrl,
        serviceRoleKey: maskSecret(serviceRoleKey),
        durationMs,
        timedOut,
      },
    });

    return { ok: false, durationMs, error, timedOut };
  }
};

export const resolveServiceAccountProbeConfig = (
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
  options: ResolveServiceAccountProbeOptions = {},
): ServiceAccountProbeConfig | null => {
  const rawSupabaseUrl =
    options.supabaseUrlOverride ?? env.SUPABASE_URL ?? env.VITE_SUPABASE_URL ?? '';
  const supabaseUrl = rawSupabaseUrl.trim();
  const serviceRoleKey = (env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();

  if (!supabaseUrl || !serviceRoleKey) {
    return null;
  }

  return {
    supabaseUrl,
    serviceRoleKey,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  };
};
