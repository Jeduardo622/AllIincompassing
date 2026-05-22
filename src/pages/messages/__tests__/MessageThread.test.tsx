import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { PHI_COMPOSER_PLACEHOLDER, PHI_POLICY_BANNER } from '../../../lib/messages/constants';
import { MessageThread } from '../MessageThread';

vi.mock('../../../lib/authContext', () => ({
  useAuth: () => ({
    profile: { id: 'user-1' },
  }),
}));

vi.mock('../../../lib/messages/fetchers', () => ({
  fetchMessageThread: vi.fn(async () => ({
    id: 'thread-1',
    organization_id: 'org-1',
    created_by: 'user-1',
    subject: 'Handoff',
    thread_type: 'direct',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  })),
  fetchThreadMessages: vi.fn(async () => ([
    {
      id: 'message-1',
      thread_id: 'thread-1',
      sender_id: 'user-2',
      sender_name: 'Alex Admin',
      body: 'Hello from Alex',
      created_at: '2026-05-22T12:00:00.000Z',
    },
    {
      id: 'message-2',
      thread_id: 'thread-1',
      sender_id: 'user-1',
      sender_name: 'Taylor Therapist',
      body: 'Reply from Taylor',
      created_at: '2026-05-22T12:01:00.000Z',
    },
  ])),
}));

vi.mock('../../../lib/messages/mutations', () => ({
  markThreadRead: vi.fn(async () => undefined),
  sendThreadMessage: vi.fn(),
}));

const renderPage = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/messages/thread-1']}>
        <Routes>
          <Route path="/messages/:threadId" element={<MessageThread />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

describe('MessageThread', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows PHI policy and composer placeholder', async () => {
    renderPage();
    expect(await screen.findByText(PHI_POLICY_BANNER)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(PHI_COMPOSER_PLACEHOLDER)).toBeInTheDocument();
  });

  it('shows sender names for both incoming and outgoing messages', async () => {
    renderPage();

    expect(await screen.findByTestId('message-sender-message-1')).toHaveTextContent('Alex Admin');
    expect(screen.getByTestId('message-sender-message-2')).toHaveTextContent('Taylor Therapist');
  });
});
