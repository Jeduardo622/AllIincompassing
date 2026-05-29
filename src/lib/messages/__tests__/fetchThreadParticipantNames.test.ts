import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpcMock = vi.fn();

vi.mock('../../supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
  },
}));

import { fetchThreadParticipantNames } from '../fetchThreadParticipantNames';

describe('fetchThreadParticipantNames', () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  it('dedupes concurrent requests for the same thread id', async () => {
    let resolveRpc: ((value: { data: unknown; error: null }) => void) | undefined;
    rpcMock.mockImplementation(() => new Promise((resolve) => {
      resolveRpc = resolve;
    }));

    const first = fetchThreadParticipantNames('thread-1');
    const second = fetchThreadParticipantNames('thread-1');

    expect(rpcMock).toHaveBeenCalledTimes(1);

    resolveRpc?.({
      data: [{ user_id: 'user-a', full_name: 'Alex Admin' }],
      error: null,
    });

    await expect(first).resolves.toEqual(new Map([['user-a', 'Alex Admin']]));
    await expect(second).resolves.toEqual(new Map([['user-a', 'Alex Admin']]));
  });

  it('issues a new request after the previous one settles', async () => {
    rpcMock.mockResolvedValue({
      data: [{ user_id: 'user-a', full_name: 'Alex Admin' }],
      error: null,
    });

    await fetchThreadParticipantNames('thread-1');
    await fetchThreadParticipantNames('thread-1');

    expect(rpcMock).toHaveBeenCalledTimes(2);
  });
});
