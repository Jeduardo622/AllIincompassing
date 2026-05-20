import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Routes, Route } from 'react-router-dom';
import { renderWithProviders, screen } from '../../../test/utils';
import { MessagesInboxPage } from '../MessagesInboxPage';
import { PHI_POLICY_BANNER } from '../../../lib/messages/constants';

const useInboxThreadsMock = vi.fn();

vi.mock('../../../lib/messages/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/messages/hooks')>();
  return {
    ...actual,
    useInboxThreads: () => useInboxThreadsMock(),
  };
});

describe('MessagesInboxPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders inbox threads and PHI banner', () => {
    useInboxThreadsMock.mockReturnValue({
      data: [
        {
          threadId: 'thread-1',
          subject: 'Handoff',
          threadType: 'direct',
          updatedAt: '2026-05-20T12:00:00.000Z',
          lastReadAt: null,
          latestMessageBody: 'See you at 3pm',
          latestMessageAt: '2026-05-20T12:00:00.000Z',
          latestMessageSenderId: 'user-a',
        },
      ],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      isFetching: false,
    });

    renderWithProviders(
      <Routes>
        <Route path="/messages" element={<MessagesInboxPage />} />
      </Routes>,
      { router: { initialEntries: ['/messages'] }, auth: { role: 'admin', userId: 'admin-user-id' } },
    );

    expect(screen.getByText(PHI_POLICY_BANNER)).toBeInTheDocument();
    expect(screen.getByText('Handoff')).toBeInTheDocument();
    expect(screen.getByText(/See you at 3pm/i)).toBeInTheDocument();
  });
});
