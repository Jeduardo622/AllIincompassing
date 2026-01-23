import { createClient } from '@supabase/supabase-js';

type AdminRole = 'admin' | 'super_admin';

type ProfileRow = {
  id: string;
  email: string | null;
  role: AdminRole;
};

const getClient = () => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables.');
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
};

export const buildAdminMetadata = (role: AdminRole, existing: Record<string, unknown> | null | undefined) => {
  const metadata = { ...(existing ?? {}) } as Record<string, unknown>;
  metadata.role = role;
  metadata.signup_role = role;

  if (role === 'admin') {
    metadata.is_admin = true;
    metadata.is_super_admin = false;
  } else {
    metadata.is_admin = true;
    metadata.is_super_admin = true;
  }

  return metadata;
};

export const resolveMissingAuthProfileRole = () => ({
  role: 'client' as const,
  reason: 'missing-auth-user-downgraded',
});

const fetchProfileAdmins = async (clientInstance: ReturnType<typeof createClient>): Promise<ProfileRow[]> => {
  const { data, error } = await clientInstance
    .from('profiles')
    .select('id, email, role')
    .in('role', ['admin', 'super_admin']);

  if (error) {
    throw error;
  }

  return (data ?? []) as ProfileRow[];
};

const downgradeProfileRole = async (clientInstance: ReturnType<typeof createClient>, profile: ProfileRow) => {
  const resolution = resolveMissingAuthProfileRole();
  const { error } = await clientInstance
    .from('profiles')
    .update({ role: resolution.role })
    .eq('id', profile.id);

  if (error) {
    throw error;
  }

  return { email: profile.email ?? profile.id, updated: true, reason: resolution.reason };
};

const updateAuthMetadata = async (clientInstance: ReturnType<typeof createClient>, profile: ProfileRow) => {
  const { data: userResponse, error: fetchError } = await clientInstance.auth.admin.getUserById(profile.id);

  if (fetchError) {
    if (fetchError.status === 404) {
      return downgradeProfileRole(clientInstance, profile);
    }
    throw fetchError;
  }

  const user = userResponse.user;
  if (!user) {
    return { email: profile.email ?? profile.id, updated: false, reason: 'missing-auth-user' };
  }

  const metadata = buildAdminMetadata(profile.role, user.user_metadata as Record<string, unknown> | undefined);
  const { error: updateError } = await clientInstance.auth.admin.updateUserById(profile.id, {
    user_metadata: metadata,
  });

  if (updateError) {
    throw updateError;
  }

  return { email: profile.email ?? profile.id, updated: true, reason: 'ok' };
};

const main = async () => {
  console.log('[sync-profile-only-admins] Aligning auth metadata for admin profiles…');

  const clientInstance = getClient();
  const profiles = await fetchProfileAdmins(clientInstance);
  const results: Array<{ email: string; updated: boolean; reason: string }> = [];

  for (const profile of profiles) {
    try {
      const result = await updateAuthMetadata(clientInstance, profile);
      results.push(result);
    } catch (error) {
      console.error(`[sync-profile-only-admins] Failed for ${profile.email ?? profile.id}:`, error);
      results.push({
        email: profile.email ?? profile.id,
        updated: false,
        reason: 'error',
      });
      process.exitCode = 1;
    }
  }

  console.table(results);
};

if (process.env.VITEST !== 'true') {
  void main().catch((error) => {
    console.error('[sync-profile-only-admins] Failed to sync metadata:', error);
    process.exit(1);
  });
}
