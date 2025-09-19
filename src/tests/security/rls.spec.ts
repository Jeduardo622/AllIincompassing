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
  clientUserId: string;
  clientEmail: string;
  clientPassword: string;
  sessionId: string;
  organizationId: string;
}

interface AdminContext {
  email: string;
  password: string;
  userId: string;
}

const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
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
let adminContext: AdminContext | null = null;

const createdLocationIds: string[] = [];
const createdServiceLineIds: string[] = [];
const createdReferringProviderIds: string[] = [];
const createdFileCabinetCategoryIds: string[] = [];
const uploadedClientDocumentPaths: string[] = [];
let companySettingsId: string | null = null;
let originalCompanyName: string | null = null;

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

  const clientEmail = `${label}.client.${Date.now()}@example.com`;
  const clientPassword = `P@ssw0rd-${Math.random().toString(36).slice(2, 10)}`;

  const { data: createdClientUser, error: clientUserError } = await serviceClient.auth.admin.createUser({
    email: clientEmail,
    password: clientPassword,
    email_confirm: true,
  });

  if (clientUserError || !createdClientUser?.user) {
    throw clientUserError ?? new Error('Client user creation failed');
  }

  const clientUserId = createdClientUser.user.id;

  await serviceClient.from('profiles').update({ role: 'client' }).eq('id', clientUserId);

  const { error: clientInsertError } = await serviceClient.from('clients').insert({
    id: clientUserId,
    email: clientEmail,
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
    client_id: clientUserId,
    therapist_id: therapistId,
    start_time: start.toISOString(),
    end_time: end.toISOString(),
    status: 'completed',
  });

  if (sessionInsertError) {
    throw sessionInsertError;
  }

  return {
    email,
    password,
    userId,
    therapistId,
    clientId: clientUserId,
    clientUserId,
    clientEmail,
    clientPassword,
    sessionId,
    organizationId,
  };
};

const createAdminFixture = async (): Promise<AdminContext> => {
  if (!serviceClient) {
    throw new Error('Service client not initialized');
  }

  const email = `admin.${Date.now()}@example.com`;
  const password = `P@ssw0rd-${Math.random().toString(36).slice(2, 10)}`;

  const { data: createdUser, error: createUserError } = await serviceClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (createUserError || !createdUser?.user) {
    throw createUserError ?? new Error('Admin user creation failed');
  }

  const userId = createdUser.user.id;

  const assignResult = await serviceClient.rpc('assign_admin_role', {
    user_email: email,
  });

  if (assignResult.error) {
    throw assignResult.error;
  }

  return { email, password, userId };
};

const signInWithPassword = async (email: string, password: string): Promise<TypedClient> => {
  const client = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const signInResult = await client.auth.signInWithPassword({
    email,
    password,
  });

  if (signInResult.error) {
    throw signInResult.error;
  }

  return client;
};

const signInTherapist = async (context: TenantContext): Promise<TypedClient> => {
  return signInWithPassword(context.email, context.password);
};

const signInAdmin = async (context: AdminContext): Promise<TypedClient> => {
  return signInWithPassword(context.email, context.password);
};

const signInClient = async (context: TenantContext): Promise<TypedClient> => {
  return signInWithPassword(context.clientEmail, context.clientPassword);
};

const expectRlsViolation = (error: PostgrestError | null, fallbackRowCount = 0) => {
  if (error) {
    expect(error.message.toLowerCase()).toMatch(/row-level security|not allowed|permission|violat/);
    return;
  }

  expect(fallbackRowCount).toBe(0);
};

const createTextBlob = (text: string): Blob => {
  return new Blob([text], { type: 'text/plain' });
};

const buildClientDocumentPath = (clientId: string, label: string): string => {
  return `clients/${clientId}/${label}-${Date.now()}.txt`;
};

