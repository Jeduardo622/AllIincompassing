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
  organizationId: string;
}

type OrgRecordIds = { orgA: string; orgB: string };

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
let otherAdminContext: AdminContext | null = null;

const createdLocationIds: string[] = [];
const createdServiceLineIds: string[] = [];
const createdReferringProviderIds: string[] = [];
const createdFileCabinetCategoryIds: string[] = [];
const uploadedClientDocumentPaths: string[] = [];
let companySettingsId: string | null = null;
let originalCompanyName: string | null = null;

const createdCptCodeIds: string[] = [];
const createdBillingModifierIds: string[] = [];
const createdBillingRecordIds: string[] = [];
const createdSessionCptEntryIds: string[] = [];
const createdSessionCptModifierIds: string[] = [];
const createdAiCacheIds: string[] = [];
const createdAiSessionNoteIds: string[] = [];
const createdBehavioralPatternIds: string[] = [];
const createdSessionTranscriptIds: string[] = [];
const createdSessionTranscriptSegmentIds: string[] = [];
const createdSessionHoldIds: string[] = [];
const createdUserSessionIds: string[] = [];
const createdConversationIds: string[] = [];
const createdSessionNoteTemplateIds: string[] = [];
const createdAdminActionIds: string[] = [];

let sessionCptEntryIdsByOrg: OrgRecordIds | null = null;
let sessionCptModifierIdsByOrg: OrgRecordIds | null = null;
let billingRecordIdsByOrg: OrgRecordIds | null = null;
let aiSessionNoteIdsByOrg: OrgRecordIds | null = null;
let behavioralPatternIdsByOrg: OrgRecordIds | null = null;
let sessionTranscriptIdsByOrg: OrgRecordIds | null = null;
let userSessionIdsByOrg: OrgRecordIds | null = null;
let aiCacheIdsByOrg: OrgRecordIds | null = null;
let sessionHoldIdsByOrg: OrgRecordIds | null = null;
let conversationIdsByOrg: OrgRecordIds | null = null;
let sessionNoteTemplateIdsByOrg: OrgRecordIds | null = null;
let sessionTranscriptSegmentIdsByOrg: OrgRecordIds | null = null;

