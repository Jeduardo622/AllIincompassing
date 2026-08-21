import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  createClient,
  type SupabaseClient,
  type User,
} from '@supabase/supabase-js';

import {
  QA_PERSONA_MANIFEST_ENV,
  TARGET_ORGANIZATION_ID,
  WIN_43_ISSUE,
  assertStrongQaPersonaPassword,
  buildPersonaAppMetadata,
  buildPersonaAuthMetadata,
  buildPersonaEmail,
  isDeniedPersonaName,
  isOwnedQaPersonaAppMetadata,
  serializeError,
  type QaPersonaRole,
} from './provision-persistent-qa-personas';

type RotationCredentialSet = 'bootstrap' | 'rotation';
type RotationCredentialField = 'EMAIL' | 'PASSWORD';

type RotationCredentialEnv = {
  secretBase: string;
  aliasSecretBase?: string;
};

type RotationPersonaDefinition = {
  role: QaPersonaRole;
  authUserId: string;
  displayName: string;
  firstName: string;
  lastName: string;
  credentialEnv: RotationCredentialEnv;
};

type RotationPersonaCredentials = {
  email: string;
  password: string;
};

type RotationPersonaContext = {
  definition: RotationPersonaDefinition;
  bootstrapCredentials: RotationPersonaCredentials;
  rotationCredentials: RotationPersonaCredentials;
  user: User;
};

type RotationPersonaStatus =
  | 'preflighted'
  | 'rotated_authenticated'
  | 'rollback_authenticated';

type ManifestPersonaResult = {
  role: QaPersonaRole;
  email: string;
  authUserId: string;
  status: RotationPersonaStatus;
};

type ManifestRecord = {
  ok: boolean;
  mode: 'rotate';
  generatedAt: string;
  issue: typeof WIN_43_ISSUE;
  organizationId: string;
  rollbackApplied: boolean;
  personas: ManifestPersonaResult[];
};

export const ROTATION_PERSONAS = [
  {
    role: 'bt',
    authUserId: '48e62486-b142-4e6a-8e1e-165d6a8f6821',
    displayName: 'Playwright QA BT',
    firstName: 'Playwright',
    lastName: 'BT',
    credentialEnv: { secretBase: 'BT' },
  },
  {
    role: 'therapist',
    authUserId: 'ab03f560-8a71-4929-91ad-74be523d3c93',
    displayName: 'Playwright QA Therapist',
    firstName: 'Playwright',
    lastName: 'Therapist',
    credentialEnv: { secretBase: 'THERAPIST' },
  },
  {
    role: 'bcba',
    authUserId: 'f4488d24-bb11-482f-9367-bbb7e726e026',
    displayName: 'Playwright QA BCBA',
    firstName: 'Playwright',
    lastName: 'BCBA',
    credentialEnv: { secretBase: 'BCBA' },
  },
  {
    role: 'midtier',
    authUserId: 'bfaaad8d-cf0c-4843-81c4-680b564d3737',
    displayName: 'Playwright QA Midtier',
    firstName: 'Playwright',
    lastName: 'Midtier',
    credentialEnv: { secretBase: 'MIDTIER' },
  },
  {
    role: 'admin_schedule',
    authUserId: 'ad44fe11-7297-467b-9fed-0a8c6f56ce98',
    displayName: 'Playwright QA Admin Schedule',
    firstName: 'Playwright',
    lastName: 'Schedule',
    credentialEnv: {
      secretBase: 'ADMIN_SCHEDULE',
      aliasSecretBase: 'SCHEDULE',
    },
  },
  {
    role: 'client',
    authUserId: '87130857-af13-4fe1-8195-c75710d5325f',
    displayName: 'Playwright QA Client',
    firstName: 'Playwright',
    lastName: 'Client',
    credentialEnv: { secretBase: 'CLIENT' },
  },
  {
    role: 'admin',
    authUserId: 'a67fa20b-b3f9-4625-98c4-ba106cc7a434',
    displayName: 'Playwright QA Admin',
    firstName: 'Playwright',
    lastName: 'Admin',
    credentialEnv: { secretBase: 'ADMIN' },
  },
  {
    role: 'super_admin',
    authUserId: '5ba467e1-ef50-4247-bbb2-099ab70c26bb',
    displayName: 'Playwright QA Super Admin',
    firstName: 'Playwright',
    lastName: 'SuperAdmin',
    credentialEnv: { secretBase: 'SUPERADMIN' },
  },
] as const satisfies readonly RotationPersonaDefinition[];

export const REQUIRED_ROTATION_BASE_ENV_VARS = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_PUBLISHABLE_KEY',
  QA_PERSONA_MANIFEST_ENV,
] as const;

