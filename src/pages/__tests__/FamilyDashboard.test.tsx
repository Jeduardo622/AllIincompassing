import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderWithProviders, screen, userEvent } from '../../test/utils';
import FamilyDashboard from '../FamilyDashboard';

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
  });

  it('allows guardians to confirm their contact details', async () => {
    renderWithProviders(<FamilyDashboard />);

    const confirmButton = screen.getByRole('button', { name: /Confirm my contact details/i });
    await userEvent.click(confirmButton);

    expect(mockConfirm.mutateAsync).toHaveBeenCalledWith('child-1');
  });
});