const ensureTelemetryTableExists = async (tableName: string): Promise<boolean> => {
  if (!serviceClient) {
    return false;
  }

  const { error } = await serviceClient.from(tableName).select('count').limit(1);

  if (!error) {
    return true;
  }

  const message = error.message.toLowerCase();
  if (message.includes('does not exist')) {
    console.warn(`⏭️  Skipping telemetry RLS test - table ${tableName} missing.`);
    return false;
  }

  throw error;
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
  adminContext = await createAdminFixture();

  const { data: existingSettings, error: companyFetchError } = await serviceClient
    .from('company_settings')
    .select('id, company_name')
    .limit(1)
    .maybeSingle();

  if (companyFetchError) {
    throw companyFetchError;
  }

  if (existingSettings) {
    companySettingsId = existingSettings.id;
    originalCompanyName = existingSettings.company_name;
  } else {
    const insertResult = await serviceClient
      .from('company_settings')
      .insert({
        company_name: 'RLS Test Company',
        time_zone: 'UTC',
        date_format: 'MM/dd/yyyy',
        time_format: '12h',
        default_currency: 'USD',
        session_duration_default: 60,
        primary_color: '#000000',
        accent_color: '#FFFFFF',
      })
      .select('id, company_name')
      .single();

    if (insertResult.error || !insertResult.data) {
      throw insertResult.error ?? new Error('Failed to insert company settings for tests');
    }

    companySettingsId = insertResult.data.id;
    originalCompanyName = insertResult.data.company_name;
  }
});

describe('telemetry tables enforce admin-only visibility', () => {
  const telemetryTables = [
    'ai_performance_metrics',
    'db_performance_metrics',
    'system_performance_metrics',
    'performance_alerts',
    'performance_baselines',
    'error_logs',
    'function_performance_logs',
    'ai_processing_logs'
  ] as const;

  telemetryTables.forEach((tableName) => {
    it(`prevents therapists from querying ${tableName}`, async () => {
      if (!runTests || !orgAContext) {
        console.log('⏭️  Skipping RLS test - setup incomplete.');
        return;
      }

      const tableExists = await ensureTelemetryTableExists(tableName);
      if (!tableExists) {
        return;
      }

      const supabaseOrgA = await signInTherapist(orgAContext);
      try {
        const result = await supabaseOrgA
          .from(tableName)
          .select('id')
          .limit(1);

        const affectedRows = Array.isArray(result.data) ? result.data.length : 0;
        expectRlsViolation(result.error, affectedRows);
      } finally {
        await supabaseOrgA.auth.signOut();
      }
    });

    it(`allows admins to query ${tableName}`, async () => {
      if (!runTests || !adminContext) {
        console.log('⏭️  Skipping RLS test - setup incomplete.');
        return;
      }

      const tableExists = await ensureTelemetryTableExists(tableName);
      if (!tableExists) {
        return;
      }

      const adminClient = await signInAdmin(adminContext);
      try {
        const result = await adminClient
          .from(tableName)
          .select('id')
          .limit(1);

        expect(result.error).toBeNull();
      } finally {
        await adminClient.auth.signOut();
      }
    });
  });
});

