import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OrganizationSettings } from '../../settings/OrganizationSettings';

vi.mock('../../../lib/authContext', async () => {
  const actual = await vi.importActual<any>('../../../lib/authContext');
  return {
    ...actual,
    useAuth: () => ({
      profile: { role: 'bt' },
      effectiveRole: 'super_admin',
      hasCapability: () => true,
    }),
  };
});

describe('OrganizationSettings', () => {
  it('renders single-clinic messaging', () => {
    render(<OrganizationSettings />);

    expect(
      screen.getByText(/Multi-organization features are temporarily paused/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Single-clinic mode active/i)).toBeInTheDocument();
  });

  it('renders current access from the effective role before the stored profile role', () => {
    render(<OrganizationSettings />);

    expect(screen.getByText(/Current access:/i)).toHaveTextContent('Current access: super admin');
  });
});


