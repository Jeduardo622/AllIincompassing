import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderWithProviders, screen, waitFor } from '../../test/utils';
import { Authorizations } from '../Authorizations';
import type { UserProfile } from '../../lib/authContext';

const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn() }));

vi.mock('../../lib/authContext', () => ({
  useAuth: () => useAuthMock(),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const emptyAuthRow = {
  id: 'auth-1',
  authorization_number: 'AUTH-1',
  client_id: 'client-x',
  provider_id: 'therapist-b',
  insurance_provider_id: 'ins-1',
  diagnosis_code: 'F84.0',
  diagnosis_description: 'Autistic disorder',
  start_date: '2025-01-01',
  end_date: '2025-12-31',
  status: 'pending' as const,
  created_at: '2025-01-01T00:00:00.000Z',
  updated_at: '2025-01-01T00:00:00.000Z',
  client: { id: 'client-x', full_name: 'Extra Client' },
  provider: { id: 'therapist-b', full_name: 'Other Therapist' },
  services: [] as unknown[],
};

const {
  fetchClientsMock,
  supabaseFromMock,
  therapistsSelectMock,
  therapistsInMock,
  therapistsOrderAfterInMock,
  therapistsOrderFullMock,
} = vi.hoisted(() => {
  const fetchClientsMock = vi.fn();
  const therapistsSelectMock = vi.fn();
  const therapistsInMock = vi.fn();
  const therapistsOrderAfterInMock = vi.fn();
  const therapistsOrderFullMock = vi.fn();

  const supabaseFromMock = vi.fn((table: string) => {
    if (table === 'authorizations') {
      return {
        select: vi.fn(() => ({
          order: vi.fn(() =>
            Promise.resolve({
              data: [emptyAuthRow],
              error: null,
            }),
          ),
        })),
      };
    }
    if (table === 'therapists') {
      therapistsSelectMock.mockReturnValue({
        in: therapistsInMock.mockImplementation(() => ({
          order: therapistsOrderAfterInMock.mockImplementation(() =>
            Promise.resolve({ data: [{ id: 'therapist-b', full_name: 'Other Therapist' }], error: null }),
          ),
        })),
        order: therapistsOrderFullMock.mockImplementation(() =>
          Promise.resolve({ data: [{ id: 't-all', full_name: 'Everyone' }], error: null }),
        ),
      });
      return {
        select: therapistsSelectMock,
      };
    }
    return {
      select: vi.fn(() => ({
        order: vi.fn(() => Promise.resolve({ data: [], error: null })),
      })),
    };
  });

  return {
    fetchClientsMock,
    supabaseFromMock,
    therapistsSelectMock,
    therapistsInMock,
    therapistsOrderAfterInMock,
    therapistsOrderFullMock,
  };
});

vi.mock('../../lib/clients/fetchers', () => ({
  fetchClients: (...args: unknown[]) => fetchClientsMock(...args),
}));

vi.mock('../../lib/supabase', () => ({
  supabase: { from: supabaseFromMock },
}));

vi.mock('../../components/AuthorizationModal', () => ({
  AuthorizationModal: () => null,
}));

vi.mock('../../lib/authorizations/mutations', () => ({
  createAuthorizationWithServices: vi.fn(),
  updateAuthorizationWithServices: vi.fn(),
}));

const baseProfile = (overrides: Partial<UserProfile>): UserProfile => ({
  id: 'user-id',
  email: 'user@example.com',
  role: 'therapist',
  organization_id: 'org-1',
  is_active: true,
  created_at: '2025-01-01T00:00:00.000Z',
  updated_at: '2025-01-01T00:00:00.000Z',
  ...overrides,
});

describe('Authorizations page query scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchClientsMock.mockResolvedValue([
      {
        id: 'client-1',
        full_name: 'Scoped Client',
        email: 'c@example.com',
        date_of_birth: '2010-01-01',
        insurance_info: {},
        service_preference: [],
        one_to_one_units: 0,
        supervision_units: 0,
        parent_consult_units: 0,
        assessment_units: 0,
        auth_units: 0,
        availability_hours: {
          monday: { start: null, end: null },
          tuesday: { start: null, end: null },
          wednesday: { start: null, end: null },
          thursday: { start: null, end: null },
          friday: { start: null, end: null },
          saturday: { start: null, end: null },
          sunday: { start: null, end: null },
        },
        created_at: '2025-01-01T00:00:00.000Z',
        updated_at: '2025-01-01T00:00:00.000Z',
      },
    ]);
  });

  it('uses scoped client fetch and bounded therapist fetch for therapist role', async () => {
    const therapistUserId = 'therapist-user-uuid';

    useAuthMock.mockReturnValue({
      user: null,
      effectiveRole: 'therapist',
      profile: baseProfile({
        id: therapistUserId,
        role: 'therapist',
        organization_id: 'org-therapist-1',
      }),
    });

    renderWithProviders(<Authorizations />, { auth: false });

    await waitFor(() => {
      expect(fetchClientsMock).toHaveBeenCalled();
    });

    expect(fetchClientsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-therapist-1',
        therapistId: therapistUserId,
        allowAll: false,
      }),
    );

    await waitFor(() => {
      expect(therapistsInMock).toHaveBeenCalled();
    });

    await waitFor(() => {
      const lastCall = therapistsInMock.mock.calls.at(-1);
      expect(lastCall?.[0]).toBe('id');
      const idList = lastCall?.[1] as string[];
      expect(idList).toContain(therapistUserId);
      expect(idList).toContain('therapist-b');
    });

    expect(therapistsOrderFullMock).not.toHaveBeenCalled();
  });

  it('uses allowAll clients and full therapist list query for admin role', async () => {
    useAuthMock.mockReturnValue({
      user: null,
      effectiveRole: 'admin',
      profile: baseProfile({
        id: 'admin-user',
        role: 'admin',
        organization_id: 'org-admin-1',
      }),
    });

    renderWithProviders(<Authorizations />, { auth: false });

    await waitFor(() => {
      expect(fetchClientsMock).toHaveBeenCalledWith({ allowAll: true });
    });

    await waitFor(() => {
      expect(therapistsOrderFullMock).toHaveBeenCalled();
    });

    expect(therapistsInMock).not.toHaveBeenCalled();
    expect(screen.getByText('Authorizations')).toBeInTheDocument();
  });
});
