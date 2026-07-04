import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { appendFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';

type RoleName = 'super_admin';

const getEnv = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
};

export const serializeError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  if (error && typeof error === 'object') {
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  return String(error);
};

export const getMissingProvisionSecrets = (env: NodeJS.ProcessEnv = process.env): string[] => (
  ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'].filter((name) => !env[name]?.trim())
);

export const shouldSkipForSecretlessPullRequest = (env: NodeJS.ProcessEnv = process.env): boolean => (
  env.GITHUB_EVENT_NAME === 'pull_request' && getMissingProvisionSecrets(env).length > 0
);

export const buildDefaultSmokeAdminEmail = (): string => {
  const runId = process.env.GITHUB_RUN_ID?.trim() || String(Date.now());
  const runAttempt = process.env.GITHUB_RUN_ATTEMPT?.trim() || '1';
  const job = process.env.GITHUB_JOB?.trim() || 'local';
  return `playwright.ci.${job}.${runId}.${runAttempt}@example.com`.toLowerCase();
};

export const assertDedicatedSmokeEmail = (email: string): void => {
  if (!/^playwright\.ci\.[a-z0-9_.-]+@example\.com$/i.test(email)) {
    throw new Error('Refusing to mutate non-dedicated CI smoke account email.');
  }
};

const createPassword = (): string => `C1-${randomBytes(18).toString('base64url')}!Aa`;

const createAdminClient = (): SupabaseClient =>
  createClient(getEnv('SUPABASE_URL'), getEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

const findUserByEmail = async (client: SupabaseClient, email: string) => {
  const normalized = email.toLowerCase();
  const perPage = 200;

  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage });
    if (error) {
      throw error;
    }

    const user = data.users.find((candidate) => candidate.email?.toLowerCase() === normalized);
    if (user) {
      return user;
    }

    if (data.users.length < perPage) {
      break;
    }
  }

  return null;
};

const ensureRoleMapping = async (client: SupabaseClient, userId: string, email: string, role: RoleName): Promise<void> => {
  const { data: roleRow, error: roleError } = await client
    .from('roles')
    .select('id')
    .eq('name', role)
    .maybeSingle();

  if (roleError) {
    throw roleError;
  }
  if (!roleRow?.id) {
    throw new Error(`Role ${role} is not provisioned.`);
  }

  const { error: profileError } = await client.from('profiles').upsert(
    {
      id: userId,
      email,
      role,
      is_active: true,
      first_name: 'Playwright',
      last_name: 'CI',
      organization_id: null,
    },
    { onConflict: 'id' },
  );

  if (profileError) {
    throw profileError;
  }

  const { error: userRoleError } = await client.from('user_roles').upsert(
    {
      user_id: userId,
      role_id: roleRow.id,
      is_active: true,
    },
    { onConflict: 'user_id,role_id' },
  );

  if (userRoleError) {
    throw userRoleError;
  }
};

export const writeGitHubEnv = (email: string, password: string): void => {
  process.stdout.write(`::add-mask::${password}\n`);

  const githubEnv = process.env.GITHUB_ENV?.trim();
  if (!githubEnv) {
    return;
  }

  appendFileSync(githubEnv, `PW_SUPERADMIN_EMAIL=${email}\n`, { encoding: 'utf8' });
  appendFileSync(githubEnv, `PW_SUPERADMIN_PASSWORD=${password}\n`, { encoding: 'utf8' });
};

export const resolveCleanupSmokeAdminEmail = (): string => (
  process.env.CI_SMOKE_ADMIN_EMAIL?.trim()
  || process.env.PW_SUPERADMIN_EMAIL?.trim()
  || buildDefaultSmokeAdminEmail()
).toLowerCase();

const provision = async (): Promise<void> => {
  const email = (process.env.CI_SMOKE_ADMIN_EMAIL?.trim() || buildDefaultSmokeAdminEmail()).toLowerCase();
  assertDedicatedSmokeEmail(email);

  const password = createPassword();
  const metadata = {
    role: 'super_admin',
    signup_role: 'super_admin',
    is_admin: true,
    is_super_admin: true,
    organization_id: null,
    organizationId: null,
  };
  const client = createAdminClient();
  const existing = await findUserByEmail(client, email);

  if (existing) {
    const { error } = await client.auth.admin.updateUserById(existing.id, {
      password,
      email_confirm: true,
      user_metadata: {
        ...(existing.user_metadata ?? {}),
        ...metadata,
      },
    });
    if (error) {
      throw error;
    }
    await ensureRoleMapping(client, existing.id, email, 'super_admin');
    writeGitHubEnv(email, password);
    console.log(JSON.stringify({ ok: true, action: 'updated', email, userId: existing.id }));
    return;
  }

  const { data, error } = await client.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: metadata,
  });

  if (error) {
    throw error;
  }
  if (!data.user) {
    throw new Error('Supabase did not return a created smoke user.');
  }

  await ensureRoleMapping(client, data.user.id, email, 'super_admin');
  writeGitHubEnv(email, password);
  console.log(JSON.stringify({ ok: true, action: 'created', email, userId: data.user.id }));
};

const cleanup = async (): Promise<void> => {
  const email = resolveCleanupSmokeAdminEmail();
  if (!email) {
    console.log(JSON.stringify({ ok: true, action: 'cleanup_skipped', reason: 'missing_email' }));
    return;
  }
  assertDedicatedSmokeEmail(email);

  const client = createAdminClient();
  const user = await findUserByEmail(client, email);
  if (!user) {
    console.log(JSON.stringify({ ok: true, action: 'cleanup_skipped', email, reason: 'not_found' }));
    return;
  }

  const { error: userRolesDeleteError } = await client.from('user_roles').delete().eq('user_id', user.id);
  if (userRolesDeleteError) {
    throw userRolesDeleteError;
  }

  const { error: profileDeleteError } = await client.from('profiles').delete().eq('id', user.id);
  if (profileDeleteError) {
    throw profileDeleteError;
  }

  const { error } = await client.auth.admin.deleteUser(user.id);
  if (error) {
    throw error;
  }
  console.log(JSON.stringify({ ok: true, action: 'deleted', email, userId: user.id }));
};

const main = async (): Promise<void> => {
  const missingSecrets = getMissingProvisionSecrets();
  if (missingSecrets.length > 0) {
    if (shouldSkipForSecretlessPullRequest()) {
      console.log(
        JSON.stringify({
          ok: true,
          action: 'skipped',
          reason: 'missing_pull_request_secrets',
          missing: missingSecrets,
        }),
      );
      return;
    }
    throw new Error(`Missing required Supabase admin secrets: ${missingSecrets.join(', ')}.`);
  }

  if (process.argv.includes('--cleanup')) {
    await cleanup();
    return;
  }
  await provision();
};

const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href && process.env.VITEST !== 'true';

if (isDirectRun) {
  main().catch((error) => {
    console.error(
      JSON.stringify({
        ok: false,
        error: serializeError(error),
      }),
    );
    process.exit(1);
  });
}
