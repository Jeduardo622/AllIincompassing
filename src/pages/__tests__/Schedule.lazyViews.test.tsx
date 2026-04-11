import { describe, expect, it, beforeEach, vi } from 'vitest';
import { renderWithProviders, screen } from '../../test/utils';
import userEvent from '@testing-library/user-event';

const mockUseScheduleDataBatch = vi.fn();
const mockUseSessionsOptimized = vi.fn();
const mockUseDropdownData = vi.fn();
const mockUseActiveOrganizationId = vi.fn(() => 'org-1');
let weekViewModuleLoads = 0;
let dayViewModuleLoads = 0;

vi.mock('../../lib/optimizedQueries', () => ({
  useScheduleDataBatch: (...args: unknown[]) => mockUseScheduleDataBatch(...args),
  useSessionsOptimized: (...args: unknown[]) => mockUseSessionsOptimized(...args),
  useDropdownData: (...args: unknown[]) => mockUseDropdownData(...args),
  useSmartPrefetch: () => ({
    prefetchScheduleRange: vi.fn(),
    prefetchNextWeek: vi.fn(),
    prefetchReportData: vi.fn(),
  }),
}));

vi.mock('../../lib/organization', () => ({
  useActiveOrganizationId: () => mockUseActiveOrganizationId(),
}));

vi.mock('../ScheduleWeekView', () => {
  weekViewModuleLoads += 1;
  return {
    ScheduleWeekView: () => <div data-testid="schedule-week-view">Week view</div>,
  };
});

vi.mock('../ScheduleDayView', () => {
  dayViewModuleLoads += 1;
  return {
    ScheduleDayView: () => <div data-testid="schedule-day-view">Day view</div>,
  };
});

import { Schedule } from '../Schedule';

const scheduleFixtures = {
  sessions: [
    {
      id: 'session-1',
      therapist_id: 'therapist-1',
      client_id: 'client-1',
      program_id: 'program-1',
      goal_id: 'goal-1',
      start_time: '2025-07-01T10:00:00Z',
      end_time: '2025-07-01T11:00:00Z',
      status: 'scheduled' as const,
      notes: '',
      created_at: '2025-06-01T00:00:00Z',
      updated_at: '2025-06-01T00:00:00Z',
      therapist: { id: 'therapist-1', full_name: 'Dr. Myles' },
      client: { id: 'client-1', full_name: 'Jamie Client' },
    },
  ],
  therapists: [
    {
      id: 'therapist-1',
      full_name: 'Dr. Myles',
      email: 'myles@example.com',
      availability_hours: {},
    },
  ],
  clients: [
    {
      id: 'client-1',
      full_name: 'Jamie Client',
      email: 'jamie@example.com',
      availability_hours: {},
      service_preference: [],
    },
  ],
};

describe('Schedule lazy calendar views', () => {
  beforeEach(() => {
    weekViewModuleLoads = 0;
    dayViewModuleLoads = 0;
    mockUseActiveOrganizationId.mockReturnValue('org-1');
    mockUseScheduleDataBatch.mockReturnValue({
      data: scheduleFixtures,
      isLoading: false,
      refetch: vi.fn(),
    });
    mockUseSessionsOptimized.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    mockUseDropdownData.mockReturnValue({
      data: scheduleFixtures,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
  });

  it('loads only the active calendar view module until the user switches views', async () => {
    renderWithProviders(<Schedule />);

    expect(await screen.findByTestId('schedule-week-view')).toBeInTheDocument();
    expect(weekViewModuleLoads).toBe(1);
    expect(dayViewModuleLoads).toBe(0);

    await userEvent.click(screen.getByRole('button', { name: /Day view/i }));

    expect(await screen.findByTestId('schedule-day-view')).toBeInTheDocument();
    expect(dayViewModuleLoads).toBe(1);
  });
});
