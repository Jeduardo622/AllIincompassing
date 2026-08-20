import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  createClient,
  type SupabaseClient,
  type User,
} from '@supabase/supabase-js';

export const WIN_43_ISSUE = 'WIN-43';
export const TARGET_ORGANIZATION_ID = '5238e88b-6198-4862-80a2-dbe15bbeabdd';
export const QA_PERSONA_MANIFEST_ENV = 'QA_PERSONA_MANIFEST_PATH';
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const DENYLISTED_PERSONA_NAMES = ['Steve Job', 'MJ Menjivar'] as const;
export const THERAPIST_LINK_ROLES = ['bt', 'therapist', 'bcba', 'midtier', 'admin_schedule'] as const;
export const CLIENT_CASELOAD_ROLES = ['bt', 'therapist', 'bcba', 'midtier'] as const;

export type QaPersonaRole =
  | 'bt'
  | 'therapist'
  | 'bcba'
  | 'midtier'
  | 'admin_schedule'
  | 'client'
  | 'admin'
  | 'super_admin';

export type PersonaCredentialEnv = {
  emailEnv: string;
  passwordEnv: string;
};

export type QaPersonaDefinition = {
  role: QaPersonaRole;
  displayName: string;
  firstName: string;
  lastName: string;
  title: string | null;
  credentialEnv: PersonaCredentialEnv;
};

type QaPersonaCredentials = {
  email: string;
  password: string;
};

type QaPersonaAuthMetadata = {
  first_name: string;
  last_name: string;
  full_name: string;
  role: QaPersonaRole;
  signup_role: QaPersonaRole;
  organization_id: string;
  organizationId: string;
  name: string;
};

type QaPersonaAppMetadata = {
  synthetic_qa_persona: true;
  issue: typeof WIN_43_ISSUE;
  organization_id: string;
  role: QaPersonaRole;
  qa_persona: true;
  qa_persona_email: string;
  qa_persona_issue: typeof WIN_43_ISSUE;
  qa_persona_key: QaPersonaRole;
  qa_persona_org_id: string;
  qa_persona_role: QaPersonaRole;
};

type RoleRow = {
  id: string;
  name: QaPersonaRole;
};

type ManifestPersonaResult = {
  role: QaPersonaRole;
  email: string;
  authUserId: string | null;
  status: 'verified';
};

type ManifestRecord = {
  ok: boolean;
  mode: 'provision' | 'verify';
  generatedAt: string;
  issue: typeof WIN_43_ISSUE;
  organizationId: string;
  personas: ManifestPersonaResult[];
};

type PersonaRunContext = {
  definition: QaPersonaDefinition;
  credentials: QaPersonaCredentials;
  user: User;
  existedBeforeRun: boolean;
};

type VerificationSummary = {
  userId: string;
  profileOk: boolean;
  roleOk: boolean;
  therapistOk: boolean;
  clientOk: boolean;
  loginOk: boolean;
};

export const QA_PERSONAS = [
  {
    role: 'bt',
    displayName: 'Playwright QA BT',
    firstName: 'Playwright',
    lastName: 'BT',
    title: 'BT',
    credentialEnv: { emailEnv: 'PW_BT_EMAIL', passwordEnv: 'PW_BT_PASSWORD' },
  },
  {
    role: 'therapist',
    displayName: 'Playwright QA Therapist',
    firstName: 'Playwright',
    lastName: 'Therapist',
    title: 'Therapist',
    credentialEnv: { emailEnv: 'PW_THERAPIST_EMAIL', passwordEnv: 'PW_THERAPIST_PASSWORD' },
  },
  {
    role: 'bcba',
    displayName: 'Playwright QA BCBA',
    firstName: 'Playwright',
    lastName: 'BCBA',
    title: 'BCBA',
    credentialEnv: { emailEnv: 'PW_BCBA_EMAIL', passwordEnv: 'PW_BCBA_PASSWORD' },
  },
  {
    role: 'midtier',
    displayName: 'Playwright QA Midtier',
    firstName: 'Playwright',
    lastName: 'Midtier',
    title: 'Midtier',
    credentialEnv: { emailEnv: 'PW_MIDTIER_EMAIL', passwordEnv: 'PW_MIDTIER_PASSWORD' },
  },
  {
    role: 'admin_schedule',
    displayName: 'Playwright QA Admin Schedule',
    firstName: 'Playwright',
    lastName: 'Schedule',
    title: 'Schedule Admin',
    credentialEnv: { emailEnv: 'PW_ADMIN_SCHEDULE_EMAIL', passwordEnv: 'PW_ADMIN_SCHEDULE_PASSWORD' },
  },
  {
    role: 'client',
    displayName: 'Playwright QA Client',
    firstName: 'Playwright',
    lastName: 'Client',
    title: null,
    credentialEnv: { emailEnv: 'PW_CLIENT_EMAIL', passwordEnv: 'PW_CLIENT_PASSWORD' },
  },
  {
    role: 'admin',
    displayName: 'Playwright QA Admin',
    firstName: 'Playwright',
    lastName: 'Admin',
    title: null,
    credentialEnv: { emailEnv: 'PW_ADMIN_EMAIL', passwordEnv: 'PW_ADMIN_PASSWORD' },
  },
  {
    role: 'super_admin',
    displayName: 'Playwright QA Super Admin',
    firstName: 'Playwright',
    lastName: 'SuperAdmin',
    title: null,
    credentialEnv: { emailEnv: 'PW_SUPERADMIN_EMAIL', passwordEnv: 'PW_SUPERADMIN_PASSWORD' },
  },
] as const satisfies readonly QaPersonaDefinition[];

