import { createClient, type User } from '@supabase/supabase-js';

type SeedRole = 'admin' | 'super_admin';

interface SeedAccount {
  email: string;
  role: SeedRole;
  metadata?: Record<string, unknown>;
  organizationId?: string | null;
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DEFAULT_PASSWORD = process.env.SEED_ACCOUNT_PASSWORD ?? 'Password123!';

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('[seed-admin-users] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables.');
  process.exit(1);
}

const client = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const ACCOUNTS: SeedAccount[] = [
  {
    email: 'admin@test.com',
    role: 'admin',
    metadata: {
      first_name: 'Admin',
      last_name: 'Tester',
    },
    organizationId: null,
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

const buildSeedMetadata = (account: SeedAccount, existing: Record<string, unknown> | undefined): Record<string, unknown> => {
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

const ensureAccount = async (account: SeedAccount) => {
  const summary: { email: string; created: boolean; updated: boolean } = {
    email: account.email,
    created: false,
    updated: false,
  };

  const { data: existingResponse, error: lookupError } = await client.auth.admin.getUserByEmail(account.email);

  if (lookupError && lookupError.status !== 400) {
    throw lookupError;
  }

  const existingUser = existingResponse?.user ?? null;
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
    await ensureRoleMapping(data.user, account.role);
    return summary;
  }

  const existingRole = normalizeRole((existingUser.user_metadata as Record<string, unknown> | undefined)?.role);
  const needsRoleUpdate = existingRole !== account.role;
  const needsOrgUpdate = account.organizationId !== undefined && (existingUser.user_metadata as Record<string, unknown> | undefined)?.organization_id !== account.organizationId;

  if (needsRoleUpdate || needsOrgUpdate) {
    const { error } = await client.auth.admin.updateUserById(existingUser.id, {
      password: DEFAULT_PASSWORD,
      user_metadata: metadata,
    });

    if (error) {
      throw error;
    }

    summary.updated = true;
  }

  await ensureRoleMapping(existingUser, account.role);
  return summary;
};

const ensureRoleMapping = async (user: User, role: SeedRole) => {
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

  const { error } = await client
    .from('user_roles')
    .insert({ user_id: user.id, role_id: roleId })
    .onConflict('user_id,role_id')
    .ignore();

  if (error && error.code !== '23505') {
    throw error;
  }
};

const main = async () => {
  console.log('[seed-admin-users] Seeding diagnostic admin accounts…');

  if (!process.env.SEED_ACCOUNT_PASSWORD) {
    console.warn('[seed-admin-users] Using default password Password123!; override via SEED_ACCOUNT_PASSWORD env for production environments.');
  }

  const results: Array<{ email: string; created: boolean; updated: boolean }> = [];

  for (const account of ACCOUNTS) {
    try {
      const summary = await ensureAccount(account);
      results.push(summary);
    } catch (error) {
      console.error(`[seed-admin-users] Failed to seed ${account.email}:`, error);
      process.exitCode = 1;
    }
  }

  console.table(results);
};

void main();

