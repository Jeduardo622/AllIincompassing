import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders, screen, userEvent, waitFor } from '../../test/utils';
import Signup from '../Signup';
import Login from '../Login';
import { useAuth } from '../../lib/authContext';
import { getConsoleGuard } from '../../test/utils/consoleGuard';

vi.mock('../../lib/authContext');
vi.mock('../../lib/toast', () => ({
  showError: vi.fn(),
  showSuccess: vi.fn(),
}));

const guard = getConsoleGuard();
const mockedUseAuth = vi.mocked(useAuth);

describe('Auth page logging redaction', () => {
  beforeEach(() => {
    guard.resetCapturedLogs();
    vi.clearAllMocks();
  });

  it('masks PHI when signup flow logs an error', async () => {
    const signUp = vi.fn().mockResolvedValue({
      error: new Error('Signup failed for patient jane.doe@example.com with MRN 998877'),
    });

    mockedUseAuth.mockReturnValue({
      user: null,
      profile: null,
      session: null,
      loading: false,
      signIn: vi.fn(),
      signUp,
      signOut: vi.fn(),
      resetPassword: vi.fn(),
      updateProfile: vi.fn(),
      hasRole: vi.fn().mockReturnValue(false),
      hasAnyRole: vi.fn().mockReturnValue(false),
      isAdmin: vi.fn().mockReturnValue(false),
      isSuperAdmin: vi.fn().mockReturnValue(false),
    });

    renderWithProviders(<Signup />);

    await userEvent.type(screen.getByLabelText(/First Name/i), 'Jane');
    await userEvent.type(screen.getByLabelText(/Last Name/i), 'Doe');
    await userEvent.type(screen.getByLabelText(/Email address/i), 'jane.doe@example.com');
    await userEvent.type(screen.getByLabelText(/^Password/i), 'StrongPass!1');
    await userEvent.type(screen.getByLabelText(/Confirm Password/i), 'StrongPass!1');

    await userEvent.click(screen.getByRole('button', { name: /Create account/i }));

    await waitFor(() => {
      expect(signUp).toHaveBeenCalled();
    });

    const logs = guard.getCapturedLogs('error');
    expect(logs).not.toHaveLength(0);
    const combined = logs.join(' ');
    expect(combined).not.toContain('jane.doe@example.com');
    expect(combined).not.toContain('998877');
    expect(combined).toMatch(/\*\*\*\*/);
  });

  it('masks PHI when login flow logs an error', async () => {
    const signIn = vi.fn().mockResolvedValue({
      error: new Error('Login denied for user leak@example.com with MRN 445566'),
    });

    mockedUseAuth.mockReturnValue({
      user: null,
      profile: null,
      session: null,
      loading: false,
      signIn,
      signUp: vi.fn(),
      signOut: vi.fn(),
      resetPassword: vi.fn(),
      updateProfile: vi.fn(),
      hasRole: vi.fn().mockReturnValue(false),
      hasAnyRole: vi.fn().mockReturnValue(false),
      isAdmin: vi.fn().mockReturnValue(false),
      isSuperAdmin: vi.fn().mockReturnValue(false),
    });

    renderWithProviders(<Login />);

    await userEvent.type(screen.getByLabelText(/Email address/i), 'leak@example.com');
    await userEvent.type(screen.getByLabelText(/^Password/i), 'Password123!');

    await userEvent.click(screen.getByRole('button', { name: /Sign in/i }));

    await waitFor(() => {
      expect(signIn).toHaveBeenCalled();
    });

    const logs = guard.getCapturedLogs('error');
    expect(logs).not.toHaveLength(0);
    const combined = logs.join(' ');
    expect(combined).not.toContain('leak@example.com');
    expect(combined).not.toContain('445566');
    expect(combined).toMatch(/\*\*\*\*/);
  });
});
