import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  renderWithProviders,
  screen,
  userEvent,
  waitFor,
  within,
} from '../../test/utils';
import Therapists, { matchesStatusFilter } from '../Therapists';

const invalidateQueries = vi.fn();
const useQueryMock = vi.fn();
const mutationHandlers: Array<{ options: any; mutateAsync: ReturnType<typeof vi.fn> }> = [];
const useMutationMock = vi.fn();

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');

  return {
    ...actual,
    useQuery: (options: unknown) => useQueryMock(options),
    useMutation: (options: unknown) => useMutationMock(options),
    useQueryClient: () => ({
      invalidateQueries,
    }),
  };
});

const mockTherapists = [
  {
    id: 'therapist-1',
    full_name: 'Active Therapist',
    email: 'active@example.com',
    status: 'active',
    service_type: 'In clinic',
    specialties: ['ABA Therapy'],
  },
  {
    id: 'therapist-2',
    full_name: 'Inactive Therapist',
    email: 'inactive@example.com',
    status: 'inactive',
    service_type: 'In clinic',
    specialties: ['ABA Therapy'],
  },
  {
    id: 'therapist-3',
    full_name: 'Archived Therapist',
    email: 'archived@example.com',
    status: 'inactive',
    service_type: 'Telehealth',
    specialties: ['Speech Therapy'],
    deleted_at: '2025-01-01T00:00:00.000Z',
  },
];

beforeEach(() => {
  invalidateQueries.mockClear();
  useQueryMock.mockReset();
  useMutationMock.mockReset();
  mutationHandlers.length = 0;

  useQueryMock.mockReturnValue({ data: mockTherapists, isLoading: false });
  useMutationMock.mockImplementation((options: any) => {
    const mutateAsync = vi.fn();
    mutationHandlers.push({ options, mutateAsync });
    return { mutateAsync, isPending: false, isSuccess: false };
  });
});

describe('matchesStatusFilter', () => {
  it('returns true when all statuses are selected', () => {
    expect(matchesStatusFilter('inactive', 'all')).toBe(true);
  });

  it('treats missing statuses as active', () => {
    expect(matchesStatusFilter(null, 'active')).toBe(true);
  });

  it('compares statuses case-insensitively', () => {
    expect(matchesStatusFilter('Inactive', 'inactive')).toBe(true);
  });
});

describe('Therapists page filtering', () => {
  it('hides active therapists when the Inactive filter is selected', async () => {
    renderWithProviders(<Therapists />);

    const statusSelect = screen.getAllByRole('combobox')[2];
    await userEvent.selectOptions(statusSelect, 'inactive');

    await waitFor(() => {
      expect(screen.queryByText('Active Therapist')).not.toBeInTheDocument();
    });

    const inactiveRow = screen.getByText('Inactive Therapist').closest('tr');
    expect(inactiveRow).not.toBeNull();
    expect(within(inactiveRow as HTMLTableRowElement).getByText('Inactive')).toBeInTheDocument();
  });

  it('invalidates the therapists query after successful mutations', () => {
    renderWithProviders(<Therapists />);

    expect(mutationHandlers).toHaveLength(3);

    mutationHandlers.forEach(({ options }) => {
      invalidateQueries.mockClear();
      options.onSuccess?.();
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['therapists'] });
    });
  });

  it('shows only archived therapists when the archived filter is selected', async () => {
    renderWithProviders(<Therapists />);

    const archivedSelect = screen.getAllByRole('combobox')[3];
    await userEvent.selectOptions(archivedSelect, 'archived');

    await waitFor(() => {
      expect(screen.getByText('Archived Therapist')).toBeInTheDocument();
      expect(screen.queryByText('Active Therapist')).not.toBeInTheDocument();
      expect(screen.queryByText('Inactive Therapist')).not.toBeInTheDocument();
    });
  });
});
