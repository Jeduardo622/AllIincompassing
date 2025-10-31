import { createClient } from '@supabase/supabase-js';

type Role = 'client' | 'therapist' | 'admin' | 'super_admin';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('[check-role-drift] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables.');
  process.exit(1);
}

const client = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const toRole = (value: unknown): Role | null => {
  if (typeof value !== 'string') return null;

  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

  switch (normalized) {
    case 'client':
    case 'therapist':
    case 'admin':
      return normalized as Role;
    case 'super_admin':
    case 'superadmin':
      return 'super_admin';
    default:
      return null;
  }
};

type AdminListResponse = Awaited<ReturnType<typeof client.auth.admin.listUsers>>;
type AdminUser = AdminListResponse['data']['users'][number];

const listAdminUsers = async (): Promise<AdminUser[]> => {
  const perPage = 1000;
  let page = 1;
  let hasMore = true;
  const users: AdminUser[] = [];

  while (hasMore) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage });
    if (error) {
      throw error;
    }

    users.push(...data.users);

    if (data.users.length < perPage) {
      hasMore = false;
    } else {
      page += 1;
    }
  }

  return users;
};

const main = async () => {
  console.log('[check-role-drift] Inspecting admin role alignment…');

  const allUsers = await listAdminUsers();

  const adminCandidates = allUsers
    .map((user) => {
      const metadata = (user.user_metadata ?? {}) as Record<string, unknown>;
      const metaRole = toRole(metadata.role ?? metadata.signup_role ?? metadata.signupRole ?? metadata.default_role ?? metadata.defaultRole);
      return {
        id: user.id,
        email: user.email ?? 'unknown',
        metaRole,
        metadata,
      };
    })
    .filter((user) => user.metaRole === 'admin' || user.metaRole === 'super_admin');

  const profileIds = adminCandidates.map((user) => user.id);

  const { data: profileRows, error: profileError } = await client
    .from('profiles')
    .select('id, email, role')
    .in('id', profileIds.length > 0 ? profileIds : ['00000000-0000-0000-0000-000000000000']);

  if (profileError) {
    throw profileError;
  }

  const profileById = new Map(profileRows?.map((row) => [row.id, row]) ?? []);

  const mismatches: Array<{ email: string; metadataRole: Role | null; profileRole: Role | null; status: string }> = [];

  for (const candidate of adminCandidates) {
    const profile = profileById.get(candidate.id);
    const profileRole = profile ? (profile.role as Role) : null;

    if (!profile) {
      mismatches.push({
        email: candidate.email,
        metadataRole: candidate.metaRole,
        profileRole: null,
        status: 'missing-profile',
      });
      continue;
    }

    if (candidate.metaRole && profileRole !== candidate.metaRole) {
      mismatches.push({
        email: candidate.email,
        metadataRole: candidate.metaRole,
        profileRole,
        status: 'metadata-profile-mismatch',
      });
    }
  }

  // Profiles marked as admins without metadata support
  const { data: adminProfiles, error: adminProfileError } = await client
    .from('profiles')
    .select('id, email, role')
    .in('role', ['admin', 'super_admin']);

  if (adminProfileError) {
    throw adminProfileError;
  }

  for (const profile of adminProfiles ?? []) {
    const hasMetadata = adminCandidates.some((candidate) => candidate.id === profile.id);
    if (!hasMetadata) {
      mismatches.push({
        email: profile.email,
        metadataRole: null,
        profileRole: profile.role as Role,
        status: 'profile-only-admin',
      });
    }
  }

  if (mismatches.length === 0) {
    console.log('[check-role-drift] No role drift detected.');
    return;
  }

  console.table(mismatches.map((entry) => ({
    email: entry.email,
    metadataRole: entry.metadataRole ?? 'none',
    profileRole: entry.profileRole ?? 'none',
    status: entry.status,
  })));

  process.exitCode = 1;
};

void main().catch((error) => {
  console.error('[check-role-drift] Failed to evaluate role drift:', error);
  process.exit(1);
});


