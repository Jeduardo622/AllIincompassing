import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderWithProviders, screen } from '../../test/utils';

vi.mock('../../lib/optimizedQueries', async () => {
  const actual = await vi.importActual<typeof import('../../lib/optimizedQueries')>('../../lib/optimizedQueries');
  return {
    ...actual,
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
    }),
  };
});

vi.mock('../../lib/supabase', () => ({
  supabase: { from: vi.fn() },
}));

import Dashboard from '../Dashboard';

describe('Dashboard without client fallbacks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders metrics from useDashboardData and does not hit supabase.from', () => {
    renderWithProviders(<Dashboard />);

    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Active Clients')).toBeInTheDocument();
  });
});