const userSessionIdsByUser = new Map<string, string>();

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

  await serviceClient.from('profiles').update({ role: 'therapist' }).eq('id', userId);

  const clientEmail = `${label}.client.${Date.now()}@example.com`;
  const clientPassword = `P@ssw0rd-${Math.random().toString(36).slice(2, 10)}`;

  const { data: createdClientUser, error: clientUserError } = await serviceClient.auth.admin.createUser({
    email: clientEmail,
    password: clientPassword,
    email_confirm: true,
    user_metadata: { organization_id: organizationId },
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
    organization_id: organizationId,
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
    organization_id: organizationId,
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

const createAdminFixture = async (organizationId: string): Promise<AdminContext> => {
  if (!serviceClient) {
    throw new Error('Service client not initialized');
  }

  const email = `admin.${Date.now()}@example.com`;
  const password = `P@ssw0rd-${Math.random().toString(36).slice(2, 10)}`;

  const { data: createdUser, error: createUserError } = await serviceClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { organization_id: organizationId },
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

  return { email, password, userId, organizationId };
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

const randomSuffix = (): string => {
  return Math.random().toString(36).slice(2, 10);
};

const generateCptCode = (): string => {
  return `${Math.floor(10000 + Math.random() * 90000)}`;
};

const generateModifierCode = (): string => {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let index = 0; index < 4; index += 1) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return result;
};

const generateHoldWindow = (
  offsetMinutes = 0,
): { start: string; end: string; expires: string } => {
  const offsetMillis = (offsetMinutes + 5) * 60 * 1000;
  const startDate = new Date(Date.now() + offsetMillis + Math.floor(Math.random() * 1000));
  const endDate = new Date(startDate.getTime() + 30 * 60 * 1000);
  const expiresDate = new Date(startDate.getTime() + 10 * 60 * 1000);

  return {
    start: startDate.toISOString(),
    end: endDate.toISOString(),
    expires: expiresDate.toISOString(),
  };
};

const ensureSessionCptEntriesSeeded = async (): Promise<void> => {
  if (!serviceClient || !orgAContext || !orgBContext || sessionCptEntryIdsByOrg) {
    return;
  }

  const cptCode = generateCptCode();
  const { data: cptRow, error: cptInsertError } = await serviceClient
    .from('cpt_codes')
    .insert({
      code: cptCode,
      short_description: `RLS Test ${cptCode}`,
      long_description: 'Generated for RLS coverage tests',
      service_setting: 'testing',
      typical_duration_minutes: 60,
    })
    .select('id')
    .single();

  if (cptInsertError || !cptRow) {
    throw cptInsertError ?? new Error('Failed to insert CPT code for tests');
  }

  createdCptCodeIds.push(cptRow.id);

  const insertEntryForContext = async (context: TenantContext, label: string) => {
    const { data, error } = await serviceClient
      .from('session_cpt_entries')
      .insert({
        session_id: context.sessionId,
        cpt_code_id: cptRow.id,
        line_number: 1,
        units: 1,
        billed_minutes: 60,
        rate: 120,
        is_primary: true,
        notes: `RLS coverage entry ${label}`,
        organization_id: context.organizationId,
      })
      .select('id')
      .single();

    if (error || !data) {
      throw error ?? new Error('Failed to insert session CPT entry for tests');
    }

    createdSessionCptEntryIds.push(data.id);
    return data.id;
  };

  const orgAId = await insertEntryForContext(orgAContext, 'orgA');
  const orgBId = await insertEntryForContext(orgBContext, 'orgB');

  sessionCptEntryIdsByOrg = { orgA: orgAId, orgB: orgBId };
};

const ensureBillingRecordsSeeded = async (): Promise<void> => {
  if (!serviceClient || !orgAContext || !orgBContext || billingRecordIdsByOrg) {
    return;
  }

  const insertRecordForContext = async (context: TenantContext, label: string) => {
    const { data, error } = await serviceClient
      .from('billing_records')
      .insert({
        session_id: context.sessionId,
        amount: 150,
        status: 'pending',
        organization_id: context.organizationId,
      })
      .select('id')
      .single();

    if (error || !data) {
      throw error ?? new Error(`Failed to insert billing record for ${label}`);
    }

    createdBillingRecordIds.push(data.id);
    return data.id;
  };

  const orgARecordId = await insertRecordForContext(orgAContext, 'orgA');
  const orgBRecordId = await insertRecordForContext(orgBContext, 'orgB');

  billingRecordIdsByOrg = { orgA: orgARecordId, orgB: orgBRecordId };
};

const ensureSessionCptModifiersSeeded = async (): Promise<void> => {
  if (!serviceClient || !orgAContext || !orgBContext || sessionCptModifierIdsByOrg) {
    return;
  }

  await ensureSessionCptEntriesSeeded();

  if (!sessionCptEntryIdsByOrg) {
    throw new Error('Session CPT entries were not seeded before modifier seeding');
  }

  const modifierCode = generateModifierCode();
  const { data: modifierRow, error: modifierInsertError } = await serviceClient
    .from('billing_modifiers')
    .insert({
      code: modifierCode,
      description: 'RLS coverage modifier',
      billing_note: 'Generated during RLS policy coverage tests',
    })
    .select('id')
    .single();

  if (modifierInsertError || !modifierRow) {
    throw modifierInsertError ?? new Error('Failed to insert billing modifier for tests');
  }

  createdBillingModifierIds.push(modifierRow.id);

  const insertModifierForEntry = async (entryId: string, position: number) => {
    const { data, error } = await serviceClient
      .from('session_cpt_modifiers')
      .insert({
        session_cpt_entry_id: entryId,
        modifier_id: modifierRow.id,
        position,
      })
      .select('id')
      .single();

    if (error || !data) {
      throw error ?? new Error('Failed to insert session CPT modifier for tests');
    }

    createdSessionCptModifierIds.push(data.id);
    return data.id;
  };

  const orgAModifierId = await insertModifierForEntry(sessionCptEntryIdsByOrg.orgA, 1);
  const orgBModifierId = await insertModifierForEntry(sessionCptEntryIdsByOrg.orgB, 1);

  sessionCptModifierIdsByOrg = { orgA: orgAModifierId, orgB: orgBModifierId };
};

const ensureAiSessionNotesSeeded = async (): Promise<void> => {
  if (!serviceClient || !orgAContext || !orgBContext || aiSessionNoteIdsByOrg) {
    return;
  }

  const insertNoteForContext = async (context: TenantContext, label: string) => {
    const start = new Date();
    const end = new Date(start.getTime() + 45 * 60 * 1000);

    const { data, error } = await serviceClient
      .from('ai_session_notes')
      .insert({
        session_id: context.sessionId,
        therapist_id: context.therapistId,
        client_id: context.clientId,
        session_date: start.toISOString(),
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        session_duration: 45,
        ai_generated_summary: `Automated summary ${label}`,
        ai_confidence_score: 0.88,
        participants: ['therapist', 'client'],
        manual_edits: [],
        recommendations: [`Follow-up ${label}`],
      })
      .select('id')
      .single();

    if (error || !data) {
      throw error ?? new Error('Failed to insert AI session note for tests');
    }

    createdAiSessionNoteIds.push(data.id);
    return data.id;
  };

  const orgANoteId = await insertNoteForContext(orgAContext, 'orgA');
  const orgBNoteId = await insertNoteForContext(orgBContext, 'orgB');

  aiSessionNoteIdsByOrg = { orgA: orgANoteId, orgB: orgBNoteId };
};

const ensureBehavioralPatternsSeeded = async (): Promise<void> => {
  if (!serviceClient || !orgAContext || !orgBContext || behavioralPatternIdsByOrg) {
    return;
  }

  const insertPatternForContext = async (context: TenantContext, label: string) => {
    const { data, error } = await serviceClient
      .from('behavioral_patterns')
      .insert({
        pattern_name: `RLS Pattern ${label} ${randomSuffix()}`,
        pattern_type: 'aba',
        regex_pattern: `^${label}-${randomSuffix()}$`,
        created_by: context.therapistId,
        confidence_weight: 0.75,
        is_active: true,
      })
      .select('id')
      .single();

    if (error || !data) {
      throw error ?? new Error('Failed to insert behavioral pattern for tests');
    }

    createdBehavioralPatternIds.push(data.id);
    return data.id;
  };

  const orgAPatternId = await insertPatternForContext(orgAContext, 'orgA');
  const orgBPatternId = await insertPatternForContext(orgBContext, 'orgB');

  behavioralPatternIdsByOrg = { orgA: orgAPatternId, orgB: orgBPatternId };
};

const ensureSessionTranscriptsSeeded = async (): Promise<void> => {
  if (!serviceClient || !orgAContext || !orgBContext || sessionTranscriptIdsByOrg) {
    return;
  }

  const insertTranscriptForContext = async (context: TenantContext, label: string) => {
    const { data, error } = await serviceClient
      .from('session_transcripts')
      .insert({
        session_id: context.sessionId,
        processed_transcript: `Processed transcript for ${label}`,
        raw_transcript: `Raw transcript for ${label}`,
        confidence_score: 0.93,
      })
      .select('id')
      .single();

    if (error || !data) {
      throw error ?? new Error('Failed to insert session transcript for tests');
    }

    createdSessionTranscriptIds.push(data.id);
    return data.id;
  };

  const orgATranscriptId = await insertTranscriptForContext(orgAContext, 'orgA');
  const orgBTranscriptId = await insertTranscriptForContext(orgBContext, 'orgB');

  sessionTranscriptIdsByOrg = { orgA: orgATranscriptId, orgB: orgBTranscriptId };
};

const ensureSessionHoldsSeeded = async (): Promise<void> => {
  if (!serviceClient || !orgAContext || !orgBContext || sessionHoldIdsByOrg) {
    return;
  }

  const insertHoldForContext = async (context: TenantContext, offsetMinutes: number) => {
    const { start, end, expires } = generateHoldWindow(offsetMinutes);
    const { data, error } = await serviceClient
      .from('session_holds')
      .insert({
        therapist_id: context.therapistId,
        client_id: context.clientId,
        start_time: start,
        end_time: end,
        hold_key: randomUUID(),
        expires_at: expires,
      })
      .select('id')
      .single();

    if (error || !data) {
      throw error ?? new Error('Failed to insert session hold for tests');
    }

    createdSessionHoldIds.push(data.id);
    return data.id;
  };

  const orgAHoldId = await insertHoldForContext(orgAContext, 120);
  const orgBHoldId = await insertHoldForContext(orgBContext, 180);

  sessionHoldIdsByOrg = { orgA: orgAHoldId, orgB: orgBHoldId };
};

const ensureUserSessionsSeeded = async (): Promise<void> => {
  if (!serviceClient || !orgAContext || !orgBContext || userSessionIdsByOrg) {
    return;
  }

  const insertUserSessionForContext = async (context: TenantContext, label: string) => {
    const { data, error } = await serviceClient
      .from('user_sessions')
      .insert({
        user_id: context.userId,
        session_token: `token-${label}-${randomSuffix()}`,
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        is_active: true,
        user_agent: `vitest/${label}`,
      })
      .select('id, user_id')
      .single();

    if (error || !data) {
      throw error ?? new Error('Failed to insert user session for tests');
    }

    createdUserSessionIds.push(data.id);
    userSessionIdsByUser.set(context.userId, data.id);
    return data.id;
  };

  const orgAUserSessionId = await insertUserSessionForContext(orgAContext, 'orgA');
  const orgBUserSessionId = await insertUserSessionForContext(orgBContext, 'orgB');

  userSessionIdsByOrg = { orgA: orgAUserSessionId, orgB: orgBUserSessionId };
};

const ensureAiCacheSeeded = async (): Promise<void> => {
  if (!serviceClient || !orgAContext || !orgBContext || aiCacheIdsByOrg) {
    return;
  }

  const insertCacheRow = async (label: string) => {
    const { data, error } = await serviceClient
      .from('ai_cache')
      .insert({
        function_name: `generate_plan_${label}`,
        input_hash: `hash-${label}-${randomSuffix()}`,
        response_data: { source: 'rls-tests', label },
        expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      })
      .select('id')
      .single();

    if (error || !data) {
      throw error ?? new Error('Failed to insert AI cache row for tests');
    }

    createdAiCacheIds.push(data.id);
    return data.id;
  };

  const orgACacheId = await insertCacheRow('orgA');
  const orgBCacheId = await insertCacheRow('orgB');

  aiCacheIdsByOrg = { orgA: orgACacheId, orgB: orgBCacheId };
};

const ensureConversationsSeeded = async (): Promise<void> => {
  if (!serviceClient || !orgAContext || !orgBContext || conversationIdsByOrg) {
    return;
  }

  const insertConversationForContext = async (context: TenantContext, label: string) => {
    const { data, error } = await serviceClient
      .from('conversations')
      .insert({
        user_id: context.userId,
        title: `RLS Conversation ${label}`,
        metadata: { label, source: 'rls-tests' },
      })
      .select('id')
      .single();

    if (error || !data) {
      throw error ?? new Error('Failed to insert conversation for tests');
    }

    createdConversationIds.push(data.id);
    return data.id;
  };

  const orgAConversationId = await insertConversationForContext(orgAContext, 'orgA');
  const orgBConversationId = await insertConversationForContext(orgBContext, 'orgB');

  conversationIdsByOrg = { orgA: orgAConversationId, orgB: orgBConversationId };
};

const ensureSessionNoteTemplatesSeeded = async (): Promise<void> => {
  if (!serviceClient || !orgAContext || !orgBContext || sessionNoteTemplateIdsByOrg) {
    return;
  }

  const insertTemplateForContext = async (context: TenantContext, label: string) => {
    const { data, error } = await serviceClient
      .from('session_note_templates')
      .insert({
        template_name: `RLS Template ${label}`,
        template_type: 'progress_note',
        template_structure: { sections: ['summary'] },
        created_by: context.therapistId,
        compliance_requirements: { region: 'test' },
      })
      .select('id')
      .single();

    if (error || !data) {
      throw error ?? new Error('Failed to insert session note template for tests');
    }

    createdSessionNoteTemplateIds.push(data.id);
    return data.id;
  };

  const orgATemplateId = await insertTemplateForContext(orgAContext, 'orgA');
  const orgBTemplateId = await insertTemplateForContext(orgBContext, 'orgB');

  sessionNoteTemplateIdsByOrg = { orgA: orgATemplateId, orgB: orgBTemplateId };
};

const ensureSessionTranscriptSegmentsSeeded = async (): Promise<void> => {
  if (!serviceClient || !orgAContext || !orgBContext || sessionTranscriptSegmentIdsByOrg) {
    return;
  }

  await ensureSessionTranscriptsSeeded();

  if (!sessionTranscriptIdsByOrg) {
    throw new Error('Session transcripts must be seeded before segments');
  }

  const insertSegmentForTranscript = async (transcriptId: string, offset: number) => {
    const { data, error } = await serviceClient
      .from('session_transcript_segments')
      .insert({
        session_id: transcriptId,
        start_time: offset,
        end_time: offset + 10,
        speaker: 'therapist',
        text: `Segment ${offset} generated for RLS tests`,
        behavioral_markers: { markers: ['engagement'] },
        confidence: 0.9,
      })
      .select('id')
      .single();

    if (error || !data) {
      throw error ?? new Error('Failed to insert session transcript segment for tests');
    }

    createdSessionTranscriptSegmentIds.push(data.id);
    return data.id;
  };

  const orgASegmentId = await insertSegmentForTranscript(sessionTranscriptIdsByOrg.orgA, 0);
  const orgBSegmentId = await insertSegmentForTranscript(sessionTranscriptIdsByOrg.orgB, 0);

  sessionTranscriptSegmentIdsByOrg = { orgA: orgASegmentId, orgB: orgBSegmentId };
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
  adminContext = await createAdminFixture(orgAId);
  otherAdminContext = await createAdminFixture(orgBId);

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
    const userSessionId = userSessionIdsByUser.get(context.userId);
    if (userSessionId) {
      await serviceClient.from('user_sessions').delete().eq('id', userSessionId);
      userSessionIdsByUser.delete(context.userId);
      const index = createdUserSessionIds.indexOf(userSessionId);
      if (index >= 0) {
        createdUserSessionIds.splice(index, 1);
      }
    }

    await serviceClient.from('sessions').delete().eq('id', context.sessionId);
    await serviceClient.from('clients').delete().eq('id', context.clientId);
    await serviceClient.from('user_therapist_links').delete().eq('user_id', context.userId);
    await serviceClient.from('therapists').delete().eq('id', context.therapistId);
    await serviceClient.auth.admin.deleteUser(context.userId);
    await serviceClient.auth.admin.deleteUser(context.clientUserId);
  }

  if (createdSessionHoldIds.length > 0) {
    await serviceClient.from('session_holds').delete().in('id', createdSessionHoldIds);
  }

  if (createdSessionCptModifierIds.length > 0) {
    await serviceClient.from('session_cpt_modifiers').delete().in('id', createdSessionCptModifierIds);
  }

  if (createdBillingRecordIds.length > 0) {
    await serviceClient.from('billing_records').delete().in('id', createdBillingRecordIds);
  }

  if (createdSessionCptEntryIds.length > 0) {
    await serviceClient.from('session_cpt_entries').delete().in('id', createdSessionCptEntryIds);
  }

  if (createdAiSessionNoteIds.length > 0) {
    await serviceClient.from('ai_session_notes').delete().in('id', createdAiSessionNoteIds);
  }

  if (createdSessionNoteTemplateIds.length > 0) {
    await serviceClient.from('session_note_templates').delete().in('id', createdSessionNoteTemplateIds);
  }

  if (createdBehavioralPatternIds.length > 0) {
    await serviceClient.from('behavioral_patterns').delete().in('id', createdBehavioralPatternIds);
  }

  if (createdSessionTranscriptSegmentIds.length > 0) {
    await serviceClient
      .from('session_transcript_segments')
      .delete()
      .in('id', createdSessionTranscriptSegmentIds);
  }

  if (createdSessionTranscriptIds.length > 0) {
    await serviceClient.from('session_transcripts').delete().in('id', createdSessionTranscriptIds);
  }

  if (createdAiCacheIds.length > 0) {
    await serviceClient.from('ai_cache').delete().in('id', createdAiCacheIds);
  }

  if (createdUserSessionIds.length > 0) {
    await serviceClient.from('user_sessions').delete().in('id', createdUserSessionIds);
  }

  if (createdConversationIds.length > 0) {
    await serviceClient.from('conversations').delete().in('id', createdConversationIds);
  }

  if (createdCptCodeIds.length > 0) {
    await serviceClient.from('cpt_codes').delete().in('id', createdCptCodeIds);
  }

  if (createdBillingModifierIds.length > 0) {
    await serviceClient.from('billing_modifiers').delete().in('id', createdBillingModifierIds);
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

  if (otherAdminContext) {
    await serviceClient.auth.admin.deleteUser(otherAdminContext.userId);
  }

  if (createdAdminActionIds.length > 0) {
    await serviceClient.from('admin_actions').delete().in('id', createdAdminActionIds);
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

  it('prevents admins from reading other organization clients', async () => {
    if (!runTests || !adminContext || !orgBContext) {
      console.log('⏭️  Skipping RLS test - setup incomplete.');
      return;
    }

    const supabaseAdmin = await signInAdmin(adminContext);
    try {
      const { data, error } = await supabaseAdmin
        .from('clients')
        .select('id')
        .eq('id', orgBContext.clientId);

      expect(error).toBeNull();
      expect(Array.isArray(data)).toBe(true);
      expect(data).toHaveLength(0);
    } finally {
      await supabaseAdmin.auth.signOut();
    }
  });

  it('prevents admins from reading other organization therapists', async () => {
    if (!runTests || !adminContext || !orgBContext) {
      console.log('⏭️  Skipping RLS test - setup incomplete.');
      return;
    }

    const supabaseAdmin = await signInAdmin(adminContext);
    try {
      const { data, error } = await supabaseAdmin
        .from('therapists')
        .select('id')
        .eq('id', orgBContext.therapistId);

      expect(error).toBeNull();
      expect(Array.isArray(data)).toBe(true);
      expect(data).toHaveLength(0);
    } finally {
      await supabaseAdmin.auth.signOut();
    }
  });

  it('prevents admins from reading other organization sessions', async () => {
    if (!runTests || !adminContext || !orgBContext) {
      console.log('⏭️  Skipping RLS test - setup incomplete.');
      return;
    }

    const supabaseAdmin = await signInAdmin(adminContext);
    try {
      const { data, error } = await supabaseAdmin
        .from('sessions')
        .select('id')
        .eq('id', orgBContext.sessionId);

      expect(error).toBeNull();
      expect(Array.isArray(data)).toBe(true);
      expect(data).toHaveLength(0);
    } finally {
      await supabaseAdmin.auth.signOut();
    }
  });

  it('prevents admins from reading other organization billing records', async () => {
    if (!runTests || !adminContext || !orgAContext || !orgBContext) {
      console.log('⏭️  Skipping RLS test - setup incomplete.');
      return;
    }

    await ensureBillingRecordsSeeded();
    if (!billingRecordIdsByOrg) {
      throw new Error('Billing records were not seeded');
    }

    const supabaseAdmin = await signInAdmin(adminContext);
    try {
      const { data, error } = await supabaseAdmin
        .from('billing_records')
        .select('id')
        .eq('id', billingRecordIdsByOrg.orgB);

      expect(error).toBeNull();
      expect(Array.isArray(data)).toBe(true);
      expect(data).toHaveLength(0);
    } finally {
      await supabaseAdmin.auth.signOut();
    }
  });

  it('prevents admins from reading other organization session CPT entries', async () => {
    if (!runTests || !adminContext || !orgAContext || !orgBContext) {
      console.log('⏭️  Skipping RLS test - setup incomplete.');
      return;
    }

    await ensureSessionCptEntriesSeeded();
    if (!sessionCptEntryIdsByOrg) {
      throw new Error('Session CPT entries were not seeded');
    }

    const supabaseAdmin = await signInAdmin(adminContext);
    try {
      const { data, error } = await supabaseAdmin
        .from('session_cpt_entries')
        .select('id')
        .eq('id', sessionCptEntryIdsByOrg.orgB);

      expect(error).toBeNull();
      expect(Array.isArray(data)).toBe(true);
      expect(data).toHaveLength(0);
    } finally {
      await supabaseAdmin.auth.signOut();
    }
  });
});

describe('user_profiles row level security', () => {
  it('prevents anonymous clients from reading user profiles', async () => {
    if (!runTests) {
      console.log('⏭️  Skipping user_profiles anonymous access test - setup incomplete.');
      return;
    }

    const anonymousClient = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const result = await anonymousClient
      .from('user_profiles')
      .select('id')
      .limit(1);

    const rowCount = Array.isArray(result.data) ? result.data.length : 0;
    expectRlsViolation(result.error, rowCount);
  });

  it('prevents therapists from updating other user profiles', async () => {
    if (!runTests || !orgAContext || !orgBContext || !serviceClient) {
      console.log('⏭️  Skipping user_profiles cross-tenant update test - setup incomplete.');
      return;
    }

    const { data: targetProfile, error: targetError } = await serviceClient
      .from('user_profiles')
      .select('id')
      .eq('id', orgBContext.userId)
      .maybeSingle();

    if (targetError) {
      console.warn(
        '⏭️  Skipping user_profiles cross-tenant update test - service query failed.',
        targetError.message,
      );
      return;
    }

    if (!targetProfile) {
      console.warn('⏭️  Skipping user_profiles cross-tenant update test - target profile missing.');
      return;
    }

    const supabaseOrgA = await signInTherapist(orgAContext);
    try {
      const result = await supabaseOrgA
        .from('user_profiles')
        .update({ full_name: 'Unauthorized Update Attempt' })
        .eq('id', orgBContext.userId)
        .select('id');

      const affectedRows = Array.isArray(result.data) ? result.data.length : 0;
      expectRlsViolation(result.error, affectedRows);
    } finally {
      await supabaseOrgA.auth.signOut();
    }
  });
});

describe('session holds enforce role-scoped access', () => {
  beforeAll(async () => {
    if (!runTests || !serviceClient || !orgAContext || !orgBContext) {
      return;
    }

    await ensureSessionHoldsSeeded();
  });

  it('allows admins to manage session holds for any therapist', async () => {
    if (!runTests || !adminContext || !orgAContext || !orgBContext || !sessionHoldIdsByOrg) {
      console.log('⏭️  Skipping RLS test - setup incomplete.');
      return;
    }

    const adminClient = await signInAdmin(adminContext);
    let insertedHoldId: string | null = null;

    try {
      const existingHoldResult = await adminClient
        .from('session_holds')
        .select('id, therapist_id')
        .eq('id', sessionHoldIdsByOrg.orgB)
        .single();

      expect(existingHoldResult.error).toBeNull();
      expect(existingHoldResult.data?.therapist_id).toBe(orgBContext.therapistId);

      const { start, end, expires } = generateHoldWindow(240);
      const insertResult = await adminClient
        .from('session_holds')
        .insert({
          therapist_id: orgAContext.therapistId,
          client_id: orgAContext.clientId,
          start_time: start,
          end_time: end,
          hold_key: randomUUID(),
          expires_at: expires,
        })
        .select('id, end_time')
        .single();

      expect(insertResult.error).toBeNull();
      const insertedHold = insertResult.data;
      if (!insertedHold) {
        throw new Error('Failed to insert session hold as admin');
      }

      insertedHoldId = insertedHold.id;
      createdSessionHoldIds.push(insertedHoldId);

      const newEndTime = new Date(new Date(end).getTime() + 15 * 60 * 1000).toISOString();
      const updateResult = await adminClient
        .from('session_holds')
        .update({ end_time: newEndTime })
        .eq('id', insertedHoldId)
        .select('end_time')
        .single();

      expect(updateResult.error).toBeNull();
      expect(updateResult.data?.end_time).toBe(newEndTime);

      const deleteResult = await adminClient
        .from('session_holds')
        .delete()
        .eq('id', insertedHoldId)
        .select('id')
        .single();

      expect(deleteResult.error).toBeNull();
      insertedHoldId = null;
    } finally {
      if (insertedHoldId && serviceClient) {
        await serviceClient.from('session_holds').delete().eq('id', insertedHoldId);
      }
      await adminClient.auth.signOut();
    }
  });

  it('prevents therapists from viewing other therapists session holds', async () => {
    if (!runTests || !orgAContext || !sessionHoldIdsByOrg) {
      console.log('⏭️  Skipping RLS test - setup incomplete.');
      return;
    }

    const supabaseOrgA = await signInTherapist(orgAContext);
    try {
      const { data, error } = await supabaseOrgA
        .from('session_holds')
        .select('id')
        .eq('id', sessionHoldIdsByOrg.orgB);

      expect(error).toBeNull();
      expect(Array.isArray(data)).toBe(true);
      expect(data).toHaveLength(0);
    } finally {
      await supabaseOrgA.auth.signOut();
    }
  });

  it('prevents therapists from inserting session holds for other therapists', async () => {
    if (!runTests || !orgAContext || !orgBContext) {
      console.log('⏭️  Skipping RLS test - setup incomplete.');
      return;
    }

    const supabaseOrgA = await signInTherapist(orgAContext);
    try {
      const { start, end, expires } = generateHoldWindow(300);
      const insertResult = await supabaseOrgA
        .from('session_holds')
        .insert({
          therapist_id: orgBContext.therapistId,
          client_id: orgBContext.clientId,
          start_time: start,
          end_time: end,
          hold_key: randomUUID(),
          expires_at: expires,
        })
        .select('id');

      const affectedRows = Array.isArray(insertResult.data) ? insertResult.data.length : 0;
      expectRlsViolation(insertResult.error, affectedRows);
    } finally {
      await supabaseOrgA.auth.signOut();
    }
  });

  it('allows therapists to insert, update, and delete their own session holds', async () => {
    if (!runTests || !orgAContext) {
      console.log('⏭️  Skipping RLS test - setup incomplete.');
      return;
    }

    const supabaseOrgA = await signInTherapist(orgAContext);
    let therapistHoldId: string | null = null;

    try {
      const { start, end, expires } = generateHoldWindow(360);
      const insertResult = await supabaseOrgA
        .from('session_holds')
        .insert({
          therapist_id: orgAContext.therapistId,
          client_id: orgAContext.clientId,
          start_time: start,
          end_time: end,
          hold_key: randomUUID(),
          expires_at: expires,
        })
        .select('id, end_time')
        .single();

      expect(insertResult.error).toBeNull();
      const insertedHold = insertResult.data;
      if (!insertedHold) {
        throw new Error('Failed to insert session hold for therapist');
      }

      therapistHoldId = insertedHold.id;
      createdSessionHoldIds.push(insertedHold.id);

      const updatedEnd = new Date(new Date(end).getTime() + 5 * 60 * 1000).toISOString();
      const updateResult = await supabaseOrgA
        .from('session_holds')
        .update({ end_time: updatedEnd })
        .eq('id', therapistHoldId)
        .select('end_time')
        .single();

      expect(updateResult.error).toBeNull();
      expect(updateResult.data?.end_time).toBe(updatedEnd);

      const deleteResult = await supabaseOrgA
        .from('session_holds')
        .delete()
        .eq('id', therapistHoldId)
        .select('id')
        .single();

      expect(deleteResult.error).toBeNull();
      therapistHoldId = null;
    } finally {
      if (therapistHoldId && serviceClient) {
        await serviceClient.from('session_holds').delete().eq('id', therapistHoldId);
      }
      await supabaseOrgA.auth.signOut();
    }
  });

  it('prevents therapists from updating other therapists session holds', async () => {
    if (!runTests || !orgAContext || !sessionHoldIdsByOrg) {
      console.log('⏭️  Skipping RLS test - setup incomplete.');
      return;
    }

    const supabaseOrgA = await signInTherapist(orgAContext);
    try {
      const updateResult = await supabaseOrgA
        .from('session_holds')
        .update({ expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString() })
        .eq('id', sessionHoldIdsByOrg.orgB)
        .select('id');

      const affectedRows = Array.isArray(updateResult.data) ? updateResult.data.length : 0;
      expectRlsViolation(updateResult.error, affectedRows);
    } finally {
      await supabaseOrgA.auth.signOut();
    }
  });

  it('prevents therapists from deleting other therapists session holds', async () => {
    if (!runTests || !orgAContext || !sessionHoldIdsByOrg) {
      console.log('⏭️  Skipping RLS test - setup incomplete.');
      return;
    }

    const supabaseOrgA = await signInTherapist(orgAContext);
    try {
      const deleteResult = await supabaseOrgA
        .from('session_holds')
        .delete()
        .eq('id', sessionHoldIdsByOrg.orgB)
        .select('id');

      const affectedRows = Array.isArray(deleteResult.data) ? deleteResult.data.length : 0;
      expectRlsViolation(deleteResult.error, affectedRows);
    } finally {
      await supabaseOrgA.auth.signOut();
    }
  });

  it('prevents therapists from reassigning session holds to other therapists', async () => {
    if (!runTests || !orgAContext || !orgBContext || !sessionHoldIdsByOrg) {
      console.log('⏭️  Skipping RLS test - setup incomplete.');
      return;
    }

    const supabaseOrgA = await signInTherapist(orgAContext);
    try {
      const updateResult = await supabaseOrgA
        .from('session_holds')
        .update({ therapist_id: orgBContext.therapistId })
        .eq('id', sessionHoldIdsByOrg.orgA)
        .select('id');

      const affectedRows = Array.isArray(updateResult.data) ? updateResult.data.length : 0;
      expectRlsViolation(updateResult.error, affectedRows);
    } finally {
      await supabaseOrgA.auth.signOut();
    }
  });
});

describe('admin action logs enforce admin-only access', () => {
  it('prevents therapists from reading admin action logs', async () => {
    if (!runTests || !orgAContext) {
      console.log('⏭️  Skipping admin action RLS test - setup incomplete.');
      return;
    }

    const therapistClient = await signInTherapist(orgAContext);
    try {
      const result = await therapistClient.from('admin_actions').select('id').limit(1);
      const affectedRows = Array.isArray(result.data) ? result.data.length : 0;
      expectRlsViolation(result.error, affectedRows);
    } finally {
      await therapistClient.auth.signOut();
    }
  });

  it('allows admins to insert and read admin action logs', async () => {
    if (!runTests || !adminContext) {
      console.log('⏭️  Skipping admin action allow test - setup incomplete.');
      return;
    }

    const adminClient = await signInAdmin(adminContext);
    let insertedActionId: string | null = null;

    try {
      const insertResult = await adminClient
        .from('admin_actions')
        .insert({
          admin_user_id: adminContext.userId,
          action_type: 'rls-test',
          target_user_id: adminContext.userId,
          action_details: { scope: 'rls', message: 'admin verification' },
        })
        .select('id, admin_user_id')
        .single();

      expect(insertResult.error).toBeNull();
      const inserted = insertResult.data;
      expect(inserted?.admin_user_id).toBe(adminContext.userId);

      if (inserted?.id) {
        insertedActionId = inserted.id;
        createdAdminActionIds.push(inserted.id);
      }

      if (!insertedActionId) {
        throw new Error('Expected admin action id to be returned');
      }

      const selectResult = await adminClient
        .from('admin_actions')
        .select('id, admin_user_id')
        .eq('id', insertedActionId)
        .single();

      expect(selectResult.error).toBeNull();
      expect(selectResult.data?.admin_user_id).toBe(adminContext.userId);
    } finally {
      await adminClient.auth.signOut();
    }
  });
});

describe('session artifacts enforce tenant isolation', () => {
  type OrgScopedConfig = {
    table: keyof Database['public']['Tables'];
    label: string;
    seed: () => Promise<void>;
    getIds: () => OrgRecordIds | null;
    allowsAssignedTherapist?: boolean;
    allowsAdmin?: boolean;
    enforceAdminIsolation?: boolean;
  };

  const orgScopedConfigs: OrgScopedConfig[] = [
    {
      table: 'session_cpt_entries',
      label: 'session CPT entries',
      seed: ensureSessionCptEntriesSeeded,
      getIds: () => sessionCptEntryIdsByOrg,
    },
    {
      table: 'session_cpt_modifiers',
      label: 'session CPT modifiers',
      seed: ensureSessionCptModifiersSeeded,
      getIds: () => sessionCptModifierIdsByOrg,
    },
    {
      table: 'ai_session_notes',
      label: 'AI session notes',
      seed: ensureAiSessionNotesSeeded,
      getIds: () => aiSessionNoteIdsByOrg,
    },
    {
      table: 'behavioral_patterns',
      label: 'behavioral patterns',
      seed: ensureBehavioralPatternsSeeded,
      getIds: () => behavioralPatternIdsByOrg,
      enforceAdminIsolation: true,
    },
    {
      table: 'session_note_templates',
      label: 'session note templates',
      seed: ensureSessionNoteTemplatesSeeded,
      getIds: () => sessionNoteTemplateIdsByOrg,
      enforceAdminIsolation: true,
    },
    {
      table: 'session_transcripts',
      label: 'session transcripts',
      seed: ensureSessionTranscriptsSeeded,
      getIds: () => sessionTranscriptIdsByOrg,
      enforceAdminIsolation: true,
    },
    {
      table: 'session_transcript_segments',
      label: 'session transcript segments',
      seed: ensureSessionTranscriptSegmentsSeeded,
      getIds: () => sessionTranscriptSegmentIdsByOrg,
      enforceAdminIsolation: true,
    },
    {
      table: 'user_sessions',
      label: 'user sessions',
      seed: ensureUserSessionsSeeded,
      getIds: () => userSessionIdsByOrg,
    },
    {
      table: 'conversations',
      label: 'chat conversations',
      seed: ensureConversationsSeeded,
      getIds: () => conversationIdsByOrg,
    },
    {
      table: 'ai_cache',
      label: 'AI cache entries',
      seed: ensureAiCacheSeeded,
      getIds: () => aiCacheIdsByOrg,
      allowsAssignedTherapist: false,
    },
  ];

  beforeAll(async () => {
    if (!runTests || !serviceClient || !orgAContext || !orgBContext) {
      return;
    }

    for (const config of orgScopedConfigs) {
      await config.seed();
    }
  });

  orgScopedConfigs.forEach((config) => {
    it(`prevents therapists from reading other organization ${config.label}`, async () => {
      if (!runTests || !orgAContext || !orgBContext) {
        console.log('⏭️  Skipping RLS test - setup incomplete.');
        return;
      }

      const recordIds = config.getIds();
      if (!recordIds) {
        console.log(`⏭️  Skipping ${config.table} RLS test - seed data unavailable.`);
        return;
      }

      const supabaseOrgB = await signInTherapist(orgBContext);
      try {
        const result = await supabaseOrgB
          .from(config.table)
          .select('id')
          .eq('id', recordIds.orgA)
          .maybeSingle();

        if (result.error) {
          expectRlsViolation(result.error);
          return;
        }

        expect(result.data).toBeNull();
      } finally {
        await supabaseOrgB.auth.signOut();
      }
    });

    if (config.allowsAssignedTherapist !== false) {
      it(`allows assigned therapists to access their ${config.label}`, async () => {
        if (!runTests || !orgAContext) {
          console.log('⏭️  Skipping RLS test - setup incomplete.');
          return;
        }

        const recordIds = config.getIds();
        if (!recordIds) {
          console.log(`⏭️  Skipping ${config.table} allow test - seed data unavailable.`);
          return;
        }

        const supabaseOrgA = await signInTherapist(orgAContext);
        try {
          const result = await supabaseOrgA
            .from(config.table)
            .select('id')
            .eq('id', recordIds.orgA)
            .maybeSingle();

          expect(result.error).toBeNull();
          expect(result.data?.id).toBe(recordIds.orgA);
        } finally {
          await supabaseOrgA.auth.signOut();
        }
      });
    }

    if (config.enforceAdminIsolation) {
      it(`prevents admins from other organizations from reading ${config.label}`, async () => {
        if (!runTests || !otherAdminContext) {
          console.log('⏭️  Skipping RLS test - setup incomplete.');
          return;
        }

        const recordIds = config.getIds();
        if (!recordIds) {
          console.log(`⏭️  Skipping ${config.table} cross-org admin test - seed data unavailable.`);
          return;
        }

        const adminClient = await signInAdmin(otherAdminContext);
        try {
          const result = await adminClient
            .from(config.table)
            .select('id')
            .eq('id', recordIds.orgA)
            .maybeSingle();

          if (result.error) {
            expectRlsViolation(result.error);
            return;
          }

          expect(result.data).toBeNull();
        } finally {
          await adminClient.auth.signOut();
        }
      });
    }

    if (config.allowsAdmin !== false) {
      it(`allows admins to access ${config.label}`, async () => {
        if (!runTests || !adminContext) {
          console.log('⏭️  Skipping RLS test - setup incomplete.');
          return;
        }

        const recordIds = config.getIds();
        if (!recordIds) {
          console.log(`⏭️  Skipping ${config.table} admin test - seed data unavailable.`);
          return;
        }

        const adminClient = await signInAdmin(adminContext);
        try {
          const result = await adminClient
            .from(config.table)
            .select('id')
            .eq('id', recordIds.orgA)
            .maybeSingle();

          expect(result.error).toBeNull();
          expect(result.data?.id).toBe(recordIds.orgA);
        } finally {
          await adminClient.auth.signOut();
        }
      });
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
