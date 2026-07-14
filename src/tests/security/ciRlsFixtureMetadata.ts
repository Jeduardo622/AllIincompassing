import type { SupabaseClient } from '@supabase/supabase-js';

export type CiRlsAppMetadata = {
  ci_rls_fixture: true;
  ci_rls_expires_at: string;
};

export const buildCiRlsAppMetadata = (): CiRlsAppMetadata => ({
  ci_rls_fixture: true,
  ci_rls_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
});

export const persistCiRlsAppMetadata = async (
  serviceClient: SupabaseClient,
  userId: string,
  metadata: CiRlsAppMetadata = buildCiRlsAppMetadata(),
): Promise<void> => {
  const updateResult = await serviceClient.auth.admin.updateUserById(userId, {
    app_metadata: metadata,
  });
  if (updateResult.error) {
    throw updateResult.error;
  }

  const readResult = await serviceClient.auth.admin.getUserById(userId);
  if (readResult.error || !readResult.data.user) {
    throw readResult.error ?? new Error('Synthetic RLS actor metadata readback failed');
  }

  const persisted = readResult.data.user.app_metadata;
  const expiresAt = Date.parse(String(persisted.ci_rls_expires_at ?? ''));
  if (persisted.ci_rls_fixture !== true || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    throw new Error('Synthetic RLS actor metadata was not persisted with an unexpired marker');
  }
};
