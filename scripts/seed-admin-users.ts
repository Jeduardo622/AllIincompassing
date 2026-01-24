import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { pathToFileURL } from 'node:url';

type SeedRole = 'admin' | 'super_admin';

interface SeedAccount {
  email: string;
  role: SeedRole;
  metadata?: Record<string, unknown>;
  organizationId?: string | null;
}

const DEFAULT_PASSWORD = process.env.SEED_ACCOUNT_PASSWORD ?? 'Password123!';
const SHOULD_RESET_PASSWORD = process.env.SEED_ACCOUNT_PASSWORD_RESET === 'true';

const DEFAULT_ORGANIZATION_ID = process.env.DEFAULT_ORGANIZATION_ID ?? null;

const ACCOUNTS: SeedAccount[] = [
  {
    email: 'admin@test.com',
    role: 'admin',
    metadata: {
      first_name: 'Admin',
      last_name: 'Tester',
    },
    organizationId: DEFAULT_ORGANIZATION_ID,
  },
  {
    email: 'superadmin@test.com',
    role: 'super_admin',
    metadata: {
      first_name: 'Super',
      last_name: 'Admin',
    },
    organizationId: null,
  },
];

const normalizeRole = (value: unknown): SeedRole | null => {
  if (typeof value !== 'string') return null;
  const lowered = value.toLowerCase();
  if (lowered === 'admin' || lowered === 'super_admin') {
    return lowered as SeedRole;
  }
  return null;
};

export const buildSeedMetadata = (
  account: SeedAccount,
  existing: Record<string, unknown> | undefined,
): Record<string, unknown> => {
  const metadata = { ...(existing ?? {}) } as Record<string, unknown>;
  metadata.role = account.role;
  metadata.signup_role = account.role;
  metadata.organization_id = account.organizationId ?? null;
  metadata.organizationId = account.organizationId ?? null;

  if (account.role === 'admin') {
    metadata.is_admin = true;
    metadata.is_super_admin = false;
  } else {
    metadata.is_admin = true;
    metadata.is_super_admin = true;
  }

  if (account.metadata) {
    Object.assign(metadata, account.metadata);
  }

  return metadata;
};

const getClient = (): SupabaseClient => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables.');
  }

  return createClient(supabaseUrl, serviceRoleKey);
};

type UserLookup = Pick<User, 'id' | 'user_metadata'> & { email?: string | null };

export const findUserByEmail = async (client: SupabaseClient, email: string): Promise<UserLookup | null> => {
  const admin = client.auth.admin;

  if ('getUserByEmail' in admin && typeof admin.getUserByEmail === 'function') {
    const { data: existingResponse, error: lookupError } = await admin.getUserByEmail(email);

    if (lookupError && lookupError.status !== 400) {
      throw lookupError;
    }

    return existingResponse?.user ?? null;
  }

  const perPage = 200;
  const maxPages = 10;
  const normalizedEmail = email.toLowerCase();

  for (let page = 1; page <= maxPages; page += 1) {
    const { data, error } = await admin.listUsers({ page, perPage });

    if (error) {
      throw error;
    }

    const found = data.users.find((user) => user.email?.toLowerCase() === normalizedEmail);

    if (found) {
      return found;
    }

    if (data.users.length < perPage) {
      break;
    }
  }

  return null;
};

const ensureAccount = async (client: SupabaseClient, account: SeedAccount) => {
  const summary: { email: string; created: boolean; updated: boolean } = {
    email: account.email,
    created: false,
    updated: false,
  };

  const existingUser = await findUserByEmail(client, account.email);
  const metadata = buildSeedMetadata(account, existingUser?.user_metadata as Record<string, unknown> | undefined);

  if (!existingUser) {
    const { data, error } = await client.auth.admin.createUser({
      email: account.email,
      password: DEFAULT_PASSWORD,
      user_metadata: metadata,
      email_confirm: true,
    });

    if (error) {
      throw error;
    }

    summary.created = true;
    await ensureRoleMapping(client, data.user, account.role);
    return summary;
  }

  const existingRole = normalizeRole((existingUser.user_metadata as Record<string, unknown> | undefined)?.role);
  const needsRoleUpdate = existingRole !== account.role;
  const needsOrgUpdate = account.organizationId !== undefined && (existingUser.user_metadata as Record<string, unknown> | undefined)?.organization_id !== account.organizationId;

  if (needsRoleUpdate || needsOrgUpdate) {
    const updatePayload: { password?: string; user_metadata: Record<string, unknown> } = {
      user_metadata: metadata,
    };

    if (SHOULD_RESET_PASSWORD && process.env.SEED_ACCOUNT_PASSWORD) {
      updatePayload.password = DEFAULT_PASSWORD;
    }

    const { error } = await client.auth.admin.updateUserById(existingUser.id, updatePayload);

    if (error) {
      throw error;
    }

    summary.updated = true;
  }

  await ensureRoleMapping(client, existingUser, account.role);
  return summary;
};

const ensureRoleMapping = async (client: SupabaseClient, user: Pick<User, 'id'>, role: SeedRole) => {
  const { data: roles, error: roleError } = await client
    .from('roles')
    .select('id')
    .eq('name', role)
    .maybeSingle();

  if (roleError) {
    throw roleError;
  }

  const roleId = roles?.id;

  if (!roleId) {
    throw new Error(`Role ${role} is not provisioned in the roles table.`);
  }

  const { error } = await client.from('user_roles').upsert(
    { user_id: user.id, role_id: roleId },
    {
      onConflict: 'user_id,role_id',
      ignoreDuplicates: true,
    },
  );

  if (error) {
    throw error;
  }
};

const main = async () => {
  console.log('[seed-admin-users] Seeding diagnostic admin accounts…');

  if (!process.env.SEED_ACCOUNT_PASSWORD) {
    console.warn('[seed-admin-users] Using default password Password123!; override via SEED_ACCOUNT_PASSWORD env for production environments.');
  }

  const results: Array<{ email: string; created: boolean; updated: boolean }> = [];

  const client = getClient();

  for (const account of ACCOUNTS) {
    try {
      const summary = await ensureAccount(client, account);
      results.push(summary);
    } catch (error) {
      console.error(`[seed-admin-users] Failed to seed ${account.email}:`, error);
      process.exitCode = 1;
    }
  }

  console.table(results);
};

const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href && process.env.VITEST !== 'true';

if (isDirectRun) {
  void main();
}

