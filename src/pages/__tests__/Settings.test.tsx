import { describe, expect, it, afterEach, vi } from 'vitest';
import { useLocation } from 'react-router-dom';
import { renderWithProviders, screen } from '../../test/utils';
import { Settings } from '../Settings';
import * as authContext from '../../lib/authContext';

vi.mock('../SuperAdminFeatureFlags', () => ({
  SuperAdminFeatureFlags: () => <div>FeatureFlagsPanel</div>,
}));

vi.mock('../SuperAdminImpersonation', () => ({
  SuperAdminImpersonation: () => <div>ImpersonationPanel</div>,
}));

const LocationProbe = () => {
  const location = useLocation();
  return <div data-testid="settings-location">{location.pathname}</div>;
};

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

  it('opens the feature flags tab from a settings deep link for super admins', () => {
    useAuthSpy.mockReturnValue({
      isSuperAdmin: () => true,
    } as unknown as ReturnType<typeof authContext.useAuth>);

    renderWithProviders(<Settings />, {
      router: { initialEntries: ['/settings/feature-flags'] },
    });

    expect(screen.getByRole('button', { name: /Feature Flags/i })).toHaveClass('border-blue-500');
    expect(screen.getByText('FeatureFlagsPanel')).toBeInTheDocument();
  });

  it('opens the impersonation tab from a settings deep link for super admins', () => {
    useAuthSpy.mockReturnValue({
      isSuperAdmin: () => true,
    } as unknown as ReturnType<typeof authContext.useAuth>);

    renderWithProviders(<Settings />, {
      router: { initialEntries: ['/settings/impersonation'] },
    });

    expect(screen.getByRole('button', { name: /Impersonation/i })).toHaveClass('border-blue-500');
    expect(screen.getByText('ImpersonationPanel')).toBeInTheDocument();
  });

  it.each([
    ['/settings/feature-flags', 'FeatureFlagsPanel'],
    ['/settings/impersonation', 'ImpersonationPanel'],
  ])('normalizes non-super-admin deep links from %s to personal settings', async (path, hiddenPanel) => {
    useAuthSpy.mockReturnValue({
      user: { id: 'admin-user-id', email: 'admin@example.com' },
      isSuperAdmin: () => false,
    } as unknown as ReturnType<typeof authContext.useAuth>);

    renderWithProviders(
      <>
        <Settings />
        <LocationProbe />
      </>,
      {
        router: { initialEntries: [path] },
      },
    );

    expect(await screen.findByTestId('settings-location')).toHaveTextContent('/settings');
    expect(screen.getByRole('heading', { name: /Personal Settings/i })).toBeInTheDocument();
    expect(screen.queryByText(hiddenPanel)).not.toBeInTheDocument();
  });
});
