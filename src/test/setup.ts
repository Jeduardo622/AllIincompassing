import { vi, beforeAll, afterEach, afterAll } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import '@testing-library/jest-dom';

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

  return {
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
      },
    },
    callEdge: vi.fn((path: string, init?: RequestInit) => {
      const url = `http://localhost/functions/v1/${path}`;
      return fetch(url, init);
    }),
  };
});

/**
 * Test Supabase mock usage:
 * const { data, error } = await supabase.from('table').select('*').eq('id', '1').maybeSingle();
 * const { data, error } = await supabase.from('table').select('*').returns<MyType>().limit(10);
 */

// Note: date-fns mocking removed for simplicity

// Setup MSW server for mocking API calls (for integration tests or when Supabase mocks are bypassed)
export const server = setupServer(
  // Mock RPC endpoints with proper test data
  http.post('*/rest/v1/rpc/get_schedule_data_batch', () => {
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
  }),
  http.post('*/rest/v1/rpc/get_sessions_optimized', () => {
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
  }),
  http.post('*/rest/v1/rpc/get_dropdown_data', () => {
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
  http.get('*/rest/v1/therapists*', () => {
    return HttpResponse.json([
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
    ]);
  }),
  http.get('*/rest/v1/clients*', () => {
    return HttpResponse.json([
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
    ]);
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