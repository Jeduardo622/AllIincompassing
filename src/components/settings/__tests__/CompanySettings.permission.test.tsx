import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { CompanySettings } from '../CompanySettings';
import { useAuth } from '../../../lib/authContext';
import { supabase } from '../../../lib/supabase';

vi.mock('../../../lib/authContext', () => ({
  useAuth: vi.fn(),
}));

vi.mock('../../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
  },
}));

vi.mock('../../../lib/toast', () => ({
  showError: vi.fn(),
}));

type AuthContextMock = {
  hasRole: (role: string) => boolean;
  loading: boolean;
};

const renderWithQueryClient = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <CompanySettings />
    </QueryClientProvider>,
  );
};

describe('CompanySettings permission and error-state behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders unauthorized UI for non-admin users without raising query permission errors', () => {
    vi.mocked(useAuth).mockReturnValue({
      hasRole: () => false,
      loading: false,
    } as AuthContextMock);

    renderWithQueryClient();

    expect(
      screen.getByText(/you do not have permission to manage company settings/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/only admins can load company settings/i)).not.toBeInTheDocument();
    expect(vi.mocked(supabase.from)).not.toHaveBeenCalled();
  });

  it('renders fetch failures with consistent error messaging for admin users', async () => {
    vi.mocked(useAuth).mockReturnValue({
      hasRole: () => true,
      loading: false,
    } as AuthContextMock);

    vi.mocked(supabase.from).mockReturnValue({
      select: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue({
          data: null,
          error: new Error('settings fetch failed'),
        }),
      }),
    } as unknown as ReturnType<typeof supabase.from>);

    renderWithQueryClient();

    expect(
      await screen.findByText(/failed to load company settings: settings fetch failed/i),
    ).toBeInTheDocument();
  });
});
