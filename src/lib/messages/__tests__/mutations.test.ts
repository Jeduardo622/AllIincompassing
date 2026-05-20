import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createThread, markThreadRead, sendMessage } from '../mutations';

const { rpcMock, fromMock, insertMock, updateMock, eqMock, participantsTableMock } = vi.hoisted(() => {
  const insertMock = vi.fn();
  const updateMock = vi.fn();
  const eqMock = vi.fn();
  const rpcMock = vi.fn();
  const participantsTableMock = {
    update: updateMock.mockReturnValue({ eq: eqMock }),
  };
  const fromMock = vi.fn((table: string) => {
    if (table === 'messages') {
      return { insert: insertMock };
    }
    if (table === 'message_thread_participants') {
      return participantsTableMock;
    }
    throw new Error(`Unexpected table ${table}`);
  });
  return { rpcMock, fromMock, insertMock, updateMock, eqMock, participantsTableMock };
});

vi.mock('../../supabase', () => ({
  supabase: {
    rpc: rpcMock,
    from: fromMock,
  },
}));

describe('staff messaging mutations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    eqMock.mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
    insertMock.mockResolvedValue({ error: null });
    rpcMock.mockResolvedValue({ data: 'thread-uuid-1', error: null });
  });

  it('calls create_staff_message_thread RPC for direct threads', async () => {
    const threadId = await createThread({
      subject: 'Coordination',
      threadType: 'direct',
      participantUserIds: ['user-a', 'user-b'],
    });

    expect(threadId).toBe('thread-uuid-1');
    expect(rpcMock).toHaveBeenCalledWith('create_staff_message_thread', {
      p_subject: 'Coordination',
      p_thread_type: 'direct',
      p_participant_user_ids: ['user-a', 'user-b'],
    });
  });

  it('inserts messages with trimmed body', async () => {
    await sendMessage({
      threadId: 'thread-1',
      senderId: 'user-a',
      body: '  Synthetic staff note  ',
    });

    expect(insertMock).toHaveBeenCalledWith({
      thread_id: 'thread-1',
      sender_id: 'user-a',
      body: 'Synthetic staff note',
    });
  });

  it('rejects empty message bodies', async () => {
    await expect(
      sendMessage({
        threadId: 'thread-1',
        senderId: 'user-a',
        body: '   ',
      }),
    ).rejects.toThrow(/empty/i);
  });

  it('updates participant last_read_at for markThreadRead', async () => {
    await markThreadRead('thread-1', 'user-a');

    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        last_read_at: expect.any(String),
      }),
    );
    expect(eqMock).toHaveBeenCalledWith('thread_id', 'thread-1');
  });
});
