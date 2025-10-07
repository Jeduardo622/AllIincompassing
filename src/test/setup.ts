import { vi, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import '@testing-library/jest-dom';
import { installConsoleGuard } from './utils/consoleGuard';
import { setRuntimeSupabaseConfig } from '../lib/runtimeConfig';

if (!process.env.RUN_CLIENT_DOMAIN_TESTS) {
  process.env.RUN_CLIENT_DOMAIN_TESTS = 'true';
}

const ORG_A_TEST_TOKEN = 'test-org-a-jwt-placeholder';
const ORG_B_TEST_TOKEN = 'test-org-b-jwt-placeholder';
const SUPER_ADMIN_TEST_TOKEN = 'test-super-admin-jwt-placeholder';
const ORG_A_PLACEHOLDER_ID = 'org-a-placeholder-id';
const ORG_B_PLACEHOLDER_ID = 'org-b-placeholder-id';
const ARCHIVE_TIMESTAMP = '2025-03-18T09:00:00Z';

const isOrgAToken = (token: string): boolean => (
  token === ORG_A_TEST_TOKEN || token === SUPER_ADMIN_TEST_TOKEN
);

const isOrgBToken = (token: string): boolean => token === ORG_B_TEST_TOKEN;

const archiveState = {
  client: {
    id: 'client-1',
    organizationId: ORG_A_PLACEHOLDER_ID,
    deletedAt: null as string | null,
  },
  therapist: {
    id: 'therapist-1',
    organizationId: ORG_A_PLACEHOLDER_ID,
    deletedAt: null as string | null,
  },
};

if (!process.env.TEST_JWT_ORG_A) {
  process.env.TEST_JWT_ORG_A = ORG_A_TEST_TOKEN;
}

if (!process.env.TEST_JWT_ORG_B) {
  process.env.TEST_JWT_ORG_B = ORG_B_TEST_TOKEN;
}

if (!process.env.TEST_JWT_SUPER_ADMIN) {
  process.env.TEST_JWT_SUPER_ADMIN = SUPER_ADMIN_TEST_TOKEN;
}

if (!process.env.TEST_THERAPIST_ID_ORG_A) {
  process.env.TEST_THERAPIST_ID_ORG_A = 'therapist-1';
}

if (!process.env.TEST_CLIENT_ID_ORG_A) {
  process.env.TEST_CLIENT_ID_ORG_A = 'client-1';
}

const consoleGuard = installConsoleGuard({ passthrough: false });

setRuntimeSupabaseConfig({
  supabaseUrl: 'https://test-project.supabase.co',
  supabaseAnonKey: 'test-anon-key',
});

beforeEach(() => {
  consoleGuard.resetCapturedLogs();
});

// Global, deterministic time for tests (fake Date only; keep real timers)
vi.useFakeTimers({ toFake: ['Date'] });
vi.setSystemTime(new Date('2025-06-30T12:00:00Z'));

// Mock Supabase with more realistic implementations
vi.mock('../lib/supabase', () => {
  const chain: any = {
    select: vi.fn(() => chain),
    insert: vi.fn(() => chain),
    update: vi.fn(() => chain),
    delete: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(async () => ({ data: [], error: null })),
    single: vi.fn(async () => ({ data: null, error: null })),
    // Realistic helpers to match Supabase Postgrest API surface
    maybeSingle: vi.fn(async () => ({ data: null, error: null })),
    returns: vi.fn(() => chain),
  };

  const supabaseMock: any = {
    supabase: {
      from: vi.fn((table: string) => {
        if (table === 'sessions') {
          let lastInserted: any[] | null = null;
          const sessionsChain: any = {
            select: vi.fn(() => sessionsChain),
            insert: vi.fn((rows: any[]) => {
              lastInserted = Array.isArray(rows) ? rows : [rows];
              // Trigger MSW handler for tests that intercept REST
              try { fetch('http://localhost/rest/v1/sessions', { method: 'POST', body: JSON.stringify(rows) }); } catch { /* noop */ }
              return sessionsChain;
            }),
            update: vi.fn(() => sessionsChain),
            delete: vi.fn(() => sessionsChain),
            eq: vi.fn(() => sessionsChain),
            order: vi.fn(() => sessionsChain),
            limit: vi.fn(async () => ({ data: [], error: null })),
            returns: vi.fn(() => sessionsChain),
            single: vi.fn(async () => ({ data: lastInserted ? { id: 'new-session-id', ...lastInserted[0] } : null, error: null })),
            maybeSingle: vi.fn(async () => ({ data: lastInserted ? { id: 'new-session-id', ...lastInserted[0] } : null, error: null })),
          };
          return sessionsChain;
        }
        return chain;
      }),
      rpc: vi.fn(async (functionName: string) => {
        if (functionName === 'get_schedule_data_batch') {
          return {
            data: {
              sessions: [
                {
                  id: 'test-session-1',
                  client: { id: 'client-1', full_name: 'Test Client' },
                  therapist: { id: 'therapist-1', full_name: 'Test Therapist' },
                  start_time: '2025-03-18T10:00:00Z',
                  end_time: '2025-03-18T11:00:00Z',
                  status: 'scheduled',
                },
              ],
              therapists: [
                {
                  id: 'therapist-1',
                  full_name: 'Test Therapist',
                  email: 'therapist@example.com',
                  specialties: ['ABA'],
                  availability_hours: {
                    monday: { start: '09:00', end: '17:00' },
                    tuesday: { start: '09:00', end: '17:00' },
                    wednesday: { start: '09:00', end: '17:00' },
                    thursday: { start: '09:00', end: '17:00' },
                    friday: { start: '09:00', end: '17:00' },
                    saturday: { start: '10:00', end: '14:00' },
                    sunday: { start: '10:00', end: '14:00' },
                  },
                },
              ],
              clients: [
                {
                  id: 'client-1',
                  full_name: 'Test Client',
                  email: 'client@example.com',
                  availability_hours: {
                    monday: { start: '09:00', end: '17:00' },
                    tuesday: { start: '09:00', end: '17:00' },
                    wednesday: { start: '09:00', end: '17:00' },
                    thursday: { start: '09:00', end: '17:00' },
                    friday: { start: '09:00', end: '17:00' },
                    saturday: { start: '10:00', end: '14:00' },
                    sunday: { start: '10:00', end: '14:00' },
                  },
                },
              ],
            },
            error: null,
          };
        }
        if (functionName === 'get_sessions_optimized') {
          return {
            data: [
              {
                session_data: {
                  id: 'test-session-1',
                  client: { id: 'client-1', full_name: 'Test Client' },
                  therapist: { id: 'therapist-1', full_name: 'Test Therapist' },
                  start_time: '2025-03-18T10:00:00Z',
                  end_time: '2025-03-18T11:00:00Z',
                  status: 'scheduled',
                },
              },
            ],
            error: null,
          };
        }
        if (functionName === 'get_dropdown_data') {
          return {
            data: {
              therapists: [
                {
                  id: 'therapist-1',
                  full_name: 'Test Therapist',
                  email: 'therapist@example.com',
                  availability_hours: {
                    monday: { start: '09:00', end: '17:00' },
                    tuesday: { start: '09:00', end: '17:00' },
                    wednesday: { start: '09:00', end: '17:00' },
                    thursday: { start: '09:00', end: '17:00' },
                    friday: { start: '09:00', end: '17:00' },
                    saturday: { start: '10:00', end: '14:00' },
                    sunday: { start: '10:00', end: '14:00' },
                  },
                },
              ],
              clients: [
                {
                  id: 'client-1',
                  full_name: 'Test Client',
                  email: 'client@example.com',
                  availability_hours: {
                    monday: { start: '09:00', end: '17:00' },
                    tuesday: { start: '09:00', end: '17:00' },
                    wednesday: { start: '09:00', end: '17:00' },
                    thursday: { start: '09:00', end: '17:00' },
                    friday: { start: '09:00', end: '17:00' },
                    saturday: { start: '10:00', end: '14:00' },
                    sunday: { start: '10:00', end: '14:00' },
                  },
                },
              ],
            },
            error: null,
          };
        }
        return { data: null, error: null };
      }),
      functions: {
        invoke: vi.fn(async (functionName: string, opts?: { body?: any }) => {
          if (functionName === 'suggest-alternative-times') {
            return {
              data: {
                alternatives: [
                  {
                    startTime: '2024-03-18T10:00:00Z',
                    endTime: '2024-03-18T11:00:00Z',
                    score: 0.95,
                    reason: 'No conflicts and within availability'
                  },
                  {
                    startTime: '2024-03-18T09:00:00Z',
                    endTime: '2024-03-18T10:00:00Z',
                    score: 0.88,
                    reason: 'Early slot available for both parties'
                  }
                ]
              },
              error: null
            };
          }
          return { data: { alternatives: [] }, error: null };
        }),
      },
      auth: {
        getUser: vi.fn(() =>
          Promise.resolve({
            data: { user: { id: 'test-user', email: 'test@example.com' } },
            error: null,
          }),
        ),
        getSession: vi.fn(() =>
          Promise.resolve({
            data: { session: { access_token: 'test-access-token' } },
            error: null,
          }),
        ),
      },
    },
  };

  supabaseMock.callEdge = vi.fn(async (
    path: string,
    init: RequestInit = {},
    options: { accessToken?: string; anonKey?: string } = {},
  ) => {
    const headers = new Headers(init?.headers ?? {});

    const providedToken = typeof options.accessToken === 'string' ? options.accessToken.trim() : '';
    if (providedToken.length > 0) {
      headers.set('Authorization', `Bearer ${providedToken}`);
    } else if (!headers.has('Authorization')) {
      const { data: { session } = { session: null } } = await supabaseMock.supabase.auth.getSession();
      if (session?.access_token) {
        headers.set('Authorization', `Bearer ${session.access_token}`);
      }
    }

    const anonKey = typeof options.anonKey === 'string' ? options.anonKey.trim() : '';
    if (anonKey.length > 0) {
      headers.set('apikey', anonKey);
    }

    const url = `http://localhost/functions/v1/${path}`;
    return fetch(url, { ...init, headers });
  });

  return supabaseMock;
});

/**
 * Test Supabase mock usage:
 * const { data, error } = await supabase.from('table').select('*').eq('id', '1').maybeSingle();
 * const { data, error } = await supabase.from('table').select('*').returns<MyType>().limit(10);
 */

// Note: date-fns mocking removed for simplicity

const getBearerToken = (headers: Headers): string => {
  const authorization = headers.get('authorization');
  return authorization ? authorization.replace(/^Bearer\s+/i, '').trim() : '';
};

// Setup MSW server for mocking API calls (for integration tests or when Supabase mocks are bypassed)
export const server = setupServer(
  http.post('*/rest/v1/rpc/current_user_organization_id', async ({ request }) => {
    const token = getBearerToken(request.headers);

    if (token === ORG_A_TEST_TOKEN || token === SUPER_ADMIN_TEST_TOKEN) {
      return HttpResponse.json({ organization_id: ORG_A_PLACEHOLDER_ID });
    }

    if (token === ORG_B_TEST_TOKEN) {
      return HttpResponse.json({ organization_id: ORG_B_PLACEHOLDER_ID });
    }

    return HttpResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }),
  http.post('*/rest/v1/rpc/get_admin_users', async ({ request }) => {
    const token = getBearerToken(request.headers);
    const body = await request.json().catch(() => ({}));
    const requestedOrganizationId = typeof (body as Record<string, unknown>).organization_id === 'string'
      ? (body as Record<string, string>).organization_id
      : undefined;

    if (token === ORG_A_TEST_TOKEN && requestedOrganizationId === ORG_A_PLACEHOLDER_ID) {
      return HttpResponse.json([
        {
          id: 'admin-org-a-1',
          email: 'admin-a@example.com',
          organization_id: ORG_A_PLACEHOLDER_ID,
          full_name: 'Org A Admin',
        },
      ]);
    }

    if (token === ORG_B_TEST_TOKEN && requestedOrganizationId === ORG_A_PLACEHOLDER_ID) {
      return HttpResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    return HttpResponse.json([], { status: 200 });
  }),
  http.post('*/rest/v1/rpc/insert_session_with_billing', async ({ request }) => {
    const token = getBearerToken(request.headers);
    const payload = await request.json().catch(() => ({}));

    if (token === ORG_A_TEST_TOKEN) {
      return HttpResponse.json({
        success: true,
        session: {
          id: 'session-org-a-1',
          client_id: process.env.TEST_CLIENT_ID_ORG_A,
          therapist_id: process.env.TEST_THERAPIST_ID_ORG_A,
          organization_id: ORG_A_PLACEHOLDER_ID,
        },
        cpt: {
          code: (payload as Record<string, unknown>).p_cpt_code ?? '97153',
          modifiers: (payload as Record<string, unknown>).p_modifiers ?? ['HN'],
        },
      });
    }

    if (token === ORG_B_TEST_TOKEN) {
      return HttpResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    return HttpResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }),
  // Mock RPC endpoints with proper test data
  http.post('*/rest/v1/rpc/get_schedule_data_batch', async ({ request }) => {
    const token = getBearerToken(request.headers);

    if (isOrgAToken(token)) {
      return HttpResponse.json({
        sessions: [
          {
            id: 'test-session-1',
            client: { id: 'client-1', full_name: 'Test Client' },
            therapist: { id: 'therapist-1', full_name: 'Test Therapist' },
            start_time: '2025-03-18T10:00:00Z',
            end_time: '2025-03-18T11:00:00Z',
            status: 'scheduled',
          }
        ],
        therapists: [
          {
            id: 'therapist-1',
            full_name: 'Test Therapist',
            email: 'therapist@example.com',
            specialties: ['ABA'],
            availability_hours: {
              monday: { start: '09:00', end: '17:00' },
              tuesday: { start: '09:00', end: '17:00' },
              wednesday: { start: '09:00', end: '17:00' },
              thursday: { start: '09:00', end: '17:00' },
              friday: { start: '09:00', end: '17:00' },
              saturday: { start: '10:00', end: '14:00' },
              sunday: { start: '10:00', end: '14:00' }
            }
          }
        ],
        clients: [
          {
            id: 'client-1',
            full_name: 'Test Client',
            email: 'client@example.com',
            availability_hours: {
              monday: { start: '09:00', end: '17:00' },
              tuesday: { start: '09:00', end: '17:00' },
              wednesday: { start: '09:00', end: '17:00' },
              thursday: { start: '09:00', end: '17:00' },
              friday: { start: '09:00', end: '17:00' },
              saturday: { start: '10:00', end: '14:00' },
              sunday: { start: '10:00', end: '14:00' }
            }
          }
        ]
      });
    }

    if (isOrgBToken(token)) {
      return HttpResponse.json({ sessions: [], therapists: [], clients: [] });
    }

    return HttpResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }),
  http.post('*/rest/v1/rpc/get_sessions_optimized', async ({ request }) => {
    const token = getBearerToken(request.headers);

    if (isOrgAToken(token)) {
      return HttpResponse.json([
        {
          session_data: {
            id: 'test-session-1',
            client: { id: 'client-1', full_name: 'Test Client' },
            therapist: { id: 'therapist-1', full_name: 'Test Therapist' },
            start_time: '2025-03-18T10:00:00Z',
            end_time: '2025-03-18T11:00:00Z',
            status: 'scheduled',
          }
        }
      ]);
    }

    if (isOrgBToken(token)) {
      return HttpResponse.json([]);
    }

    return HttpResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }),
  http.post('*/rest/v1/rpc/get_dropdown_data', async ({ request }) => {
    const token = getBearerToken(request.headers);

    if (isOrgAToken(token)) {
      return HttpResponse.json({
        therapists: [
          {
            id: 'therapist-1',
            full_name: 'Test Therapist',
            email: 'therapist@example.com',
            availability_hours: {
              monday: { start: '09:00', end: '17:00' },
              tuesday: { start: '09:00', end: '17:00' },
              wednesday: { start: '09:00', end: '17:00' },
              thursday: { start: '09:00', end: '17:00' },
              friday: { start: '09:00', end: '17:00' },
              saturday: { start: '10:00', end: '14:00' },
              sunday: { start: '10:00', end: '14:00' }
            }
          }
        ],
        clients: [
          {
            id: 'client-1',
            full_name: 'Test Client',
            email: 'client@example.com',
            availability_hours: {
              monday: { start: '09:00', end: '17:00' },
              tuesday: { start: '09:00', end: '17:00' },
              wednesday: { start: '09:00', end: '17:00' },
              thursday: { start: '09:00', end: '17:00' },
              friday: { start: '09:00', end: '17:00' },
              saturday: { start: '10:00', end: '14:00' },
              sunday: { start: '10:00', end: '14:00' }
            }
          }
        ]
      });
    }

    if (isOrgBToken(token)) {
      return HttpResponse.json({ therapists: [], clients: [] });
    }

    return HttpResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }),
  http.post('*/rest/v1/rpc/get_session_metrics', async ({ request }) => {
    const token = getBearerToken(request.headers);

    if (isOrgAToken(token)) {
      return HttpResponse.json({
        totalSessions: 12,
        completedSessions: 10,
        cancelledSessions: 1,
        noShowSessions: 1,
        sessionsByTherapist: { 'therapist-1': 12 },
        sessionsByClient: { 'client-1': 12 },
        sessionsByDayOfWeek: { monday: 4, tuesday: 4, wednesday: 4 },
      });
    }

    if (isOrgBToken(token)) {
      return HttpResponse.json({
        totalSessions: 0,
        completedSessions: 0,
        cancelledSessions: 0,
        noShowSessions: 0,
        sessionsByTherapist: {},
        sessionsByClient: {},
        sessionsByDayOfWeek: {},
      });
    }

    return HttpResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }),
  http.post('*/rest/v1/rpc/set_client_archive_state', async ({ request }) => {
    const token = getBearerToken(request.headers);
    const body = await request.json().catch(() => ({}));
    const restore = Boolean((body as Record<string, unknown>).p_restore);

    if (!isOrgAToken(token)) {
      return HttpResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    archiveState.client.deletedAt = restore ? null : ARCHIVE_TIMESTAMP;

    return HttpResponse.json({
      id: archiveState.client.id,
      organization_id: archiveState.client.organizationId,
      deleted_at: archiveState.client.deletedAt,
    });
  }),
  http.post('*/rest/v1/rpc/set_therapist_archive_state', async ({ request }) => {
    const token = getBearerToken(request.headers);
    const body = await request.json().catch(() => ({}));
    const restore = Boolean((body as Record<string, unknown>).p_restore);

    if (!isOrgAToken(token)) {
      return HttpResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    archiveState.therapist.deletedAt = restore ? null : ARCHIVE_TIMESTAMP;

    return HttpResponse.json({
      id: archiveState.therapist.id,
      organization_id: archiveState.therapist.organizationId,
      deleted_at: archiveState.therapist.deletedAt,
    });
  }),
  // AI Edge Functions
  http.post('https://wnnjeqheqxxyrgsjmygy.supabase.co/functions/v1/ai-transcription', async ({ request }) => {
    const body = await request.json().catch(() => ({}));
    // Echo back what tests might expect if they set specific payloads
    return HttpResponse.json({
      text: body?.audio ? 'Test transcription' : 'Test transcription',
      confidence: 0.85,
      processing_time: 1000,
    });
  }),
  http.post('https://wnnjeqheqxxyrgsjmygy.supabase.co/functions/v1/ai-session-note-generator', () => {
    // Return compliant payload by default to satisfy strict tests
    return HttpResponse.json({
      content: JSON.stringify({
        clinical_status: 'Client demonstrates emerging receptive language skills with measured progress across structured tasks and consistent performance in targeted programs.',
        goals: [{
          goal_id: 'goal_1',
          description: 'Follow one-step instructions',
          target_behavior: 'compliance',
          measurement_type: 'percentage',
          baseline_data: 60,
          target_criteria: 80,
          session_performance: 75,
          progress_status: 'improving'
        }],
        interventions: [{
          type: 'DTT',
          aba_technique: 'Discrete Trial Training',
          description: 'Presented visual prompts with verbal instructions',
          implementation_fidelity: 95,
          client_response: 'Positive engagement with minimal prompting',
          effectiveness_rating: 4
        }],
        observations: [{
          behavior_type: 'positive_behavior',
          description: 'Client followed instructions independently',
          frequency: 12,
          duration: 300,
          intensity: 'medium',
          antecedent: 'Therapist presented instruction',
          consequence: 'Praise and preferred item'
        }],
        data_summary: [{
          program_name: 'Following Instructions',
          trials_presented: 20,
          correct_responses: 16,
          incorrect_responses: 4,
          no_responses: 0,
          percentage_correct: 80,
          trend: 'increasing'
        }],
        summary: 'Objective summary with quantified outcomes and professional language.',
        confidence: 0.9
      }),
      california_compliant: true,
      insurance_ready: true,
    });
  }),
  // Legacy REST endpoints for backward compatibility
  http.get('*/rest/v1/sessions*', () => {
    return HttpResponse.json([
      {
        id: 'test-session-1',
        client: { id: 'client-1', full_name: 'Test Client' },
        therapist: { id: 'therapist-1', full_name: 'Test Therapist' },
        start_time: '2025-03-18T10:00:00Z',
        end_time: '2025-03-18T11:00:00Z',
        status: 'scheduled',
      }
    ]);
  }),
  http.get('*/rest/v1/therapists*', ({ request }) => {
    const token = getBearerToken(request.headers);

    if (isOrgBToken(token)) {
      return HttpResponse.json([]);
    }

    if (!isOrgAToken(token)) {
      return HttpResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const url = new URL(request.url);
    const deletedFilter = url.searchParams.get('deleted_at');
    const idFilter = url.searchParams.get('id');

    const therapistRow = {
      id: archiveState.therapist.id,
      organization_id: archiveState.therapist.organizationId,
      deleted_at: archiveState.therapist.deletedAt,
      full_name: 'Test Therapist',
      email: 'therapist@example.com',
      availability_hours: {
        monday: { start: '09:00', end: '17:00' },
        tuesday: { start: '09:00', end: '17:00' },
        wednesday: { start: '09:00', end: '17:00' },
        thursday: { start: '09:00', end: '17:00' },
        friday: { start: '09:00', end: '17:00' },
        saturday: { start: '10:00', end: '14:00' },
        sunday: { start: '10:00', end: '14:00' }
      },
    };

    if (deletedFilter === 'is.null' && therapistRow.deleted_at !== null) {
      return HttpResponse.json([]);
    }

    if (idFilter) {
      const [, value] = idFilter.split('.');
      if (value && value !== therapistRow.id) {
        return HttpResponse.json([]);
      }
    }

    return HttpResponse.json([therapistRow]);
  }),
  http.get('*/rest/v1/clients*', ({ request }) => {
    const token = getBearerToken(request.headers);

    if (isOrgBToken(token)) {
      return HttpResponse.json([]);
    }

    if (!isOrgAToken(token)) {
      return HttpResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const url = new URL(request.url);
    const deletedFilter = url.searchParams.get('deleted_at');
    const idFilter = url.searchParams.get('id');

    const clientRow = {
      id: archiveState.client.id,
      organization_id: archiveState.client.organizationId,
      deleted_at: archiveState.client.deletedAt,
      full_name: 'Test Client',
      email: 'client@example.com',
      availability_hours: {
        monday: { start: '09:00', end: '17:00' },
        tuesday: { start: '09:00', end: '17:00' },
        wednesday: { start: '09:00', end: '17:00' },
        thursday: { start: '09:00', end: '17:00' },
        friday: { start: '09:00', end: '17:00' },
        saturday: { start: '10:00', end: '14:00' },
        sunday: { start: '10:00', end: '14:00' }
      },
    };

    if (deletedFilter === 'is.null' && clientRow.deleted_at !== null) {
      return HttpResponse.json([]);
    }

    if (idFilter) {
      const [, value] = idFilter.split('.');
      if (value && value !== clientRow.id) {
        return HttpResponse.json([]);
      }
    }

    return HttpResponse.json([clientRow]);
  }),
  http.post('*/api/book', async ({ request }) => {
    let body: { session?: Record<string, unknown> } | null = null;
    try {
      body = await request.json();
    } catch (error) {
      console.error('Failed to parse book API payload in tests', error);
    }

    const sessionPayload = (body?.session ?? {}) as Record<string, unknown>;
    const startTime = typeof sessionPayload.start_time === 'string'
      ? sessionPayload.start_time
      : '2025-03-18T10:00:00Z';
    const endTime = typeof sessionPayload.end_time === 'string'
      ? sessionPayload.end_time
      : '2025-03-18T11:00:00Z';

    const responseSession = {
      id: (sessionPayload.id as string) ?? 'new-session-id',
      client_id: (sessionPayload.client_id as string) ?? 'client-1',
      therapist_id: (sessionPayload.therapist_id as string) ?? 'therapist-1',
      start_time: startTime,
      end_time: endTime,
      status: (sessionPayload.status as string) ?? 'scheduled',
      notes: (sessionPayload.notes as string) ?? 'Test session',
      created_at: '2025-03-18T09:00:00Z',
      created_by: 'user-1',
      updated_at: '2025-03-18T09:00:00Z',
      updated_by: 'user-1',
      duration_minutes: 60,
      location_type: (sessionPayload.location_type as string) ?? null,
      session_type: (sessionPayload.session_type as string) ?? null,
      rate_per_hour: null,
      total_cost: null,
    };

    return HttpResponse.json({
      success: true,
      data: {
        session: responseSession,
        hold: {
          holdKey: 'test-hold',
          holdId: 'hold-1',
          expiresAt: '2025-01-01T00:05:00Z',
        },
        cpt: {
          code: '97153',
          description: 'Adaptive behavior treatment by protocol',
          modifiers: [],
          source: 'fallback',
          durationMinutes: 60,
        },
      },
    });
  }),
  // Mock session hold + confirmation flow
  http.post('*/functions/v1/sessions-hold*', () => {
    return HttpResponse.json({
      success: true,
      data: {
        holdKey: 'test-hold',
        holdId: 'hold-1',
        expiresAt: '2025-01-01T00:05:00Z',
      },
    });
  }),
  http.post('*/functions/v1/sessions-confirm*', () => {
    return HttpResponse.json({
      success: true,
      data: {
        session: {
          id: 'new-session-id',
          client_id: 'client-1',
          therapist_id: 'therapist-1',
          start_time: '2025-03-18T10:00:00Z',
          end_time: '2025-03-18T11:00:00Z',
          status: 'scheduled',
          notes: 'Test session',
          created_at: '2025-03-18T09:00:00Z',
          duration_minutes: 60,
          location_type: null,
          session_type: null,
          rate_per_hour: null,
          total_cost: null,
        },
        roundedDurationMinutes: 60,
      },
    });
  }),
);

// Determine if we're running integration tests
const isIntegrationTest = process.env.VITEST_POOL_ID?.includes('Integration') || 
                          process.argv.some(arg => arg.includes('Integration'));

// Start server before all tests
beforeAll(() => {
  // Always error on unhandled to force explicit handlers per-domain.
  // Integration tests should also declare handlers; avoid bypass to catch gaps.
  server.listen({ onUnhandledRequest: 'error' });
});

// Reset handlers after each test
afterEach(() => server.resetHandlers());

// Close server after all tests
afterAll(() => server.close());

afterAll(() => {
  consoleGuard.restore();
});

if (typeof window !== 'undefined') {
  // Mock window.matchMedia for responsive design tests
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(query => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(), // deprecated
      removeListener: vi.fn(), // deprecated
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });

  // Mock IntersectionObserver for virtual scrolling tests
  const mockIntersectionObserver = vi.fn();
  mockIntersectionObserver.mockReturnValue({
    observe: () => null,
    unobserve: () => null,
    disconnect: () => null,
  });
  window.IntersectionObserver = mockIntersectionObserver;

  // Stub browser dialogs for jsdom environment
  Object.defineProperty(window, 'alert', {
    writable: true,
    value: vi.fn(),
  });
  Object.defineProperty(window, 'confirm', {
    writable: true,
    value: vi.fn(() => true),
  });
}