describe('AI cache and telemetry logs restrict standard users', () => {
  it('prevents therapists from reading the AI response cache', async () => {
    if (!runTests || !orgAContext) {
      console.log('⏭️  Skipping RLS test - setup incomplete.');
      return;
    }

    const tableExists = await ensureTelemetryTableExists('ai_response_cache');
    if (!tableExists) {
      return;
    }

    const supabaseOrgA = await signInTherapist(orgAContext);
    try {
      const result = await supabaseOrgA
        .from('ai_response_cache')
        .select('id')
        .limit(1);

      const affectedRows = Array.isArray(result.data) ? result.data.length : 0;
      expectRlsViolation(result.error, affectedRows);
    } finally {
      await supabaseOrgA.auth.signOut();
    }
  });

  it('prevents therapists from inserting AI response cache entries', async () => {
    if (!runTests || !orgAContext) {
      console.log('⏭️  Skipping RLS test - setup incomplete.');
      return;
    }

    const tableExists = await ensureTelemetryTableExists('ai_response_cache');
    if (!tableExists) {
      return;
    }

    const supabaseOrgA = await signInTherapist(orgAContext);
    try {
      const insertResult = await supabaseOrgA
        .from('ai_response_cache')
        .insert({
          cache_key: `unauthorized-${Date.now()}`,
          query_text: 'SELECT 1',
          response_text: 'forbidden',
          metadata: {},
          expires_at: new Date(Date.now() + 60_000).toISOString(),
        });

      const affectedRows = Array.isArray(insertResult.data) ? insertResult.data.length : 0;
      expectRlsViolation(insertResult.error, affectedRows);
    } finally {
      await supabaseOrgA.auth.signOut();
    }
  });

  it('prevents therapists from inserting function performance log entries', async () => {
    if (!runTests || !orgAContext) {
      console.log('⏭️  Skipping RLS test - setup incomplete.');
      return;
    }

    const tableExists = await ensureTelemetryTableExists('function_performance_logs');
    if (!tableExists) {
      return;
    }

    const supabaseOrgA = await signInTherapist(orgAContext);
    try {
      const insertResult = await supabaseOrgA
        .from('function_performance_logs')
        .insert({
          function_name: 'unauthorized_test',
          execution_time_ms: 10,
          parameters: {},
          result_size: 1,
        });

      const affectedRows = Array.isArray(insertResult.data) ? insertResult.data.length : 0;
      expectRlsViolation(insertResult.error, affectedRows);
    } finally {
      await supabaseOrgA.auth.signOut();
    }
  });
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
    await serviceClient.auth.admin.deleteUser(context.clientUserId);
  }

  if (createdLocationIds.length > 0) {
    await serviceClient.from('locations').delete().in('id', createdLocationIds);
  }

  if (createdServiceLineIds.length > 0) {
    await serviceClient.from('service_lines').delete().in('id', createdServiceLineIds);
  }

  if (createdReferringProviderIds.length > 0) {
    await serviceClient.from('referring_providers').delete().in('id', createdReferringProviderIds);
  }

  if (createdFileCabinetCategoryIds.length > 0) {
    await serviceClient.from('file_cabinet_settings').delete().in('id', createdFileCabinetCategoryIds);
  }

  if (uploadedClientDocumentPaths.length > 0) {
    await serviceClient.storage.from('client-documents').remove(uploadedClientDocumentPaths);
  }

  if (companySettingsId && originalCompanyName !== null) {
    await serviceClient
      .from('company_settings')
      .update({ company_name: originalCompanyName })
      .eq('id', companySettingsId);
  }

  if (adminContext) {
    await serviceClient.auth.admin.deleteUser(adminContext.userId);
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

describe('storage client document access policies', () => {
  it('allows admins to upload and download client documents', async () => {
    if (!runTests || !adminContext || !orgAContext) {
      console.log('⏭️  Skipping RLS test - setup incomplete.');
      return;
    }

    const adminClient = await signInAdmin(adminContext);
    const path = buildClientDocumentPath(orgAContext.clientId, 'admin');
    try {
      const uploadResult = await adminClient.storage
        .from('client-documents')
        .upload(path, createTextBlob('Admin storage test'), {
          contentType: 'text/plain',
          upsert: true,
        });

      expect(uploadResult.error).toBeNull();
      uploadedClientDocumentPaths.push(path);

      const downloadResult = await adminClient.storage.from('client-documents').download(path);
      expect(downloadResult.error).toBeNull();
      if (!downloadResult.data) {
        throw new Error('Expected admin download payload.');
      }

      const downloadedText = await downloadResult.data.text();
      expect(downloadedText).toBe('Admin storage test');
    } finally {
      await adminClient.auth.signOut();
    }
  });

  it('allows assigned therapists to upload and download client documents', async () => {
    if (!runTests || !orgAContext) {
      console.log('⏭️  Skipping RLS test - setup incomplete.');
      return;
    }

    const therapistClient = await signInTherapist(orgAContext);
    const path = buildClientDocumentPath(orgAContext.clientId, 'therapist');
    try {
      const uploadResult = await therapistClient.storage
        .from('client-documents')
        .upload(path, createTextBlob('Therapist storage test'), {
          contentType: 'text/plain',
          upsert: true,
        });

      expect(uploadResult.error).toBeNull();
      uploadedClientDocumentPaths.push(path);

      const downloadResult = await therapistClient.storage.from('client-documents').download(path);
      expect(downloadResult.error).toBeNull();
      if (!downloadResult.data) {
        throw new Error('Expected therapist download payload.');
      }

      const downloadedText = await downloadResult.data.text();
      expect(downloadedText).toBe('Therapist storage test');
    } finally {
      await therapistClient.auth.signOut();
    }
  });

  it('allows clients to upload and download their own documents', async () => {
    if (!runTests || !orgAContext) {
      console.log('⏭️  Skipping RLS test - setup incomplete.');
      return;
    }

    const client = await signInClient(orgAContext);
    const path = buildClientDocumentPath(orgAContext.clientId, 'client');
    try {
      const uploadResult = await client.storage
        .from('client-documents')
        .upload(path, createTextBlob('Client storage test'), {
          contentType: 'text/plain',
          upsert: true,
        });

      expect(uploadResult.error).toBeNull();
      uploadedClientDocumentPaths.push(path);

      const downloadResult = await client.storage.from('client-documents').download(path);
      expect(downloadResult.error).toBeNull();
      if (!downloadResult.data) {
        throw new Error('Expected client download payload.');
      }

      const downloadedText = await downloadResult.data.text();
      expect(downloadedText).toBe('Client storage test');
    } finally {
      await client.auth.signOut();
    }
  });

  it('prevents unrelated therapists from uploading client documents', async () => {
    if (!runTests || !orgAContext || !orgBContext) {
      console.log('⏭️  Skipping RLS test - setup incomplete.');
      return;
    }

    const otherTherapist = await signInTherapist(orgBContext);
    const path = buildClientDocumentPath(orgAContext.clientId, 'unauthorized-upload');
    try {
      const uploadResult = await otherTherapist.storage
        .from('client-documents')
        .upload(path, createTextBlob('Unauthorized storage test'), {
          contentType: 'text/plain',
          upsert: true,
        });

      expect(uploadResult.error).not.toBeNull();
      expect(uploadResult.data).toBeNull();
    } finally {
      await otherTherapist.auth.signOut();
    }
  });

  it('prevents unrelated therapists from downloading client documents', async () => {
    if (!runTests || !orgAContext || !orgBContext || !serviceClient) {
      console.log('⏭️  Skipping RLS test - setup incomplete.');
      return;
    }

    const path = buildClientDocumentPath(orgAContext.clientId, 'protected');
    const seedResult = await serviceClient.storage
      .from('client-documents')
      .upload(path, createTextBlob('Protected content'), {
        contentType: 'text/plain',
        upsert: true,
      });

    if (seedResult.error) {
      throw seedResult.error;
    }

    uploadedClientDocumentPaths.push(path);

    const otherTherapist = await signInTherapist(orgBContext);
    try {
      const downloadResult = await otherTherapist.storage.from('client-documents').download(path);
      expect(downloadResult.error).not.toBeNull();
      expect(downloadResult.data).toBeNull();
    } finally {
      await otherTherapist.auth.signOut();
    }
  });

  it('prevents clients from accessing other client documents', async () => {
    if (!runTests || !orgAContext || !orgBContext || !serviceClient) {
      console.log('⏭️  Skipping RLS test - setup incomplete.');
      return;
    }

    const path = buildClientDocumentPath(orgBContext.clientId, 'restricted');
    const seedResult = await serviceClient.storage
      .from('client-documents')
      .upload(path, createTextBlob('Restricted content'), {
        contentType: 'text/plain',
        upsert: true,
      });

    if (seedResult.error) {
      throw seedResult.error;
    }

    uploadedClientDocumentPaths.push(path);

    const client = await signInClient(orgAContext);
    try {
      const downloadResult = await client.storage.from('client-documents').download(path);
      expect(downloadResult.error).not.toBeNull();
      expect(downloadResult.data).toBeNull();
    } finally {
      await client.auth.signOut();
    }
  });
});

describe('configuration tables enforce admin-only access', () => {
  it('prevents therapists from updating company settings', async () => {
    if (!runTests || !orgAContext || !companySettingsId) {
      console.log('⏭️  Skipping RLS test - setup incomplete.');
      return;
    }

    const supabaseOrgA = await signInTherapist(orgAContext);
    try {
      const result = await supabaseOrgA
        .from('company_settings')
        .update({ company_name: 'Unauthorized Update' })
        .eq('id', companySettingsId)
        .select('id');

      const affectedRows = Array.isArray(result.data) ? result.data.length : 0;
      expectRlsViolation(result.error, affectedRows);
    } finally {
      await supabaseOrgA.auth.signOut();
    }
  });

  it('allows admins to update company settings', async () => {
    if (!runTests || !adminContext || !companySettingsId) {
      console.log('⏭️  Skipping RLS test - setup incomplete.');
      return;
    }

    const adminClient = await signInAdmin(adminContext);
    const newName = `Admin Updated Company ${Date.now()}`;
    try {
      const result = await adminClient
        .from('company_settings')
        .update({ company_name: newName })
        .eq('id', companySettingsId)
        .select('company_name')
        .single();

      expect(result.error).toBeNull();
      expect(result.data?.company_name).toBe(newName);
    } finally {
      await adminClient.auth.signOut();
      if (serviceClient && companySettingsId && originalCompanyName !== null) {
        await serviceClient
          .from('company_settings')
          .update({ company_name: originalCompanyName })
          .eq('id', companySettingsId);
      }
    }
  });

  it('prevents therapists from creating locations', async () => {
    if (!runTests || !orgAContext) {
      console.log('⏭️  Skipping RLS test - setup incomplete.');
      return;
    }

    const supabaseOrgA = await signInTherapist(orgAContext);
    try {
      const result = await supabaseOrgA
        .from('locations')
        .insert({
          name: 'Unauthorized Location',
          type: 'clinic',
          is_active: true,
          operating_hours: {
            monday: { start: '09:00', end: '17:00' },
          },
        })
        .select('id');

      const affectedRows = Array.isArray(result.data) ? result.data.length : 0;
      expectRlsViolation(result.error, affectedRows);
    } finally {
      await supabaseOrgA.auth.signOut();
    }
  });

  it('allows admins to create locations', async () => {
    if (!runTests || !adminContext) {
      console.log('⏭️  Skipping RLS test - setup incomplete.');
      return;
    }

    const adminClient = await signInAdmin(adminContext);
    try {
      const result = await adminClient
        .from('locations')
        .insert({
          name: `Admin Location ${Date.now()}`,
          type: 'clinic',
          address_line1: null,
          city: null,
          state: null,
          zip_code: null,
          phone: null,
          email: null,
          is_active: true,
          operating_hours: {
            monday: { start: '09:00', end: '17:00' },
            tuesday: { start: '09:00', end: '17:00' },
          },
        })
        .select('id')
        .single();

      expect(result.error).toBeNull();
      expect(result.data?.id).toBeTruthy();
      if (result.data?.id) {
        createdLocationIds.push(result.data.id);
      }
    } finally {
      await adminClient.auth.signOut();
    }
  });

  it('prevents therapists from creating service lines', async () => {
    if (!runTests || !orgAContext) {
      console.log('⏭️  Skipping RLS test - setup incomplete.');
      return;
    }

    const supabaseOrgA = await signInTherapist(orgAContext);
    try {
      const result = await supabaseOrgA
        .from('service_lines')
        .insert({
          name: 'Unauthorized Service Line',
          code: 'UNAUTH',
          description: 'Should fail',
          rate_per_hour: 150,
          billable: true,
          requires_authorization: true,
          documentation_required: true,
          available_locations: [],
          is_active: true,
        })
        .select('id');

      const affectedRows = Array.isArray(result.data) ? result.data.length : 0;
      expectRlsViolation(result.error, affectedRows);
    } finally {
      await supabaseOrgA.auth.signOut();
    }
  });

  it('allows admins to create service lines', async () => {
    if (!runTests || !adminContext) {
      console.log('⏭️  Skipping RLS test - setup incomplete.');
      return;
    }

    const adminClient = await signInAdmin(adminContext);
    try {
      const result = await adminClient
        .from('service_lines')
        .insert({
          name: `Admin Service Line ${Date.now()}`,
          code: 'ADMIN',
          description: 'Created via RLS test',
          rate_per_hour: 175,
          billable: true,
          requires_authorization: true,
          documentation_required: true,
          available_locations: [],
          is_active: true,
        })
        .select('id')
        .single();

      expect(result.error).toBeNull();
      expect(result.data?.id).toBeTruthy();
      if (result.data?.id) {
        createdServiceLineIds.push(result.data.id);
      }
    } finally {
      await adminClient.auth.signOut();
    }
  });

  it('prevents therapists from creating referring providers', async () => {
    if (!runTests || !orgAContext) {
      console.log('⏭️  Skipping RLS test - setup incomplete.');
      return;
    }

    const supabaseOrgA = await signInTherapist(orgAContext);
    try {
      const result = await supabaseOrgA
        .from('referring_providers')
        .insert({
          first_name: 'Unauthorized',
          last_name: 'Provider',
          credentials: ['MD'],
          npi_number: '1234567890',
          specialty: 'Other',
          phone: null,
          fax: null,
          email: 'unauthorized@example.com',
          address_line1: null,
          city: null,
          state: null,
          zip_code: null,
          is_active: true,
        })
        .select('id');

      const affectedRows = Array.isArray(result.data) ? result.data.length : 0;
      expectRlsViolation(result.error, affectedRows);
    } finally {
      await supabaseOrgA.auth.signOut();
    }
  });

  it('allows admins to create referring providers', async () => {
    if (!runTests || !adminContext) {
      console.log('⏭️  Skipping RLS test - setup incomplete.');
      return;
    }

    const adminClient = await signInAdmin(adminContext);
    try {
      const result = await adminClient
        .from('referring_providers')
        .insert({
          first_name: 'Admin',
          last_name: `Provider ${Date.now()}`,
          credentials: ['MD'],
          npi_number: '1234567890',
          facility_name: 'Admin Facility',
          specialty: 'Other',
          phone: null,
          fax: null,
          email: `admin.provider.${Date.now()}@example.com`,
          address_line1: null,
          city: null,
          state: null,
          zip_code: null,
          is_active: true,
        })
        .select('id')
        .single();

      expect(result.error).toBeNull();
      expect(result.data?.id).toBeTruthy();
      if (result.data?.id) {
        createdReferringProviderIds.push(result.data.id);
      }
    } finally {
      await adminClient.auth.signOut();
    }
  });

  it('prevents therapists from creating file cabinet settings', async () => {
    if (!runTests || !orgAContext) {
      console.log('⏭️  Skipping RLS test - setup incomplete.');
      return;
    }

    const supabaseOrgA = await signInTherapist(orgAContext);
    try {
      const result = await supabaseOrgA
        .from('file_cabinet_settings')
        .insert({
          category_name: 'Unauthorized Category',
          description: 'Should be blocked',
          allowed_file_types: ['.pdf'],
          max_file_size_mb: 5,
          retention_period_days: 30,
          requires_signature: false,
          is_active: true,
        })
        .select('id');

      const affectedRows = Array.isArray(result.data) ? result.data.length : 0;
      expectRlsViolation(result.error, affectedRows);
    } finally {
      await supabaseOrgA.auth.signOut();
    }
  });

  it('allows admins to create file cabinet settings', async () => {
    if (!runTests || !adminContext) {
      console.log('⏭️  Skipping RLS test - setup incomplete.');
      return;
    }

    const adminClient = await signInAdmin(adminContext);
    try {
      const result = await adminClient
        .from('file_cabinet_settings')
        .insert({
          category_name: `Admin Category ${Date.now()}`,
          description: 'Created via RLS test',
          allowed_file_types: ['.pdf', '.docx'],
          max_file_size_mb: 25,
          retention_period_days: 180,
          requires_signature: false,
          is_active: true,
        })
        .select('id')
        .single();

      expect(result.error).toBeNull();
      expect(result.data?.id).toBeTruthy();
      if (result.data?.id) {
        createdFileCabinetCategoryIds.push(result.data.id);
      }
    } finally {
      await adminClient.auth.signOut();
    }
  });
});

