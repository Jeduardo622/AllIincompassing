import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import OrganizationSettings from '../../settings/OrganizationSettings';

vi.mock('../../../lib/authContext', async () => {
  const actual = await vi.importActual<any>('../../../lib/authContext');
  return {
    ...actual,
    useAuth: () => ({
      profile: { role: 'super_admin' },
      effectiveRole: 'super_admin',
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
});


