import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '../../test/utils';
import { renderWithProviders } from '../../test/utils';
import { ClientSessionTrendsTab } from '../ClientDetails/ClientSessionTrendsTab';
import { fetchClientSessionNotes } from '../../lib/session-notes';
import { supabase } from '../../lib/supabase';

vi.mock('react-chartjs-2', () => ({
  Line: ({ data }: { data: { labels: string[]; datasets: Array<{ data: number[] }> } }) => (
    <div data-testid="session-trends-chart">
      {data.labels.join(',')}:{data.datasets[0]?.data.join(',')}
    </div>
  ),
}));

vi.mock('../../lib/session-notes', async () => {
  const actual = await vi.importActual<typeof import('../../lib/session-notes')>('../../lib/session-notes');
  return {
    ...actual,
    fetchClientSessionNotes: vi.fn(),
  };
});

const createGoalsBuilder = () => {
  const builder: any = {};
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.order = vi.fn(async () => ({
    data: [
      {
        id: 'goal-1',
        organization_id: '5238e88b-6198-4862-80a2-dbe15bbeabdd',
        client_id: 'client-1',
        program_id: 'program-1',
        title: 'Emergency scenarios',
        description: 'Responds to emergency scenarios',
        original_text: 'Emergency scenarios',
        measurement_type: 'percent accuracy',
        status: 'active',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        programs: { name: 'Safety' },
      },
    ],
    error: null,
  }));
  return builder;
};

describe('ClientSessionTrendsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.setSystemTime(new Date('2025-06-30T12:00:00Z'));
    vi.mocked(fetchClientSessionNotes).mockResolvedValue([
      {
        id: 'note-1',
        date: '2025-06-01',
        start_time: '09:00:00',
        end_time: '10:00:00',
        service_code: '97153',
        therapist_name: 'Test Therapist',
        therapist_id: 'therapist-1',
        goals_addressed: ['Emergency scenarios'],
        goal_ids: ['goal-1'],
        goal_notes: null,
        goal_measurements: {
          'goal-1': {
            version: 1,
            data: {
              measurement_type: 'percent accuracy',
              targets: ['lost in community'],
              target_trials: [
                { target: 'lost in community', metric_value: 8, opportunities: 10 },
              ],
            },
          },
        },
        session_id: 'session-1',
        narrative: 'Session note',
        is_locked: false,
        client_id: 'client-1',
        authorization_id: 'auth-1',
        organization_id: '5238e88b-6198-4862-80a2-dbe15bbeabdd',
      },
      {
        id: 'note-2',
        date: '2025-06-08',
        start_time: '09:00:00',
        end_time: '10:00:00',
        service_code: '97153',
        therapist_name: 'Test Therapist',
        therapist_id: 'therapist-1',
        goals_addressed: ['Emergency scenarios'],
        goal_ids: ['goal-1'],
        goal_notes: null,
        goal_measurements: {
          'goal-1': {
            version: 1,
            data: {
              measurement_type: 'percent accuracy',
              targets: ['lost in community'],
              target_trials: [
                { target: 'lost in community', metric_value: 10, opportunities: 10 },
              ],
            },
          },
        },
        session_id: 'session-2',
        narrative: 'Session note',
        is_locked: false,
        client_id: 'client-1',
        authorization_id: 'auth-1',
        organization_id: '5238e88b-6198-4862-80a2-dbe15bbeabdd',
      },
    ]);
    vi.spyOn(supabase, 'from').mockImplementation((table: string) => {
      if (table === 'goals') {
        return createGoalsBuilder();
      }
      throw new Error(`Unexpected table ${table}`);
    });
  });

  it('renders median trend chart controls and source evidence', async () => {
    renderWithProviders(<ClientSessionTrendsTab client={{ id: 'client-1' }} />, {
      auth: { role: 'admin', userId: 'admin-user-id' },
    });

    await waitFor(() => expect(screen.getByTestId('session-trends-chart')).toHaveTextContent('Jun 2025:90'));
    expect(fetchClientSessionNotes).toHaveBeenCalledWith('client-1', '5238e88b-6198-4862-80a2-dbe15bbeabdd', {
      limit: null,
      startDate: '2024-12-01',
      endDate: '2025-06-30',
    });
    expect(screen.getByRole('heading', { name: /Session Trends/i })).toBeInTheDocument();
    expect(screen.getByLabelText('Goal')).toHaveTextContent('Safety: Emergency scenarios');
    expect(screen.getByLabelText('Target')).toHaveTextContent('lost in community');
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getAllByText(/80%|100%/).length).toBeGreaterThan(0);
  });

  it('uses a stable month-start default range on month-end dates', async () => {
    vi.setSystemTime(new Date('2026-03-31T12:00:00Z'));

    renderWithProviders(<ClientSessionTrendsTab client={{ id: 'client-1' }} />, {
      auth: { role: 'admin', userId: 'admin-user-id' },
    });

    await waitFor(() => expect(fetchClientSessionNotes).toHaveBeenCalledWith(
      'client-1',
      '5238e88b-6198-4862-80a2-dbe15bbeabdd',
      {
        limit: null,
        startDate: '2025-09-01',
        endDate: '2026-03-31',
      },
    ));
  });

  it('shows an empty state when no notes have graphable measurements', async () => {
    vi.mocked(fetchClientSessionNotes).mockResolvedValue([]);

    renderWithProviders(<ClientSessionTrendsTab client={{ id: 'client-1' }} />, {
      auth: { role: 'admin', userId: 'admin-user-id' },
    });

    expect(await screen.findByText('No graphable trial data')).toBeInTheDocument();
  });
});
