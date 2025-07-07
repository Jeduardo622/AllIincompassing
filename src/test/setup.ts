import { vi, beforeAll, afterEach, afterAll } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import '@testing-library/jest-dom';

// Mock Supabase with more realistic implementations
vi.mock('../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        data: [],
        error: null,
      })),
      insert: vi.fn(() => ({
        data: [],
        error: null,
      })),
      update: vi.fn(() => ({
        data: [],
        error: null,
      })),
      delete: vi.fn(() => ({
        data: [],
        error: null,
      })),
      eq: vi.fn(() => ({
        data: [],
        error: null,
      })),
    })),
    rpc: vi.fn(async (functionName: string) => {
      // Mock RPC calls with proper test data
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
          },
          error: null
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
              }
            }
          ],
          error: null
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
          },
          error: null
        };
      }
      return { data: null, error: null };
    }),
    auth: {
      getUser: vi.fn(() => Promise.resolve({
        data: { user: { id: 'test-user', email: 'test@example.com' } },
        error: null,
      })),
    },
  },
}));

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
  // Mock session creation
  http.post('*/rest/v1/sessions*', () => {
    return HttpResponse.json({ id: 'new-session-id' });
  }),
);

// Determine if we're running integration tests
const isIntegrationTest = process.env.VITEST_POOL_ID?.includes('Integration') || 
                          process.argv.some(arg => arg.includes('Integration'));

// Start server before all tests
beforeAll(() => {
  const serverOptions = isIntegrationTest 
    ? { onUnhandledRequest: 'bypass' as const }  // Allow real requests for integration tests
    : { onUnhandledRequest: 'warn' as const };   // Warn for unhandled requests in other tests
  
  server.listen(serverOptions);
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