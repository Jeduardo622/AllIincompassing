import { beforeEach, describe, expect, it, vi } from 'vitest';

const fromMock = vi.fn();
const rpcMock = vi.fn();

vi.mock('../../supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => fromMock(...args),
    rpc: (...args: unknown[]) => rpcMock(...args),
  },
}));

import { fetchThreadMessages } from '../fetchers';

describe('fetchThreadMessages', () => {
  beforeEach(() => {
    fromMock.mockReset();
    rpcMock.mockReset();
  });

  it('enriches messages with sender_name from participant names RPC', async () => {
    const orderMock = vi.fn().mockResolvedValue({
      data: [
        {
          id: 'msg-1',
          thread_id: 'thread-1',
          sender_id: 'user-a',
          body: 'Hello',
          created_at: '2026-05-22T12:00:00.000Z',
        },
        {
          id: 'msg-2',
          thread_id: 'thread-1',
          sender_id: 'user-b',
          body: 'Reply',
          created_at: '2026-05-22T12:01:00.000Z',
        },
      ],
      error: null,
    });
    const eqMock = vi.fn().mockReturnValue({ order: orderMock });
    const selectMock = vi.fn().mockReturnValue({ eq: eqMock });
    fromMock.mockReturnValue({ select: selectMock });

    rpcMock.mockResolvedValue({
      data: [
        { user_id: 'user-a', full_name: 'Alex Admin' },
        { user_id: 'user-b', full_name: 'Taylor Therapist' },
      ],
      error: null,
    });

    const messages = await fetchThreadMessages('thread-1');

    expect(fromMock).toHaveBeenCalledWith('messages');
    expect(rpcMock).toHaveBeenCalledWith('list_staff_message_thread_participant_names', {
      p_thread_id: 'thread-1',
    });
    expect(messages).toEqual([
      expect.objectContaining({
        id: 'msg-1',
        sender_id: 'user-a',
        sender_name: 'Alex Admin',
      }),
      expect.objectContaining({
        id: 'msg-2',
        sender_id: 'user-b',
        sender_name: 'Taylor Therapist',
      }),
    ]);
  });

  it('falls back to Staff member when sender is missing from RPC map', async () => {
    const orderMock = vi.fn().mockResolvedValue({
      data: [
        {
          id: 'msg-1',
          thread_id: 'thread-1',
          sender_id: 'unknown-user',
          body: 'Hello',
          created_at: '2026-05-22T12:00:00.000Z',
        },
      ],
      error: null,
    });
    const eqMock = vi.fn().mockReturnValue({ order: orderMock });
    const selectMock = vi.fn().mockReturnValue({ eq: eqMock });
    fromMock.mockReturnValue({ select: selectMock });

    rpcMock.mockResolvedValue({
      data: [{ user_id: 'user-a', full_name: 'Alex Admin' }],
      error: null,
    });

    const messages = await fetchThreadMessages('thread-1');

    expect(messages[0]?.sender_name).toBe('Staff member');
  });
});
