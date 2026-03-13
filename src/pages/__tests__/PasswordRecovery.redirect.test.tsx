import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders, screen, waitFor } from '../../test/utils';
import { PasswordRecovery } from '../PasswordRecovery';
import { useAuth } from '../../lib/authContext';

const mockNavigate = vi.fn();
const mockLocation = {
  pathname: '/auth/recovery',
  search: '',
  hash: '',
  state: null,
  key: 'test',
};

vi.mock('../../lib/authContext');
vi.mock('../../lib/toast', () => ({
  showSuccess: vi.fn(),
}));
vi.mock('../../lib/supabaseClient', () => ({
  supabase: {
    auth: {
      updateUser: vi.fn(),
      signOut: vi.fn(),
    },
  },
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

describe('PasswordRecovery redirect guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLocation.search = '';
    mockLocation.hash = '';
  });

  it('does not render recovery form while auth is loading', () => {
    mockedUseAuth.mockReturnValue({
      user: null,
      profile: null,
      session: null,
      loading: true,
      profileLoading: false,
      metadataRole: null,
      effectiveRole: 'client',
      roleMismatch: false,
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

    renderWithProviders(<PasswordRecovery />, { auth: false });

    expect(screen.queryByText('Set a new password')).not.toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('redirects invalid recovery sessions and never renders recovery form', async () => {
    mockedUseAuth.mockReturnValue({
      user: null,
      profile: null,
      session: null,
      loading: false,
      profileLoading: false,
      metadataRole: null,
      effectiveRole: 'client',
      roleMismatch: false,
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

    renderWithProviders(<PasswordRecovery />, { auth: false });

    expect(screen.queryByText('Set a new password')).not.toBeInTheDocument();
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/login', {
        replace: true,
        state: {
          message: 'Password recovery session is invalid or expired. Request a new reset email.',
        },
      });
    });
  });

  it('waits briefly before redirecting when recovery callback params are present', async () => {
    mockLocation.hash = '#type=recovery&access_token=test-access-token&refresh_token=test-refresh-token';

    mockedUseAuth.mockReturnValue({
      user: null,
      profile: null,
      session: null,
      loading: false,
      profileLoading: false,
      metadataRole: null,
      effectiveRole: 'client',
      roleMismatch: false,
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

    renderWithProviders(<PasswordRecovery />, { auth: false });

    expect(mockNavigate).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(mockNavigate).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/login', {
        replace: true,
        state: {
          message: 'Password recovery session is invalid or expired. Request a new reset email.',
        },
      });
    }, { timeout: 2500 });
  });

  it('renders recovery form for valid recovery sessions without redirecting', async () => {
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

    renderWithProviders(<PasswordRecovery />, { auth: false });

    expect(screen.getByText('Set a new password')).toBeInTheDocument();
    await waitFor(() => {
      expect(mockNavigate).not.toHaveBeenCalled();
    });
  });
});
