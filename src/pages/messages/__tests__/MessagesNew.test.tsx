import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

import { PHI_POLICY_BANNER } from '../../../lib/messages/constants';
import { MessagesNew } from '../MessagesNew';

vi.mock('../../../lib/authContext', () => ({
  useAuth: () => ({
    profile: { id: 'user-1' },
    effectiveRole: 'therapist',
  }),
}));

vi.mock('../../../lib/organization', () => ({
  useActiveOrganizationId: () => 'org-1',
}));

vi.mock('../../../lib/messages/fetchStaffRecipients', () => ({
  fetchStaffRecipients: vi.fn(async () => [
    { id: 'staff-2', full_name: 'Alex Admin', email: 'alex@test.com', role: 'admin' },
  ]),
}));

const renderPage = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <MessagesNew />
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

describe('MessagesNew', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows PHI policy banner for compose', async () => {
    renderPage();
    expect(await screen.findByText(PHI_POLICY_BANNER)).toBeInTheDocument();
  });

  it('does not offer group thread type for therapists', async () => {
    renderPage();
    await screen.findByTestId('staff-recipient-picker');
    expect(screen.queryByRole('radio', { name: /group/i })).not.toBeInTheDocument();
  });
});