export const REQUIRED_BASE_ENV_VARS = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_PUBLISHABLE_KEY',
  QA_PERSONA_MANIFEST_ENV,
] as const;

export const THERAPIST_ROLE_SET = new Set<QaPersonaRole>(THERAPIST_LINK_ROLES);
export const CLIENT_CASELOAD_ROLE_SET = new Set<QaPersonaRole>(CLIENT_CASELOAD_ROLES);

const qaPersonaByRole = new Map<QaPersonaRole, QaPersonaDefinition>(
  QA_PERSONAS.map((persona) => [persona.role, persona]),
);

const getEnv = (name: string, env: NodeJS.ProcessEnv = process.env): string => {
  const value = env[name]?.trim();
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

export const buildPersonaEmail = (role: QaPersonaRole): string => `playwright.qa.${role}@example.com`;

export const isDeniedPersonaName = (name: string): boolean => {
  const normalized = name.trim().replace(/\s+/g, ' ').toLowerCase();
  return DENYLISTED_PERSONA_NAMES.some(
    (entry) => entry.trim().replace(/\s+/g, ' ').toLowerCase() === normalized,
  );
};

export const buildPersonaAuthMetadata = (persona: QaPersonaDefinition): QaPersonaAuthMetadata => ({
  first_name: persona.firstName,
  last_name: persona.lastName,
  full_name: persona.displayName,
  role: persona.role,
  signup_role: persona.role,
  organization_id: TARGET_ORGANIZATION_ID,
  organizationId: TARGET_ORGANIZATION_ID,
  name: persona.displayName,
});

export const buildPersonaAppMetadata = (role: QaPersonaRole): QaPersonaAppMetadata => ({
  synthetic_qa_persona: true,
  issue: WIN_43_ISSUE,
  organization_id: TARGET_ORGANIZATION_ID,
  role,
  qa_persona: true,
  qa_persona_email: buildPersonaEmail(role),
  qa_persona_issue: WIN_43_ISSUE,
  qa_persona_key: role,
  qa_persona_org_id: TARGET_ORGANIZATION_ID,
  qa_persona_role: role,
});

export const isOwnedQaPersonaAppMetadata = (
  metadata: Record<string, unknown> | null | undefined,
  role: QaPersonaRole,
): metadata is QaPersonaAppMetadata => (
  metadata?.synthetic_qa_persona === true
  && metadata.issue === WIN_43_ISSUE
  && metadata.organization_id === TARGET_ORGANIZATION_ID
  && metadata.role === role
  && metadata.qa_persona === true
  && metadata.qa_persona_email === buildPersonaEmail(role)
  && metadata.qa_persona_issue === WIN_43_ISSUE
  && metadata.qa_persona_key === role
  && metadata.qa_persona_org_id === TARGET_ORGANIZATION_ID
  && metadata.qa_persona_role === role
);

export const assertStrongQaPersonaPassword = (password: string): void => {
  if (
    password.length < 24
    || !/[a-z]/.test(password)
    || !/[A-Z]/.test(password)
    || !/[0-9]/.test(password)
    || !/[^A-Za-z0-9]/.test(password)
  ) {
    throw new Error('QA persona password must be at least 24 characters with upper, lower, number, and symbol.');
  }
};

export const getPersonaDefinition = (role: QaPersonaRole): QaPersonaDefinition => {
  const persona = qaPersonaByRole.get(role);
  if (!persona) {
    throw new Error(`Unsupported QA persona role: ${role}`);
  }
  return persona;
};

export const getMissingQaPersonaEnvVars = (env: NodeJS.ProcessEnv = process.env): string[] => {
  const missing: string[] = [];
  for (const name of REQUIRED_BASE_ENV_VARS) {
    if (!env[name]?.trim()) {
      missing.push(name);
    }
  }

  for (const persona of QA_PERSONAS) {
    if (!env[persona.credentialEnv.emailEnv]?.trim()) {
      missing.push(persona.credentialEnv.emailEnv);
    }
    if (!env[persona.credentialEnv.passwordEnv]?.trim()) {
      missing.push(persona.credentialEnv.passwordEnv);
    }
  }

  return missing;
};

export const resolvePersonaCredentials = (
  persona: QaPersonaDefinition,
  env: NodeJS.ProcessEnv = process.env,
): QaPersonaCredentials => {
  const expectedEmail = buildPersonaEmail(persona.role);
  const configuredEmail = getEnv(persona.credentialEnv.emailEnv, env).toLowerCase();
  if (configuredEmail !== expectedEmail) {
    throw new Error(
      `${persona.credentialEnv.emailEnv} must equal ${expectedEmail}. Refusing drifted QA persona email.`,
    );
  }

  const password = getEnv(persona.credentialEnv.passwordEnv, env);
  assertStrongQaPersonaPassword(password);

  return {
    email: configuredEmail,
    password,
  };
};

const assertSafePersonaDefinition = (persona: QaPersonaDefinition): void => {
  if (isDeniedPersonaName(persona.displayName)) {
    throw new Error(`Denied QA persona display name: ${persona.displayName}`);
  }
  const combinedName = `${persona.firstName} ${persona.lastName}`;
  if (isDeniedPersonaName(combinedName)) {
    throw new Error(`Denied QA persona personal name: ${combinedName}`);
  }
};

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

export const assertEmptyQaPersonaNamespace = (
  collisions: Array<{ surface: string; email?: string | null }>,
): void => {
  if (collisions.length === 0) return;
  const surfaces = [...new Set(collisions.map(({ surface }) => surface))].sort();
  throw new Error(
    `Persistent QA persona namespace is not empty on: ${surfaces.join(', ')}. Use --verify or a separately reviewed rotation flow.`,
  );
};

export const assertNoUnexpectedClientTherapistLinks = (
  actualTherapistIds: string[],
  allowedTherapistIds: Set<string>,
): void => {
  if (actualTherapistIds.some((therapistId) => !allowedTherapistIds.has(therapistId))) {
    throw new Error('Synthetic client graph contains an unexpected therapist link; refusing destructive repair.');
  }
};

const preflightEmptyQaPersonaNamespace = async (client: SupabaseClient): Promise<void> => {
  const emails = QA_PERSONAS.map(({ role }) => buildPersonaEmail(role));
  const collisions: Array<{ surface: string; email?: string | null }> = [];

  for (const email of emails) {
    if (await findUserByEmail(client, email)) collisions.push({ surface: 'auth', email });
  }

  for (const table of ['profiles', 'therapists', 'clients'] as const) {
    const { data, error } = await client.from(table).select('email').in('email', emails);
    if (error) {
      throw new Error(`${table} namespace preflight failed: ${serializeError(error)}`);
    }
    for (const row of data ?? []) collisions.push({ surface: table, email: row.email });
  }

  assertEmptyQaPersonaNamespace(collisions);
};

const getRoleRows = async (client: SupabaseClient): Promise<Map<QaPersonaRole, RoleRow>> => {
  const { data, error } = await client
    .from('roles')
    .select('id,name')
    .in('name', QA_PERSONAS.map((persona) => persona.role));

  if (error) {
    throw new Error(`Role lookup failed: ${serializeError(error)}`);
  }

  const rows = new Map<QaPersonaRole, RoleRow>();
  for (const row of data ?? []) {
    if (typeof row.id !== 'string' || !UUID_PATTERN.test(row.id)) {
      throw new Error('Role lookup returned an invalid role id.');
    }
    if (!qaPersonaByRole.has(row.name as QaPersonaRole)) {
      continue;
    }
    rows.set(row.name as QaPersonaRole, {
      id: row.id,
      name: row.name as QaPersonaRole,
    });
  }

  for (const persona of QA_PERSONAS) {
    if (!rows.has(persona.role)) {
      throw new Error(`Role ${persona.role} is not provisioned.`);
    }
  }

  return rows;
};

const upsertBasicProfile = async (
  client: SupabaseClient,
  context: PersonaRunContext,
): Promise<void> => {
  const { error } = await client.from('profiles').upsert(
    {
      id: context.user.id,
      email: context.credentials.email,
      first_name: context.definition.firstName,
      last_name: context.definition.lastName,
    },
    { onConflict: 'id' },
  );

  if (error) {
    throw new Error(`Profile upsert failed for ${context.definition.role}: ${serializeError(error)}`);
  }
};

const enforceExactRoleMapping = async (
  client: SupabaseClient,
  context: PersonaRunContext,
  roleRows: Map<QaPersonaRole, RoleRow>,
): Promise<void> => {
  // Hosted sync_user_profile seeds org context from Auth metadata; the existing
  // user_roles triggers then synchronize profiles.role after this exact insert.
  const { error: deleteError } = await client.from('user_roles').delete().eq('user_id', context.user.id);
  if (deleteError) {
    throw new Error(`user_roles cleanup failed for ${context.definition.role}: ${serializeError(deleteError)}`);
  }

  const roleRow = roleRows.get(context.definition.role);
  if (!roleRow) {
    throw new Error(`Missing resolved role row for ${context.definition.role}.`);
  }

  const { error: insertError } = await client.from('user_roles').insert({
    user_id: context.user.id,
    role_id: roleRow.id,
    is_active: true,
  });
  if (insertError) {
    throw new Error(`user_roles insert failed for ${context.definition.role}: ${serializeError(insertError)}`);
  }
};

const ensureTherapistActor = async (
  client: SupabaseClient,
  context: PersonaRunContext,
): Promise<void> => {
  if (!THERAPIST_ROLE_SET.has(context.definition.role)) {
    return;
  }

  const { error: therapistError } = await client.from('therapists').upsert(
    {
      id: context.user.id,
      organization_id: TARGET_ORGANIZATION_ID,
      email: context.credentials.email,
      first_name: context.definition.firstName,
      last_name: context.definition.lastName,
      full_name: context.definition.displayName,
      title: context.definition.title,
      status: 'active',
      specialties: ['qa-persona'],
      service_type: ['aba'],
      max_clients: 5,
    },
    { onConflict: 'id' },
  );
  if (therapistError) {
    throw new Error(`therapists upsert failed for ${context.definition.role}: ${serializeError(therapistError)}`);
  }

  const { error: linkError } = await client.from('user_therapist_links').upsert(
    {
      user_id: context.user.id,
      therapist_id: context.user.id,
    },
    { onConflict: 'user_id,therapist_id' },
  );
  if (linkError) {
    throw new Error(
      `user_therapist_links self-link failed for ${context.definition.role}: ${serializeError(linkError)}`,
    );
  }
};

const ensureClientActor = async (
  client: SupabaseClient,
  context: PersonaRunContext,
  therapistPersonaId: string,
  createdByUserId: string,
): Promise<void> => {
  if (context.definition.role !== 'client') {
    return;
  }

  const { error: clientError } = await client.from('clients').upsert(
    {
      id: context.user.id,
      email: context.credentials.email,
      full_name: context.definition.displayName,
      date_of_birth: '2015-01-01',
      organization_id: TARGET_ORGANIZATION_ID,
      therapist_id: therapistPersonaId,
    },
    { onConflict: 'id' },
  );
  if (clientError) {
    throw new Error(`clients upsert failed for client: ${serializeError(clientError)}`);
  }

  for (const role of CLIENT_CASELOAD_ROLES) {
    const linkedPersona = qaPersonaByRole.get(role);
    if (!linkedPersona) {
      throw new Error(`Missing linked client caseload role definition: ${role}`);
    }
    const linkedUser = await findUserByEmail(client, buildPersonaEmail(linkedPersona.role));
    if (!linkedUser) {
      throw new Error(`Missing provisioned linked therapist persona for client linkage: ${linkedPersona.role}`);
    }
    const { error: linkInsertError } = await client.from('client_therapist_links').upsert(
      {
        client_id: context.user.id,
        therapist_id: linkedUser.id,
        organization_id: TARGET_ORGANIZATION_ID,
        created_by: createdByUserId,
      },
      { onConflict: 'client_id,therapist_id' },
    );
    if (linkInsertError) {
      throw new Error(
        `client_therapist_links upsert failed for ${linkedPersona.role}: ${serializeError(linkInsertError)}`,
      );
    }
  }

  const allowedTherapistIds = new Set<string>();
  for (const role of CLIENT_CASELOAD_ROLES) {
    const linkedUser = await findUserByEmail(client, buildPersonaEmail(role));
    if (!linkedUser) {
      throw new Error(`Missing linked user for client cleanup verification: ${role}`);
    }
    allowedTherapistIds.add(linkedUser.id);
  }

  const { data: currentLinks, error: currentLinksError } = await client
    .from('client_therapist_links')
    .select('id, therapist_id')
    .eq('client_id', context.user.id);

  if (currentLinksError) {
    throw new Error(`client_therapist_links verification lookup failed: ${serializeError(currentLinksError)}`);
  }

  assertNoUnexpectedClientTherapistLinks(
    (currentLinks ?? []).map((row) => String(row.therapist_id ?? '')),
    allowedTherapistIds,
  );
};

const normalizeRoleNames = (
  rows: Array<{ is_active?: boolean | null; roles?: unknown }> | null,
): string[] => {
  const result: string[] = [];
  for (const row of rows ?? []) {
    if (row.is_active !== true) {
      continue;
    }
    const nested = row.roles as { name?: unknown } | Array<{ name?: unknown }> | null;
    const roleEntries = Array.isArray(nested) ? nested : nested ? [nested] : [];
    for (const entry of roleEntries) {
      if (typeof entry.name === 'string') {
        result.push(entry.name);
      }
    }
  }
  return result;
};

const verifyProfileAndRole = async (
  client: SupabaseClient,
  context: PersonaRunContext,
): Promise<{ profileOk: boolean; roleOk: boolean }> => {
  const [profileResult, roleResult] = await Promise.all([
    client
      .from('profiles')
      .select('id,email,role,is_active,organization_id')
      .eq('id', context.user.id)
      .maybeSingle(),
    client
      .from('user_roles')
      .select('is_active,roles(name)')
      .eq('user_id', context.user.id),
  ]);

  if (profileResult.error) {
    throw new Error(`Profile verification failed for ${context.definition.role}: ${serializeError(profileResult.error)}`);
  }
  if (roleResult.error) {
    throw new Error(`Role verification failed for ${context.definition.role}: ${serializeError(roleResult.error)}`);
  }

  const profileOk = profileResult.data?.id === context.user.id
    && profileResult.data.email?.toLowerCase() === context.credentials.email
    && profileResult.data.role === context.definition.role
    && profileResult.data.is_active === true
    && profileResult.data.organization_id === TARGET_ORGANIZATION_ID;

  const activeRoles = normalizeRoleNames(roleResult.data);
  const roleOk = activeRoles.length === 1 && activeRoles[0] === context.definition.role;

  if (!profileOk) {
    throw new Error(`Profile invariant failed for ${context.definition.role}.`);
  }
  if (!roleOk) {
    throw new Error(`Authoritative role invariant failed for ${context.definition.role}.`);
  }

  return { profileOk, roleOk };
};

const verifyTherapistActor = async (
  client: SupabaseClient,
  context: PersonaRunContext,
): Promise<boolean> => {
  if (!THERAPIST_ROLE_SET.has(context.definition.role)) {
    return true;
  }

  const [therapistResult, linkResult] = await Promise.all([
    client
      .from('therapists')
      .select('id,email,status,organization_id,deleted_at')
      .eq('id', context.user.id)
      .maybeSingle(),
    client
      .from('user_therapist_links')
      .select('therapist_id')
      .eq('user_id', context.user.id),
  ]);

  if (therapistResult.error) {
    throw new Error(`Therapist verification failed for ${context.definition.role}: ${serializeError(therapistResult.error)}`);
  }
  if (linkResult.error) {
    throw new Error(`Therapist link verification failed for ${context.definition.role}: ${serializeError(linkResult.error)}`);
  }

  const therapistOk = therapistResult.data?.id === context.user.id
    && therapistResult.data.email?.toLowerCase() === context.credentials.email
    && therapistResult.data.status === 'active'
    && therapistResult.data.organization_id === TARGET_ORGANIZATION_ID
    && therapistResult.data.deleted_at == null;

  const selfLinks = (linkResult.data ?? []).filter((row) => row.therapist_id === context.user.id);
  if (!therapistOk || selfLinks.length !== 1) {
    throw new Error(`Therapist actor invariant failed for ${context.definition.role}.`);
  }

  return true;
};

const verifyClientActor = async (
  client: SupabaseClient,
  context: PersonaRunContext,
  therapistPersonaId: string,
  clientTherapistIds: string[],
): Promise<boolean> => {
  if (context.definition.role !== 'client') {
    return true;
  }

  const [clientResult, linkResult] = await Promise.all([
    client
      .from('clients')
      .select('id,email,full_name,organization_id,therapist_id')
      .eq('id', context.user.id)
      .maybeSingle(),
    client
      .from('client_therapist_links')
      .select('therapist_id')
      .eq('client_id', context.user.id),
  ]);

  if (clientResult.error) {
    throw new Error(`Client verification failed: ${serializeError(clientResult.error)}`);
  }
  if (linkResult.error) {
    throw new Error(`Client therapist link verification failed: ${serializeError(linkResult.error)}`);
  }

  const expectedLinkIds = new Set(clientTherapistIds);
  const actualLinkIds = new Set(
    (linkResult.data ?? [])
      .map((row) => (typeof row.therapist_id === 'string' ? row.therapist_id : ''))
      .filter(Boolean),
  );

  const exactLinks = actualLinkIds.size === expectedLinkIds.size
    && Array.from(expectedLinkIds).every((id) => actualLinkIds.has(id));

  const clientOk = clientResult.data?.id === context.user.id
    && clientResult.data.email?.toLowerCase() === context.credentials.email
    && clientResult.data.full_name === context.definition.displayName
    && clientResult.data.organization_id === TARGET_ORGANIZATION_ID
    && clientResult.data.therapist_id === therapistPersonaId;

  if (!clientOk || !exactLinks) {
    throw new Error('Client actor invariant failed.');
  }

  return true;
};

const verifyPasswordLogin = async (
  client: SupabaseClient,
  context: PersonaRunContext,
  therapistPersonaId: string,
): Promise<boolean> => {
  const { data: authData, error: authError } = await client.auth.signInWithPassword({
    email: context.credentials.email,
    password: context.credentials.password,
  });

  if (authError || authData.user?.id !== context.user.id) {
    throw new Error(`Publishable-key login failed for ${context.definition.role}: ${serializeError(authError)}`);
  }

  let signOutErrorMessage: string | null = null;

  try {
    const { data: profile, error: profileError } = await client
      .from('profiles')
      .select('id,role,is_active,organization_id')
      .eq('id', context.user.id)
      .maybeSingle();
    if (profileError) {
      throw profileError;
    }
    if (
      profile?.id !== context.user.id
      || profile.role !== context.definition.role
      || profile.is_active !== true
      || profile.organization_id !== TARGET_ORGANIZATION_ID
    ) {
      throw new Error(`Authenticated profile mismatch for ${context.definition.role}.`);
    }

    if (THERAPIST_ROLE_SET.has(context.definition.role)) {
      const { data: therapist, error: therapistError } = await client
        .from('therapists')
        .select('id,organization_id,status')
        .eq('id', context.user.id)
        .maybeSingle();
      if (
        therapistError
        || therapist?.id !== context.user.id
        || therapist.organization_id !== TARGET_ORGANIZATION_ID
        || therapist.status !== 'active'
      ) {
        throw new Error(`Authenticated therapist read mismatch for ${context.definition.role}.`);
      }
    }

    if (context.definition.role === 'client') {
      const { data: clientRow, error: clientError } = await client
        .from('clients')
        .select('id,organization_id,therapist_id')
        .eq('id', context.user.id)
        .maybeSingle();
      if (
        clientError
        || clientRow?.id !== context.user.id
        || clientRow.organization_id !== TARGET_ORGANIZATION_ID
        || clientRow.therapist_id !== therapistPersonaId
      ) {
        throw new Error('Authenticated client read mismatch.');
      }
    }
  } finally {
    const { error: signOutError } = await client.auth.signOut();
    if (signOutError) {
      signOutErrorMessage = `Sign out failed for ${context.definition.role}: ${serializeError(signOutError)}`;
    }
  }

  if (signOutErrorMessage) {
    throw new Error(signOutErrorMessage);
  }

  return true;
};

const cleanupOwnedPersonaRows = async (client: SupabaseClient, user: User, role: QaPersonaRole): Promise<void> => {
  if (role === 'client') {
    const { error: deleteClientLinksError } = await client
      .from('client_therapist_links')
      .delete()
      .eq('client_id', user.id);
    if (deleteClientLinksError) {
      throw new Error(`Client link cleanup failed: ${serializeError(deleteClientLinksError)}`);
    }

    const { error: deleteClientError } = await client.from('clients').delete().eq('id', user.id);
    if (deleteClientError) {
      throw new Error(`Client cleanup failed: ${serializeError(deleteClientError)}`);
    }
  }

  if (THERAPIST_ROLE_SET.has(role)) {
    const { error: linkError } = await client.from('user_therapist_links').delete().eq('user_id', user.id);
    if (linkError) {
      throw new Error(`Therapist link cleanup failed: ${serializeError(linkError)}`);
    }

    const { error: therapistError } = await client.from('therapists').delete().eq('id', user.id);
    if (therapistError) {
      throw new Error(`Therapist cleanup failed: ${serializeError(therapistError)}`);
    }
  }

  const { error: roleError } = await client.from('user_roles').delete().eq('user_id', user.id);
  if (roleError) {
    throw new Error(`Role cleanup failed: ${serializeError(roleError)}`);
  }

  const { error: profileError } = await client.from('profiles').delete().eq('id', user.id);
  if (profileError) {
    throw new Error(`Profile cleanup failed: ${serializeError(profileError)}`);
  }
};

const cleanupNewlyCreatedPersona = async (client: SupabaseClient, context: PersonaRunContext): Promise<void> => {
  if (!isOwnedQaPersonaAppMetadata(context.user.app_metadata ?? null, context.definition.role)) {
    throw new Error(`Refusing cleanup without owned QA persona metadata for ${context.definition.role}.`);
  }

  await cleanupOwnedPersonaRows(client, context.user, context.definition.role);

  const { error: deleteUserError } = await client.auth.admin.deleteUser(context.user.id);
  if (deleteUserError) {
    throw new Error(`Auth cleanup failed for ${context.definition.role}: ${serializeError(deleteUserError)}`);
  }
};

const ensureOwnedAuthUser = async (
  client: SupabaseClient,
  persona: QaPersonaDefinition,
  credentials: QaPersonaCredentials,
): Promise<PersonaRunContext> => {
  const existing = await findUserByEmail(client, credentials.email);
  const userMetadata = buildPersonaAuthMetadata(persona);
  const appMetadata = buildPersonaAppMetadata(persona.role);

  if (existing) {
    throw new Error(
      `Collision detected for ${credentials.email}. Provisioning never mutates an existing Auth user; use --verify.`,
    );
  }

  const { data, error } = await client.auth.admin.createUser({
    email: credentials.email,
    password: credentials.password,
    email_confirm: true,
    user_metadata: userMetadata,
    app_metadata: appMetadata,
  });
  if (error || !data.user) {
    throw error ?? new Error(`Auth create failed for ${persona.role}.`);
  }

  return {
    definition: persona,
    credentials,
    user: data.user,
    existedBeforeRun: false,
  };
};

const verifyPersona = async (
  adminClient: SupabaseClient,
  publishableClient: SupabaseClient,
  context: PersonaRunContext,
  therapistPersonaId: string,
  clientTherapistIds: string[],
): Promise<VerificationSummary> => {
  const profileAndRole = await verifyProfileAndRole(adminClient, context);
  const therapistOk = await verifyTherapistActor(adminClient, context);
  const clientOk = await verifyClientActor(adminClient, context, therapistPersonaId, clientTherapistIds);
  const loginOk = await verifyPasswordLogin(publishableClient, context, therapistPersonaId);

  return {
    userId: context.user.id,
    profileOk: profileAndRole.profileOk,
    roleOk: profileAndRole.roleOk,
    therapistOk,
    clientOk,
    loginOk,
  };
};

const writeManifest = (manifest: ManifestRecord): void => {
  const manifestPath = getEnv(QA_PERSONA_MANIFEST_ENV);
  mkdirSync(path.dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
};

const provision = async (): Promise<void> => {
  const missingEnv = getMissingQaPersonaEnvVars();
  if (missingEnv.length > 0) {
    throw new Error(`Missing required QA persona inputs: ${missingEnv.join(', ')}`);
  }

  for (const persona of QA_PERSONAS) {
    assertSafePersonaDefinition(persona);
  }

  const adminClient = createAdminClient();
  const publishableClient = createPublishableClient();
  const roleRows = await getRoleRows(adminClient);
  const createdThisRun: PersonaRunContext[] = [];
  const contexts = new Map<QaPersonaRole, PersonaRunContext>();
  const manifestPersonas: ManifestPersonaResult[] = [];

  try {
    await preflightEmptyQaPersonaNamespace(adminClient);

    for (const persona of QA_PERSONAS) {
      const context = await ensureOwnedAuthUser(adminClient, persona, resolvePersonaCredentials(persona));
      contexts.set(persona.role, context);
      if (!context.existedBeforeRun) {
        createdThisRun.push(context);
      }
    }

    for (const persona of QA_PERSONAS) {
      const context = contexts.get(persona.role);
      if (!context) {
        throw new Error(`Missing persona context for ${persona.role}.`);
      }
      await upsertBasicProfile(adminClient, context);
      await enforceExactRoleMapping(adminClient, context, roleRows);
      await ensureTherapistActor(adminClient, context);
    }

    const therapistPersonaId = contexts.get('therapist')?.user.id;
    const adminActorId = contexts.get('admin')?.user.id ?? contexts.get('super_admin')?.user.id;
    if (!therapistPersonaId || !UUID_PATTERN.test(therapistPersonaId)) {
      throw new Error('Therapist persona id is required before client provisioning.');
    }
    if (!adminActorId || !UUID_PATTERN.test(adminActorId)) {
      throw new Error('Admin or super_admin persona id is required before client provisioning.');
    }

    const clientContext = contexts.get('client');
    if (!clientContext) {
      throw new Error('Client persona context is required.');
    }
    await ensureClientActor(adminClient, clientContext, therapistPersonaId, adminActorId);

    const clientTherapistIds = CLIENT_CASELOAD_ROLES.map((role) => {
      const userId = contexts.get(role)?.user.id;
      if (!userId) {
        throw new Error(`Missing linked persona id for ${role}.`);
      }
      return userId;
    });

    for (const persona of QA_PERSONAS) {
      const context = contexts.get(persona.role);
      if (!context) {
        throw new Error(`Missing verification context for ${persona.role}.`);
      }
      const verification = await verifyPersona(
        adminClient,
        publishableClient,
        context,
        therapistPersonaId,
        clientTherapistIds,
      );

      manifestPersonas.push({
        role: persona.role,
        email: context.credentials.email,
        authUserId: verification.userId,
        status: 'verified',
      });
    }

    writeManifest({
      ok: true,
      mode: 'provision',
      generatedAt: new Date().toISOString(),
      issue: WIN_43_ISSUE,
      organizationId: TARGET_ORGANIZATION_ID,
      personas: manifestPersonas,
    });
  } catch (error) {
    for (const context of createdThisRun.slice().reverse()) {
      try {
        await cleanupNewlyCreatedPersona(adminClient, context);
      } catch (cleanupError) {
        throw new Error(`${serializeError(error)} Cleanup failure: ${serializeError(cleanupError)}`);
      }
    }

    writeManifest({
      ok: false,
      mode: 'provision',
      generatedAt: new Date().toISOString(),
      issue: WIN_43_ISSUE,
      organizationId: TARGET_ORGANIZATION_ID,
      personas: [],
    });
    throw error;
  }
};

const verify = async (): Promise<void> => {
  const missingEnv = getMissingQaPersonaEnvVars();
  if (missingEnv.length > 0) {
    throw new Error(`Missing required QA persona inputs: ${missingEnv.join(', ')}`);
  }

  const adminClient = createAdminClient();
  const publishableClient = createPublishableClient();
  const contexts = new Map<QaPersonaRole, PersonaRunContext>();
  const manifestPersonas: ManifestPersonaResult[] = [];

  for (const persona of QA_PERSONAS) {
    const credentials = resolvePersonaCredentials(persona);
    const user = await findUserByEmail(adminClient, credentials.email);
    if (!user) {
      throw new Error(`Missing persistent QA persona Auth user for ${persona.role}.`);
    }
    if (!isOwnedQaPersonaAppMetadata(user.app_metadata ?? null, persona.role)) {
      throw new Error(`Auth user collision for ${persona.role}; exact WIN-43 QA ownership marker is missing.`);
    }
    contexts.set(persona.role, {
      definition: persona,
      credentials,
      user,
      existedBeforeRun: true,
    });
  }

  const therapistPersonaId = contexts.get('therapist')?.user.id;
  if (!therapistPersonaId) {
    throw new Error('Therapist persona must exist for verification.');
  }
  const clientTherapistIds = CLIENT_CASELOAD_ROLES.map((role) => {
    const userId = contexts.get(role)?.user.id;
    if (!userId) {
      throw new Error(`Missing linked QA persona for ${role}.`);
    }
    return userId;
  });

  for (const persona of QA_PERSONAS) {
    const context = contexts.get(persona.role);
    if (!context) {
      throw new Error(`Missing verification context for ${persona.role}.`);
    }

    const verification = await verifyPersona(
      adminClient,
      publishableClient,
      context,
      therapistPersonaId,
      clientTherapistIds,
    );

    manifestPersonas.push({
      role: persona.role,
      email: context.credentials.email,
      authUserId: verification.userId,
      status: 'verified',
    });
  }

  writeManifest({
    ok: true,
    mode: 'verify',
    generatedAt: new Date().toISOString(),
    issue: WIN_43_ISSUE,
    organizationId: TARGET_ORGANIZATION_ID,
    personas: manifestPersonas,
  });
};

export const parseMode = (argv: string[]): 'provision' | 'verify' => {
  const wantsProvision = argv.includes('--provision');
  const wantsVerify = argv.includes('--verify');

  if (wantsProvision === wantsVerify) {
    throw new Error('Provide exactly one mode: --provision or --verify.');
  }

  return wantsProvision ? 'provision' : 'verify';
};

export const main = async (argv: string[] = process.argv.slice(2)): Promise<void> => {
  const mode = parseMode(argv);
  if (mode === 'provision') {
    await provision();
    return;
  }
  await verify();
};

const isDirectRun = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href
  && process.env.VITEST !== 'true';

if (isDirectRun) {
  main().catch(() => {
    console.error(
      JSON.stringify({
        ok: false,
        error: 'QA persona operation failed; inspect the sanitized manifest and protected run logs.',
      }),
    );
    process.exit(1);
  });
}
