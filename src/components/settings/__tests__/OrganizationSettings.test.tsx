import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import OrganizationSettings from '../../settings/OrganizationSettings';

vi.mock('../../../lib/authContext', async () => {
  const actual = await vi.importActual<any>('../../../lib/authContext');
  return {
    ...actual,
    useAuth: () => ({
      user: { id: 'user-1', user_metadata: {} },
      profile: { role: 'super_admin' },
    }),
  };
});

vi.mock('../../../lib/edgeInvoke', async () => {
  return {
    edgeInvoke: vi.fn(async () => ({ data: { organization: { id: 'new-org' } }, error: null, status: 201 })),
  };
});

vi.mock('../../../lib/supabase', async () => {
  return {
    supabase: {
      auth: {
        updateUser: vi.fn(async () => ({ data: null, error: null })),
      },
    },
  };
});

describe('OrganizationSettings', () => {
  it('creates organization via edge function', async () => {
    render(<OrganizationSettings />);

    await userEvent.type(screen.getByLabelText(/Organization name/i), 'Acme Behavioral');
    await userEvent.type(screen.getByLabelText(/Slug/i), 'acme-behavioral');
    await userEvent.click(screen.getByRole('button', { name: /Create organization/i }));

    expect(await screen.findByText(/Organization created|Organization saved/i)).toBeInTheDocument();
  });
});


