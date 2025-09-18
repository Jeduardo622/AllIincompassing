import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type PostgrestError, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import type { Database } from '../../lib/generated/database.types';

type TypedClient = SupabaseClient<Database, 'public', Database['public']>;

interface TenantContext {
  email: string;
  password: string;
  userId: string;
  therapistId: string;
  clientId: string;
  sessionId: string;
  organizationId: string;
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  ((import.meta as unknown as { env?: Record<string, string | undefined> }).env?.SUPABASE_SERVICE_ROLE_KEY ?? '');

const SHOULD_RUN_RLS_TESTS =
  Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && SERVICE_ROLE_KEY) &&
  Boolean(
    import.meta.env.CI ||
      (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.RUN_DB_IT === '1',
  );

let serviceClient: TypedClient | null = null;
let runTests = false;
let orgAContext: TenantContext | null = null;
let orgBContext: TenantContext | null = null;

const createTenantFixture = async (label: string, organizationId: string): Promise<TenantContext> => {
  if (!serviceClient) {
    throw new Error('Service client not initialized');
  }

  const email = `${label}.${Date.now()}@example.com`;
  const password = `P@ssw0rd-${Math.random().toString(36).slice(2, 10)}`;

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

  await serviceClient.from('profiles').update({ role: 'therapist' }).eq('id', userId);

  const clientId = randomUUID();
  const { error: clientInsertError } = await serviceClient.from('clients').insert({
    id: clientId,
    email: `${label}.client.${Date.now()}@example.com`,
    full_name: `${label.toUpperCase()} Client`,
    date_of_birth: '2015-01-01',
  });

  if (clientInsertError) {
    throw clientInsertError;
  }

  const sessionId = randomUUID();
  const start = new Date(Date.now() - 60 * 60 * 1000);
  const end = new Date(Date.now());

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

const signInTherapist = async (context: TenantContext): Promise<TypedClient> => {
  const client = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const signInResult = await client.auth.signInWithPassword({
    email: context.email,
    password: context.password,
  });

  if (signInResult.error) {
    throw signInResult.error;
  }

  return client;
};

const expectRlsViolation = (error: PostgrestError | null, fallbackRowCount = 0) => {
  if (error) {
    expect(error.message.toLowerCase()).toMatch(/row-level security|not allowed|permission|violat/);
    return;
  }

  expect(fallbackRowCount).toBe(0);
};

beforeAll(async () => {
  if (!SHOULD_RUN_RLS_TESTS) {
    console.warn('⏭️  Skipping RLS security tests - environment not configured.');
    return;
  }

  serviceClient = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const { error } = await serviceClient.from('roles').select('id').limit(1);
    if (error) {
      console.warn('⏭️  Skipping RLS security tests - Supabase not reachable:', error.message);
      return;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('⏭️  Skipping RLS security tests - Supabase connection failed.', message);
    return;
  }

  runTests = true;
  const orgAId = randomUUID();
  const orgBId = randomUUID();
  orgAContext = await createTenantFixture('orga', orgAId);
  orgBContext = await createTenantFixture('orgb', orgBId);
});

afterAll(async () => {
  if (!runTests || !serviceClient) {
    return;
  }

  const contexts = [orgAContext, orgBContext].filter(Boolean) as TenantContext[];
  for (const context of contexts) {
    await serviceClient.from('sessions').delete().eq('id', context.sessionId);
    await serviceClient.from('clients').delete().eq('id', context.clientId);
    await serviceClient.from('user_therapist_links').delete().eq('user_id', context.userId);
    await serviceClient.from('therapists').delete().eq('id', context.therapistId);
    await serviceClient.auth.admin.deleteUser(context.userId);
  }
});

describe('row level security for multi-tenant tables', () => {
  it('prevents therapists from reading other organization clients', async () => {
    if (!runTests || !orgAContext || !orgBContext) {
      console.log('⏭️  Skipping RLS test - setup incomplete.');
      return;
    }

    const supabaseOrgA = await signInTherapist(orgAContext);
    try {
      const { data, error } = await supabaseOrgA
        .from('clients')
        .select('id')
        .eq('id', orgBContext.clientId);

      expect(error).toBeNull();
      expect(Array.isArray(data)).toBe(true);
      expect(data).toHaveLength(0);
    } finally {
      await supabaseOrgA.auth.signOut();
    }
  });

  it('prevents therapists from updating other organization clients', async () => {
    if (!runTests || !orgAContext || !orgBContext) {
      console.log('⏭️  Skipping RLS test - setup incomplete.');
      return;
    }

    const supabaseOrgA = await signInTherapist(orgAContext);
    try {
      const result = await supabaseOrgA
        .from('clients')
        .update({ full_name: 'Unauthorized Update' })
        .eq('id', orgBContext.clientId)
        .select('id');

      const affectedRows = Array.isArray(result.data) ? result.data.length : 0;
      expectRlsViolation(result.error, affectedRows);
    } finally {
      await supabaseOrgA.auth.signOut();
    }
  });

  it('prevents therapists from reading other therapist profiles', async () => {
    if (!runTests || !orgAContext || !orgBContext) {
      console.log('⏭️  Skipping RLS test - setup incomplete.');
      return;
    }

    const supabaseOrgA = await signInTherapist(orgAContext);
    try {
      const { data, error } = await supabaseOrgA
        .from('therapists')
        .select('id')
        .eq('id', orgBContext.therapistId);

      expect(error).toBeNull();
      expect(Array.isArray(data)).toBe(true);
      expect(data).toHaveLength(0);
    } finally {
      await supabaseOrgA.auth.signOut();
    }
  });

  it('prevents therapists from updating other therapist profiles', async () => {
    if (!runTests || !orgAContext || !orgBContext) {
      console.log('⏭️  Skipping RLS test - setup incomplete.');
      return;
    }

    const supabaseOrgA = await signInTherapist(orgAContext);
    try {
      const result = await supabaseOrgA
        .from('therapists')
        .update({ full_name: 'Intruder Therapist' })
        .eq('id', orgBContext.therapistId)
        .select('id');

      const affectedRows = Array.isArray(result.data) ? result.data.length : 0;
      expectRlsViolation(result.error, affectedRows);
    } finally {
      await supabaseOrgA.auth.signOut();
    }
  });

  it('blocks therapists from reading other organization sessions', async () => {
    if (!runTests || !orgAContext || !orgBContext) {
      console.log('⏭️  Skipping RLS test - setup incomplete.');
      return;
    }

    const supabaseOrgA = await signInTherapist(orgAContext);
    try {
      const { data, error } = await supabaseOrgA
        .from('sessions')
        .select('id')
        .eq('id', orgBContext.sessionId);

      expect(error).toBeNull();
      expect(Array.isArray(data)).toBe(true);
      expect(data).toHaveLength(0);
    } finally {
      await supabaseOrgA.auth.signOut();
    }
  });

  it('blocks therapists from updating other organization sessions', async () => {
    if (!runTests || !orgAContext || !orgBContext) {
      console.log('⏭️  Skipping RLS test - setup incomplete.');
      return;
    }

    const supabaseOrgA = await signInTherapist(orgAContext);
    try {
      const result = await supabaseOrgA
        .from('sessions')
        .update({ status: 'cancelled' })
        .eq('id', orgBContext.sessionId)
        .select('id');

      const affectedRows = Array.isArray(result.data) ? result.data.length : 0;
      expectRlsViolation(result.error, affectedRows);
    } finally {
      await supabaseOrgA.auth.signOut();
    }
  });

  it('prevents therapists from inserting sessions for other organizations', async () => {
    if (!runTests || !orgAContext || !orgBContext) {
      console.log('⏭️  Skipping RLS test - setup incomplete.');
      return;
    }

    const supabaseOrgA = await signInTherapist(orgAContext);
    try {
      const start = new Date(Date.now() + 60 * 60 * 1000);
      const end = new Date(start.getTime() + 60 * 60 * 1000);

      const result = await supabaseOrgA
        .from('sessions')
        .insert({
          client_id: orgBContext.clientId,
          therapist_id: orgBContext.therapistId,
          start_time: start.toISOString(),
          end_time: end.toISOString(),
          status: 'scheduled',
        })
        .select('id');

      const affectedRows = Array.isArray(result.data) ? result.data.length : 0;
      expectRlsViolation(result.error, affectedRows);
    } finally {
      await supabaseOrgA.auth.signOut();
    }
  });
});
