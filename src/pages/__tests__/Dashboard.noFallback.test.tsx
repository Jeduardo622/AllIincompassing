import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { DashboardView } from '../Dashboard';

vi.mock('../../components/Dashboard/ReportsSummary', () => ({
  default: () => <div data-testid="reports-summary" />,
}));

const baseProps = {
  dashboardData: {
    todaySessions: [],
    incompleteSessions: [],
    billingAlerts: [],
    clientMetrics: { total: 10, active: 5, totalUnits: 30 },
    therapistMetrics: { total: 3, active: 2, totalHours: 60 },
  },
  isLoading: false,
  error: null,
  refetch: vi.fn(),
  isLiveRole: true,
  intervalMs: 30000,
};

describe('Dashboard without client fallbacks', () => {
  it('renders metrics from provided data and shows summary cards', () => {
    render(<DashboardView {...baseProps} />);

    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Active Clients')).toBeInTheDocument();
    expect(screen.getByText('Billing Alerts')).toBeInTheDocument();
  });
});
