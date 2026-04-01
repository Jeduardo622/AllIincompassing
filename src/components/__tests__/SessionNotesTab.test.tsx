import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/utils';
import type { SessionNote } from '../../types';
import { SessionNotesTab } from '../ClientDetails/SessionNotesTab';

vi.mock('../AddSessionNoteModal', () => ({
  AddSessionNoteModal: () => null,
}));

const useQueryMock = vi.fn();
const useMutationMock = vi.fn();

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');

  return {
    ...actual,
    useQuery: (options: unknown) => useQueryMock(options),
    useMutation: (options: unknown) => useMutationMock(options),
    useQueryClient: () => ({
      invalidateQueries: vi.fn(),
    }),
  };
});

function buildSessionNote(overrides: Partial<SessionNote>): SessionNote {
  return {
    id: 'note-1',
    date: '2024-06-15',
    start_time: '09:00',
    end_time: '10:00',
    service_code: '97153',
    therapist_name: 'Test Therapist',
    therapist_id: 'therapist-1',
    goals_addressed: ['Communication'],
    goal_ids: ['goal-id-1'],
    session_id: null,
    narrative: '',
    is_locked: false,
    client_id: 'client-1',
    authorization_id: 'auth-1',
    organization_id: 'org-1',
    ...overrides,
  };
}

const authorizationFixture = [
  {
    id: 'auth-1',
    authorization_number: 'AUTH-100',
    start_date: '2024-01-01',
    end_date: '2025-12-31',
    services: [
      {
        id: 'svc-1',
        service_code: '97153',
        approved_units: 10,
        requested_units: 10,
        unit_type: 'hours',
      },
    ],
  },
];

function stubQueries(sessionNotes: SessionNote[]) {
  useQueryMock.mockImplementation((options: { queryKey: unknown[] }) => {
    const key = options.queryKey[0];
    if (key === 'authorizations') {
      return { data: authorizationFixture, isLoading: false, isRefetching: false };
    }
    if (key === 'therapists') {
      return { data: [], isLoading: false, isRefetching: false };
    }
    if (key === 'client-session-notes') {
      return { data: sessionNotes, isLoading: false, isRefetching: false };
    }
    return { data: undefined, isLoading: false, isRefetching: false };
  });
}

describe('SessionNotesTab', () => {
  beforeEach(() => {
    useQueryMock.mockReset();
    useMutationMock.mockReset();
    useMutationMock.mockReturnValue({
      mutate: vi.fn(),
      isLoading: false,
    });
  });

  it('does not render the per-note Session Notes narrative block when narrative is blank and goals are present', () => {
    stubQueries([
      buildSessionNote({
        narrative: '',
        goals_addressed: ['Per-goal detail target'],
      }),
    ]);

    renderWithProviders(<SessionNotesTab client={{ id: 'client-1' }} />);

    expect(screen.queryByText('Session Notes:')).toBeNull();
    expect(screen.getByText('Per-goal detail target')).toBeInTheDocument();
    expect(screen.getByText('Goals Addressed:')).toBeInTheDocument();
  });

  it('does not render the narrative block for whitespace-only narrative', () => {
    stubQueries([buildSessionNote({ narrative: '  \n\t  ', goals_addressed: ['G1'] })]);

    renderWithProviders(<SessionNotesTab client={{ id: 'client-1' }} />);

    expect(screen.queryByText('Session Notes:')).toBeNull();
    expect(screen.getByText('G1')).toBeInTheDocument();
  });

  it('renders the Session Notes narrative block when narrative has content', () => {
    stubQueries([
      buildSessionNote({
        narrative: 'Client made excellent progress today.',
        goals_addressed: ['Motor skills'],
      }),
    ]);

    renderWithProviders(<SessionNotesTab client={{ id: 'client-1' }} />);

    expect(screen.getByText('Session Notes:')).toBeInTheDocument();
    expect(screen.getByText('Client made excellent progress today.')).toBeInTheDocument();
    expect(screen.getByText('Motor skills')).toBeInTheDocument();
  });
});
