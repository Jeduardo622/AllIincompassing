import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
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
  fetchMessageThreads: vi.fn(async () => ({
    threads: [
      {
        id: 'thread-1',
        organization_id: 'org-1',
        created_by: 'user-1',
        subject: null,
        thread_type: 'direct',
        created_at: '2026-05-22T12:00:00.000Z',
        updated_at: '2026-05-22T12:01:00.000Z',
        last_message_preview: 'Latest note',
        last_message_at: '2026-05-22T12:01:00.000Z',
        participant_names: ['Alex Admin'],
      },
    ],
    schemaUnavailable: false,
  })),
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

  it('shows participant names for direct-message inbox rows without subjects', async () => {
    renderPage();

    expect(await screen.findByText('Alex Admin')).toBeInTheDocument();
    expect(screen.queryByText('Direct message')).not.toBeInTheDocument();
  });

  it('searches inbox threads by participant name', async () => {
    renderPage();

    const search = await screen.findByTestId('messages-inbox-search');
    fireEvent.change(search, { target: { value: 'alex' } });

    expect(screen.getByTestId('message-thread-row-thread-1')).toBeInTheDocument();
  });
});
