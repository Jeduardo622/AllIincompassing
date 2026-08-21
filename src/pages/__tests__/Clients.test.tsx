import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  renderWithProviders,
  screen,
  userEvent,
  waitFor,
} from '../../test/utils';
import { Clients } from '../Clients';
const invalidateQueries = vi.fn();
const useQueryMock = vi.fn();
const mutationHandlers: Array<{ options: any; mutateAsync: ReturnType<typeof vi.fn> }> = [];
const useMutationMock = vi.fn();

const isSuperAdminMock = vi.fn(() => true);

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');

  return {
    ...actual,
    useQuery: (options: unknown) => useQueryMock(options),
    useMutation: (options: unknown) => useMutationMock(options),
    useQueryClient: () => ({ invalidateQueries }),
  };
});

vi.mock('../../lib/authContext', () => ({
  useAuth: () => ({
    isSuperAdmin: isSuperAdminMock,
    effectiveRole: isSuperAdminMock() ? 'super_admin' : 'admin',
    hasCapability: () => true,
  }),
}));

vi.mock('../../lib/toast', async () => {
  const actual = await vi.importActual<typeof import('../../lib/toast')>('../../lib/toast');

  return {
    ...actual,
    showSuccess: vi.fn(),
    showError: vi.fn(),
  };
});

const mockClients = [
  {
    id: 'client-1',
    full_name: 'Active Client',
    email: 'active@example.com',
    client_id: 'AC-001',
    date_of_birth: '2015-04-20',
    insurance_info: { provider: 'Blue Shield', policy_number: 'AC-001' },
    service_preference: ['ABA Therapy'],
    one_to_one_units: 10,
    supervision_units: 5,
    parent_consult_units: 3,
    assessment_units: 2,
    availability_hours: {
      monday: { start: '09:00', end: '15:00' },
      tuesday: { start: '09:00', end: '15:00' },
      wednesday: { start: '09:00', end: '15:00' },
      thursday: { start: '09:00', end: '15:00' },
      friday: { start: '09:00', end: '15:00' },
      saturday: { start: null, end: null },
      sunday: { start: null, end: null },
    },
    created_at: '2025-01-01T00:00:00.000Z',
    deleted_at: null,
  },
  {
    id: 'client-2',
    full_name: 'Archived Client',
    email: 'archived@example.com',
    client_id: 'AC-002',
    date_of_birth: '2016-09-10',
    insurance_info: { provider: 'Aetna', policy_number: 'AC-002' },
    service_preference: ['Speech Therapy'],
    one_to_one_units: 8,
    supervision_units: 2,
    parent_consult_units: 1,
    assessment_units: 0,
    availability_hours: {
      monday: { start: '10:00', end: '14:00' },
      tuesday: { start: '10:00', end: '14:00' },
      wednesday: { start: '10:00', end: '14:00' },
      thursday: { start: '10:00', end: '14:00' },
      friday: { start: '10:00', end: '14:00' },
      saturday: { start: null, end: null },
      sunday: { start: null, end: null },
    },
    created_at: '2025-01-01T00:00:00.000Z',
    deleted_at: '2025-01-10T00:00:00.000Z',
  },
  {
    id: 'client-3',
    full_name: 'Jose O’Connor',
    email: 'jose.oconnor@example.com',
    client_id: 'JOSE-123',
    date_of_birth: '2017-03-15',
    insurance_info: { provider: 'Kaiser', policy_number: 'JOSE-123' },
    service_preference: ['ABA Therapy'],
    one_to_one_units: 6,
    supervision_units: 1,
    parent_consult_units: 0,
    assessment_units: 0,
    availability_hours: {
      monday: { start: '11:00', end: '13:00' },
      tuesday: { start: null, end: null },
      wednesday: { start: null, end: null },
      thursday: { start: null, end: null },
      friday: { start: null, end: null },
      saturday: { start: null, end: null },
      sunday: { start: null, end: null },
    },
    created_at: '2025-01-01T00:00:00.000Z',
    deleted_at: null,
  },
];

beforeEach(() => {
  invalidateQueries.mockClear();
  useQueryMock.mockReset();
  useMutationMock.mockReset();
  mutationHandlers.length = 0;
  isSuperAdminMock.mockReset();
  isSuperAdminMock.mockReturnValue(true);

  useQueryMock.mockReturnValue({ data: mockClients, isLoading: false });
  useMutationMock.mockImplementation((options: any) => {
    const mutateAsync = vi.fn();
    mutationHandlers.push({ options, mutateAsync });
    return { mutateAsync, isPending: false, isSuccess: false };
  });
});

