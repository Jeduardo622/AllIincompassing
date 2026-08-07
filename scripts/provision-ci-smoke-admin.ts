import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { appendFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';

type RoleName = 'super_admin';

type SmokeAdminCleanupStep = {
  table:
    | 'bt_session_note_amendments'
    | 'goal_target_phase_evaluations'
    | 'goal_target_transitions'
    | 'client_session_notes'
    | 'session_goals'
    | 'sessions'
    | 'user_roles'
    | 'profiles';
  filter:
    | { kind: 'eq'; column: string; value: string }
    | { kind: 'in'; column: string; values: string[] };
};

type SmokeAdminCleanupTargets = {
  sessionIds: string[];
  noteIds: string[];
};

type SmokeAdminOwnershipMetadata = {
  smoke_actor: 'ci_super_admin';
  smoke_email: string;
  smoke_run_id: string;
  smoke_run_attempt: string;
  smoke_job: string;
};

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

export const buildSmokeAdminOwnershipMetadata = (
  email: string,
  env: NodeJS.ProcessEnv = process.env,
): SmokeAdminOwnershipMetadata => ({
  smoke_actor: 'ci_super_admin',
  smoke_email: email.toLowerCase(),
  smoke_run_id: env.GITHUB_RUN_ID?.trim() || 'local',
  smoke_run_attempt: env.GITHUB_RUN_ATTEMPT?.trim() || '1',
  smoke_job: env.GITHUB_JOB?.trim() || 'local',
});

export const assertSmokeAdminOwnership = (
  user: { email?: string | null; app_metadata?: Record<string, unknown> | null },
  expectedEmail: string,
): void => {
  if (user.email?.toLowerCase() !== expectedEmail.toLowerCase()) {
    throw new Error('Refusing to delete an auth user whose email does not match the cleanup target.');
  }

  const metadata = user.app_metadata;
  if (
    metadata?.smoke_actor !== 'ci_super_admin'
    || metadata.smoke_email !== expectedEmail.toLowerCase()
  ) {
    throw new Error('Refusing to delete an auth user without matching CI smoke ownership metadata.');
  }
};

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

export const writeGitHubEnv = (email: string, password: string, userId: string): void => {
  process.stdout.write(`::add-mask::${password}\n`);

  const githubEnv = process.env.GITHUB_ENV?.trim();
  if (!githubEnv) {
    return;
  }

  appendFileSync(githubEnv, `PW_SUPERADMIN_EMAIL=${email}\n`, { encoding: 'utf8' });
  appendFileSync(githubEnv, `PW_SUPERADMIN_PASSWORD=${password}\n`, { encoding: 'utf8' });
  appendFileSync(githubEnv, `PW_SUPERADMIN_USER_ID=${userId}\n`, { encoding: 'utf8' });
};

export const resolveCleanupSmokeAdminEmail = (): string => (
  process.env.CI_SMOKE_ADMIN_EMAIL?.trim()
  || process.env.PW_SUPERADMIN_EMAIL?.trim()
  || buildDefaultSmokeAdminEmail()
).toLowerCase();

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const extractCleanupTargetIds = (
  rows: Array<{ id?: unknown }> | null,
  table: string,
): string[] => Array.from(new Set((rows ?? []).map((row) => {
  if (typeof row.id !== 'string' || !UUID_PATTERN.test(row.id)) {
    throw new Error(`${table} cleanup target discovery returned an invalid id.`);
  }
  return row.id;
})));

export const discoverSmokeAdminCleanupTargets = async (
  client: SupabaseClient,
  userId: string,
): Promise<SmokeAdminCleanupTargets> => {
  const [sessions, notes] = await Promise.all([
    client.from('sessions').select('id').eq('created_by', userId),
    client.from('client_session_notes').select('id').eq('created_by', userId),
  ]);

  if (sessions.error) {
    throw new Error(`sessions cleanup target discovery failed: ${serializeError(sessions.error)}`);
  }
  if (notes.error) {
    throw new Error(`client_session_notes cleanup target discovery failed: ${serializeError(notes.error)}`);
  }

  return {
    sessionIds: extractCleanupTargetIds(sessions.data, 'sessions'),
    noteIds: extractCleanupTargetIds(notes.data, 'client_session_notes'),
  };
};

export const buildSmokeAdminCleanupSteps = (
  userId: string,
  targets: SmokeAdminCleanupTargets,
): SmokeAdminCleanupStep[] => {
  const steps: SmokeAdminCleanupStep[] = [];
  const addInStep = (table: SmokeAdminCleanupStep['table'], column: string, values: string[]): void => {
    if (values.length > 0) {
      steps.push({ table, filter: { kind: 'in', column, values } });
    }
  };

  addInStep('bt_session_note_amendments', 'original_bt_note_id', targets.noteIds);
  addInStep('goal_target_phase_evaluations', 'note_id', targets.noteIds);
  addInStep('goal_target_transitions', 'note_id', targets.noteIds);
  addInStep('goal_target_phase_evaluations', 'session_id', targets.sessionIds);
  addInStep('goal_target_transitions', 'session_id', targets.sessionIds);
  addInStep('client_session_notes', 'id', targets.noteIds);
  addInStep('session_goals', 'session_id', targets.sessionIds);
  addInStep('sessions', 'id', targets.sessionIds);
  steps.push(
    { table: 'user_roles', filter: { kind: 'eq', column: 'user_id', value: userId } },
    { table: 'profiles', filter: { kind: 'eq', column: 'id', value: userId } },
  );
  return steps;
};

export const cleanupSmokeAdminRows = async (
  client: SupabaseClient,
  userId: string,
  targets: SmokeAdminCleanupTargets,
): Promise<void> => {
  for (const step of buildSmokeAdminCleanupSteps(userId, targets)) {
    if (step.table === 'bt_session_note_amendments') {
      const immutableQuery = client.from(step.table).select('id', { count: 'exact', head: true });
      const immutableVerification = step.filter.kind === 'eq'
        ? await immutableQuery.eq(step.filter.column, step.filter.value)
        : await immutableQuery.in(step.filter.column, step.filter.values);
      if (immutableVerification.error) {
        throw new Error(`${step.table} cleanup verification failed: ${serializeError(immutableVerification.error)}`);
      }
      if (immutableVerification.count !== 0) {
        throw new Error(`${step.table} cleanup blocked by ${immutableVerification.count ?? 'unknown'} immutable rows.`);
      }
      continue;
    }

    const deleteQuery = client.from(step.table).delete();
    const { error } = step.filter.kind === 'eq'
      ? await deleteQuery.eq(step.filter.column, step.filter.value)
      : await deleteQuery.in(step.filter.column, step.filter.values);

    if (error) {
      throw new Error(`${step.table} cleanup failed: ${serializeError(error)}`);
    }

    const verifyQuery = client.from(step.table).select('id', { count: 'exact', head: true });
    const verification = step.filter.kind === 'eq'
      ? await verifyQuery.eq(step.filter.column, step.filter.value)
      : await verifyQuery.in(step.filter.column, step.filter.values);

    if (verification.error) {
      throw new Error(`${step.table} cleanup verification failed: ${serializeError(verification.error)}`);
    }
    if (verification.count !== 0) {
      throw new Error(`${step.table} cleanup verification found ${verification.count ?? 'unknown'} residual rows.`);
    }
  }
};

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
  const ownershipMetadata = buildSmokeAdminOwnershipMetadata(email);
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
      app_metadata: {
        ...(existing.app_metadata ?? {}),
        ...ownershipMetadata,
      },
    });
    if (error) {
      throw error;
    }
    await ensureRoleMapping(client, existing.id, email, 'super_admin');
    writeGitHubEnv(email, password, existing.id);
    console.log(JSON.stringify({ ok: true, action: 'updated', email, userId: existing.id }));
    return;
  }

  const { data, error } = await client.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: metadata,
    app_metadata: ownershipMetadata,
  });

  if (error) {
    throw error;
  }
  if (!data.user) {
    throw new Error('Supabase did not return a created smoke user.');
  }

  await ensureRoleMapping(client, data.user.id, email, 'super_admin');
  writeGitHubEnv(email, password, data.user.id);
  console.log(JSON.stringify({ ok: true, action: 'created', email, userId: data.user.id }));
};

