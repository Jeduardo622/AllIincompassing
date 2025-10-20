import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders, screen, userEvent, waitFor } from '../../test/utils';
import Signup from '../Signup';
import { useAuth } from '../../lib/authContext';
import { showError, showSuccess } from '../../lib/toast';

vi.mock('../../lib/authContext');
vi.mock('../../lib/toast', () => ({
  showError: vi.fn(),
  showSuccess: vi.fn(),
}));

const mockedUseAuth = vi.mocked(useAuth);

const buildAuthContext = (overrides: Partial<ReturnType<typeof useAuth>> = {}) => ({
  user: null,
  profile: null,
  session: null,
  loading: false,
  signIn: vi.fn(),
  signUp: vi.fn().mockResolvedValue({ error: null }),
  signOut: vi.fn(),
  resetPassword: vi.fn(),
  updateProfile: vi.fn(),
  hasRole: vi.fn().mockReturnValue(false),
  hasAnyRole: vi.fn().mockReturnValue(false),
  isAdmin: vi.fn().mockReturnValue(false),
  isSuperAdmin: vi.fn().mockReturnValue(false),
  ...overrides,
});

describe('Signup guardian flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reveals guardian-specific inputs when the guardian role is selected', async () => {
    mockedUseAuth.mockReturnValue(buildAuthContext());

    renderWithProviders(<Signup />);

    expect(screen.queryByLabelText(/Organization ID/i)).not.toBeInTheDocument();

    await userEvent.selectOptions(
      screen.getByLabelText(/Account Type/i),
      screen.getByRole('option', { name: /Guardian/i })
    );

    expect(screen.getByLabelText(/Organization ID/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Invite code/i)).toBeInTheDocument();
  });

  it('requires at least one guardian routing field before submission', async () => {
    const signUp = vi.fn().mockResolvedValue({ error: null });
    mockedUseAuth.mockReturnValue(buildAuthContext({ signUp }));

    renderWithProviders(<Signup />);

    await userEvent.selectOptions(
      screen.getByLabelText(/Account Type/i),
      screen.getByRole('option', { name: /Guardian/i })
    );

    await userEvent.type(screen.getByLabelText(/First Name/i), 'Jamie');
    await userEvent.type(screen.getByLabelText(/Last Name/i), 'Doe');
    await userEvent.type(screen.getByLabelText(/Email address/i), 'jamie.doe@example.com');
    await userEvent.type(screen.getByLabelText(/^Password/i), 'GuardianPass1!');
    await userEvent.type(screen.getByLabelText(/Confirm Password/i), 'GuardianPass1!');

    await userEvent.click(screen.getByRole('button', { name: /Create account/i }));

    expect(signUp).not.toHaveBeenCalled();
    expect(showError).toHaveBeenCalledWith(
      'Please enter either your organization ID or the invite code you received from your provider.'
    );
  });

  it('submits guardian metadata when invite code is provided', async () => {
    const signUp = vi.fn().mockResolvedValue({ error: null });
    mockedUseAuth.mockReturnValue(buildAuthContext({ signUp }));

    renderWithProviders(<Signup />);

    await userEvent.selectOptions(
      screen.getByLabelText(/Account Type/i),
      screen.getByRole('option', { name: /Guardian/i })
    );

    await userEvent.type(screen.getByLabelText(/First Name/i), 'Alex');
    await userEvent.type(screen.getByLabelText(/Last Name/i), 'Carson');
    await userEvent.type(screen.getByLabelText(/Email address/i), 'alex.carson@example.com');
    await userEvent.type(screen.getByLabelText(/^Password/i), 'GuardianPass1!');
    await userEvent.type(screen.getByLabelText(/Confirm Password/i), 'GuardianPass1!');
    await userEvent.type(screen.getByLabelText(/Invite code/i), '  INVITE-123  ');

    await userEvent.click(screen.getByRole('button', { name: /Create account/i }));

    await waitFor(() => {
      expect(signUp).toHaveBeenCalledTimes(1);
    });

    const metadata = signUp.mock.calls[0][2];
    expect(metadata).toMatchObject({
      signup_role: 'guardian',
      guardian_signup: true,
      guardian_invite_token: 'INVITE-123',
      role: 'client',
    });
    expect(metadata).not.toHaveProperty('guardian_organization_hint');
    expect(showSuccess).toHaveBeenCalled();
  });
});
