import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ReportsSummary } from '../ReportsSummary';

vi.mock('../../../lib/optimizedQueries', () => ({
  useDropdownData: () => ({
    data: {
      clients: [],
      therapists: [],
    },
  }),
  useSessionMetrics: () => ({
    data: {
      total_sessions: 0,
      completed_sessions: 0,
      sessions_by_client: {},
      sessions_by_therapist: {},
      sessions_by_day: {},
    },
  }),
}));

describe('ReportsSummary', () => {
  it('shows 0.0% change when current and previous metrics are both zero', () => {
    render(
      <MemoryRouter>
        <ReportsSummary />
      </MemoryRouter>,
    );

    expect(screen.getAllByText('0.0%')).toHaveLength(4);
    expect(screen.queryByText('100.0%')).not.toBeInTheDocument();
  });
});