const getEnv = (name: string, env: NodeJS.ProcessEnv = process.env): string => {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
};

const buildCredentialEnvName = (
  set: RotationCredentialSet,
  secretBase: string,
  field: RotationCredentialField,
): string => `QA_${set === 'bootstrap' ? 'BOOTSTRAP' : 'ROTATION'}_${secretBase}_${field}`;

const buildCredentialEnvNames = (
  persona: RotationPersonaDefinition,
  set: RotationCredentialSet,
): {
  emailEnv: string;
  passwordEnv: string;
  aliasEmailEnv?: string;
  aliasPasswordEnv?: string;
} => ({
  emailEnv: buildCredentialEnvName(set, persona.credentialEnv.secretBase, 'EMAIL'),
  passwordEnv: buildCredentialEnvName(set, persona.credentialEnv.secretBase, 'PASSWORD'),
  ...(persona.credentialEnv.aliasSecretBase
    ? {
      aliasEmailEnv: buildCredentialEnvName(set, persona.credentialEnv.aliasSecretBase, 'EMAIL'),
      aliasPasswordEnv: buildCredentialEnvName(set, persona.credentialEnv.aliasSecretBase, 'PASSWORD'),
    }
    : {}),
});

const createAdminClient = (): SupabaseClient => createClient(
  getEnv('SUPABASE_URL'),
  getEnv('SUPABASE_SERVICE_ROLE_KEY'),
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  },
);

const createPublishableClient = (): SupabaseClient => createClient(
  getEnv('SUPABASE_URL'),
  getEnv('SUPABASE_PUBLISHABLE_KEY'),
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  },
);

const findUserByEmail = async (client: SupabaseClient, email: string): Promise<User | null> => {
  const normalized = email.toLowerCase();
  const perPage = 200;

  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage });
    if (error) {
      throw error;
    }

    const found = data.users.find((candidate) => candidate.email?.toLowerCase() === normalized);
    if (found) {
      return found;
    }

    if (data.users.length < perPage) {
      break;
    }
  }

  return null;
};

const assertSafePersonaDefinition = (persona: RotationPersonaDefinition): void => {
  if (isDeniedPersonaName(persona.displayName)) {
    throw new Error(`Denied QA persona display name: ${persona.displayName}`);
  }
  const combinedName = `${persona.firstName} ${persona.lastName}`;
  if (isDeniedPersonaName(combinedName)) {
    throw new Error(`Denied QA persona personal name: ${combinedName}`);
  }
};

const assertNoDeniedAuthMetadataNames = (user: User, persona: RotationPersonaDefinition): void => {
  const metadata = user.user_metadata ?? {};
  const names = [
    String(metadata.full_name ?? ''),
    String(metadata.name ?? ''),
    `${String(metadata.first_name ?? '')} ${String(metadata.last_name ?? '')}`.trim(),
    persona.displayName,
    `${persona.firstName} ${persona.lastName}`.trim(),
  ].filter(Boolean);

  for (const name of names) {
    if (isDeniedPersonaName(name)) {
      throw new Error(`Denied QA persona name detected for ${persona.role}.`);
    }
  }
};

const assertExactUserMetadata = (user: User, persona: RotationPersonaDefinition): void => {
  const expectedMetadata = buildPersonaAuthMetadata({
    role: persona.role,
    displayName: persona.displayName,
    firstName: persona.firstName,
    lastName: persona.lastName,
    title: null,
    credentialEnv: {
      emailEnv: buildCredentialEnvName('rotation', persona.credentialEnv.secretBase, 'EMAIL'),
      passwordEnv: buildCredentialEnvName('rotation', persona.credentialEnv.secretBase, 'PASSWORD'),
    },
  });
  const actual = user.user_metadata ?? {};

  for (const [key, expected] of Object.entries(expectedMetadata)) {
    if (actual[key] !== expected) {
      throw new Error(`Exact Auth metadata mismatch for ${persona.role}: ${key}.`);
    }
  }
};

export const getMissingRotationEnvVars = (
  env: NodeJS.ProcessEnv = process.env,
): string[] => {
  const missing: string[] = [];

  for (const name of REQUIRED_ROTATION_BASE_ENV_VARS) {
    if (!env[name]?.trim()) {
      missing.push(name);
    }
  }

  for (const set of ['bootstrap', 'rotation'] as const) {
    for (const persona of ROTATION_PERSONAS) {
      const envNames = buildCredentialEnvNames(persona, set);
      if (!env[envNames.emailEnv]?.trim()) {
        missing.push(envNames.emailEnv);
      }
      if (!env[envNames.passwordEnv]?.trim()) {
        missing.push(envNames.passwordEnv);
      }
      if (envNames.aliasEmailEnv && !env[envNames.aliasEmailEnv]?.trim()) {
        missing.push(envNames.aliasEmailEnv);
      }
      if (envNames.aliasPasswordEnv && !env[envNames.aliasPasswordEnv]?.trim()) {
        missing.push(envNames.aliasPasswordEnv);
      }
    }
  }

  return missing;
};

