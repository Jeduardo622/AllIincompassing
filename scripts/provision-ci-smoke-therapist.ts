import { randomBytes } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { resolveSmokeAdminOrganizationId, serializeError } from './provision-ci-smoke-admin';

type SmokeTherapistOwnershipMetadata = {
  smoke_actor: 'ci_therapist';
  smoke_email: string;
  smoke_run_id: string;
  smoke_run_attempt: string;
  smoke_job: string;
};

type SmokeTherapistFixtureMetadata = SmokeTherapistOwnershipMetadata & {
  ci_rls_fixture: 'true';
  ci_rls_expires_at: string;
};

export interface SmokeTherapistProfileInvariant {
  id?: string | null;
  role?: string | null;
  is_active?: boolean | null;
  organization_id?: string | null;
}

const getEnv = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
};

export const buildDefaultSmokeTherapistEmail = (
  env: NodeJS.ProcessEnv = process.env,
): string => {
  const runId = env.GITHUB_RUN_ID?.trim() || String(Date.now());
  const runAttempt = env.GITHUB_RUN_ATTEMPT?.trim() || '1';
  const job = env.GITHUB_JOB?.trim() || 'local';
  return `playwright.ci.therapist.${job}.${runId}.${runAttempt}@example.com`.toLowerCase();
};

export const assertDedicatedSmokeTherapistEmail = (email: string): void => {
  if (!/^playwright\.ci\.therapist\.[a-z0-9_.-]+\.[a-z0-9_.-]+\.[a-z0-9_.-]+@example\.com$/i.test(email)) {
    throw new Error('Refusing to mutate non-dedicated CI therapist account email.');
  }
};

export const getMissingSmokeTherapistSecrets = (
  env: NodeJS.ProcessEnv = process.env,
): string[] => [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_PUBLISHABLE_KEY',
  'CI_SMOKE_THERAPIST_SCOPE_EMAIL',
].filter((name) => !env[name]?.trim());

export const shouldSkipSecretlessPullRequest = (
  env: NodeJS.ProcessEnv = process.env,
): boolean => env.GITHUB_EVENT_NAME === 'pull_request'
  && getMissingSmokeTherapistSecrets(env).length > 0;

export const buildSmokeTherapistOwnershipMetadata = (
  email: string,
  env: NodeJS.ProcessEnv = process.env,
): SmokeTherapistOwnershipMetadata => ({
  smoke_actor: 'ci_therapist',
  smoke_email: email.toLowerCase(),
  smoke_run_id: env.GITHUB_RUN_ID?.trim() || 'local',
  smoke_run_attempt: env.GITHUB_RUN_ATTEMPT?.trim() || '1',
  smoke_job: env.GITHUB_JOB?.trim() || 'local',
});

export const buildSmokeTherapistFixtureMetadata = (
  email: string,
  env: NodeJS.ProcessEnv = process.env,
  now: Date = new Date(),
): SmokeTherapistFixtureMetadata => ({
  ...buildSmokeTherapistOwnershipMetadata(email, env),
  ci_rls_fixture: 'true',
  ci_rls_expires_at: new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString(),
});

export const buildSmokeTherapistProfileSeed = (userId: string, email: string) => ({
  id: userId,
  email,
  first_name: 'Playwright',
  last_name: 'Therapist',
});

export const assertSmokeTherapistOwnership = (
  user: { email?: string | null; app_metadata?: Record<string, unknown> | null },
  expectedEmail: string,
  env: NodeJS.ProcessEnv = process.env,
): void => {
  const expected = buildSmokeTherapistOwnershipMetadata(expectedEmail, env);
  const metadata = user.app_metadata;
  if (
    user.email?.toLowerCase() !== expectedEmail.toLowerCase()
    || metadata?.smoke_actor !== expected.smoke_actor
    || metadata.smoke_email !== expected.smoke_email
    || metadata.smoke_run_id !== expected.smoke_run_id
    || metadata.smoke_run_attempt !== expected.smoke_run_attempt
    || metadata.smoke_job !== expected.smoke_job
  ) {
    throw new Error('Refusing to delete a therapist user without exact CI smoke ownership metadata.');
  }
};

