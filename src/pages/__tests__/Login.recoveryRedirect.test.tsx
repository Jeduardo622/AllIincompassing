import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders, screen, userEvent, waitFor } from '../../test/utils';
import { Login } from '../Login';
import { useAuth } from '../../lib/authContext';
import { showError } from '../../lib/toast';

const mockNavigate = vi.fn();
const mockLocation = {
  state: { from: { pathname: '/clients', search: '?tab=active', hash: '#section-1' } },
  pathname: '/login',
  search: '',
  hash: '',
  key: 'test',
};

vi.mock('../../lib/authContext');
vi.mock('../../lib/toast', () => ({
  showError: vi.fn(),
  showSuccess: vi.fn(),
}));
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useLocation: () => mockLocation,
  };
});

const mockedUseAuth = vi.mocked(useAuth);
const mockedShowError = vi.mocked(showError);

describe('Login recovery redirect behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLocation.state = { from: { pathname: '/clients', search: '?tab=active', hash: '#section-1' } };
    mockLocation.pathname = '/login';
    mockLocation.search = '';
    mockLocation.hash = '';
  });

  it('prioritizes password recovery redirect over normal logged-in redirect', async () => {
    mockedUseAuth.mockReturnValue({
      user: { id: 'user-1', email: 'user@example.com' } as never,
      profile: null,
      session: null,
      loading: false,
      profileLoading: false,
      metadataRole: null,
      effectiveRole: 'client',
      roleMismatch: false,
      authFlow: 'password_recovery',
      signIn: vi.fn(),
      signUp: vi.fn(),
      signOut: vi.fn(),
      resetPassword: vi.fn(),
      updateProfile: vi.fn(),
      hasRole: vi.fn().mockReturnValue(false),
      hasAnyRole: vi.fn().mockReturnValue(false),
      isAdmin: vi.fn().mockReturnValue(false),
      isSuperAdmin: vi.fn().mockReturnValue(false),
    });

    renderWithProviders(<Login />, { auth: false });

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/auth/recovery', { replace: true });
    });
    expect(mockNavigate).not.toHaveBeenCalledWith('/clients?tab=active#section-1', { replace: true });
  });

  it('preserves pathname, search, and hash when redirecting logged-in users', async () => {
    mockedUseAuth.mockReturnValue({
      user: { id: 'user-1', email: 'user@example.com' } as never,
      profile: null,
      session: null,
      loading: false,
      profileLoading: false,
      metadataRole: null,
      effectiveRole: 'client',
      roleMismatch: false,
      isGuardian: false,
      authFlow: 'normal',
      signIn: vi.fn(),
      signUp: vi.fn(),
      signOut: vi.fn(),
      resetPassword: vi.fn(),
      updateProfile: vi.fn(),
      hasRole: vi.fn().mockReturnValue(false),
      hasAnyRole: vi.fn().mockReturnValue(false),
      isAdmin: vi.fn().mockReturnValue(false),
      isSuperAdmin: vi.fn().mockReturnValue(false),
    });

    renderWithProviders(<Login />, { auth: false });

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/clients?tab=active#section-1', { replace: true });
    });
  });

  it('shows a sanitized login error message for provider failures', async () => {
    const signIn = vi.fn().mockResolvedValue({
      error: new Error('GoTrueException: unexpected provider failure at auth.gotrue.internal'),
    });

    mockedUseAuth.mockReturnValue({
      user: null,
      profile: null,
      session: null,
      loading: false,
      profileLoading: false,
      metadataRole: null,
      effectiveRole: 'client',
      roleMismatch: false,
      isGuardian: false,
      authFlow: 'normal',
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

    renderWithProviders(<Login />, { auth: false });

    await userEvent.type(screen.getByLabelText(/Email address/i), 'user@example.com');
    await userEvent.type(screen.getByLabelText(/^Password/i), 'SomePass123!');
    await userEvent.click(screen.getByRole('button', { name: /Sign in/i }));

    await waitFor(() => {
      expect(mockedShowError).toHaveBeenCalledWith(
        'Unable to sign in right now. Please try again in a moment.'
      );
    });
  });

  it('renders recovery invalid-session messages as errors from route state', async () => {
    mockLocation.state = {
      message: 'Password recovery session is invalid or expired. Request a new reset email.',
      messageType: 'error',
    };

    mockedUseAuth.mockReturnValue({
      user: null,
      profile: null,
      session: null,
      loading: false,
      profileLoading: false,
      metadataRole: null,
      effectiveRole: 'client',
      roleMismatch: false,
      isGuardian: false,
      authFlow: 'normal',
      signIn: vi.fn(),
      signUp: vi.fn(),
      signOut: vi.fn(),
      resetPassword: vi.fn(),
      updateProfile: vi.fn(),
      hasRole: vi.fn().mockReturnValue(false),
      hasAnyRole: vi.fn().mockReturnValue(false),
      isAdmin: vi.fn().mockReturnValue(false),
      isSuperAdmin: vi.fn().mockReturnValue(false),
    });

    renderWithProviders(<Login />, { auth: false });

    expect(
      await screen.findByText('Password recovery session is invalid or expired. Request a new reset email.')
    ).toBeInTheDocument();
  });
});
