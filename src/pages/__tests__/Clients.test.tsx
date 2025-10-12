import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  renderWithProviders,
  screen,
  userEvent,
  waitFor,
} from '../../test/utils';
import Clients from '../Clients';
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
    date_of_birth: null,
    service_preference: [],
    one_to_one_units: 10,
    supervision_units: 5,
    parent_consult_units: 3,
    availability_hours: {},
    created_at: '2025-01-01T00:00:00.000Z',
    deleted_at: null,
  },
  {
    id: 'client-2',
    full_name: 'Archived Client',
    email: 'archived@example.com',
    client_id: 'AC-002',
    date_of_birth: null,
    service_preference: [],
    one_to_one_units: 8,
    supervision_units: 2,
    parent_consult_units: 1,
    availability_hours: {},
    created_at: '2025-01-01T00:00:00.000Z',
    deleted_at: '2025-01-10T00:00:00.000Z',
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
  it('shows only archived clients when the archived filter is selected', async () => {
    renderWithProviders(<Clients />);

    const archivedSelect = screen.getAllByRole('combobox')[3];
    await userEvent.selectOptions(archivedSelect, 'archived');

    await waitFor(() => {
      expect(screen.getByText('Archived Client')).toBeInTheDocument();
      expect(screen.queryByText('Active Client')).not.toBeInTheDocument();
    });
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

    const deleteButtons = screen.getAllByRole('button', { name: /delete/i });
    expect(deleteButtons).toHaveLength(1);

    await userEvent.click(deleteButtons[0]);

    expect(mutationHandlers[3]?.mutateAsync).toHaveBeenCalledWith('client-1');

    confirmSpy.mockRestore();
  });

  it('hides the delete action when the viewer is not a super admin', () => {
    isSuperAdminMock.mockReturnValue(false);

    renderWithProviders(<Clients />);

    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
  });
});
