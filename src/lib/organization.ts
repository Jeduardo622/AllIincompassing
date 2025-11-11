import { useMemo } from 'react';
import type { User } from '@supabase/supabase-js';
import { useAuth, type UserProfile } from './authContext';

const normalizeId = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

interface ResolveOrganizationArgs {
  user?: User | null;
  profile?: UserProfile | null;
}

export const resolveOrganizationId = ({
  user,
  profile,
}: ResolveOrganizationArgs): string | null => {
  const metadata = (user?.user_metadata ?? {}) as Record<string, unknown>;
  const metaSnake = normalizeId(metadata.organization_id);
  const metaCamel = normalizeId(metadata.organizationId);

  if (metaSnake) return metaSnake;
  if (metaCamel) return metaCamel;

  const profileOrg = normalizeId((profile as unknown as { organization_id?: string | null })?.organization_id);
  if (profileOrg) return profileOrg;

  const preferences = profile?.preferences;
  if (preferences && typeof preferences === 'object') {
    const prefRecord = preferences as Record<string, unknown>;
    const prefSnake = normalizeId(prefRecord.organization_id);
    if (prefSnake) return prefSnake;
    const prefCamel = normalizeId(prefRecord.organizationId);
    if (prefCamel) return prefCamel;
  }

  return null;
};

export const useActiveOrganizationId = (): string | null => {
  const { user, profile } = useAuth();

  return useMemo(() => resolveOrganizationId({ user, profile }), [user, profile]);
};

