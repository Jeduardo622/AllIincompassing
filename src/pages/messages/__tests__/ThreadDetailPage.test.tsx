import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Routes, Route } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { renderWithProviders, screen, waitFor } from '../../../test/utils';
import { ThreadDetailPage } from '../ThreadDetailPage';
import { PHI_POLICY_BANNER } from '../../../lib/messages/constants';

const {
  useThreadDetailMock,
  useThreadMessagesMock,
  useSendMessageMutationMock,
  useMarkThreadReadMutationMock,
} = vi.hoisted(() => ({
  useThreadDetailMock: vi.fn(),
  useThreadMessagesMock: vi.fn(),
  useSendMessageMutationMock: vi.fn(),
  useMarkThreadReadMutationMock: vi.fn(),
}));

vi.mock('../../../lib/authContext', () => ({
  useAuth: () => ({
    user: { id: 'admin-user-id' },
    effectiveRole: 'admin',
  }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../../../lib/messages/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/messages/hooks')>();
  return {
    ...actual,
    useThreadDetail: (threadId: string | undefined) => useThreadDetailMock(threadId),
    useThreadMessages: (threadId: string | undefined) => useThreadMessagesMock(threadId),
    useSendMessageMutation: (threadId: string | undefined) => useSendMessageMutationMock(threadId),
    useMarkThreadReadMutation: (threadId: string | undefined) => useMarkThreadReadMutationMock(threadId),
  };
});

const threadDetail = {
  id: 'thread-1',
  subject: 'Ops sync',
  threadType: 'direct' as const,
  updatedAt: '2026-05-20T12:00:00.000Z',
  createdAt: '2026-05-20T10:00:00.000Z',
  participants: [
    { userId: 'admin-user-id', fullName: 'Admin', email: 'admin@example.com' },
    { userId: 'staff-b', fullName: 'Staff B', email: 'b@example.com' },
  ],
};

describe('ThreadDetailPage', () => {
  const mutateAsync = vi.fn().mockResolvedValue(undefined);
  const markReadMutate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    useThreadDetailMock.mockReturnValue({
      data: threadDetail,
      isLoading: false,
      isError: false,
    });
    useThreadMessagesMock.mockReturnValue({
      data: [
        {
          id: 'msg-1',
          threadId: 'thread-1',
          senderId: 'staff-b',
          body: 'Ready for handoff',
          createdAt: '2026-05-20T11:00:00.000Z',
        },
      ],
      isLoading: false,
    });
    useSendMessageMutationMock.mockReturnValue({
      mutateAsync,
      isPending: false,
    });
    useMarkThreadReadMutationMock.mockReturnValue({
      mutate: markReadMutate,
    });
  });

  it('renders thread messages, PHI banner, and marks read on load', async () => {
    renderWithProviders(
      <Routes>
        <Route path="/messages/:threadId" element={<ThreadDetailPage />} />
      </Routes>,
      { router: { initialEntries: ['/messages/thread-1'] } },
    );

    expect(screen.getByText(PHI_POLICY_BANNER)).toBeInTheDocument();
    expect(screen.getByText('Ops sync')).toBeInTheDocument();
    expect(screen.getByText('Ready for handoff')).toBeInTheDocument();

    await waitFor(() => {
      expect(markReadMutate).toHaveBeenCalled();
    });
  });

  it('sends a message from the composer', async () => {
    const user = userEvent.setup();

    renderWithProviders(
      <Routes>
        <Route path="/messages/:threadId" element={<ThreadDetailPage />} />
      </Routes>,
      { router: { initialEntries: ['/messages/thread-1'] } },
    );

    await user.type(screen.getByLabelText(/message body/i), 'Thanks, noted.');
    await user.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith({ body: 'Thanks, noted.' });
    });
  });
});
