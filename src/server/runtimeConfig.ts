import type { RuntimeSupabaseConfig } from '../lib/runtimeConfig';
import { logger } from '../lib/logger/logger';
import { getOptionalServerEnv, getRequiredServerEnv } from './env';

export const RUNTIME_CONFIG_FALLBACK_ORGANIZATION_ID = '5238e88b-6198-4862-80a2-dbe15bbeabdd';

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

  logger.warn(
    'DEFAULT_ORGANIZATION_ID missing; falling back to baked-in runtime config default',
    {
      fallbackOrganizationId: RUNTIME_CONFIG_FALLBACK_ORGANIZATION_ID,
    },
  );
  return RUNTIME_CONFIG_FALLBACK_ORGANIZATION_ID;
};

export const getRuntimeSupabaseConfig = (): RuntimeSupabaseConfig => {
  const supabaseUrl = getRequiredServerEnv('SUPABASE_URL');
  const supabaseAnonKey = getRequiredServerEnv('SUPABASE_ANON_KEY');
  const supabaseEdgeUrl = getOptionalServerEnv('SUPABASE_EDGE_URL');
  const defaultOrganizationId = resolveDefaultOrganizationId();

  return {
    supabaseUrl,
    supabaseAnonKey,
    defaultOrganizationId,
    supabaseEdgeUrl: supabaseEdgeUrl ?? undefined,
  };
};

