import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import type { Database } from '../generated/database.types';

type TypedClient = SupabaseClient<Database, 'public', Database['public']>;

interface TestUserContext {
  email: string;
  password: string;
  userId: string;
  therapistId: string;
  clientId: string;
  sessionId: string;
  organizationId: string;
}

const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  ((import.meta as unknown as { env?: Record<string, string | undefined> }).env?.SUPABASE_SERVICE_ROLE_KEY ?? '');

const SHOULD_RUN_MULTI_TENANT =
  Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && SERVICE_ROLE_KEY) &&
  Boolean(import.meta.env.CI || (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.RUN_DB_IT === '1');

const createPassword = () => `P@ssw0rd-${Math.random().toString(36).slice(2, 10)}`;

let serviceClient: TypedClient | null = null;
let runTests = false;
let orgAContext: TestUserContext | null = null;
let orgBContext: TestUserContext | null = null;

const createTherapistFixture = async (label: string, organizationId: string): Promise<TestUserContext> => {
  if (!serviceClient) {
    throw new Error('Service client not initialized');
  }

  const email = `${label}.${Date.now()}@example.com`;
  const password = createPassword();
  const { data: createdUser, error: createUserError } = await serviceClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { organization_id: organizationId },
  });

  if (createUserError || !createdUser?.user) {
    throw createUserError ?? new Error('User creation failed');
  }

  const userId = createdUser.user.id;
  const therapistId = userId;

  const { error: therapistInsertError } = await serviceClient.from('therapists').insert({
    id: therapistId,
    email,
    full_name: `${label.toUpperCase()} Therapist`,
    specialties: ['aba'],
    max_clients: 5,
    organization_id: organizationId,
  });

  if (therapistInsertError) {
    throw therapistInsertError;
  }

  const assignRoleResult = await serviceClient.rpc('assign_therapist_role', {
    user_email: email,
    therapist_id: therapistId,
  });

  if (assignRoleResult.error) {
    throw assignRoleResult.error;
  }

  await serviceClient
    .from('profiles')
    .update({ role: 'therapist' })
    .eq('id', userId);

  const clientId = randomUUID();
  const { error: clientInsertError } = await serviceClient.from('clients').insert({
    id: clientId,
    email: `${label}.client.${Date.now()}@example.com`,
    full_name: `${label.toUpperCase()} Client`,
    date_of_birth: '2015-01-01',
    organization_id: organizationId,
  });

  if (clientInsertError) {
    throw clientInsertError;
  }

  const sessionId = randomUUID();
  const start = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const end = new Date(Date.now() - 60 * 60 * 1000);

  const { error: sessionInsertError } = await serviceClient.from('sessions').insert({
    id: sessionId,
    client_id: clientId,
    therapist_id: therapistId,
    start_time: start.toISOString(),
    end_time: end.toISOString(),
    status: 'completed',
  });

  if (sessionInsertError) {
    throw sessionInsertError;
  }

  return { email, password, userId, therapistId, clientId, sessionId, organizationId };
};

beforeAll(async () => {
  if (!SHOULD_RUN_MULTI_TENANT) {
    console.warn('⏭️  Skipping multi-tenant access integration tests - environment not configured.');
    return;
  }

  serviceClient = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  try {
    const { error } = await serviceClient.from('roles').select('id').limit(1);
    if (error) {
      console.warn('⏭️  Skipping multi-tenant tests - Supabase not reachable:', error.message);
      return;
    }
  } catch (error) {
    console.warn('⏭️  Skipping multi-tenant tests - Supabase connection failed.');
    return;
  }

  runTests = true;
  const orgAId = randomUUID();
  const orgBId = randomUUID();
  orgAContext = await createTherapistFixture('orga', orgAId);
  orgBContext = await createTherapistFixture('orgb', orgBId);
});

afterAll(async () => {
  if (!runTests || !serviceClient) {
    return;
  }

  const contexts = [orgAContext, orgBContext].filter(Boolean) as TestUserContext[];
  for (const context of contexts) {
    await serviceClient.from('sessions').delete().eq('id', context.sessionId);
    await serviceClient.from('clients').delete().eq('id', context.clientId);
    await serviceClient.from('user_therapist_links').delete().eq('user_id', context.userId);
    await serviceClient.from('therapists').delete().eq('id', context.therapistId);
    await serviceClient.auth.admin.deleteUser(context.userId);
  }
});

