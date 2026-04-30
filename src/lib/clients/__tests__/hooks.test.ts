import { describe, expect, it, vi, beforeEach } from 'vitest';

const useQueryMock = vi.fn();
const useMutationMock = vi.fn();
const useQueryClientMock = vi.fn();
const mockUseAuth = vi.fn();

vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: unknown) => useQueryMock(options),
  useMutation: (options: unknown) => useMutationMock(options),
  useQueryClient: () => useQueryClientMock(),
}));

vi.mock('../../authContext', () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock('../fetchers', () => ({
  fetchGuardianClients: vi.fn(),
  fetchGuardianClientById: vi.fn(),
  fetchGuardianContactMetadata: vi.fn(),
  fetchClientNotes: vi.fn(),
  fetchClientIssues: vi.fn(),
  confirmGuardianContactInfo: vi.fn(),
}));

describe('guardian client hooks query scoping', () => {
  beforeEach(() => {
    useQueryMock.mockReset();
    useMutationMock.mockReset();
    useQueryClientMock.mockReset();
    mockUseAuth.mockReset();
    useQueryMock.mockReturnValue({ data: [], isLoading: false, isError: false });
    useMutationMock.mockReturnValue({});
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
  });

  it('scopes guardian client list queries by signed-in guardian id', async () => {
    mockUseAuth.mockReturnValue({
      user: { id: 'guardian-a' },
      isGuardian: true,
    });

    const { useGuardianClients } = await import('../hooks');
    useGuardianClients();

    expect(useQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ['guardian', 'clients', 'guardian-a'],
        enabled: true,
      }),
    );
  });

  it('scopes guardian client detail queries by guardian id and client id', async () => {
    mockUseAuth.mockReturnValue({
      user: { id: 'guardian-b' },
      isGuardian: true,
    });

    const { useGuardianClient } = await import('../hooks');
    useGuardianClient('client-1');

    expect(useQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ['guardian', 'clients', 'guardian-b', 'client-1'],
        enabled: true,
      }),
    );
  });

  it('disables guardian queries when no signed-in guardian is available', async () => {
    mockUseAuth.mockReturnValue({
      user: null,
      isGuardian: false,
    });

    const { useGuardianClients, useGuardianClient } = await import('../hooks');
    useGuardianClients();
    useGuardianClient('client-2');

    expect(useQueryMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        queryKey: ['guardian', 'clients', 'anonymous'],
        enabled: false,
      }),
    );
    expect(useQueryMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        queryKey: ['guardian', 'clients', 'anonymous', 'client-2'],
        enabled: false,
      }),
    );
  });
});
