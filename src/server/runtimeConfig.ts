import type { RuntimeSupabaseConfig } from '../lib/runtimeConfig';
import { serverLogger as logger } from '../lib/logger/server';
import { getOptionalServerEnv, getRequiredServerEnv } from './env';

export const RUNTIME_CONFIG_FALLBACK_ORGANIZATION_ID = '5238e88b-6198-4862-80a2-dbe15bbeabdd';
const PLACEHOLDER_ENV_PATTERNS = [/^\*+$/, /^changeme$/i, /^replace[-_ ]?me$/i, /^your[-_ ]/i];

const getRuntimeEnvironment = (): string => {
  return (
    getOptionalServerEnv('APP_ENV') ||
    getOptionalServerEnv('NODE_ENV') ||
    getOptionalServerEnv('ENVIRONMENT') ||
    getOptionalServerEnv('NETLIFY_CONTEXT') ||
    'development'
  );
};

const shouldAllowFallbacks = (): boolean => getRuntimeEnvironment() !== 'production';

const isPlaceholderValue = (value: string): boolean => {
  return PLACEHOLDER_ENV_PATTERNS.some((pattern) => pattern.test(value.trim()));
};

const assertSupabaseUrl = (value: string): void => {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('SUPABASE_URL must be a valid absolute URL');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('SUPABASE_URL must use http or https');
  }

  if (isPlaceholderValue(value)) {
    throw new Error('SUPABASE_URL appears to be a placeholder value');
  }
};

const assertSupabaseAnonKey = (value: string): void => {
  const trimmed = value.trim();
  if (isPlaceholderValue(trimmed)) {
    throw new Error('SUPABASE_ANON_KEY appears to be a placeholder value');
  }
  if (trimmed.toLowerCase().includes('unregistered')) {
    throw new Error('SUPABASE_ANON_KEY appears invalid (contains unregistered marker)');
  }

  // Supabase anon keys should not be trivially short.
  if (trimmed.length < 24) {
    throw new Error('SUPABASE_ANON_KEY appears invalid (too short)');
  }
};

const resolveRequiredEnv = (primaryKey: string, fallbackKeys: string[]): string => {
  const primary = getOptionalServerEnv(primaryKey);
  if (primary) {
    return primary;
  }

  for (const fallbackKey of fallbackKeys) {
    const fallback = getOptionalServerEnv(fallbackKey);
    if (fallback) {
      logger.warn(`${primaryKey} missing; falling back to alternate env`, {
        fallbackKey,
      });
      return fallback;
    }
  }

  return getRequiredServerEnv(primaryKey);
};

const resolveDefaultOrganizationId = (): string => {
  const explicit = getOptionalServerEnv('DEFAULT_ORGANIZATION_ID');
  if (explicit) {
    return explicit;
  }

  const fallbackKeys = [
    'SUPABASE_DEFAULT_ORGANIZATION_ID',
    'VITE_DEFAULT_ORGANIZATION_ID',
    'DEFAULT_ORG_ID',
  ];

  for (const key of fallbackKeys) {
    const candidate = getOptionalServerEnv(key);
    if (candidate) {
      logger.warn('DEFAULT_ORGANIZATION_ID missing; falling back to alternate env', {
        fallbackKey: key,
      });
      return candidate;
    }
  }

  if (!shouldAllowFallbacks()) {
    throw new Error('DEFAULT_ORGANIZATION_ID missing in production environment');
  }

  logger.warn(
    'DEFAULT_ORGANIZATION_ID missing; falling back to baked-in runtime config default',
    {
      fallbackOrganizationId: RUNTIME_CONFIG_FALLBACK_ORGANIZATION_ID,
    },
  );
  return RUNTIME_CONFIG_FALLBACK_ORGANIZATION_ID;
};

export const getRuntimeSupabaseConfig = (): RuntimeSupabaseConfig => {
  const supabaseUrl = resolveRequiredEnv('SUPABASE_URL', ['VITE_SUPABASE_URL']);
  const supabaseAnonKey = resolveRequiredEnv('SUPABASE_ANON_KEY', ['VITE_SUPABASE_ANON_KEY']);
  const supabaseEdgeUrl = getOptionalServerEnv('SUPABASE_EDGE_URL') ?? getOptionalServerEnv('VITE_SUPABASE_EDGE_URL');
  const defaultOrganizationId = resolveDefaultOrganizationId();
  assertSupabaseUrl(supabaseUrl);
  assertSupabaseAnonKey(supabaseAnonKey);

  return {
    supabaseUrl,
    supabaseAnonKey,
    defaultOrganizationId,
    supabaseEdgeUrl: supabaseEdgeUrl ?? undefined,
  };
};

export const getDefaultOrganizationId = (): string => resolveDefaultOrganizationId();