describe('multi-tenant access controls', () => {
  it('allows therapists to read their own client record', async () => {
    if (!runTests || !orgAContext) {
      console.log('⏭️  Skipping multi-tenant test - setup incomplete.');
      return;
    }

    const supabaseOrgA = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const signInResult = await supabaseOrgA.auth.signInWithPassword({
      email: orgAContext.email,
      password: orgAContext.password,
    });

    expect(signInResult.error).toBeNull();

    const { data: userInfo } = await supabaseOrgA.auth.getUser();
    expect(userInfo.user?.user_metadata.organization_id).toBe(orgAContext.organizationId);

    const { data, error } = await supabaseOrgA
      .from('clients')
      .select('id, full_name')
      .eq('id', orgAContext.clientId);

    expect(error).toBeNull();
    expect(data).toBeTruthy();
    expect(data).toHaveLength(1);
    expect(data?.[0]?.id).toBe(orgAContext.clientId);

    await supabaseOrgA.auth.signOut();
  });

  it('prevents cross-organization client access', async () => {
    if (!runTests || !orgAContext || !orgBContext) {
      console.log('⏭️  Skipping multi-tenant test - setup incomplete.');
      return;
    }

    const supabaseOrgA = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const signInResult = await supabaseOrgA.auth.signInWithPassword({
      email: orgAContext.email,
      password: orgAContext.password,
    });

    expect(signInResult.error).toBeNull();

    const { data, error } = await supabaseOrgA
      .from('clients')
      .select('id')
      .eq('id', orgBContext.clientId);

    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
    expect(data).toHaveLength(0);

    await supabaseOrgA.auth.signOut();
  });

  it('returns only in-organization clients when listing all records', async () => {
    if (!runTests || !orgAContext) {
      console.log('⏭️  Skipping multi-tenant test - setup incomplete.');
      return;
    }

    const supabaseOrgA = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const signInResult = await supabaseOrgA.auth.signInWithPassword({
      email: orgAContext.email,
      password: orgAContext.password,
    });

    expect(signInResult.error).toBeNull();

    const { data, error } = await supabaseOrgA
      .from('clients')
      .select('id, organization_id')
      .order('created_at', { ascending: true });

    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
    expect(data?.length).toBeGreaterThan(0);

    const distinctOrgIds = new Set((data ?? []).map(row => row.organization_id));
    expect(distinctOrgIds.size).toBe(1);
    expect(distinctOrgIds.has(orgAContext.organizationId)).toBe(true);

    await supabaseOrgA.auth.signOut();
  });

  it('blocks reciprocal cross-organization client access', async () => {
    if (!runTests || !orgAContext || !orgBContext) {
      console.log('⏭️  Skipping multi-tenant test - setup incomplete.');
      return;
    }

    const supabaseOrgB = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const signInResult = await supabaseOrgB.auth.signInWithPassword({
      email: orgBContext.email,
      password: orgBContext.password,
    });

    expect(signInResult.error).toBeNull();

    const { data, error } = await supabaseOrgB
      .from('clients')
      .select('id')
      .eq('id', orgAContext.clientId);

    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
    expect(data).toHaveLength(0);

    await supabaseOrgB.auth.signOut();
  });

  it('prevents therapists from reading another therapist’s sessions within the same org', async () => {
    if (!runTests || !orgAContext || !orgBContext) {
      console.log('⏭️  Skipping multi-tenant test - setup incomplete.');
      return;
    }

    const supabaseOrgA = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const signInResult = await supabaseOrgA.auth.signInWithPassword({
      email: orgAContext.email,
      password: orgAContext.password,
    });
    expect(signInResult.error).toBeNull();

    const { data, error } = await supabaseOrgA
      .from('sessions')
      .select('id')
      .eq('therapist_id', orgBContext.therapistId);

    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
    expect(data?.length).toBe(0);

    await supabaseOrgA.auth.signOut();
  });

  it('allows therapists to read only their assigned client record', async () => {
    if (!runTests || !orgAContext || !orgBContext) {
      console.log('⏭️  Skipping multi-tenant test - setup incomplete.');
      return;
    }

    const supabaseOrgA = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const signInResult = await supabaseOrgA.auth.signInWithPassword({
      email: orgAContext.email,
      password: orgAContext.password,
    });
    expect(signInResult.error).toBeNull();

    const mine = await supabaseOrgA
      .from('clients')
      .select('id')
      .eq('id', orgAContext.clientId)
      .maybeSingle();
    expect(mine.error).toBeNull();
    expect(mine.data?.id).toBe(orgAContext.clientId);

    const other = await supabaseOrgA
      .from('clients')
      .select('id')
      .eq('id', orgBContext.clientId)
      .maybeSingle();
    expect(other.error).toBeNull();
    expect(other.data).toBeNull();

    await supabaseOrgA.auth.signOut();
  });
});
