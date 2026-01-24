import { describe, expect, it, afterEach, vi } from 'vitest';
import { renderWithProviders, screen } from '../../test/utils';
import Settings from '../Settings';
import * as authContext from '../../lib/authContext';

describe('Settings', () => {
  const useAuthSpy = vi.spyOn(authContext, 'useAuth');

  afterEach(() => {
    useAuthSpy.mockReset();
  });

  it('shows super admin tabs for super admin users', () => {
    useAuthSpy.mockReturnValue({
      isSuperAdmin: () => true,
    } as unknown as ReturnType<typeof authContext.useAuth>);

    renderWithProviders(<Settings />);

    expect(screen.getByRole('button', { name: /Feature Flags/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Impersonation/i })).toBeInTheDocument();
  });

  it('hides super admin tabs for non-super admins', () => {
    useAuthSpy.mockReturnValue({
      isSuperAdmin: () => false,
    } as unknown as ReturnType<typeof authContext.useAuth>);

    renderWithProviders(<Settings />);

    expect(screen.queryByRole('button', { name: /Feature Flags/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Impersonation/i })).not.toBeInTheDocument();
  });
});