export const resolveRotationPersonaCredentials = (
  persona: RotationPersonaDefinition,
  set: RotationCredentialSet,
  env: NodeJS.ProcessEnv = process.env,
): RotationPersonaCredentials => {
  const expectedEmail = buildPersonaEmail(persona.role);
  const envNames = buildCredentialEnvNames(persona, set);
  const canonicalEmail = getEnv(envNames.emailEnv, env).toLowerCase();
  if (canonicalEmail !== expectedEmail) {
    throw new Error(
      `${envNames.emailEnv} must equal ${expectedEmail}. Refusing drifted QA persona email.`,
    );
  }

  if (envNames.aliasEmailEnv) {
    const aliasEmail = getEnv(envNames.aliasEmailEnv, env).toLowerCase();
    if (aliasEmail !== canonicalEmail) {
      throw new Error(
        `${envNames.aliasEmailEnv} must exactly match ${envNames.emailEnv}.`,
      );
    }
  }

  const password = getEnv(envNames.passwordEnv, env);
  assertStrongQaPersonaPassword(password);

  if (envNames.aliasPasswordEnv) {
    const aliasPassword = getEnv(envNames.aliasPasswordEnv, env);
    assertStrongQaPersonaPassword(aliasPassword);
    if (aliasPassword !== password) {
      throw new Error(
        `${envNames.aliasPasswordEnv} must exactly match ${envNames.passwordEnv}.`,
      );
    }
  }

  return {
    email: canonicalEmail,
    password,
  };
};

const assertDistinctCredentialSets = (
  persona: RotationPersonaDefinition,
  bootstrapCredentials: RotationPersonaCredentials,
  rotationCredentials: RotationPersonaCredentials,
): void => {
  if (bootstrapCredentials.email !== rotationCredentials.email) {
    throw new Error(`Credential email drift detected between staged sets for ${persona.role}.`);
  }
  if (bootstrapCredentials.password === rotationCredentials.password) {
    throw new Error(`QA rotation password must differ from bootstrap password for ${persona.role}.`);
  }
};

const assertRotationPersonaOwnership = (
  user: User,
  persona: RotationPersonaDefinition,
  bootstrapCredentials: RotationPersonaCredentials,
): void => {
  if (user.id !== persona.authUserId) {
    throw new Error(`Exact auth user id mismatch for ${persona.role}.`);
  }
  if (user.email?.toLowerCase() !== bootstrapCredentials.email) {
    throw new Error(`Exact auth email mismatch for ${persona.role}.`);
  }
  if (!isOwnedQaPersonaAppMetadata(user.app_metadata ?? null, persona.role)) {
    throw new Error(`Exact WIN-43 ownership markers are missing for ${persona.role}.`);
  }
  const expectedAppMetadata = buildPersonaAppMetadata(persona.role);
  for (const [key, expected] of Object.entries(expectedAppMetadata)) {
    if ((user.app_metadata ?? {})[key] !== expected) {
      throw new Error(`Exact Auth app metadata mismatch for ${persona.role}: ${key}.`);
    }
  }
  assertExactUserMetadata(user, persona);
  assertNoDeniedAuthMetadataNames(user, persona);
};

const verifyPasswordLogin = async (
  persona: RotationPersonaDefinition,
  credentials: RotationPersonaCredentials,
): Promise<void> => {
  const client = createPublishableClient();
  const { data, error } = await client.auth.signInWithPassword({
    email: credentials.email,
    password: credentials.password,
  });

  if (error || data.user?.id !== persona.authUserId) {
    throw new Error(`Publishable-key login failed for ${persona.role}: ${serializeError(error)}`);
  }

  const { error: signOutError } = await client.auth.signOut();
  if (signOutError) {
    throw new Error(`Sign out failed for ${persona.role}: ${serializeError(signOutError)}`);
  }
};

