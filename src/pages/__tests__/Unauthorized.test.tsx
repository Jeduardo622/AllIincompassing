import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders, screen, userEvent } from '../../test/utils';
import { Unauthorized } from '../Unauthorized';

const navigateMock = vi.fn();
let authState = {
  user: { id: 'user-1', email: 'user@example.com' },
  profile: { role: 'therapist' },
};

vi.mock('../../lib/authContext', () => ({
  useAuth: () => authState,
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

describe('Unauthorized', () => {
  beforeEach(() => {
    authState = {
      user: { id: 'user-1', email: 'user@example.com' },
      profile: { role: 'therapist' },
    };
    navigateMock.mockReset();
  });

  it('shows sign-in specific copy and actions when there is no authenticated user', async () => {
    authState = {
      user: null,
      profile: null,
    };
    navigateMock.mockReset();

    renderWithProviders(<Unauthorized />, { auth: false });

    expect(screen.getByRole('heading', { name: /sign in required/i })).toBeInTheDocument();
    expect(screen.getByText(/sign in to continue to this page/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /go to login/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /return home/i })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /go to login/i }));
    expect(navigateMock).toHaveBeenCalledWith('/login', { replace: true });
  });

  it('shows access-denied copy and a dashboard action for authenticated users', async () => {
    renderWithProviders(<Unauthorized />);

    expect(screen.getByRole('heading', { name: /access denied/i })).toBeInTheDocument();
    expect(screen.getByText(/don't have permission/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /return to dashboard/i }));
    expect(navigateMock).toHaveBeenCalledWith('/', { replace: false });
  });
});