export const assertSmokeTherapistProfileInvariant = (
  profile: SmokeTherapistProfileInvariant | null,
  expected: { userId: string; organizationId: string },
): void => {
  if (
    !profile
    || profile.id !== expected.userId
    || profile.role !== 'therapist'
    || profile.is_active !== true
    || profile.organization_id !== expected.organizationId
  ) {
    throw new Error('Synthetic smoke therapist profile tenant binding did not persist.');
  }
};

const createAdminClient = (): SupabaseClient => createClient(
  getEnv('SUPABASE_URL'),
  getEnv('SUPABASE_SERVICE_ROLE_KEY'),
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const createAuthenticatedProbeClient = (): SupabaseClient => createClient(
  getEnv('SUPABASE_URL'),
  getEnv('SUPABASE_PUBLISHABLE_KEY'),
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const findUserByEmail = async (client: SupabaseClient, email: string) => {
  const normalized = email.toLowerCase();
  const perPage = 200;
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const user = data.users.find((candidate) => candidate.email?.toLowerCase() === normalized);
    if (user) return user;
    if (data.users.length < perPage) break;
  }
  return null;
};

export const verifySmokeTherapistAuthenticatedReadiness = async (
  client: SupabaseClient,
  expected: {
    email: string;
    password: string;
    userId: string;
    organizationId: string;
    therapistId: string;
  },
): Promise<void> => {
  const { data: authData, error: authError } = await client.auth.signInWithPassword({
    email: expected.email,
    password: expected.password,
  });
  if (authError || authData.user?.id !== expected.userId) {
    throw new Error(`Synthetic smoke therapist login failed: ${serializeError(authError)}`);
  }

  try {
    const { data: profile, error: profileError } = await client
      .from('profiles')
      .select('id,role,is_active,organization_id')
      .eq('id', expected.userId)
      .maybeSingle();
    if (profileError) throw profileError;
    assertSmokeTherapistProfileInvariant(profile, expected);

    const { data: therapist, error: therapistError } = await client
      .from('therapists')
      .select('id,status,organization_id,deleted_at')
      .eq('id', expected.therapistId)
      .maybeSingle();
    if (
      therapistError
      || therapist?.id !== expected.therapistId
      || therapist.status !== 'active'
      || therapist.organization_id !== expected.organizationId
      || therapist.deleted_at
    ) {
      throw new Error('Synthetic smoke therapist authenticated record access is not ready.');
    }

    const { data: link, error: linkError } = await client
      .from('user_therapist_links')
      .select('therapist_id')
      .eq('user_id', expected.userId)
      .maybeSingle();
    if (linkError || link?.therapist_id !== expected.therapistId) {
      throw new Error('Synthetic smoke therapist authenticated link did not persist.');
    }
  } finally {
    const { error: signOutError } = await client.auth.signOut();
    if (signOutError) throw new Error(`Synthetic smoke therapist logout failed: ${serializeError(signOutError)}`);
  }
};

const verifyProvisionedRows = async (
  client: SupabaseClient,
  userId: string,
  email: string,
  organizationId: string,
): Promise<void> => {
  const [profileResult, therapistResult, roleResult, linkResult] = await Promise.all([
    client.from('profiles').select('id,email,role,is_active,organization_id').eq('id', userId).maybeSingle(),
    client.from('therapists').select('id,email,status,organization_id,deleted_at').eq('id', userId).maybeSingle(),
    client.from('user_roles').select('is_active,roles(name)').eq('user_id', userId).eq('is_active', true),
    client.from('user_therapist_links').select('therapist_id').eq('user_id', userId).maybeSingle(),
  ]);
  if (profileResult.error || therapistResult.error || roleResult.error || linkResult.error) {
    throw new Error('Synthetic smoke therapist row verification failed.');
  }
  assertSmokeTherapistProfileInvariant(profileResult.data, { userId, organizationId });
  if (
    therapistResult.data?.id !== userId
    || therapistResult.data.email?.toLowerCase() !== email
    || therapistResult.data.status !== 'active'
    || therapistResult.data.organization_id !== organizationId
    || therapistResult.data.deleted_at
  ) {
    throw new Error('Synthetic smoke therapist record did not persist.');
  }
  const roleNames = (roleResult.data ?? []).flatMap((row) => {
    const nested = row.roles as unknown as { name?: unknown } | Array<{ name?: unknown }> | null;
    return (Array.isArray(nested) ? nested : nested ? [nested] : []).map(({ name }) => String(name ?? ''));
  });
  if (roleNames.length !== 1 || roleNames[0] !== 'therapist') {
    throw new Error('Synthetic smoke therapist authoritative role mapping did not persist.');
  }
  if (linkResult.data?.therapist_id !== userId) {
    throw new Error('Synthetic smoke therapist self-link did not persist.');
  }
};

const cleanupRows = async (client: SupabaseClient, userId: string): Promise<void> => {
  for (const [table, column] of [
    ['user_therapist_links', 'user_id'],
    ['user_roles', 'user_id'],
    ['therapists', 'id'],
    ['profiles', 'id'],
  ] as const) {
    const { error } = await client.from(table).delete().eq(column, userId);
    if (error) throw new Error(`${table} cleanup failed: ${serializeError(error)}`);
    const { count, error: countError } = await client
      .from(table)
      .select('*', { count: 'exact', head: true })
      .eq(column, userId);
    if (countError || count !== 0) {
      throw new Error(`${table} cleanup verification found ${count ?? 'unknown'} residual rows.`);
    }
  }
};

const cleanupOwnedUser = async (
  client: SupabaseClient,
  user: { id: string; email?: string | null; app_metadata?: Record<string, unknown> | null },
  email: string,
): Promise<void> => {
  assertSmokeTherapistOwnership(user, email);
  await cleanupRows(client, user.id);
  const { error: deleteError } = await client.auth.admin.deleteUser(user.id);
  if (deleteError) throw deleteError;
  const { data, error } = await client.auth.admin.getUserById(user.id);
  if (data.user || !error || error.status !== 404) {
    throw new Error(`Synthetic smoke therapist Auth cleanup verification failed: ${serializeError(error)}`);
  }
};

const writeGitHubEnv = (email: string, password: string, userId: string): void => {
  process.stdout.write(`::add-mask::${password}\n`);
  const githubEnv = process.env.GITHUB_ENV?.trim();
  if (!githubEnv) return;
  appendFileSync(githubEnv, `PW_THERAPIST_EMAIL=${email}\n`, { encoding: 'utf8' });
  appendFileSync(githubEnv, `PW_THERAPIST_PASSWORD=${password}\n`, { encoding: 'utf8' });
  appendFileSync(githubEnv, `PW_THERAPIST_USER_ID=${userId}\n`, { encoding: 'utf8' });
};

const provision = async (): Promise<void> => {
  const email = buildDefaultSmokeTherapistEmail();
  assertDedicatedSmokeTherapistEmail(email);
  const client = createAdminClient();
  const existing = await findUserByEmail(client, email);
  if (existing) await cleanupOwnedUser(client, existing, email);

  const organizationId = await resolveSmokeAdminOrganizationId(
    client,
    getEnv('CI_SMOKE_THERAPIST_SCOPE_EMAIL'),
  );
  const password = `C1-${randomBytes(18).toString('base64url')}!Aa`;
  const ownership = buildSmokeTherapistFixtureMetadata(email);
  const metadata = {
    role: 'therapist',
    signup_role: 'therapist',
    organization_id: organizationId,
    organizationId,
  };
  const { data, error } = await client.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: metadata,
    app_metadata: ownership,
  });
  if (error || !data.user) {
    throw error ?? new Error('Supabase did not return the created therapist smoke user.');
  }
  const user = data.user;

  try {
    const { data: role, error: roleError } = await client
      .from('roles')
      .select('id')
      .eq('name', 'therapist')
      .maybeSingle();
    if (roleError || !role?.id) throw new Error('Role therapist is not provisioned.');

    const { error: profileError } = await client.from('profiles').upsert(
      buildSmokeTherapistProfileSeed(user.id, email),
      { onConflict: 'id' },
    );
    if (profileError) throw profileError;

    const { error: therapistError } = await client.from('therapists').insert({
      id: user.id,
      organization_id: organizationId,
      email,
      full_name: 'Playwright CI Therapist',
      first_name: 'Playwright',
      last_name: 'Therapist',
      title: 'Therapist',
      status: 'active',
      specialties: ['ci-smoke'],
      service_type: ['aba'],
    });
    if (therapistError) throw therapistError;

    const { error: roleMapError } = await client.from('user_roles').upsert({
      user_id: user.id,
      role_id: role.id,
      is_active: true,
    }, { onConflict: 'user_id,role_id' });
    if (roleMapError) throw roleMapError;

    const { error: linkError } = await client.from('user_therapist_links').insert({
      user_id: user.id,
      therapist_id: user.id,
    });
    if (linkError) throw linkError;

    const { data: provisionedOrganizationId, error: profileProvisionError } = await client
      .rpc('provision_ci_rls_fixture_profile', {
        p_user_id: user.id,
        p_organization_id: organizationId,
      });
    if (profileProvisionError || provisionedOrganizationId !== organizationId) {
      throw new Error(
        `Synthetic smoke therapist profile authority provisioning failed: ${serializeError(profileProvisionError)}`,
      );
    }

    await verifyProvisionedRows(client, user.id, email, organizationId);
    await verifySmokeTherapistAuthenticatedReadiness(createAuthenticatedProbeClient(), {
      email,
      password,
      userId: user.id,
      organizationId,
      therapistId: user.id,
    });
    writeGitHubEnv(email, password, user.id);
    console.log(JSON.stringify({
      ok: true,
      action: 'provisioned',
      email,
      userId: user.id,
      organizationId,
      therapistId: user.id,
    }));
  } catch (provisionError) {
    await cleanupOwnedUser(client, user, email);
    throw provisionError;
  }
};

