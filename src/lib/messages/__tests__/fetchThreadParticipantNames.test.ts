import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rpcMock, getUserMock, onAuthStateChangeMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  onAuthStateChangeMock: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
}));

vi.mock('../../supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    auth: {
      onAuthStateChange: (...args: unknown[]) => onAuthStateChangeMock(...args),
    },
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

  it('clears in-flight dedupe entries on auth state change', async () => {
    const authListener = onAuthStateChangeMock.mock.calls[0]?.[0] as (() => void) | undefined;
    expect(authListener).toBeTypeOf('function');

    let resolveFirst: ((value: { data: unknown; error: null }) => void) | undefined;
    let resolveSecond: ((value: { data: unknown; error: null }) => void) | undefined;
    let callCount = 0;
    rpcMock.mockImplementation(() => new Promise((resolve) => {
      callCount += 1;
      if (callCount === 1) {
        resolveFirst = resolve;
      } else {
        resolveSecond = resolve;
      }
    }));

    const first = fetchThreadParticipantNames('thread-1');
    authListener?.();
    const second = fetchThreadParticipantNames('thread-1');

    expect(rpcMock).toHaveBeenCalledTimes(2);

    resolveFirst?.({ data: [{ user_id: 'u-1', full_name: 'Name One' }], error: null });
    resolveSecond?.({ data: [{ user_id: 'u-2', full_name: 'Name Two' }], error: null });

    await expect(first).resolves.toEqual(new Map([['u-1', 'Name One']]));
    await expect(second).resolves.toEqual(new Map([['u-2', 'Name Two']]));
  });
});
