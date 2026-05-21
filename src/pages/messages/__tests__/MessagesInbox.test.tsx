import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

import { PHI_POLICY_BANNER } from '../../../lib/messages/constants';
import { MessagesInbox } from '../MessagesInbox';

vi.mock('../../../lib/authContext', () => ({
  useAuth: () => ({
    profile: { id: 'user-1' },
  }),
}));

vi.mock('../../../lib/organization', () => ({
  useActiveOrganizationId: () => 'org-1',
}));

vi.mock('../../../lib/messages/fetchers', () => ({
  fetchMessageThreads: vi.fn(async () => ({ threads: [], schemaUnavailable: false })),
}));

const renderPage = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <MessagesInbox />
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

describe('MessagesInbox', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows PHI policy banner', async () => {
    renderPage();
    expect(await screen.findByText(PHI_POLICY_BANNER)).toBeInTheDocument();
  });
});
