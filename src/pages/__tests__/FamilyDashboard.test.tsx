import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderWithProviders, screen, userEvent } from '../../test/utils';
import { FamilyDashboard } from '../FamilyDashboard';

const mockGuardianClients = [
  {
    clientId: 'child-1',
    fullName: 'Sunny Sky',
    relationship: 'Parent',
    isPrimaryGuardian: true,
    dateOfBirth: '2015-03-01T00:00:00.000Z',
    email: 'sunny@example.com',
    phone: '555-0100',
    status: 'Active',
    upcomingSessions: [
      {
        id: 'session-1',
        startTime: '2025-01-04T15:00:00.000Z',
        endTime: '2025-01-04T16:00:00.000Z',
        status: 'Scheduled',
        therapist: { id: 'therapist-1', fullName: 'Alex Therapist' },
      },
      {
        id: 'session-2',
        startTime: '2025-01-05T15:00:00.000Z',
        endTime: '2025-01-05T16:00:00.000Z',
        status: 'in progress',
        therapist: { id: 'therapist-1', fullName: 'Alex Therapist' },
      },
      {
        id: 'session-3',
        startTime: '2025-01-06T15:00:00.000Z',
        endTime: '2025-01-06T16:00:00.000Z',
        status: 'canceled',
        therapist: { id: 'therapist-1', fullName: 'Alex Therapist' },
      },
      {
        id: 'session-4',
        startTime: '2025-01-07T15:00:00.000Z',
        endTime: '2025-01-07T16:00:00.000Z',
        status: 'completed',
        therapist: { id: 'therapist-1', fullName: 'Alex Therapist' },
      },
      {
        id: 'session-5',
        startTime: '2025-01-08T15:00:00.000Z',
        endTime: '2025-01-08T16:00:00.000Z',
        status: 'no_show',
        therapist: { id: 'therapist-1', fullName: 'Alex Therapist' },
      },
    ],
    notes: [
      {
        id: 'note-1',
        content: 'Worked on communication goals and shared progress update.',
        createdAt: '2025-01-02T20:15:00.000Z',
        status: 'open',
        createdBy: 'therapist-1',
        createdByName: 'Alex Therapist',
        isVisibleToParent: true,
        isVisibleToTherapist: true,
      },
    ],
  },
];

const mockMetadata = [
  {
    clientId: 'child-1',
    metadata: {
      last_confirmed_at: '2025-01-01T18:30:00.000Z',
    },
  },
];

const mockConfirm = {
  mutateAsync: vi.fn(async (clientId: string) => {
    mockConfirm.variables = clientId;
    return { confirmedAt: new Date().toISOString(), metadata: {} };
  }),
  isPending: false,
  variables: undefined as string | undefined,
};

vi.mock('../../lib/clients/hooks', () => ({
  useGuardianClients: () => ({ data: mockGuardianClients, isLoading: false, isError: false }),
  useGuardianContactMetadata: () => ({ data: mockMetadata, isLoading: false }),
  useConfirmGuardianContact: () => mockConfirm,
}));

vi.mock('../../lib/authContext', () => ({
  useAuth: () => ({
    profile: { first_name: 'Morgan', role: 'client' },
    user: { email: 'guardian@example.com' },
  }),
}));

describe('FamilyDashboard', () => {
  beforeEach(() => {
    mockConfirm.mutateAsync.mockClear();
    mockConfirm.variables = undefined;
  });

  it('renders kiddo details, sessions, and notes', () => {
    renderWithProviders(<FamilyDashboard />);

    expect(screen.getByText(/Welcome back, Morgan/i)).toBeInTheDocument();
    expect(screen.getByText('Sunny Sky')).toBeInTheDocument();
    expect(screen.getByText(/Primary guardian/i)).toBeInTheDocument();
    expect(screen.getByText(/Worked on communication goals/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Confirm my contact details/i })).toBeInTheDocument();
    expect(screen.getByText(/Last confirmed/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Session status: Scheduled')).toBeInTheDocument();
    expect(screen.getByLabelText('Session status: In Session')).toBeInTheDocument();
    expect(screen.getByLabelText('Session status: Cancelled')).toBeInTheDocument();
    expect(screen.getByLabelText('Session status: Completed')).toBeInTheDocument();
    expect(screen.getByLabelText('Session status: No-show')).toBeInTheDocument();
    expect(screen.getByText('In Session')).toHaveAttribute('data-session-status', 'in_progress');
    expect(screen.getByText('Cancelled')).toHaveAttribute('data-session-status', 'cancelled');
    expect(screen.getByText('Completed')).toHaveAttribute('data-session-status', 'completed');
    expect(screen.getByText('No-show')).toHaveAttribute('data-session-status', 'no-show');
  });

  it('allows guardians to confirm their contact details', async () => {
    renderWithProviders(<FamilyDashboard />);

    const confirmButton = screen.getByRole('button', { name: /Confirm my contact details/i });
    await userEvent.click(confirmButton);

    expect(mockConfirm.mutateAsync).toHaveBeenCalledWith('child-1');
  });

  it('renders a safe fallback when session status is unknown', () => {
    const originalStatus = mockGuardianClients[0].upcomingSessions[0].status;
    mockGuardianClients[0].upcomingSessions[0].status = 'unexpected_status';
    try {
      renderWithProviders(<FamilyDashboard />);

      const fallbackBadge = screen.getByText('Status unavailable');
      expect(fallbackBadge).toHaveAttribute('data-session-status', 'unknown');
      expect(fallbackBadge).toHaveAttribute('aria-label', 'Session status unavailable');
      expect(fallbackBadge).toHaveAttribute('title', 'Reported status: unexpected_status');
    } finally {
      mockGuardianClients[0].upcomingSessions[0].status = originalStatus;
    }
  });

  it('renders a safe fallback when session status is missing', () => {
    const originalStatus = mockGuardianClients[0].upcomingSessions[0].status;
    mockGuardianClients[0].upcomingSessions[0].status = '   ';
    try {
      renderWithProviders(<FamilyDashboard />);

      const fallbackBadge = screen.getByText('Status unavailable');
      expect(fallbackBadge).toHaveAttribute('data-session-status', 'unknown');
      expect(fallbackBadge).toHaveAttribute('aria-label', 'Session status unavailable');
      expect(fallbackBadge).not.toHaveAttribute('title');
    } finally {
      mockGuardianClients[0].upcomingSessions[0].status = originalStatus;
    }
  });
});
