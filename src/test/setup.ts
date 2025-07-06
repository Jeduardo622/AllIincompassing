import { vi, beforeAll, afterEach, afterAll } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import '@testing-library/jest-dom';

// Mock Supabase
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
    auth: {
      getUser: vi.fn(() => Promise.resolve({
        data: { user: { id: 'test-user', email: 'test@example.com' } },
        error: null,
      })),
    },
  },
}));

// Note: date-fns mocking removed for simplicity

// Setup MSW server for mocking API calls
export const server = setupServer(
  // Mock RPC endpoints that the app actually uses
  http.post('*/rest/v1/rpc/get_schedule_data_batch', () => {
    return HttpResponse.json({
      sessions: [],
      therapists: [],
      clients: []
    });
  }),
  http.post('*/rest/v1/rpc/get_sessions_optimized', () => {
    return HttpResponse.json([]);
  }),
  http.post('*/rest/v1/rpc/get_dropdown_data', () => {
    return HttpResponse.json({
      therapists: [],
      clients: []
    });
  }),
  // Legacy REST endpoints for backward compatibility
  http.get('*/rest/v1/sessions*', () => {
    return HttpResponse.json([]);
  }),
  http.get('*/rest/v1/therapists*', () => {
    return HttpResponse.json([]);
  }),
  http.get('*/rest/v1/clients*', () => {
    return HttpResponse.json([]);
  }),
  // Mock session creation
  http.post('*/rest/v1/sessions*', () => {
    return HttpResponse.json({ id: 'new-session-id' });
  }),
);

// Start server before all tests
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

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