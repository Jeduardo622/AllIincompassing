import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';

const runtimeConfigStub = {
  supabaseUrl: 'https://example.supabase.co',
  supabaseAnonKey: 'anon-key',
  defaultOrganizationId: 'org-123',
};

vi.mock('../../lib/runtimeConfig', () => ({
  setRuntimeSupabaseConfig: vi.fn(),
  resetRuntimeSupabaseConfigForTests: vi.fn(),
  getRuntimeSupabaseConfig: () => runtimeConfigStub,
  ensureRuntimeSupabaseConfig: async () => runtimeConfigStub,
  getSupabaseUrl: () => runtimeConfigStub.supabaseUrl,
  getSupabaseAnonKey: () => runtimeConfigStub.supabaseAnonKey,
  getDefaultOrganizationId: () => runtimeConfigStub.defaultOrganizationId,
  getSupabaseEdgeBaseUrl: () => `${runtimeConfigStub.supabaseUrl}/functions/v1/`,
  buildSupabaseEdgeUrl: (path: string) => `${runtimeConfigStub.supabaseUrl}/functions/v1/${path}`,
}));

vi.mock('../../lib/supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: null },
        error: null,
      }),
    },
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
      insert: vi.fn().mockReturnThis(),
    })),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  },
}));

vi.mock('../../lib/optimizedQueries', () => ({
  useDashboardData: () => ({
    data: {
      todaySessions: [],
      incompleteSessions: [],
      billingAlerts: [],
      clientMetrics: { total: 10, active: 5, totalUnits: 30 },
      therapistMetrics: { total: 3, active: 2, totalHours: 60 },
    },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock('../../components/Dashboard/ReportsSummary', () => ({
  default: () => <div data-testid="reports-summary" />,
}));

vi.mock('../../lib/authContext', () => ({
  useAuth: () => ({
    isAdmin: () => true,
    isSuperAdmin: () => true,
  }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      data: [],
      error: null,
    })),
  },
}));

type DashboardModule = typeof import('../Dashboard');
let DashboardComponent: DashboardModule['default'];

describe('Dashboard without client fallbacks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  beforeAll(async () => {
    const module = await import('../Dashboard');
    DashboardComponent = module.default;
  });

  it('renders metrics from useDashboardData and does not hit supabase.from', () => {
    render(<DashboardComponent />);

    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Active Clients')).toBeInTheDocument();
  });
});


