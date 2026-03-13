import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders, waitFor } from '../../test/utils';
import { Login } from '../Login';
import { useAuth } from '../../lib/authContext';

const mockNavigate = vi.fn();

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
    useLocation: () => ({
      state: { from: { pathname: '/clients' } },
      pathname: '/login',
      search: '',
      hash: '',
      key: 'test',
    }),
  };
});

const mockedUseAuth = vi.mocked(useAuth);

describe('Login recovery redirect behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    expect(mockNavigate).not.toHaveBeenCalledWith('/clients', { replace: true });
  });
});
