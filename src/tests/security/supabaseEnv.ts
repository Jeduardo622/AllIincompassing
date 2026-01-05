const importMetaEnv = (import.meta as unknown as {
  env?: Record<string, string | undefined>;
}).env ?? {};

// Vitest does not automatically load .env files (Vite does).
// Keep this scoped to the security test harness so we don't alter app/runtime behavior.
import { existsSync } from 'node:fs';
import dotenv from 'dotenv';

const loadDotenvIfPresent = (path: string): void => {
  if (!existsSync(path)) {
    return;
  }
  // Never override explicitly provided env (CI, shells, etc).
  dotenv.config({ path, override: false });
};

// Load local env once to allow RUN_DB_IT security tests to run without manual exports.
// This is a no-op if variables are already present.
loadDotenvIfPresent('.env');
loadDotenvIfPresent('.env.local');

const readEnvValue = (
  key: string,
  overrides?: Record<string, string | undefined>,
): string | undefined => {
  const raw = overrides?.[key] ?? process.env[key] ?? importMetaEnv[key];
  if (typeof raw !== 'string') {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export const parseSupabaseProjectRef = (url: string): string | null => {
  try {
    const parsed = new URL(url);
    const [projectRef] = parsed.hostname.split('.');
    return projectRef && projectRef.length > 0 ? projectRef : null;
  } catch {
    return null;
  }
};

const findServiceRoleKeyInPayload = (payload: unknown): string | undefined => {
  const queue: unknown[] = [payload];
  while (queue.length > 0) {
    const current = queue.shift();
    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }
    if (!current || typeof current !== 'object') {
      continue;
    }
    const record = current as Record<string, unknown>;
    const descriptor = (() => {
      const typeField = record.type;
      if (typeof typeField === 'string' && typeField.trim().length > 0) {
        return typeField;
      }
      const nameField = record.name;
      if (typeof nameField === 'string' && nameField.trim().length > 0) {
        return nameField;
      }
      return undefined;
    })();
    const normalizedDescriptor = descriptor?.toLowerCase() ?? '';
    const candidateKey = (() => {
      const apiKey = record.api_key;
      if (typeof apiKey === 'string' && apiKey.trim().length > 0) {
        return apiKey;
      }
      const secret = record.secret;
      if (typeof secret === 'string' && secret.trim().length > 0) {
        return secret;
      }
      const key = record.key;
      if (typeof key === 'string' && key.trim().length > 0) {
        return key;
      }
      return undefined;
    })();
    if (normalizedDescriptor.includes('service') && candidateKey) {
      return candidateKey;
    }
    queue.push(...Object.values(record));
  }
  return undefined;
};

const fetchServiceRoleKey = async (
  projectRef: string,
  accessToken: string,
  fetchImpl: typeof fetch,
): Promise<string> => {
  const response = await fetchImpl(
    `https://api.supabase.com/v1/projects/${projectRef}/api-keys`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    },
  );

  if (!response.ok) {
    throw new Error(`Supabase management API responded with status ${response.status}.`);
  }

  const payload = (await response.json()) as unknown;
  const serviceRoleKey = findServiceRoleKeyInPayload(payload);
  if (!serviceRoleKey) {
    throw new Error('Supabase management API response did not include a service role key.');
  }
  return serviceRoleKey;
};

export interface ResolveSupabaseEnvOptions {
  readonly isCiEnvironment: boolean;
  readonly runDatabaseIntegrationTests: boolean;
  readonly fetchImpl?: typeof fetch;
  readonly envOverrides?: Record<string, string | undefined>;
}

export interface ResolveSupabaseEnvResult {
  readonly supabaseUrl?: string;
  readonly supabaseAnonKey?: string;
  readonly supabaseServiceRoleKey?: string;
  readonly missing: string[];
  readonly blockers: string[];
  readonly shouldRun: boolean;
}

export const resolveSupabaseTestEnv = async (
  options: ResolveSupabaseEnvOptions,
): Promise<ResolveSupabaseEnvResult> => {
  const { envOverrides } = options;
  const supabaseUrl =
    readEnvValue('SUPABASE_URL', envOverrides) ??
    readEnvValue('VITE_SUPABASE_URL', envOverrides);
  const supabaseAnonKey =
    readEnvValue('SUPABASE_ANON_KEY', envOverrides) ??
    readEnvValue('VITE_SUPABASE_ANON_KEY', envOverrides);

  let supabaseServiceRoleKey = readEnvValue(
    'SUPABASE_SERVICE_ROLE_KEY',
    envOverrides,
  );
  const accessToken = readEnvValue('SUPABASE_ACCESS_TOKEN', envOverrides);

  const blockers: string[] = [];

  if (!supabaseServiceRoleKey) {
    const fetchImpl = options.fetchImpl ?? (typeof fetch === 'function' ? fetch : undefined);
    if (fetchImpl && accessToken && supabaseUrl) {
      const projectRef = parseSupabaseProjectRef(supabaseUrl);
      if (projectRef) {
        try {
          supabaseServiceRoleKey = await fetchServiceRoleKey(
            projectRef,
            accessToken,
            fetchImpl,
          );
          if (!envOverrides) {
            process.env.SUPABASE_SERVICE_ROLE_KEY = supabaseServiceRoleKey;
          }
        } catch (error) {
          const message =
            error instanceof Error && error.message.trim().length > 0
              ? error.message
              : 'Unknown error retrieving service role key.';
          blockers.push(
            `Supabase service role key could not be hydrated automatically: ${message}`,
          );
        }
      } else {
        blockers.push(
          'Unable to derive Supabase project reference from SUPABASE_URL to hydrate service role key automatically.',
        );
      }
    } else {
      if (!accessToken) {
        blockers.push(
          'SUPABASE_ACCESS_TOKEN is not available to hydrate the service role key automatically.',
        );
      }
      if (!supabaseUrl) {
        blockers.push(
          'SUPABASE_URL is required to hydrate the service role key automatically.',
        );
      }
      if (!fetchImpl) {
        blockers.push(
          'Node fetch implementation is unavailable to hydrate the Supabase service role key automatically.',
        );
      }
    }
  }

  const missing: string[] = [];
  if (!supabaseUrl) {
    missing.push('SUPABASE_URL');
  }
  if (!supabaseAnonKey) {
    missing.push('SUPABASE_ANON_KEY');
  }
  if (!supabaseServiceRoleKey) {
    missing.push('SUPABASE_SERVICE_ROLE_KEY');
  }

  if (!options.isCiEnvironment && !options.runDatabaseIntegrationTests) {
    blockers.push(
      'Set RUN_DB_IT=1 locally (or run inside CI) to opt into the Supabase RLS integration suite.',
    );
  }

  const shouldRun =
    missing.length === 0 &&
    (options.isCiEnvironment || options.runDatabaseIntegrationTests);

  return {
    supabaseUrl,
    supabaseAnonKey,
    supabaseServiceRoleKey,
    missing,
    blockers,
    shouldRun,
  };
};

export const SUPABASE_ENV_GUIDANCE =
  'Expose SUPABASE_URL, SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY to the test environment (for CI, map GitHub secrets with these names) before running `npm test`. For local runs, export the same values and set RUN_DB_IT=1 to opt into the suite. These should reference a read-only Supabase project dedicated to automated testing.';

export const computeEnvironmentGuidance = (
  missing: string[],
): string | undefined => {
  if (missing.length === 0) {
    return undefined;
  }
  return SUPABASE_ENV_GUIDANCE;
};
