import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderWithProviders, screen, waitFor, userEvent, within } from '../../test/utils';
import { ProfileTab } from '../TherapistDetails/ProfileTab';
import { useAuth } from '../../lib/authContext';
import { supabase } from '../../lib/supabase';
import { showSuccess } from '../../lib/toast';

vi.mock('../../lib/authContext', () => ({
  useAuth: vi.fn(),
}));

vi.mock('../../lib/toast', async () => {
  const actual = await vi.importActual<typeof import('../../lib/toast')>('../../lib/toast');
  return {
    ...actual,
    showSuccess: vi.fn(),
    showError: vi.fn(),
  };
});

const therapist = {
  id: 'therapist-1',
  organization_id: '11111111-1111-1111-1111-111111111111',
  full_name: 'Taylor BT',
  title: 'BT',
  email: 'taylor.bt@example.com',
  phone: '555-0100',
};

const mockAuth = (role: 'client' | 'bt' | 'admin' | 'bcba' | 'super_admin' = 'admin') => {
  vi.mocked(useAuth).mockReturnValue({
    user: {
      id: `${role}-user-id`,
      email: `${role}@example.com`,
      user_metadata: {
        organization_id: '11111111-1111-1111-1111-111111111111',
      },
    },
    profile: {
      id: `${role}-profile-id`,
      email: `${role}@example.com`,
      role,
      organization_id: '11111111-1111-1111-1111-111111111111',
      is_active: true,
    },
    effectiveRole: role,
    hasRole: vi.fn((requiredRole: string) => {
      const ranks: Record<string, number> = {
        client: 1,
        bt: 2,
        therapist: 3,
        midtier: 4,
        admin_schedule: 5,
        admin: 6,
        bcba: 7,
        super_admin: 8,
      };
      return (ranks[role] ?? 0) >= (ranks[requiredRole] ?? 0);
    }),
    hasCapability: vi.fn(),
    hasAnyCapability: vi.fn(),
    hasAnyRole: vi.fn(),
    isAdmin: vi.fn(() => role === 'admin' || role === 'bcba' || role === 'super_admin'),
    isSuperAdmin: vi.fn(() => role === 'super_admin'),
    loading: false,
    profileLoading: false,
    session: null,
    metadataRole: role,
    roleMismatch: false,
    authFlow: 'normal',
    signIn: vi.fn(),
    signUp: vi.fn(),
    signOut: vi.fn(),
    resetPassword: vi.fn(),
    updateProfile: vi.fn(),
  } as unknown as ReturnType<typeof useAuth>);
};

describe('Therapist profile staff invite', () => {
  let invokeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockAuth('admin');
    invokeSpy = vi.spyOn(supabase.functions, 'invoke').mockResolvedValue({ data: null, error: null });
    vi.mocked(showSuccess).mockClear();
  });

  afterEach(() => {
    invokeSpy.mockRestore();
    vi.mocked(useAuth).mockReset();
  });

  it('lets admins invite the BT from their profile with a locked BT role', async () => {
    renderWithProviders(<ProfileTab therapist={therapist} />);

    await userEvent.click(screen.getByRole('button', { name: /invite to app/i }));

    const modal = screen.getByRole('dialog', { name: /invite bt to app/i });
    expect(within(modal).getByLabelText('Email*')).toHaveValue('taylor.bt@example.com');
    expect(within(modal).getByLabelText('Role*')).toHaveValue('bt');
    expect(within(modal).getByLabelText('Role*')).toBeDisabled();
    expect(within(modal).getByLabelText('Organization')).toHaveValue('11111111-1111-1111-1111-111111111111');

    await userEvent.clear(within(modal).getByLabelText('Reason for staff access*'));
    await userEvent.type(within(modal).getByLabelText('Reason for staff access*'), 'Invite Taylor for BT data collection.');
    await userEvent.click(within(modal).getByRole('button', { name: /send invite/i }));

    await waitFor(() => {
      expect(invokeSpy).toHaveBeenCalledWith(
        'admin-invite',
        expect.objectContaining({
          body: {
            email: 'taylor.bt@example.com',
            organizationId: '11111111-1111-1111-1111-111111111111',
            role: 'bt',
            reason: 'Invite Taylor for BT data collection.',
          },
        }),
      );
    });
    expect(showSuccess).toHaveBeenCalledWith('Staff invite sent successfully');
  }, 20000);

  it('does not expose the invite action to BT viewers', () => {
    mockAuth('bt');

    renderWithProviders(<ProfileTab therapist={therapist} />);

    expect(screen.queryByRole('button', { name: /invite to app/i })).not.toBeInTheDocument();
  });

  it('does not expose the invite action to BCBA viewers', () => {
    mockAuth('bcba');

    renderWithProviders(<ProfileTab therapist={therapist} />);

    expect(screen.queryByRole('button', { name: /invite to app/i })).not.toBeInTheDocument();
  });
});
