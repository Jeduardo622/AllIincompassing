import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { RoleGuard } from '../RoleGuard';

type MockAuthValue = {
  readonly user: unknown;
  readonly loading: boolean;
  readonly hasAnyRole?: (roles: readonly string[]) => boolean;
};

vi.mock('../../lib/authContext', () => ({
  useAuth: vi.fn<() => MockAuthValue>(),
}));

import { useAuth } from '../../lib/authContext';

const renderProtectedRoute = (): void => {
  render(
    <MemoryRouter initialEntries={['/protected']}>
      <Routes>
        <Route
          path="/protected"
          element={(
            <RoleGuard roles={['admin']}>
              <div>protected</div>
            </RoleGuard>
          )}
        />
        <Route path="/login" element={<div>login-page</div>} />
        <Route path="/unauthorized" element={<div>unauthorized-page</div>} />
      </Routes>
    </MemoryRouter>,
  );
};

describe('RoleGuard route guard behaviour', () => {
  it('route guard redirects unauthenticated users to login', async () => {
    vi.mocked(useAuth).mockReturnValue({ user: null, loading: false });

    renderProtectedRoute();

    expect(await screen.findByText('login-page')).toBeInTheDocument();
  });

  it('route guard denies access when role requirement not satisfied', async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 'user-1' },
      loading: false,
      hasAnyRole: vi.fn().mockReturnValue(false),
    });

    renderProtectedRoute();

    expect(await screen.findByText('unauthorized-page')).toBeInTheDocument();
  });

  it('route guard renders children when authorized', async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 'user-1' },
      loading: false,
      hasAnyRole: vi.fn().mockReturnValue(true),
    });

    renderProtectedRoute();

    expect(await screen.findByText('protected')).toBeInTheDocument();
  });
});