describe('Clients page filtering', () => {
  it('shows a search-specific empty state when filters remove all clients', async () => {
    renderWithProviders(<Clients />);

    const searchInput = screen.getByRole('textbox', { name: /search clients/i });
    await userEvent.type(searchInput, 'missing client');

    await waitFor(() => {
      expect(screen.getByText('No clients match your search criteria')).toBeInTheDocument();
    });

    expect(screen.queryByText('No clients found')).not.toBeInTheDocument();
  });

  it('shows only archived clients when the archived filter is selected', async () => {
    renderWithProviders(<Clients />);

    const archivedSelect = screen.getAllByRole('combobox')[3];
    await userEvent.selectOptions(archivedSelect, 'archived');

    await waitFor(() => {
      expect(screen.getByText('Archived Client')).toBeInTheDocument();
      expect(screen.queryByText('Active Client')).not.toBeInTheDocument();
    });
  });

  it('matches displayed names across apostrophe and diacritic variants while preserving email and client ID search', async () => {
    renderWithProviders(<Clients />);

    const searchInput = screen.getByRole('textbox', { name: /search clients/i });

    await userEvent.type(searchInput, "josé o'connor");
    await waitFor(() => {
      expect(screen.getByText('Jose O’Connor')).toBeInTheDocument();
    });

    await userEvent.clear(searchInput);
    await userEvent.type(searchInput, 'jose.oconnor@example.com');
    await waitFor(() => {
      expect(screen.getByText('Jose O’Connor')).toBeInTheDocument();
    });

    await userEvent.clear(searchInput);
    await userEvent.type(searchInput, 'JOSE-123');
    await waitFor(() => {
      expect(screen.getByText('Jose O’Connor')).toBeInTheDocument();
    });
  });

  it('keeps the search input usable below the xl breakpoint and lets filters wrap', () => {
    renderWithProviders(<Clients />);

    const searchInput = screen.getByRole('textbox', { name: /search clients/i });
    const filterRow = searchInput.parentElement?.parentElement;

    expect(searchInput).toHaveClass('sm:min-w-[16rem]');
    expect(searchInput).toHaveClass('xl:min-w-[20rem]');
    expect(searchInput).toHaveClass('2xl:min-w-[24rem]');
    expect(filterRow).toHaveClass('sm:flex-wrap');
    expect(filterRow).toHaveClass('xl:flex-nowrap');
  });

  it('invalidates the clients query after successful mutations', () => {
    renderWithProviders(<Clients />);

    expect(mutationHandlers).toHaveLength(4);

    mutationHandlers.forEach(({ options }, index) => {
      invalidateQueries.mockClear();
      if (index === 2) {
        options.onSuccess?.({}, { restore: false });
      } else {
        options.onSuccess?.({});
      }
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['clients'] });
    });
  });

  it('invokes the delete mutation when a super admin confirms the action', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    renderWithProviders(<Clients />);

    const deleteButton = screen.getByRole('button', { name: /delete active client/i });
    await userEvent.click(deleteButton);

    expect(mutationHandlers[3]?.mutateAsync).toHaveBeenCalledWith('client-1');

    confirmSpy.mockRestore();
  });

  it('hides the delete action when the viewer is not a super admin', () => {
    isSuperAdminMock.mockReturnValue(false);

    renderWithProviders(<Clients />);

    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
  });

  it('shows a horizontal-scroll affordance and keeps the primary onboarding action touch sized with stronger green contrast', () => {
    renderWithProviders(<Clients />);

    expect(screen.getByText(/Scroll to view all client columns/i)).toBeInTheDocument();

    const onboardButton = screen.getByRole('button', { name: /onboard client/i });
    expect(onboardButton).toHaveClass('min-h-11');
    expect(onboardButton).toHaveClass('bg-green-700');
  });

  it('keeps the units summary readable instead of compressing it into a word stack', () => {
    renderWithProviders(<Clients />);

    expect(screen.getByRole('table', { name: 'Clients' })).toHaveClass('min-w-[72rem]');

    const unitsCell = screen.getByText('3 parent consult units').closest('td');
    expect(unitsCell).toHaveClass('min-w-[15rem]');
    expect(unitsCell?.firstElementChild).toHaveClass('whitespace-nowrap');
  });

  it('keeps visible mobile controls at least 44px tall and client links touch sized', () => {
    renderWithProviders(<Clients />);

    expect(screen.getByRole('link', { name: 'Active Client' })).toHaveClass('min-h-11', 'min-w-11');
    expect(screen.getByRole('textbox', { name: 'Search clients' })).toHaveClass('min-h-11');
    expect(screen.getByRole('combobox', { name: 'Filter clients by email domain' })).toHaveClass('min-h-11');
    expect(screen.getByRole('combobox', { name: 'Filter clients by service' })).toHaveClass('min-h-11');
    expect(screen.getByRole('combobox', { name: 'Filter clients by units' })).toHaveClass('min-h-11');
    expect(screen.getByRole('combobox', { name: 'Filter clients by archive status' })).toHaveClass('min-h-11');
  });
});
