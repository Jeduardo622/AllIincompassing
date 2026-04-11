import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

import { PrivateRoute } from '../PrivateRoute';

type MockAuthValue = {
  readonly user: unknown;
  readonly loading: boolean;
  readonly profileLoading?: boolean;
  readonly profile?: unknown;
  readonly signOut?: () => Promise<void> | void;
};

vi.mock('../../lib/authContext', () => ({
  useAuth: vi.fn<() => MockAuthValue>(),
}));

import { useAuth } from '../../lib/authContext';

const renderProtectedRoute = (): void => {
  const LoginRoute = () => {
    const location = useLocation();
    return <div data-testid="login-page">{JSON.stringify(location.state ?? null)}</div>;
  };

  render(
    <MemoryRouter initialEntries={['/protected']}>
      <Routes>
        <Route
          path="/protected"
          element={(
            <PrivateRoute>
              <div>protected</div>
            </PrivateRoute>
          )}
        />
        <Route path="/login" element={<LoginRoute />} />
      </Routes>
    </MemoryRouter>,
  );
};

describe('PrivateRoute access behaviour', () => {
  it('shows a guarded loading fallback while auth is unresolved', () => {
    vi.mocked(useAuth).mockReturnValue({
      user: null,
      loading: true,
      profileLoading: true,
      profile: null,
      signOut: vi.fn(),
    });

    renderProtectedRoute();

    expect(screen.getByLabelText('Restoring your secure session...')).toBeInTheDocument();
    expect(screen.getByTestId('protected-shell-pending')).toBeInTheDocument();
    expect(screen.queryByText('protected')).not.toBeInTheDocument();
    expect(screen.queryByTestId('login-page')).not.toBeInTheDocument();
    expect(screen.getByTestId('protected-shell-pending').querySelector('main')).not.toHaveClass('lg:ml-64');
  });

  it('redirects unauthenticated users to login', async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: null,
      loading: false,
      profileLoading: false,
      profile: null,
      signOut: vi.fn(),
    });

    renderProtectedRoute();

    const loginStateNode = await screen.findByTestId('login-page');
    expect(loginStateNode.textContent).toContain('"pathname":"/protected"');
  });

  it('renders protected children when the user is authenticated', async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 'user-1' },
      loading: false,
      profileLoading: false,
      profile: { is_active: true },
      signOut: vi.fn(),
    });

    renderProtectedRoute();

    expect(await screen.findByText('protected')).toBeInTheDocument();
  });
});
