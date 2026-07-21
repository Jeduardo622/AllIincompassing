import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor } from '../../test/utils';
import { renderWithProviders } from '../../test/utils';
import { ClientSessionTrendsTab } from '../ClientDetails/ClientSessionTrendsTab';
import { fetchClientSessionNotes } from '../../lib/session-notes';
import { callApi } from '../../lib/api';
import { supabase } from '../../lib/supabase';

vi.mock('react-chartjs-2', () => ({
  Line: React.forwardRef(({
    data,
    options,
  }: {
    data: { labels: string[]; datasets: Array<{ label: string; data: Array<number | null>; pointStyle?: string; borderColor?: string }> };
    options?: { scales?: { y?: { max?: number } } };
  }, ref) => {
    if (ref && typeof ref !== 'function') {
      ref.current = {
        toBase64Image: vi.fn(() => 'data:image/png;base64,chart-image'),
      };
    }

    return (
      <div data-testid="session-trends-chart">
        {data.labels.join(',')}:{data.datasets.map((dataset) => `${dataset.label}:${dataset.pointStyle}:${dataset.data.join('|')}:${dataset.borderColor}`).join(';')}:yMax={options?.scales?.y?.max ?? 'unset'}
      </div>
    );
  }),
  Bar: React.forwardRef(({
    data,
    options,
  }: {
    data: { labels: string[]; datasets: Array<{ label: string; data: Array<number | null> }> };
    options?: { scales?: { y?: { max?: number } } };
  }, ref) => {
    if (ref && typeof ref !== 'function') {
      ref.current = {
        toBase64Image: vi.fn(() => 'data:image/png;base64,outcome-chart-image'),
      };
    }

    return (
      <div data-testid="prompt-outcomes-chart">
        {data.labels.join(',')}:{data.datasets.map((dataset) => `${dataset.label}:${dataset.data.join('|')}`).join(';')}:yMax={options?.scales?.y?.max ?? 'unset'}
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

vi.mock('../../lib/api', () => ({
  callApi: vi.fn(),
}));

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
    vi.mocked(callApi).mockImplementation(async (path: string) => {
      if (path === '/api/goal-targets?goal_id=goal-1') {
        return new Response(JSON.stringify([
          {
            id: 'target-1',
            organization_id: '5238e88b-6198-4862-80a2-dbe15bbeabdd',
            client_id: 'client-1',
            goal_id: 'goal-1',
            name: 'lost in community',
            measurement_type: 'correctIncorrect',
            graph_config: { defaultChart: 'bar', source: 'trial_events' },
            status: 'active',
            sort_order: 0,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
          {
            id: 'target-2',
            organization_id: '5238e88b-6198-4862-80a2-dbe15bbeabdd',
            client_id: 'client-1',
            goal_id: 'goal-1',
            name: 'cross street safely',
            measurement_type: 'correctIncorrect',
            graph_config: { defaultChart: 'bar', source: 'trial_events' },
            status: 'active',
            sort_order: 1,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
        ]), { status: 200 });
      }
      if (path.startsWith('/api/trial-events?view=prompt_outcomes&')) {
        return new Response(JSON.stringify([
          {
            id: 'prompt-event-1',
            session_id: 'session-1',
            target_id: 'target-1',
            goal_id: 'goal-1',
            therapist_id: 'therapist-1',
            response: 'correct',
            event_timestamp: '2025-06-01T17:00:00.000Z',
          },
          {
            id: 'prompt-event-2',
            session_id: 'session-1',
            target_id: 'target-2',
            goal_id: 'goal-1',
            therapist_id: 'therapist-1',
            response: 'incorrect',
            event_timestamp: '2025-06-01T17:05:00.000Z',
          },
          {
            id: 'prompt-event-3',
            session_id: 'session-2',
            target_id: 'target-1',
            goal_id: 'goal-1',
            therapist_id: 'therapist-1',
            response: 'noResponse',
            event_timestamp: '2025-06-08T17:00:00.000Z',
          },
        ]), { status: 200 });
      }
      throw new Error(`Unhandled API path ${path}`);
    });
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
    expect(await screen.findByTestId('prompt-outcomes-chart')).toHaveTextContent('Correct:33.3;Incorrect:33.3;No response:33.3:yMax=100');
  });

  it('fetches prompt outcomes with an exclusive end date and renders compact evidence counts', async () => {
    renderWithProviders(<ClientSessionTrendsTab client={{ id: 'client-1' }} />, {
      auth: { role: 'admin', userId: 'admin-user-id' },
    });

    await screen.findByTestId('prompt-outcomes-chart');

    expect(callApi).toHaveBeenCalledWith(
      '/api/trial-events?view=prompt_outcomes&client_id=client-1&goal_id=goal-1&start_at=2024-12-01T00%3A00%3A00.000Z&end_before=2025-07-01T00%3A00%3A00.000Z',
    );
    expect(screen.getByRole('button', { name: /Download outcome graph/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Correct' })).toBeInTheDocument();
    expect(screen.getAllByText('cross street safely').length).toBeGreaterThan(0);
    expect(screen.getAllByText('1 (100%)').length).toBeGreaterThan(0);
  });

  it('renders each target as a separate chart series with distinct point symbols', async () => {
    renderWithProviders(<ClientSessionTrendsTab client={{ id: 'client-1' }} />, {
      auth: { role: 'admin', userId: 'admin-user-id' },
    });

    const chart = await screen.findByTestId('session-trends-chart');

    expect(chart).toHaveTextContent('lost in community:circle:90');
    expect(chart).toHaveTextContent('cross street safely:rectRot:45');
    expect(chart).toHaveTextContent('yMax=100');
  });

  it('expands the chart scale and flags evidence above 100 percent', async () => {
    vi.mocked(fetchClientSessionNotes).mockResolvedValue([
      createSessionNote('over-range-note', '2025-06-15', [
        { target: 'complete opportunities independently', metric_value: 8, opportunities: 7 },
      ]),
    ]);

    renderWithProviders(<ClientSessionTrendsTab client={{ id: 'client-1' }} />, {
      auth: { role: 'admin', userId: 'admin-user-id' },
    });

    const chart = await screen.findByTestId('session-trends-chart');

    expect(chart).toHaveTextContent('complete opportunities independently:circle:114.3');
    expect(chart).toHaveTextContent('yMax=120');
    expect(screen.getByText('1 plotted value exceeds 100% because recorded successes are greater than opportunities.')).toBeInTheDocument();
    expect(screen.getByText('114.3% (8/7)')).toBeInTheDocument();
  });

  it('keeps the scale and warning aligned with aggregated plotted medians', async () => {
    vi.mocked(fetchClientSessionNotes).mockResolvedValue([
      createSessionNote('over-range-note', '2025-06-15', [
        { target: 'complete opportunities independently', metric_value: 8, opportunities: 7 },
      ]),
      createSessionNote('lower-companion-note', '2025-06-22', [
        { target: 'complete opportunities independently', metric_value: 8, opportunities: 10 },
      ]),
    ]);

    renderWithProviders(<ClientSessionTrendsTab client={{ id: 'client-1' }} />, {
      auth: { role: 'admin', userId: 'admin-user-id' },
    });

    const chart = await screen.findByTestId('session-trends-chart');

    expect(chart).toHaveTextContent('complete opportunities independently:circle:97.1');
    expect(chart).toHaveTextContent('yMax=100');
    expect(screen.queryByText(/plotted value.*100%/i)).not.toBeInTheDocument();
    expect(screen.getByText('114.3% (8/7)')).toBeInTheDocument();
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

  it('can filter the trend graph to a single therapist series', async () => {
    vi.mocked(fetchClientSessionNotes).mockResolvedValue([
      {
        ...createSessionNote('jane-note', '2025-06-01', [
          { target: 'lost in community', metric_value: 8, opportunities: 10 },
        ]),
        therapist_id: 'therapist-jane',
        therapist_name: 'Jane Analyst',
      },
      {
        ...createSessionNote('pat-note', '2025-06-08', [
          { target: 'lost in community', metric_value: 4, opportunities: 10 },
        ]),
        therapist_id: 'therapist-pat',
        therapist_name: 'Pat BCBA',
      },
    ]);

    renderWithProviders(<ClientSessionTrendsTab client={{ id: 'client-1' }} />, {
      auth: { role: 'admin', userId: 'admin-user-id' },
    });

    await screen.findByTestId('session-trends-chart');
    fireEvent.change(screen.getByLabelText('Therapist'), { target: { value: 'therapist-pat' } });

    await waitFor(() => expect(screen.getByText('Therapist: Pat BCBA')).toBeInTheDocument());
    expect(screen.getByTestId('session-trends-chart')).toHaveTextContent('lost in community:circle:40');
    expect(screen.getByTestId('session-trends-chart')).not.toHaveTextContent('Jane Analyst');
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

  it('renders prompt outcomes when the median chart has no graphable data', async () => {
    vi.mocked(fetchClientSessionNotes).mockResolvedValue([
      createSessionNote('1', '2025-06-01', []),
      createSessionNote('2', '2025-06-08', []),
    ]);

    renderWithProviders(<ClientSessionTrendsTab client={{ id: 'client-1' }} />, {
      auth: { role: 'admin', userId: 'admin-user-id' },
    });

    expect(await screen.findByText('No graphable trial data')).toBeInTheDocument();
    expect(await screen.findByTestId('prompt-outcomes-chart')).toBeInTheDocument();
  });

  it('shows the exact prompt outcome empty copy', async () => {
    const defaultCallApi = vi.mocked(callApi).getMockImplementation();
    vi.mocked(callApi).mockImplementation(async (path: string) => (
      path.startsWith('/api/trial-events?view=prompt_outcomes&')
        ? new Response(JSON.stringify([]), { status: 200 })
        : defaultCallApi!(path)
    ));

    renderWithProviders(<ClientSessionTrendsTab client={{ id: 'client-1' }} />, {
      auth: { role: 'admin', userId: 'admin-user-id' },
    });

    expect(await screen.findByText('No prompted outcome data in the selected range.')).toBeInTheDocument();
  });

  it('surfaces a prompt outcome fetch error', async () => {
    const defaultCallApi = vi.mocked(callApi).getMockImplementation();
    vi.mocked(callApi).mockImplementation(async (path: string) => (
      path.startsWith('/api/trial-events?view=prompt_outcomes&')
        ? new Response(null, { status: 500 })
        : defaultCallApi!(path)
    ));

    renderWithProviders(<ClientSessionTrendsTab client={{ id: 'client-1' }} />, {
      auth: { role: 'admin', userId: 'admin-user-id' },
    });

    expect(await screen.findByText('Prompt outcomes failed to load.')).toBeInTheDocument();
  });
});
