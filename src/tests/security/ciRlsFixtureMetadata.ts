import type { SupabaseClient } from '@supabase/supabase-js';

export type CiRlsAppMetadata = {
  ci_rls_fixture: true;
  ci_rls_expires_at: string;
};

export type CiRlsFixtureRole = 'admin' | 'therapist' | 'client';

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

export const reconcileCiRlsFixtureRole = async (
  serviceClient: SupabaseClient,
  userId: string,
  expectedRole: CiRlsFixtureRole,
): Promise<void> => {
  const actorResult = await serviceClient.auth.admin.getUserById(userId);
  if (actorResult.error || !actorResult.data.user) {
    throw actorResult.error ?? new Error('Synthetic RLS actor readback failed before role reconciliation');
  }

  const actor = actorResult.data.user;
  const expiresAt = Date.parse(String(actor.app_metadata.ci_rls_expires_at ?? ''));
  if (
    !/^.+\..+@example\.com$/i.test(actor.email ?? '')
    || actor.app_metadata.ci_rls_fixture !== true
    || !Number.isFinite(expiresAt)
    || expiresAt <= Date.now()
  ) {
    throw new Error('Synthetic RLS actor is not eligible for role reconciliation');
  }

  const roleLookup = await serviceClient
    .from('roles')
    .select('id')
    .eq('name', expectedRole)
    .maybeSingle();
  if (roleLookup.error || !roleLookup.data?.id) {
    throw roleLookup.error ?? new Error(`Synthetic RLS fixture role ${expectedRole} is missing`);
  }

  const deactivateResult = await serviceClient
    .from('user_roles')
    .update({ is_active: false })
    .eq('user_id', userId);
  if (deactivateResult.error) {
    throw deactivateResult.error;
  }

  const upsertResult = await serviceClient.from('user_roles').upsert(
    {
      user_id: userId,
      role_id: roleLookup.data.id,
      is_active: true,
      expires_at: null,
    },
    { onConflict: 'user_id,role_id' },
  );
  if (upsertResult.error) {
    throw upsertResult.error;
  }

  const activeResult = await serviceClient
    .from('user_roles')
    .select('role_id, is_active, expires_at')
    .eq('user_id', userId)
    .eq('is_active', true);
  if (activeResult.error) {
    throw activeResult.error;
  }

  const now = Date.now();
  const activeRoleIds = (activeResult.data ?? [])
    .filter((row) => !row.expires_at || Date.parse(row.expires_at) > now)
    .map((row) => row.role_id);
  if (activeRoleIds.length !== 1 || activeRoleIds[0] !== roleLookup.data.id) {
    throw new Error(`Synthetic RLS actor role reconciliation failed for ${expectedRole}`);
  }
};
