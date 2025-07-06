import React from 'react';
import { render, RenderOptions } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import userEvent from '@testing-library/user-event';

// Create a test query client
const createTestQueryClient = () => {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
        staleTime: 0,
      },
      mutations: {
        retry: false,
      },
    },
  });
};

// Wrapper component that provides all necessary context
const TestProviders = ({ children }: { children: React.ReactNode }) => {
  const queryClient = createTestQueryClient();
  
  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
};

// Custom render function that includes providers
const renderWithProviders = (
  ui: React.ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>
) => {
  return render(ui, { wrapper: TestProviders, ...options });
};

// Mock Supabase client
export const mockSupabaseClient = {
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
};

// Re-export testing library utilities
export * from '@testing-library/react';
export { userEvent };
export { renderWithProviders }; 