const cleanup = async (): Promise<void> => {
  const email = buildDefaultSmokeTherapistEmail();
  assertDedicatedSmokeTherapistEmail(email);
  const client = createAdminClient();
  const user = await findUserByEmail(client, email);
  if (!user) {
    console.log(JSON.stringify({ ok: true, action: 'cleanup_skipped', email, reason: 'not_found' }));
    return;
  }
  await cleanupOwnedUser(client, user, email);
  console.log(JSON.stringify({ ok: true, action: 'deleted', email, userId: user.id }));
};

const main = async (): Promise<void> => {
  const missing = getMissingSmokeTherapistSecrets();
  if (missing.length > 0) {
    if (shouldSkipSecretlessPullRequest()) {
      console.log(JSON.stringify({
        ok: true,
        action: 'skipped',
        reason: 'missing_pull_request_secrets',
        missing,
      }));
      return;
    }
    throw new Error(`Missing required therapist smoke inputs: ${missing.join(', ')}.`);
  }
  await (process.argv.includes('--cleanup') ? cleanup() : provision());
};

const isDirectRun = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href
  && process.env.VITEST !== 'true';

if (isDirectRun) {
  main().catch((error) => {
    console.error(JSON.stringify({ ok: false, error: serializeError(error) }));
    process.exit(1);
  });
}