const writeManifest = (manifest: ManifestRecord): void => {
  const manifestPath = getEnv(QA_PERSONA_MANIFEST_ENV);
  mkdirSync(path.dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
};

const buildManifestPersonas = (
  statuses: Map<QaPersonaRole, RotationPersonaStatus>,
): ManifestPersonaResult[] => ROTATION_PERSONAS
  .filter((persona) => statuses.has(persona.role))
  .map((persona) => ({
    role: persona.role,
    email: buildPersonaEmail(persona.role),
    authUserId: persona.authUserId,
    status: statuses.get(persona.role)!,
  }));

const rotate = async (): Promise<void> => {
  const missingEnv = getMissingRotationEnvVars();
  if (missingEnv.length > 0) {
    throw new Error(`Missing required QA persona inputs: ${missingEnv.join(', ')}`);
  }

  for (const persona of ROTATION_PERSONAS) {
    assertSafePersonaDefinition(persona);
  }

  const adminClient = createAdminClient();
  const contexts: RotationPersonaContext[] = [];
  const mutatedContexts: RotationPersonaContext[] = [];
  const statuses = new Map<QaPersonaRole, RotationPersonaStatus>();
  let rollbackApplied = false;

  try {
    for (const persona of ROTATION_PERSONAS) {
      const bootstrapCredentials = resolveRotationPersonaCredentials(persona, 'bootstrap');
      const rotationCredentials = resolveRotationPersonaCredentials(persona, 'rotation');
      assertDistinctCredentialSets(persona, bootstrapCredentials, rotationCredentials);

      const user = await findUserByEmail(adminClient, bootstrapCredentials.email);
      if (!user) {
        throw new Error(`Missing persistent QA persona Auth user for ${persona.role}.`);
      }

      assertRotationPersonaOwnership(user, persona, bootstrapCredentials);
      contexts.push({
        definition: persona,
        bootstrapCredentials,
        rotationCredentials,
        user,
      });
      statuses.set(persona.role, 'preflighted');
    }

    for (const context of contexts) {
      const { data, error } = await adminClient.auth.admin.updateUserById(
        context.user.id,
        { password: context.rotationCredentials.password },
      );
      if (error || data.user?.id !== context.user.id) {
        throw error ?? new Error(`Auth password rotation failed for ${context.definition.role}.`);
      }
      mutatedContexts.push(context);
      await verifyPasswordLogin(context.definition, context.rotationCredentials);
      statuses.set(context.definition.role, 'rotated_authenticated');
    }

    writeManifest({
      ok: true,
      mode: 'rotate',
      generatedAt: new Date().toISOString(),
      issue: WIN_43_ISSUE,
      organizationId: TARGET_ORGANIZATION_ID,
      rollbackApplied,
      personas: buildManifestPersonas(statuses),
    });
  } catch (error) {
    if (mutatedContexts.length > 0) {
      rollbackApplied = true;
      const rollbackErrors: string[] = [];

      for (const context of [...mutatedContexts].reverse()) {
        const { data, error: rollbackError } = await adminClient.auth.admin.updateUserById(
          context.user.id,
          { password: context.bootstrapCredentials.password },
        );

        if (rollbackError || data.user?.id !== context.user.id) {
          rollbackErrors.push(`rollback update failed for ${context.definition.role}`);
          continue;
        }

        try {
          await verifyPasswordLogin(context.definition, context.bootstrapCredentials);
          statuses.set(context.definition.role, 'rollback_authenticated');
        } catch {
          rollbackErrors.push(`rollback login failed for ${context.definition.role}`);
        }
      }
    }

    writeManifest({
      ok: false,
      mode: 'rotate',
      generatedAt: new Date().toISOString(),
      issue: WIN_43_ISSUE,
      organizationId: TARGET_ORGANIZATION_ID,
      rollbackApplied,
      personas: buildManifestPersonas(statuses),
    });

    if (rollbackApplied) {
      const rollbackFailures = [...mutatedContexts]
        .filter((context) => statuses.get(context.definition.role) !== 'rollback_authenticated')
        .map((context) => context.definition.role);
      if (rollbackFailures.length > 0) {
        throw new Error(
          `QA persona credential rotation failed and rollback did not fully verify: ${rollbackFailures.join(', ')}.`,
        );
      }
    }

    throw error;
  }
};

export const parseMode = (argv: string[]): 'rotate' => {
  const wantsRotate = argv.includes('--rotate');
  if (!wantsRotate || argv.length !== 1) {
    throw new Error('Provide exactly one mode: --rotate.');
  }
  return 'rotate';
};

export const main = async (argv: string[] = process.argv.slice(2)): Promise<void> => {
  parseMode(argv);
  await rotate();
};

const isDirectRun = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href
  && process.env.VITEST !== 'true';

if (isDirectRun) {
  main().catch(() => {
    console.error(
      JSON.stringify({
        ok: false,
        error: 'QA persona credential rotation failed; inspect the sanitized manifest and protected run logs.',
      }),
    );
    process.exit(1);
  });
}
