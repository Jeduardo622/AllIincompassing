import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor } from '../../test/utils';
import { renderWithProviders } from '../../test/utils';
import { ClientSessionTrendsTab } from '../ClientDetails/ClientSessionTrendsTab';
import { fetchClientSessionNotes } from '../../lib/session-notes';
import { supabase } from '../../lib/supabase';

vi.mock('react-chartjs-2', () => ({
  Line: React.forwardRef(({ data }: { data: { labels: string[]; datasets: Array<{ label: string; data: number[]; pointStyle?: string; borderColor?: string }> } }, ref) => {
    if (ref && typeof ref !== 'function') {
      ref.current = {
        toBase64Image: vi.fn(() => 'data:image/png;base64,chart-image'),
      };
    }

    return (
      <div data-testid="session-trends-chart">
        {data.labels.join(',')}:{data.datasets.map((dataset) => `${dataset.label}:${dataset.pointStyle}:${dataset.data.join('|')}:${dataset.borderColor}`).join(';')}
      </div>
    );
  }),
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

const createSessionNote = (
  id: string,
  date: string,
  targetTrials: Array<{ target: string; metric_value: number; opportunities: number }>,
) => ({
  id,
  date,
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
        targets: targetTrials.map((trial) => trial.target),
        target_trials: targetTrials,
      },
    },
  },
  session_id: `session-${id}`,
  narrative: 'Session note',
  is_locked: false,
  client_id: 'client-1',
  authorization_id: 'auth-1',
  organization_id: '5238e88b-6198-4862-80a2-dbe15bbeabdd',
});

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
                { target: 'cross street safely', metric_value: 5, opportunities: 10 },
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
                { target: 'cross street safely', metric_value: 4, opportunities: 10 },
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

    await waitFor(() => expect(screen.getByTestId('session-trends-chart')).toHaveTextContent('Jun 2025:lost in community'));
    expect(fetchClientSessionNotes).toHaveBeenCalledWith('client-1', '5238e88b-6198-4862-80a2-dbe15bbeabdd', {
      limit: null,
      startDate: '2024-12-01',
      endDate: '2025-06-30',
    });
    expect(screen.getByRole('heading', { name: /Session Trends/i })).toBeInTheDocument();
    expect(screen.getByLabelText('Goal')).toHaveTextContent('Safety: Emergency scenarios');
    expect(screen.getByText('2 separate target series')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Day' })).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getAllByText(/80%|100%/).length).toBeGreaterThan(0);
  });

  it('renders each target as a separate chart series with distinct point symbols', async () => {
    renderWithProviders(<ClientSessionTrendsTab client={{ id: 'client-1' }} />, {
      auth: { role: 'admin', userId: 'admin-user-id' },
    });

    const chart = await screen.findByTestId('session-trends-chart');

    expect(chart).toHaveTextContent('lost in community:circle:90');
    expect(chart).toHaveTextContent('cross street safely:rectRot:45');
  });

  it('keeps target point symbols distinct beyond six target series', async () => {
    vi.mocked(fetchClientSessionNotes).mockResolvedValue([
      createSessionNote(
        'many-targets',
        '2025-06-15',
        Array.from({ length: 7 }, (_, index) => ({
          target: `target ${index + 1}`,
          metric_value: index + 1,
          opportunities: 10,
        })),
      ),
    ]);

    renderWithProviders(<ClientSessionTrendsTab client={{ id: 'client-1' }} />, {
      auth: { role: 'admin', userId: 'admin-user-id' },
    });

    const chart = await screen.findByTestId('session-trends-chart');

    expect(chart).toHaveTextContent('target 1:circle:10');
    expect(chart).toHaveTextContent('target 2:rectRot:20');
    expect(chart).toHaveTextContent('target 3:triangle:30');
    expect(chart).toHaveTextContent('target 4:rect:40');
    expect(chart).toHaveTextContent('target 5:star:50');
    expect(chart).toHaveTextContent('target 6:crossRot:60');
    expect(chart).toHaveTextContent('target 7:cross:70');
  });

  it('keeps marker and color pairs distinct across the full target encoding cycle', async () => {
    vi.mocked(fetchClientSessionNotes).mockResolvedValue([
      createSessionNote(
        'many-encoded-targets',
        '2025-06-15',
        Array.from({ length: 100 }, (_, index) => ({
          target: `target ${index + 1}`,
          metric_value: index + 1,
          opportunities: 100,
        })),
      ),
    ]);

    renderWithProviders(<ClientSessionTrendsTab client={{ id: 'client-1' }} />, {
      auth: { role: 'admin', userId: 'admin-user-id' },
    });

    const chart = await screen.findByTestId('session-trends-chart');
    const encodings = (chart.textContent ?? '')
      .split(';')
      .map((entry) => {
        const parts = entry.split(':');
        return `${parts.at(-3)}:${parts.at(-1)}`;
      });

    expect(chart).toHaveTextContent('target 1:circle:1:#2563eb');
    expect(chart).toHaveTextContent('target 11:circle:11:#a855f7');
    expect(new Set(encodings).size).toBe(100);
  });

  it('exposes a download button for the rendered trend graph', async () => {
    const originalCreateElement = document.createElement.bind(document);
    const click = vi.fn();
    const anchor = originalCreateElement('a');
    anchor.click = click;
    const createElement = vi.spyOn(document, 'createElement').mockImplementation((tagName, options) => {
      if (tagName === 'a') {
        return anchor;
      }
      return originalCreateElement(tagName, options);
    });

    renderWithProviders(<ClientSessionTrendsTab client={{ id: 'client-1' }} />, {
      auth: { role: 'admin', userId: 'admin-user-id' },
    });

    fireEvent.click(await screen.findByRole('button', { name: /Download graph/i }));

    expect(anchor.getAttribute('href')).toBe('data:image/png;base64,chart-image');
    expect(anchor.getAttribute('download')).toMatch(/^session-trends-client-1-\d{4}-\d{2}-\d{2}\.png$/);
    expect(click).toHaveBeenCalled();

    createElement.mockRestore();
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