const cleanup = async (): Promise<void> => {
  const email = resolveCleanupSmokeAdminEmail();
  if (!email) {
    console.log(JSON.stringify({ ok: true, action: 'cleanup_skipped', reason: 'missing_email' }));
    return;
  }
  assertDedicatedSmokeEmail(email);

  const userId = getEnv('PW_SUPERADMIN_USER_ID');
  if (!UUID_PATTERN.test(userId)) {
    throw new Error('PW_SUPERADMIN_USER_ID must be the exact provisioned smoke user UUID.');
  }

  const client = createAdminClient();
  const { data: userData, error: userLookupError } = await client.auth.admin.getUserById(userId);
  if (userLookupError) {
    throw userLookupError;
  }
  const user = userData.user;
  assertSmokeAdminOwnership(user, email);

  const cleanupTargets = await discoverSmokeAdminCleanupTargets(client, userId);
  await cleanupSmokeAdminRows(client, userId, cleanupTargets);

  const { error } = await client.auth.admin.deleteUser(userId);
  if (error) {
    throw error;
  }

  const { data: deletedUserData, error: deletedUserLookupError } = await client.auth.admin.getUserById(userId);
  if (deletedUserData.user || !deletedUserLookupError || deletedUserLookupError.status !== 404) {
    throw new Error(`Auth user cleanup verification failed: ${serializeError(deletedUserLookupError)}`);
  }
  console.log(JSON.stringify({ ok: true, action: 'deleted', email, userId }));
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
